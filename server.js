import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import { formatInTimeZone } from 'date-fns-tz';
import { addDays, isWeekend, parseISO, isBefore, isAfter, addMinutes } from 'date-fns';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tcqfhdevbmizeenqreoc.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { transport: WebSocket } });
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');

function isValidEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim());}
function normalizeEmail(e){return String(e||'').trim().toLowerCase();}
function formatName(n){if(!n)return '';return String(n).trim().replace(/\w\S*/g,w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase());}

function processSpintax(text){
  if(!text)return text;
  // Step 1: protect all {{variables}} by replacing with placeholders
  const placeholders={};
  let idx=0;
  let protected_text=text.replace(/\{\{[^}]*\}\}/g,(match)=>{
    const key=`__VAR_${idx++}__`;
    placeholders[key]=match;
    return key;
  });
  // Step 2: process spintax {option1|option2} on protected text
  let limit=20;
  while(limit-->0){
    const match=protected_text.match(/\{([^{}]*\|[^{}]*)\}/);
    if(!match)break;
    const choices=match[1].split('|');
    protected_text=protected_text.replace(match[0],choices[Math.floor(Math.random()*choices.length)].trim());
  }
  // Step 3: restore all {{variables}}
  Object.entries(placeholders).forEach(([key,val])=>{
    protected_text=protected_text.replace(key,val);
  });
  return protected_text;
}

function applyVariables(template,contact,customFields){
  if(!template)return '';
  const data={first_name:'',last_name:'',company:'',city:'',phone:'',business_url:'',timezone:'',...(customFields||{}),...contact};
  // Match {{key}} or {{key | "fallback"}} or {{key | fallback}}
  return template.replace(/\{\{(\w+)\s*(?:\|\s*"?([^"}\n]*)"?)?\}\}/g,(match,key,fallback)=>{
    let value=data[key]||data[key?.toLowerCase()]||'';
    if(key==='first_name'||key==='last_name')value=formatName(String(value||''));
    if(value&&String(value).trim())return String(value).trim();
    // Use explicit fallback if provided (even if empty string)
    if(fallback!==undefined)return fallback.trim();
    // No fallback provided — use smart defaults
    const defaults={first_name:'there',company:'your company',city:'your area'};
    return defaults[key]||'';
  });
}

function detectAutoReply(s,b){return[/out of office/i,/auto.?reply/i,/automatic reply/i,/away from/i,/on vacation/i,/will be back/i,/currently unavailable/i].some(p=>p.test(`${s||''} ${b||''}`));}
function detectUnsubscribe(b){return[/unsubscribe/i,/remove me/i,/opt out/i,/opt-out/i,/stop emailing/i,/stop contacting/i].some(p=>p.test(b||''));}
function detectBounce(s,b){return[/delivery.*failed/i,/undeliverable/i,/does not exist/i,/no such user/i,/invalid.*address/i,/user.*unknown/i,/550/i].some(p=>p.test(`${s||''} ${b||''}`));}

async function getSettings(){
  const{data,error}=await supabase.from('settings').select('*').limit(1);
  if(error){console.error('[Settings] Failed to load:',error.message);return{};}
  if(!data||!data[0]){console.warn('[Settings] No settings row found — please save settings in the app');return{};}
  return data[0];
}
async function getInboxes(){const{data}=await supabase.from('inboxes').select('*').eq('active',true).order('created_at');return data||[];}
async function getDailyCount(inbox){const today=new Date();today.setHours(0,0,0,0);const{count}=await supabase.from('sequence_sends').select('*',{count:'exact',head:true}).eq('inbox',inbox).gte('sent_at',today.toISOString());return count||0;}
async function getTotalDailyCount(){const today=new Date();today.setHours(0,0,0,0);const{count}=await supabase.from('sequence_sends').select('*',{count:'exact',head:true}).gte('sent_at',today.toISOString());return count||0;}
async function getNewLeadsTodayCount(campaignId){const today=new Date();today.setHours(0,0,0,0);const{count}=await supabase.from('sequence_sends').select('*',{count:'exact',head:true}).eq('campaign_id',campaignId).eq('step_number',1).gte('sent_at',today.toISOString());return count||0;}
async function isBlacklisted(email){const{data}=await supabase.from('blacklist').select('id').eq('email',normalizeEmail(email)).limit(1);return data&&data.length>0;}
async function addToBlacklist(email,reason){await supabase.from('blacklist').upsert({email:normalizeEmail(email),reason,created_at:new Date().toISOString()},{onConflict:'email'});await supabase.from('contacts').update({status:'blacklisted',next_send_at:null}).eq('email',normalizeEmail(email));}

function getScheduledTime(baseDate,delayDays,hourStart,hourEnd,skipWeekends){
  let d=new Date(baseDate);let added=0;
  while(added<delayDays){d=addDays(d,1);if(!skipWeekends||!isWeekend(d))added++;}
  let hs=parseInt(hourStart)||9;let he=parseInt(hourEnd)||17;
  if(hs>=he){hs=9;he=17;}// safety: invalid window falls back to 9-17
  const startMin=hs*60;const endMin=he*60;
  const randomMin=Math.floor(Math.random()*(endMin-startMin))+startMin;
  d.setHours(Math.floor(randomMin/60),randomMin%60,Math.floor(Math.random()*60),0);
  return d;
}

// TRACKING
app.get('/track/open',async(req,res)=>{const{email,subject,inbox,campaign}=req.query;await supabase.from('email_events').insert({type:'open',recipient:email,subject:decodeURIComponent(subject||''),inbox,campaign,created_at:new Date().toISOString()});res.set('Content-Type','image/gif');res.set('Cache-Control','no-store');res.send(PIXEL);});
app.get('/track/click',async(req,res)=>{const{email,subject,inbox,campaign,url}=req.query;await supabase.from('email_events').insert({type:'click',recipient:email,subject:decodeURIComponent(subject||''),inbox,campaign,clicked_url:url,created_at:new Date().toISOString()});res.redirect(decodeURIComponent(url));});
app.post('/track/reply',async(req,res)=>{const{sender_email,sender_name,recipient_inbox,subject,latest_reply,date}=req.body;await supabase.from('email_events').insert({type:'reply',recipient:sender_email,sender_name,inbox:recipient_inbox,subject,reply_body:latest_reply,created_at:date||new Date().toISOString()});const email=normalizeEmail(sender_email||'');if(email){if(detectUnsubscribe(latest_reply)){await addToBlacklist(email,'unsubscribed');}else if(!detectAutoReply(subject,latest_reply)){await supabase.from('contacts').update({status:'replied',finished_at:new Date().toISOString(),next_send_at:null}).eq('email',email);}}res.json({ok:true});});
app.post('/track/send',async(req,res)=>{const{email,subject,inbox,campaign}=req.body;await supabase.from('email_events').insert({type:'send',recipient:email,subject,inbox,campaign,created_at:new Date().toISOString()});res.json({ok:true});});

// CSV PARSE (for mapping wizard)
app.post('/api/csv/parse',async(req,res)=>{
  const{csv}=req.body;if(!csv)return res.status(400).json({error:'No CSV'});
  try{
    const records=parse(csv,{columns:true,skip_empty_lines:true,trim:true,bom:true,to:6});
    if(!records.length)return res.status(400).json({error:'CSV is empty'});
    const headers=Object.keys(records[0]);
    const preview=records.slice(0,5);
    const ALIASES={email:['email','email_address','e-mail','e_mail','mail'],first_name:['first_name','firstname','first','fname','given_name'],last_name:['last_name','lastname','last','lname','surname'],company:['company','company_name','companyname','business','organization','org'],city:['city','location','town'],phone:['phone','phone_number','phonenumber','mobile','cell','telephone'],timezone:['timezone','time_zone','tz','contact_timezone'],business_url:['business_url','website','url','web','domain','company_url']};
    const suggestions={};
    headers.forEach(h=>{
      const lower=h.toLowerCase().replace(/\s+/g,'_');
      for(const[field,aliases]of Object.entries(ALIASES)){if(aliases.includes(lower)||aliases.includes(h.toLowerCase())){suggestions[h]=field;break;}}
      if(!suggestions[h])suggestions[h]='custom';
    });
    res.json({headers,preview,suggestions});
  }catch(e){res.status(400).json({error:'Invalid CSV: '+e.message});}
});

// CONTACTS IMPORT with mapping
app.post('/api/campaigns/:id/contacts/import',async(req,res)=>{
  const{csv,mapping}=req.body;if(!csv)return res.status(400).json({error:'No CSV'});
  let records;try{records=parse(csv,{columns:true,skip_empty_lines:true,trim:true,bom:true});}catch(e){return res.status(400).json({error:'Invalid CSV: '+e.message});}
  const results={imported:0,skipped:0,invalid:0,duplicates:0,blacklisted:0,cross_campaign_dupes:0,errors:[]};
  const campaignId=req.params.id;const seen=new Set();
  for(const record of records){
    const contact={};const customFields={};
    if(mapping){
      for(const[csvCol,sysField]of Object.entries(mapping)){
        const val=record[csvCol];if(sysField==='skip'||val===undefined||val===null)continue;
        if(sysField==='custom'){const varName=csvCol.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');customFields[varName]=val;}
        else{contact[sysField]=val;}
      }
    }else{Object.entries(record).forEach(([k,v])=>{contact[k.toLowerCase().replace(/\s+/g,'_')]=v;});}
    const email=normalizeEmail(contact.email||'');
    if(!email||!isValidEmail(email)){results.invalid++;continue;}
    if(seen.has(email)){results.duplicates++;continue;}
    seen.add(email);
    if(await isBlacklisted(email)){results.blacklisted++;results.skipped++;continue;}
    const{data:existing}=await supabase.from('contacts').select('id,campaign_id').eq('email',email).limit(1);
    if(existing&&existing.length>0){if(existing[0].campaign_id===campaignId){results.duplicates++;continue;}else{results.cross_campaign_dupes++;}}
    const{error}=await supabase.from('contacts').upsert({campaign_id:campaignId,email,first_name:formatName(contact.first_name||''),last_name:formatName(contact.last_name||''),company:contact.company||'',city:contact.city||'',phone:contact.phone||'',business_url:contact.business_url||'',timezone:contact.timezone||'',custom_fields:customFields,status:'active',current_step:0,enrolled_at:new Date().toISOString()},{onConflict:'campaign_id,email'});
    if(error){results.errors.push(`${email}: ${error.message}`);}else{results.imported++;}
  }
  res.json(results);
});

// CAMPAIGNS CRUD
app.get('/api/campaigns',async(req,res)=>{const{data,error}=await supabase.from('campaigns').select('*, campaign_steps(*), contacts(count)').order('created_at',{ascending:false});if(error)return res.status(500).json({error:error.message});res.json(data);});
app.get('/api/campaigns/:id',async(req,res)=>{const{data,error}=await supabase.from('campaigns').select('*, campaign_steps(*)').eq('id',req.params.id).single();if(error)return res.status(404).json({error:'Not found'});res.json(data);});

app.post('/api/campaigns',async(req,res)=>{
  const{name,steps,daily_cap,per_inbox_cap,max_new_leads_per_day,send_hour_start,send_hour_end,skip_weekends,timezone,start_date,end_date,stop_on_auto_reply,random_delay_max}=req.body;
  const settings=await getSettings();
  const{data:campaign,error}=await supabase.from('campaigns').insert({name,status:'draft',daily_cap:daily_cap||settings.daily_cap||500,per_inbox_cap:per_inbox_cap||settings.per_inbox_cap||100,max_new_leads_per_day:max_new_leads_per_day||0,send_hour_start:send_hour_start||settings.send_hour_start||9,send_hour_end:send_hour_end||settings.send_hour_end||17,skip_weekends:skip_weekends!==undefined?skip_weekends:true,timezone:timezone||settings.timezone||'America/New_York',start_date:start_date||null,end_date:end_date||null,stop_on_auto_reply:stop_on_auto_reply||false,random_delay_max:random_delay_max||30,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}).select().single();
  if(error)return res.status(500).json({error:error.message});
  if(steps?.length){await supabase.from('campaign_steps').insert(steps.map((s,i)=>({campaign_id:campaign.id,step_number:i+1,subject:s.subject,body:s.body,delay_days:s.delay_days||2,send_hour_start:s.send_hour_start||null,send_hour_end:s.send_hour_end||null})));}
  res.json(campaign);
});

app.put('/api/campaigns/:id',async(req,res)=>{
  const{name,steps,status,daily_cap,per_inbox_cap,max_new_leads_per_day,send_hour_start,send_hour_end,skip_weekends,timezone,start_date,end_date,stop_on_auto_reply,random_delay_max}=req.body;
  const{data:campaign,error}=await supabase.from('campaigns').update({name,status,daily_cap,per_inbox_cap,max_new_leads_per_day,send_hour_start,send_hour_end,skip_weekends,timezone,start_date,end_date,stop_on_auto_reply,random_delay_max,updated_at:new Date().toISOString()}).eq('id',req.params.id).select().single();
  if(error)return res.status(500).json({error:error.message});
  if(steps){await supabase.from('campaign_steps').delete().eq('campaign_id',req.params.id);await supabase.from('campaign_steps').insert(steps.map((s,i)=>({campaign_id:req.params.id,step_number:i+1,subject:s.subject,body:s.body,delay_days:s.delay_days||2,send_hour_start:s.send_hour_start||null,send_hour_end:s.send_hour_end||null})));}
  res.json(campaign);
});

app.delete('/api/campaigns/:id',async(req,res)=>{await supabase.from('contacts').delete().eq('campaign_id',req.params.id);await supabase.from('campaign_steps').delete().eq('campaign_id',req.params.id);await supabase.from('campaigns').delete().eq('id',req.params.id);res.json({ok:true});});
app.post('/api/campaigns/:id/pause',async(req,res)=>{await supabase.from('campaigns').update({status:'paused',updated_at:new Date().toISOString()}).eq('id',req.params.id);res.json({ok:true});});
app.post('/api/campaigns/:id/resume',async(req,res)=>{await supabase.from('campaigns').update({status:'active',updated_at:new Date().toISOString()}).eq('id',req.params.id);res.json({ok:true});});

app.post('/api/campaigns/:id/launch',async(req,res)=>{
  const{data:campaign}=await supabase.from('campaigns').select('*, campaign_steps(*)').eq('id',req.params.id).single();
  if(!campaign)return res.status(404).json({error:'Campaign not found'});
  if(!campaign.campaign_steps?.length)return res.status(400).json({error:'No email steps configured'});
  const{data:contacts}=await supabase.from('contacts').select('*').eq('campaign_id',req.params.id).eq('status','active').eq('current_step',0);
  if(!contacts?.length)return res.status(400).json({error:'No contacts — import contacts first'});
  const inboxes=await getInboxes();
  if(!inboxes.length)return res.status(400).json({error:'No active inboxes configured'});
  const now=new Date();const steps=campaign.campaign_steps.sort((a,b)=>a.step_number-b.step_number);const firstStep=steps[0];
  for(let i=0;i<contacts.length;i++){
    const inbox=inboxes[i%inboxes.length];const contact=contacts[i];
    const hourStart=firstStep.send_hour_start||campaign.send_hour_start||9;
    const hourEnd=firstStep.send_hour_end||campaign.send_hour_end||17;
    let sendTime=getScheduledTime(now,0,hourStart,hourEnd,campaign.skip_weekends);
    // If calculated time is in the past, send in next scheduler tick (5 mins) not tomorrow
    if(isBefore(sendTime,now))sendTime=addMinutes(now,5);
    const randomDelay=Math.floor(Math.random()*(campaign.random_delay_max||30));
    sendTime=addMinutes(sendTime,randomDelay);
    await supabase.from('contacts').update({assigned_inbox:inbox.email,current_step:1,next_send_at:sendTime.toISOString(),status:'active'}).eq('id',contact.id);
  }
  await supabase.from('campaigns').update({status:'active',updated_at:new Date().toISOString()}).eq('id',req.params.id);
  res.json({ok:true,scheduled:contacts.length});
});

// CAMPAIGN ANALYTICS
app.get('/api/campaigns/:id/analytics',async(req,res)=>{
  const cid=req.params.id;
  // Get campaign name first since email_events stores name not id
  const{data:camp}=await supabase.from('campaigns').select('name').eq('id',cid).single();
  const campName=camp?.name||cid;
  const{data:events}=await supabase.from('email_events').select('type,created_at,inbox').or(`campaign.eq.${campName},campaign.eq.${cid}`);
  const ev=events||[];
  const sends=ev.filter(e=>e.type==='send').length,opens=ev.filter(e=>e.type==='open').length,clicks=ev.filter(e=>e.type==='click').length,replies=ev.filter(e=>e.type==='reply').length;
  const{data:sbs}=await supabase.from('sequence_sends').select('step_number').eq('campaign_id',cid);
  const stepBreakdown={};(sbs||[]).forEach(s=>{stepBreakdown[s.step_number]=(stepBreakdown[s.step_number]||0)+1;});
  const{data:cs}=await supabase.from('contacts').select('status').eq('campaign_id',cid);
  const statusBreakdown={};(cs||[]).forEach(c=>{statusBreakdown[c.status]=(statusBreakdown[c.status]||0)+1;});
  res.json({totals:{sends,opens,clicks,replies},rates:{open_rate:sends>0?((opens/sends)*100).toFixed(1):'0.0',click_rate:sends>0?((clicks/sends)*100).toFixed(1):'0.0',reply_rate:sends>0?((replies/sends)*100).toFixed(1):'0.0'},step_breakdown:stepBreakdown,status_breakdown:statusBreakdown});
});

// CONTACTS
app.get('/api/campaigns/:id/contacts',async(req,res)=>{
  const page=parseInt(req.query.page||'1'),pageSize=50,offset=(page-1)*pageSize;
  let q=supabase.from('contacts').select('*',{count:'exact'}).eq('campaign_id',req.params.id).order('enrolled_at',{ascending:false}).range(offset,offset+pageSize-1);
  if(req.query.status&&req.query.status!=='all')q=q.eq('status',req.query.status);
  if(req.query.search)q=q.or(`email.ilike.%${req.query.search}%,first_name.ilike.%${req.query.search}%,company.ilike.%${req.query.search}%`);
  const{data,count,error}=await q;if(error)return res.status(500).json({error:error.message});
  res.json({contacts:data||[],total:count||0,page,pageSize});
});

app.get('/api/contacts',async(req,res)=>{
  const page=parseInt(req.query.page||'1'),pageSize=50,offset=(page-1)*pageSize;
  let q=supabase.from('contacts').select('*',{count:'exact'}).order('enrolled_at',{ascending:false}).range(offset,offset+pageSize-1);
  if(req.query.status&&req.query.status!=='all')q=q.eq('status',req.query.status);
  if(req.query.campaign_id)q=q.eq('campaign_id',req.query.campaign_id);
  if(req.query.search)q=q.or(`email.ilike.%${req.query.search}%,first_name.ilike.%${req.query.search}%,company.ilike.%${req.query.search}%`);
  const{data,count,error}=await q;if(error)return res.status(500).json({error:error.message});
  res.json({contacts:data||[],total:count||0,page,pageSize});
});

app.put('/api/contacts/:id/status',async(req,res)=>{
  const{status,lead_label}=req.body;const update={};
  if(status)update.status=status;if(lead_label!==undefined)update.lead_label=lead_label;
  const{data,error}=await supabase.from('contacts').update(update).eq('id',req.params.id).select().single();
  if(error)return res.status(500).json({error:error.message});res.json(data);
});

app.delete('/api/campaigns/:cid/contacts/:id',async(req,res)=>{await supabase.from('contacts').update({status:'removed',next_send_at:null}).eq('id',req.params.id);res.json({ok:true});});
app.post('/api/contacts/:id/blacklist',async(req,res)=>{const{data:c}=await supabase.from('contacts').select('email').eq('id',req.params.id).single();if(c)await addToBlacklist(c.email,req.body.reason||'manual');res.json({ok:true});});

app.post('/api/campaigns/:id/contacts/bulk',async(req,res)=>{
  const{action,contact_ids}=req.body;if(!contact_ids?.length)return res.status(400).json({error:'No contacts selected'});
  if(action==='remove'){await supabase.from('contacts').update({status:'removed',next_send_at:null}).in('id',contact_ids);}
  else if(action==='blacklist'){const{data:cs}=await supabase.from('contacts').select('email').in('id',contact_ids);for(const c of cs||[])await addToBlacklist(c.email,'bulk_blacklist');}
  else if(action==='pause'){await supabase.from('contacts').update({status:'paused',next_send_at:null}).in('id',contact_ids);}
  else return res.status(400).json({error:'Unknown action'});
  res.json({ok:true,affected:contact_ids.length});
});

app.get('/api/campaigns/:id/contacts/export',async(req,res)=>{
  let q=supabase.from('contacts').select('*').eq('campaign_id',req.params.id).order('enrolled_at',{ascending:false});
  if(req.query.status&&req.query.status!=='all')q=q.eq('status',req.query.status);
  const{data}=await q;if(!data?.length)return res.status(404).json({error:'No contacts'});
  const headers=['email','first_name','last_name','company','city','phone','business_url','timezone','status','lead_label','current_step','enrolled_at','next_send_at','assigned_inbox'];
  // lead_label may not exist in older schemas — handle gracefully
  const rows=data.map(c=>headers.map(h=>`"${String(c[h]||'').replace(/"/g,'""')}"`).join(','));
  res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition',`attachment; filename="contacts.csv"`);
  res.send([headers.join(','),...rows].join('\n'));
});

// PREVIEW
app.post('/api/preview',async(req,res)=>{
  const{subject,body,contact}=req.body;
  const c=contact||{first_name:'John',last_name:'Smith',company:'Acme Corp',city:'Lagos',phone:'080-1234-5678',business_url:'acmecorp.com',timezone:'Africa/Lagos'};
  const missingVars=[];const varRegex=/\{\{(\w+)\s*(?:\|[^}]*)?\}\}/g;let match;
  while((match=varRegex.exec(body||''))!==null){
    const key=match[1];
    const hasFallback=/\|\s*"?[^"}\n]+"?/.test(match[0]);
    if(!c[key]&&!c[key?.toLowerCase()]&&!hasFallback)missingVars.push(key);
  }
  res.json({subject:applyVariables(processSpintax(subject||''),c),body:applyVariables(processSpintax(body||''),c),missingVars:[...new Set(missingVars)]});
});

// BLACKLIST
app.get('/api/blacklist',async(req,res)=>{const page=parseInt(req.query.page||'1'),pageSize=50,offset=(page-1)*pageSize;const{data,count}=await supabase.from('blacklist').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(offset,offset+pageSize-1);res.json({items:data||[],total:count||0});});
app.post('/api/blacklist',async(req,res)=>{const{email,reason}=req.body;if(!email||!isValidEmail(email))return res.status(400).json({error:'Invalid email'});await addToBlacklist(email,reason||'manual');res.json({ok:true});});
app.post('/api/blacklist/import',async(req,res)=>{const{csv}=req.body;let records;try{records=parse(csv,{columns:true,skip_empty_lines:true,trim:true});}catch(e){return res.status(400).json({error:'Invalid CSV'});}let added=0;for(const r of records){const email=normalizeEmail(r.email||r.Email||'');if(isValidEmail(email)){await addToBlacklist(email,'bulk_import');added++;}}res.json({added});});
app.delete('/api/blacklist/:id',async(req,res)=>{await supabase.from('blacklist').delete().eq('id',req.params.id);res.json({ok:true});});

// INBOXES
app.get('/api/inboxes',async(req,res)=>{const{data}=await supabase.from('inboxes').select('*').order('created_at');res.json(data||[]);});
app.post('/api/inboxes',async(req,res)=>{const{email,label,daily_cap}=req.body;if(!email||!isValidEmail(email))return res.status(400).json({error:'Invalid email'});const{data,error}=await supabase.from('inboxes').upsert({email:normalizeEmail(email),label,daily_cap:daily_cap||100,active:true},{onConflict:'email'}).select().single();if(error)return res.status(500).json({error:error.message});res.json(data);});
app.put('/api/inboxes/:id',async(req,res)=>{const{label,active,daily_cap}=req.body;const{data,error}=await supabase.from('inboxes').update({label,active,daily_cap}).eq('id',req.params.id).select().single();if(error)return res.status(500).json({error:error.message});res.json(data);});
app.delete('/api/inboxes/:id',async(req,res)=>{await supabase.from('inboxes').delete().eq('id',req.params.id);res.json({ok:true});});

// SETTINGS
app.get('/api/settings',async(req,res)=>{res.json(await getSettings());});
app.put('/api/settings',async(req,res)=>{const existing=await getSettings();let result;if(existing.id){const{data}=await supabase.from('settings').update({...req.body,updated_at:new Date().toISOString()}).eq('id',existing.id).select().single();result=data;}else{const{data}=await supabase.from('settings').insert(req.body).select().single();result=data;}res.json(result);});

// GLOBAL ANALYTICS
app.get('/api/analytics',async(req,res)=>{
  const{campaign_id,date}=req.query;let fromDate=null;const now=new Date();
  if(date==='today')fromDate=new Date(now.getFullYear(),now.getMonth(),now.getDate()).toISOString();
  else if(date==='week')fromDate=new Date(now.getTime()-7*86400000).toISOString();
  else if(date==='month')fromDate=new Date(now.getTime()-30*86400000).toISOString();
  let q=supabase.from('email_events').select('type,inbox,campaign,created_at');
  if(fromDate)q=q.gte('created_at',fromDate);if(campaign_id)q=q.eq('campaign',campaign_id);
  const{data:events}=await q;const ev=events||[];
  const sends=ev.filter(e=>e.type==='send').length,opens=ev.filter(e=>e.type==='open').length,clicks=ev.filter(e=>e.type==='click').length,replies=ev.filter(e=>e.type==='reply').length;
  const dailyMap={};ev.forEach(e=>{const day=e.created_at?.split('T')[0];if(!day)return;if(!dailyMap[day])dailyMap[day]={date:day,sends:0,opens:0,clicks:0,replies:0};const typeKey={send:'sends',open:'opens',click:'clicks',reply:'replies'}[e.type]||e.type;
    dailyMap[day][typeKey]=( dailyMap[day][typeKey]||0)+1;});
  const inboxMap={};ev.forEach(e=>{if(!e.inbox)return;if(!inboxMap[e.inbox])inboxMap[e.inbox]={inbox:e.inbox,sends:0,opens:0,replies:0};if(e.type==='send')inboxMap[e.inbox].sends++;if(e.type==='open')inboxMap[e.inbox].opens++;if(e.type==='reply')inboxMap[e.inbox].replies++;});
  res.json({totals:{sends,opens,clicks,replies,total:ev.length},rates:{open_rate:sends>0?((opens/sends)*100).toFixed(1):'0.0',click_rate:sends>0?((clicks/sends)*100).toFixed(1):'0.0',reply_rate:sends>0?((replies/sends)*100).toFixed(1):'0.0'},daily:Object.values(dailyMap).sort((a,b)=>a.date.localeCompare(b.date)).slice(-30),inboxes:Object.values(inboxMap)});
});

// REPLY RECEIVED WEBHOOK
app.post('/api/reply-received',async(req,res)=>{
  const{sender_email,subject,body,is_auto_reply}=req.body;const email=normalizeEmail(sender_email||'');if(!email)return res.json({ok:true});
  const autoReply=is_auto_reply||detectAutoReply(subject,body);const unsub=detectUnsubscribe(body);const bounce=detectBounce(subject,body);
  if(bounce){await addToBlacklist(email,'bounce');}
  else if(unsub){await addToBlacklist(email,'unsubscribed');}
  else if(!autoReply){await supabase.from('contacts').update({status:'replied',finished_at:new Date().toISOString(),next_send_at:null}).eq('email',email);}
  if(autoReply&&!unsub&&!bounce){const{data:contact}=await supabase.from('contacts').select('id,campaign_id').eq('email',email).single();if(contact){const{data:camp}=await supabase.from('campaigns').select('stop_on_auto_reply').eq('id',contact.campaign_id).single();if(camp?.stop_on_auto_reply)await supabase.from('contacts').update({status:'auto_replied',next_send_at:null}).eq('email',email);}}
  res.json({ok:true});
});

// SCHEDULER
async function runScheduler(){
  console.log(`[Scheduler] ${new Date().toISOString()}`);
  const settings=await getSettings();if(!settings.webhook_url)return;
  const totalToday=await getTotalDailyCount();const dailyCap=settings.daily_cap||500;
  if(totalToday>=dailyCap)return console.log(`[Scheduler] Daily cap reached ${totalToday}/${dailyCap}`);
  const now=new Date();
  const{data:dueSends}=await supabase.from('contacts').select('*, campaigns!inner(*, campaign_steps(*))').eq('status','active').lte('next_send_at',now.toISOString()).not('next_send_at','is',null).gt('current_step',0).order('next_send_at',{ascending:true}).limit(dailyCap-totalToday);
  if(!dueSends?.length)return;
  const inboxes=await getInboxes();const inboxCounts={};
  for(const contact of dueSends){
    if((inboxCounts._total||0)>=(dailyCap-totalToday))break;
    const campaign=contact.campaigns;if(!campaign||campaign.status!=='active')continue;
    // Parse date-only strings as local noon to avoid timezone day-shift issues
    if(campaign.start_date){const sd=new Date(campaign.start_date+'T12:00:00');if(isBefore(now,sd))continue;}
    if(campaign.end_date){const ed=new Date(campaign.end_date+'T23:59:59');if(isAfter(now,ed)){await supabase.from('campaigns').update({status:'completed'}).eq('id',campaign.id);continue;}}
    const inbox=contact.assigned_inbox;if(!inbox)continue;
    inboxCounts[inbox]=inboxCounts[inbox]!==undefined?inboxCounts[inbox]:await getDailyCount(inbox);
    if(inboxCounts[inbox]>=(campaign.per_inbox_cap||100))continue;
    if(contact.current_step===1&&campaign.max_new_leads_per_day>0){const nlt=await getNewLeadsTodayCount(campaign.id);if(nlt>=campaign.max_new_leads_per_day)continue;}
    if(await isBlacklisted(contact.email)){await supabase.from('contacts').update({status:'blacklisted',next_send_at:null}).eq('id',contact.id);continue;}
    const{data:replyCheck}=await supabase.from('email_events').select('id').eq('recipient',contact.email).eq('type','reply').limit(1);
    if(replyCheck?.length){await supabase.from('contacts').update({status:'replied',finished_at:new Date().toISOString(),next_send_at:null}).eq('id',contact.id);continue;}
    const steps=(campaign.campaign_steps||[]).sort((a,b)=>a.step_number-b.step_number);
    const stepIndex=steps.findIndex(s=>s.step_number===contact.current_step);const step=steps[stepIndex];
    if(!step){await supabase.from('contacts').update({status:'completed',finished_at:new Date().toISOString(),next_send_at:null}).eq('id',contact.id);continue;}
    const customFields=contact.custom_fields||{};
    const subject=applyVariables(processSpintax(step.subject),contact,customFields);
    const body=applyVariables(processSpintax(step.body),contact,customFields);
    try{
      await axios.post(settings.webhook_url,{to:contact.email,subject,body,inbox,campaign_id:campaign.id,campaign_name:campaign.name,contact_id:contact.id,step:contact.current_step,first_name:contact.first_name,last_name:contact.last_name,company:contact.company},{timeout:10000});
      await supabase.from('email_events').insert({type:'send',recipient:contact.email,subject,inbox,campaign:campaign.name,created_at:new Date().toISOString()});
      await supabase.from('sequence_sends').insert({campaign_id:campaign.id,contact_id:contact.id,email:contact.email,inbox,step_number:contact.current_step,subject,sent_at:new Date().toISOString(),status:'sent'});
      const nextStep=steps[stepIndex+1];
      if(nextStep){
        const shs=nextStep.send_hour_start||campaign.send_hour_start||9;const she=nextStep.send_hour_end||campaign.send_hour_end||17;
        let nextSend=getScheduledTime(now,nextStep.delay_days,shs,she,campaign.skip_weekends);
        nextSend=addMinutes(nextSend,Math.floor(Math.random()*(campaign.random_delay_max||30)));
        await supabase.from('contacts').update({current_step:nextStep.step_number,next_send_at:nextSend.toISOString()}).eq('id',contact.id);
      }else{await supabase.from('contacts').update({status:'completed',finished_at:new Date().toISOString(),next_send_at:null}).eq('id',contact.id);}
      inboxCounts[inbox]=(inboxCounts[inbox]||0)+1;inboxCounts._total=(inboxCounts._total||0)+1;
    }catch(err){console.error(`[Scheduler] Failed ${contact.email}:`,err.message);}
  }
}

cron.schedule('*/5 * * * *', runScheduler);

// ── CONTACT CHECK ENDPOINT (for n8n reply verification) ─────────────────────
app.get('/api/contacts/check',async(req,res)=>{
  const email=req.query.email?.trim().toLowerCase();
  if(!email)return res.status(400).json({found:false,error:'email param required'});
  const{data,error}=await supabase
    .from('contacts')
    .select('id,email,first_name,last_name,company,city,phone,status,current_step,campaign_id,assigned_inbox,enrolled_at')
    .eq('email',email)
    .limit(1);
  if(error||!data||data.length===0)return res.json({found:false});
  const contact=data[0];
  // Get campaign name
  const{data:camp}=await supabase.from('campaigns').select('name,status').eq('id',contact.campaign_id).single();
  res.json({
    found:true,
    contact:{
      id:contact.id,
      email:contact.email,
      first_name:contact.first_name,
      last_name:contact.last_name,
      company:contact.company,
      city:contact.city,
      phone:contact.phone,
      status:contact.status,
      current_step:contact.current_step,
      assigned_inbox:contact.assigned_inbox,
      enrolled_at:contact.enrolled_at,
      campaign_name:camp?.name||'Unknown',
      campaign_status:camp?.status||'unknown'
    }
  });
});

app.use(express.static(path.join(__dirname,'dist')));
app.get('*',(req,res)=>{if(req.path.startsWith('/api')||req.path.startsWith('/track'))return res.status(404).json({error:'Not found'});res.sendFile(path.join(__dirname,'dist/index.html'));});

const PORT=process.env.PORT||3001;
app.listen(PORT,()=>console.log(`BotCipher Mail running on port ${PORT}`));
