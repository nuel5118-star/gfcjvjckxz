import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { addDays, isWeekend, isBefore, isAfter, addMinutes } from 'date-fns';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tcqfhdevbmizeenqreoc.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { transport: WebSocket } });
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');

// Base URL for tracking pixel and click redirect URLs embedded into emails
// Set APP_URL in Railway environment variables — must be your public Railway domain
const APP_URL = (process.env.APP_URL || 'https://gfcjvjckxz-production.up.railway.app').replace(/\/$/,'');

// SSE: connected browser clients that receive real-time log pushes
const sseClients = new Set();

function broadcastLog(entry){
  if(sseClients.size===0)return;
  const payload=`data: ${JSON.stringify(entry)}\n\n`;
  for(const client of sseClients){
    try{ client.write(payload); }
    catch(e){ sseClients.delete(client); }
  }
}

const SCHEDULER_BATCH_SIZE = 1000;

function isValidEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim());}
function normalizeEmail(e){return String(e||'').trim().toLowerCase();}
function formatName(n){if(!n)return '';return String(n).trim().replace(/\w\S*/g,w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase());}
function generateRunId(){return `run_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;}

function processSpintax(text){
  if(!text)return text;
  const placeholders={};let idx=0;
  let protected_text=text.replace(/\{\{[^}]*\}\}/g,(match)=>{const key=`__VAR_${idx++}__`;placeholders[key]=match;return key;});
  let limit=20;
  while(limit-->0){const match=protected_text.match(/\{([^{}]*\|[^{}]*)\}/);if(!match)break;const choices=match[1].split('|');protected_text=protected_text.replace(match[0],choices[Math.floor(Math.random()*choices.length)].trim());}
  Object.entries(placeholders).forEach(([key,val])=>{protected_text=protected_text.replace(key,val);});
  return protected_text;
}

function applyVariables(template,contact,customFields){
  if(!template)return '';
  const data={first_name:'',last_name:'',company:'',city:'',phone:'',business_url:'',timezone:'',...(customFields||{}),...contact};
  return template.replace(/\{\{(\w+)\s*(?:\|\s*"?([^"}\n]*)?"?)?\}\}/g,(match,key,fallback)=>{
    let value=data[key]||data[key?.toLowerCase()]||'';
    if(key==='first_name'||key==='last_name')value=formatName(String(value||''));
    if(value&&String(value).trim())return String(value).trim();
    if(fallback!==undefined)return fallback.trim();
    const defaults={first_name:'there',company:'your company',city:'your area'};
    return defaults[key]||'';
  });
}

// FIX: detectAutoReply expanded, detectBounce fixed (was matching "550" anywhere in body)
function detectAutoReply(s,b){return[/out of office/i,/auto.?reply/i,/automatic reply/i,/away from/i,/on vacation/i,/will be back/i,/currently unavailable/i,/i am (currently )?away/i,/on (annual )?leave/i].some(p=>p.test(`${s||''} ${b||''}`));}
function detectUnsubscribe(b){return[/unsubscribe/i,/remove me/i,/opt out/i,/opt-out/i,/stop emailing/i,/stop contacting/i,/take me off/i,/do not (email|contact)/i].some(p=>p.test(b||''));}
function detectBounce(s,b){
  const subjectHit=[/delivery.*failed/i,/undeliverable/i,/mail.*delivery.*failure/i,/returned mail/i,/\b55[0-9]\b/].some(p=>p.test(s||''));
  const bodyHit=[/does not exist/i,/no such user/i,/invalid.*address/i,/user.*unknown/i,/account.*disabled/i,/mailbox.*full/i,/address.*rejected/i].some(p=>p.test(b||''));
  return subjectHit||bodyHit;
}

async function getSettings(){
  const{data,error}=await supabase.from('settings').select('*').limit(1);
  if(error){console.error('[Settings] Failed to load:',error.message);return{};}
  if(!data||!data[0]){console.warn('[Settings] No settings row found');return{};}
  return data[0];
}
async function getInboxes(){const{data}=await supabase.from('inboxes').select('*').eq('active',true).order('created_at');return data||[];}
// BUG7 FIX: all daily count functions previously used server local midnight (new Date(); setHours(0,0,0,0))
// which is wrong when the server runs in UTC but campaigns are in America/New_York etc.
// Now we compute the start of "today" in the given timezone (defaults to settings timezone via caller).
function getTodayStartUTC(timezone='UTC'){
  // Get the current date string in the target timezone, then convert midnight back to UTC
  const nowStr=formatInTimeZone(new Date(),timezone,'yyyy-MM-dd');
  return fromZonedTime(`${nowStr}T00:00:00`,timezone);
}
async function getDailyCount(inbox,timezone='UTC'){const todayUTC=getTodayStartUTC(timezone);const{count}=await supabase.from('sequence_sends').select('*',{count:'exact',head:true}).eq('inbox',inbox).gte('sent_at',todayUTC.toISOString()).eq('status','sent');return count||0;}
async function getTotalDailyCount(timezone='UTC'){const todayUTC=getTodayStartUTC(timezone);const{count}=await supabase.from('sequence_sends').select('*',{count:'exact',head:true}).gte('sent_at',todayUTC.toISOString()).eq('status','sent');return count||0;}
async function getNewLeadsTodayCount(campaignId,timezone='UTC'){const todayUTC=getTodayStartUTC(timezone);const{count}=await supabase.from('sequence_sends').select('*',{count:'exact',head:true}).eq('campaign_id',campaignId).eq('step_number',1).gte('sent_at',todayUTC.toISOString());return count||0;}
async function isBlacklisted(email){const{data}=await supabase.from('blacklist').select('id').eq('email',normalizeEmail(email)).limit(1);return data&&data.length>0;}

// fetchAll: paginates through ALL rows of any Supabase query, bypassing the 1000-row default cap.
// Usage: const rows = await fetchAll(() => supabase.from('table').select('col').eq('x', y));
async function fetchAll(buildQuery) {
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE - 1);
    if (error) { console.error('[fetchAll] Query error:', error.message); break; }
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function logSchedulerActivity(type,message,details={},runId=null){
  const entry={id:`live_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,type,message,details,run_id:runId,created_at:new Date().toISOString()};
  console.log(`[${type.toUpperCase()}]`,message,Object.keys(details).length?JSON.stringify(details):'');
  broadcastLog(entry);
  try{
    const{error}=await supabase.from('scheduler_logs').insert({type,message,details,run_id:runId,created_at:entry.created_at});
    if(error)console.error('[Log] DB write failed:',error.message,'— Run db-migration.sql');
  }catch(e){console.error('[Log] DB exception:',e.message);}
}

async function addToBlacklist(email,reason){
  await supabase.from('blacklist').upsert({email:normalizeEmail(email),reason,created_at:new Date().toISOString()},{onConflict:'email'});
  await supabase.from('contacts').update({status:'blacklisted',next_send_at:null}).eq('email',normalizeEmail(email));
}

function getScheduledTime(baseDate,delayDays,hourStart,hourEnd,skipWeekends,timezone='UTC'){
  let d=new Date(baseDate);let added=0;
  while(added<delayDays){d=addDays(d,1);if(!skipWeekends||!isWeekend(d))added++;}
  // BUG14 FIX: when delayDays=0 the while loop never runs, so `d` stays on baseDate even
  // if baseDate is a Saturday or Sunday. This caused emails to fire on weekends when skip_weekends=true.
  if(skipWeekends&&isWeekend(d)){
    while(isWeekend(d)){d=addDays(d,1);}
  }
  let hs=parseInt(hourStart)||9;let he=parseInt(hourEnd)||17;
  if(hs>=he){hs=9;he=17;}
  const startMin=hs*60;const endMin=he*60;
  const randomMin=Math.floor(Math.random()*(endMin-startMin))+startMin;
  const hours=Math.floor(randomMin/60);const minutes=randomMin%60;const secs=Math.floor(Math.random()*60);
  const dateStr=formatInTimeZone(d,timezone,'yyyy-MM-dd');
  const timeStr=`${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  return fromZonedTime(`${dateStr}T${timeStr}`,timezone);
}

// Injects tracking pixel + wraps all links with click tracking directly into email body
// Called by the scheduler BEFORE sending to n8n — so n8n gets a fully built email
// and doesn't need to do any HTML manipulation at all
function injectTracking(body, params){
  const{email,inbox,campaign_id,campaign_name,contact_id,step,send_id,subject}=params;
  const base=APP_URL;

  // If body is plain text (no HTML tags), convert newlines to <br> so
  // email clients respect the line breaks the user typed in the campaign builder.
  // Double newlines (blank lines / paragraph breaks) become a visible gap.
  const isPlainText=!/<[a-z][\s\S]*>/i.test(body);
  if(isPlainText){
    body=body
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/\n\n+/g,'<br><br>')// blank line = visible paragraph gap
      .replace(/\n/g,'<br>');// single enter = line break
  }

  // Build pixel URL with all enriched params
  const pixelQ=new URLSearchParams({
    email,inbox,
    campaign_id:campaign_id||'',
    campaign:campaign_name||'',
    contact_id:contact_id||'',
    step:String(step||1),
    send_id:send_id||'',
    subject:subject||''
  }).toString();
  const pixel=`<img src="${base}/track/open?${pixelQ}" width="1" height="1" style="display:none;border:0;outline:none;" alt="" />`;

  // Wrap every <a href="..."> link with click tracking redirect
  // Skips mailto:, tel:, and links already pointing to our own domain
  let tracked=body.replace(/<a(\s[^>]*?)href=["']([^"'#][^"']*)["']([^>]*?)>/gi,(match,before,url,after)=>{
    if(url.startsWith('mailto:')||url.startsWith('tel:')||url.includes(base)){
      return match;
    }
    const clickQ=new URLSearchParams({
      url,email,inbox,
      campaign_id:campaign_id||'',
      campaign:campaign_name||'',
      contact_id:contact_id||'',
      step:String(step||1),
      send_id:send_id||'',
      subject:subject||''
    }).toString();
    return `<a${before}href="${base}/track/click?${clickQ}"${after}>`;
  });

  // Append pixel — before </body> if it exists, otherwise at the very end
  if(tracked.toLowerCase().includes('</body>')){
    tracked=tracked.replace(/<\/body>/i,`${pixel}</body>`);
  }else{
    tracked=tracked+pixel;
  }
  return tracked;
}

// TRACKING
app.get('/track/open',async(req,res)=>{
  const{email,inbox,campaign_id,campaign,contact_id,step,send_id,subject}=req.query;
  const ua=req.headers['user-agent']||'';
  // Bot detection — common email security scanners and prefetch crawlers
  const BOT_PATTERNS=/GoogleImageProxy|Googlebot|YahooMailProxy|Baiduspider|bingbot|AhrefsBot|SemrushBot|DotBot|msnbot|Outlook-iOS|Microsoft.*scanning|MailScanner|SpamAssassin|Proofpoint|Barracuda|Mimecast|Symantec|CheckPoint|FortiMail|Sophos|cipher\.co|preview|prefetch|crawler|spider|bot\b/i;
  const is_bot=BOT_PATTERNS.test(ua);
  await supabase.from('email_events').insert({
    type:'open',
    recipient:email||null,
    inbox:inbox||null,
    // FIX: removed decodeURIComponent() — Express already decodes query params once.
    // Double-decoding corrupts subjects containing % characters.
    subject:subject||'',
    campaign:campaign||null,
    campaign_id:campaign_id||null,
    contact_id:contact_id||null,
    step_number:step?parseInt(step):null,
    send_id:send_id||null,
    is_bot:is_bot,
    user_agent:ua.slice(0,300),
    created_at:new Date().toISOString()
  });
  res.set('Content-Type','image/gif');
  res.set('Cache-Control','no-store, no-cache, must-revalidate');
  res.set('Pragma','no-cache');
  res.send(PIXEL);
});

// ── CALCULATOR TRACKING ───────────────────────────────────────────────────────
// When a contact clicks the calculator link in an email, this logs the click
// and redirects them to the actual calculator page.
app.get('/track/calculator',async(req,res)=>{
  const{email,contact_id,campaign_id,inbox,step,send_id}=req.query;
  const CALCULATOR_URL='https://botcipher.github.io/Revenue-calculator/';
  try{
    await supabase.from('email_events').insert({
      type:'click',
      recipient:email||null,
      contact_id:contact_id||null,
      campaign_id:campaign_id||null,
      inbox:inbox||null,
      step_number:step?parseInt(step):null,
      send_id:send_id||null,
      clicked_url:CALCULATOR_URL,
      subject:'Calculator Link',
      created_at:new Date().toISOString()
    });
  }catch(e){console.error('[track/calculator]',e.message);}
  // Always redirect regardless of whether logging succeeded
  res.redirect(CALCULATOR_URL);
});

app.get('/track/click',async(req,res)=>{
  const{url,email,inbox,campaign_id,campaign,contact_id,step,send_id,subject}=req.query;
  if(!url)return res.status(400).send('Missing url');
  const ua=req.headers['user-agent']||'';
  await supabase.from('email_events').insert({
    type:'click',
    recipient:email||null,
    inbox:inbox||null,
    // FIX: subject and campaign name were missing from click events entirely
    subject:subject||'',
    campaign:campaign||null,
    campaign_id:campaign_id||null,
    contact_id:contact_id||null,
    step_number:step?parseInt(step):null,
    send_id:send_id||null,
    clicked_url:url,
    user_agent:ua.slice(0,300),
    created_at:new Date().toISOString()
  });
  res.redirect(url);
});

// FIX: /track/reply now handles bounces + stores auto-replies as 'auto_reply' type (not 'reply')
// Previously auto-replies were stored as 'reply' which caused the scheduler to stop sequences
// even when stop_on_auto_reply=false
app.post('/track/reply',async(req,res)=>{
  const{sender_email,sender_name,recipient_inbox,subject,latest_reply,date}=req.body;
  const email=normalizeEmail(sender_email||'');
  if(!email)return res.json({ok:true});
  const autoReply=detectAutoReply(subject,latest_reply);
  const unsub=detectUnsubscribe(latest_reply);
  const bounce=detectBounce(subject,latest_reply);
  const{data:contactRow}=await supabase.from('contacts').select('id,campaign_id,campaigns!inner(name,stop_on_auto_reply)').eq('email',email).limit(1).single();
  const campaignName=contactRow?.campaigns?.name||null;
  const campaignId=contactRow?.campaign_id||null;
  const contactId=contactRow?.id||null;
  const eventType=bounce?'bounce':unsub?'unsubscribe':autoReply?'auto_reply':'reply';

  // FIX: include campaign_id and contact_id so analytics can filter correctly
  await supabase.from('email_events').insert({
    type:eventType,
    recipient:sender_email,
    sender_name,
    inbox:recipient_inbox,
    subject,
    reply_body:latest_reply,
    campaign:campaignName,
    campaign_id:campaignId,
    contact_id:contactId,
    created_at:date||new Date().toISOString()
  });

  if(bounce){
    await addToBlacklist(email,'bounce');
    // FIX: was missing contact status update — bounced contacts stayed active and kept getting scheduled
    await supabase.from('contacts').update({status:'bounced',next_send_at:null,finished_at:new Date().toISOString()}).eq('email',email);
    await logSchedulerActivity('warn',`Bounce detected for ${email} — blacklisted and stopped`,{email,subject});
  }else if(unsub){
    await addToBlacklist(email,'unsubscribed');
    await supabase.from('contacts').update({status:'removed',next_send_at:null,finished_at:new Date().toISOString()}).eq('email',email);
    await logSchedulerActivity('info',`Unsubscribe from ${email} — blacklisted and stopped`,{email});
  }else if(autoReply){
    if(contactRow?.campaigns?.stop_on_auto_reply){
      await supabase.from('contacts').update({status:'auto_replied',next_send_at:null}).eq('email',email);
      await logSchedulerActivity('info',`Auto-reply from ${email} — sequence paused`,{email,campaign:campaignName});
    }else{
      await logSchedulerActivity('info',`Auto-reply from ${email} — sequence continues (stop_on_auto_reply=false)`,{email});
    }
  }else{
    await supabase.from('contacts').update({status:'replied',finished_at:new Date().toISOString(),next_send_at:null}).eq('email',email);
    await logSchedulerActivity('info',`Reply from ${email} — sequence stopped`,{email,campaign:campaignName});
  }
  res.json({ok:true,detected:{bounce,unsub,autoReply,eventType}});
});

app.post('/track/send',async(req,res)=>{const{email,subject,inbox,campaign}=req.body;await supabase.from('email_events').insert({type:'send',recipient:email,subject,inbox,campaign,created_at:new Date().toISOString()});res.json({ok:true});});

// CSV PARSE
app.post('/api/csv/parse',async(req,res)=>{
  const{csv}=req.body;if(!csv)return res.status(400).json({error:'No CSV'});
  try{
    const records=parse(csv,{columns:true,skip_empty_lines:true,trim:true,bom:true,to:6});
    if(!records.length)return res.status(400).json({error:'CSV is empty'});
    const headers=Object.keys(records[0]);const preview=records.slice(0,5);
    const ALIASES={email:['email','email_address','e-mail','e_mail','mail'],first_name:['first_name','firstname','first','fname','given_name'],last_name:['last_name','lastname','last','lname','surname'],company:['company','company_name','companyname','business','organization','org'],city:['city','location','town'],phone:['phone','phone_number','phonenumber','mobile','cell','telephone'],timezone:['timezone','time_zone','tz','contact_timezone'],business_url:['business_url','website','url','web','domain','company_url']};
    const suggestions={};
    headers.forEach(h=>{const lower=h.toLowerCase().replace(/\s+/g,'_');for(const[field,aliases]of Object.entries(ALIASES)){if(aliases.includes(lower)||aliases.includes(h.toLowerCase())){suggestions[h]=field;break;}}if(!suggestions[h])suggestions[h]='custom';});
    res.json({headers,preview,suggestions});
  }catch(e){res.status(400).json({error:'Invalid CSV: '+e.message});}
});

// CONTACTS IMPORT
app.post('/api/campaigns/:id/contacts/import',async(req,res)=>{
  const{csv,mapping}=req.body;if(!csv)return res.status(400).json({error:'No CSV'});
  let records;try{records=parse(csv,{columns:true,skip_empty_lines:true,trim:true,bom:true});}catch(e){return res.status(400).json({error:'Invalid CSV: '+e.message});}
  const results={imported:0,skipped:0,invalid:0,duplicates:0,blacklisted:0,cross_campaign_dupes:0,errors:[]};
  const campaignId=req.params.id;const seen=new Set();
  for(const record of records){
    const contact={};const customFields={};
    if(mapping){for(const[csvCol,sysField]of Object.entries(mapping)){const val=record[csvCol];if(sysField==='skip'||val===undefined||val===null)continue;if(sysField==='custom'){const varName=csvCol.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');customFields[varName]=val;}else{contact[sysField]=val;}}}
    else{Object.entries(record).forEach(([k,v])=>{contact[k.toLowerCase().replace(/\s+/g,'_')]=v;});}
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

// FIX: PUT now correctly reschedules queued contacts when send hours change.
// Three bugs fixed vs the original:
//   1. select('*') only — campaign_steps from DB were stale (delete/reinsert hadn't run yet)
//   2. use `steps` from req.body for rescheduling, not campaign.campaign_steps (which had old hours)
//   3. parseInt() on both sides of send_hour comparison — prevents false triggers from type mismatch
app.put('/api/campaigns/:id',async(req,res)=>{
  const{name,steps,status,daily_cap,per_inbox_cap,max_new_leads_per_day,send_hour_start,send_hour_end,skip_weekends,timezone,start_date,end_date,stop_on_auto_reply,random_delay_max}=req.body;

  // Fetch old campaign for comparison — we still need campaign_steps here so we can
  // detect per-step hour changes (stepHoursChanged check below)
  const{data:oldCampaign}=await supabase.from('campaigns').select('send_hour_start,send_hour_end,timezone,skip_weekends,campaign_steps(*)').eq('id',req.params.id).single();

  // FIX 1: select('*') only on the update — we don't need campaign_steps from DB.
  // The delete/reinsert below runs after this query, so fetching steps here always
  // returned the OLD values. We use `steps` from req.body instead (see FIX 2).
  const{data:campaign,error}=await supabase.from('campaigns').update({name,status,daily_cap,per_inbox_cap,max_new_leads_per_day,send_hour_start,send_hour_end,skip_weekends,timezone,start_date,end_date,stop_on_auto_reply,random_delay_max,updated_at:new Date().toISOString()}).eq('id',req.params.id).select('*').single();
  if(error)return res.status(500).json({error:error.message});

  if(steps){
    await supabase.from('campaign_steps').delete().eq('campaign_id',req.params.id);
    await supabase.from('campaign_steps').insert(steps.map((s,i)=>({campaign_id:req.params.id,step_number:i+1,subject:s.subject,body:s.body,delay_days:s.delay_days||2,send_hour_start:s.send_hour_start||null,send_hour_end:s.send_hour_end||null})));
  }

  // FIX 3: parseInt() on both sides — without this, `9 !== "9"` is true (type coercion),
  // which caused a false reschedule trigger on every single save even with no hour change.
  const sendWindowChanged=(
    (send_hour_start!==undefined && parseInt(send_hour_start)!==parseInt(oldCampaign?.send_hour_start))||
    (send_hour_end!==undefined   && parseInt(send_hour_end)  !==parseInt(oldCampaign?.send_hour_end))  ||
    (timezone!==undefined        && timezone!==oldCampaign?.timezone)                                  ||
    (skip_weekends!==undefined   && skip_weekends!==oldCampaign?.skip_weekends)
  );

  const stepHoursChanged=steps&&oldCampaign?.campaign_steps&&steps.some((s,i)=>{
    const old=oldCampaign.campaign_steps.find(o=>o.step_number===i+1);
    return old&&(s.send_hour_start!==old.send_hour_start||s.send_hour_end!==old.send_hour_end);
  });

  let rescheduled=0;
  if(sendWindowChanged||stepHoursChanged){
    const now=new Date();
    const tz=timezone||campaign.timezone||'America/New_York';
    const sw=skip_weekends!==undefined?skip_weekends:campaign.skip_weekends;

    // FIX 2: use `steps` from req.body — these are the NEW hours the user just saved.
    // The original code used campaign.campaign_steps which always had the OLD values
    // because the delete/reinsert above hadn't been reflected in the earlier DB query.
    const newSteps=steps||[];

    const{data:contacts}=await supabase
      .from('contacts')
      .select('id,current_step,next_send_at')
      .eq('campaign_id',req.params.id)
      .eq('status','active')
      .gt('current_step',0)
      .gt('next_send_at',now.toISOString());

    for(const contact of contacts||[]){
      // Per-step hours take priority over campaign-level hours.
      // newSteps is 0-indexed array; contact.current_step is 1-based step number.
      const stepDef=newSteps[contact.current_step-1];
      const hs=stepDef?.send_hour_start||send_hour_start||9;
      const he=stepDef?.send_hour_end  ||send_hour_end  ||17;

      let newSendTime=getScheduledTime(new Date(contact.next_send_at),0,hs,he,sw,tz);
      // If recalculated time is in the past (e.g. window moved to earlier today and that
      // window has already passed), push to the next business day.
      if(newSendTime<=now) newSendTime=getScheduledTime(now,1,hs,he,sw,tz);

      await supabase.from('contacts').update({next_send_at:newSendTime.toISOString()}).eq('id',contact.id);
      rescheduled++;
    }
  }

  res.json({...campaign,rescheduled_contacts:rescheduled,send_window_updated:!!(sendWindowChanged||stepHoursChanged)});
});

app.delete('/api/campaigns/:id',async(req,res)=>{await supabase.from('contacts').delete().eq('campaign_id',req.params.id);await supabase.from('campaign_steps').delete().eq('campaign_id',req.params.id);await supabase.from('campaigns').delete().eq('id',req.params.id);res.json({ok:true});});
app.post('/api/campaigns/:id/pause',async(req,res)=>{
  await supabase.from('campaigns').update({status:'paused',updated_at:new Date().toISOString()}).eq('id',req.params.id);
  // Null out next_send_at so contacts don't pile up as overdue while paused
  await supabase.from('contacts').update({status:'paused',next_send_at:null}).eq('campaign_id',req.params.id).eq('status','active');
  res.json({ok:true});
});

app.post('/api/campaigns/:id/resume',async(req,res)=>{
  const{data:camp}=await supabase.from('campaigns').select('id,send_hour_start,send_hour_end,skip_weekends,timezone,random_delay_max,campaign_steps(*)').eq('id',req.params.id).single();
  if(!camp)return res.status(404).json({error:'Campaign not found'});
  await supabase.from('campaigns').update({status:'active',updated_at:new Date().toISOString()}).eq('id',req.params.id);
  // Reschedule paused contacts into the next valid send window
  const now=new Date();
  const steps=(camp.campaign_steps||[]).sort((a,b)=>a.step_number-b.step_number);
  const{data:pausedContacts}=await supabase.from('contacts').select('id,current_step').eq('campaign_id',req.params.id).eq('status','paused');
  for(const c of pausedContacts||[]){
    const stepDef=steps.find(s=>s.step_number===c.current_step);
    const hs=stepDef?.send_hour_start||camp.send_hour_start||9;
    const he=stepDef?.send_hour_end||camp.send_hour_end||17;
    const tz=camp.timezone||'America/New_York';
    const sw=camp.skip_weekends!==undefined?camp.skip_weekends:true;
    let nextSend=getScheduledTime(now,0,hs,he,sw,tz);
    if(isBefore(nextSend,now))nextSend=getScheduledTime(now,1,hs,he,sw,tz);
    nextSend=addMinutes(nextSend,Math.floor(Math.random()*(camp.random_delay_max||30)));
    await supabase.from('contacts').update({status:'active',next_send_at:nextSend.toISOString()}).eq('id',c.id);
  }
  res.json({ok:true,rescheduled:pausedContacts?.length||0});
});

app.post('/api/campaigns/:id/launch',async(req,res)=>{
  const{data:campaign}=await supabase.from('campaigns').select('*, campaign_steps(*)').eq('id',req.params.id).single();
  if(!campaign)return res.status(404).json({error:'Campaign not found'});
  if(!campaign.campaign_steps?.length)return res.status(400).json({error:'No email steps configured'});
  const contacts=await fetchAll(()=>supabase.from('contacts').select('*').eq('campaign_id',req.params.id).eq('status','active').eq('current_step',0));
  if(!contacts?.length)return res.status(400).json({error:'No contacts — import contacts first'});
  const inboxes=await getInboxes();
  if(!inboxes.length)return res.status(400).json({error:'No active inboxes configured'});
  const now=new Date();const steps=campaign.campaign_steps.sort((a,b)=>a.step_number-b.step_number);const firstStep=steps[0];
  const tz=campaign.timezone||'America/New_York';
  // BUG2 FIX: previously all contacts got scheduled for today (delay_days=0), causing all to fire at once.
  // Now we spread them: if max_new_leads_per_day is set, we only schedule that many per day and push
  // the rest to subsequent days. This prevents blasting all contacts in one scheduler run.
  const maxPerDay=campaign.max_new_leads_per_day>0?campaign.max_new_leads_per_day:contacts.length;
  let dayOffset=0;let countOnCurrentDay=0;
  for(let i=0;i<contacts.length;i++){
    if(countOnCurrentDay>=maxPerDay){dayOffset++;countOnCurrentDay=0;}
    const inbox=inboxes[i%inboxes.length];const contact=contacts[i];
    const hourStart=firstStep.send_hour_start||campaign.send_hour_start||9;const hourEnd=firstStep.send_hour_end||campaign.send_hour_end||17;
    // BUG14 FIX: getScheduledTime with delayDays=0 on a weekend doesn't advance to Monday.
    // We now always pass at least dayOffset; if dayOffset=0 and today is weekend+skipWeekends,
    // we force dayOffset=1 so it lands on Monday.
    let effectiveOffset=dayOffset;
    if(effectiveOffset===0&&campaign.skip_weekends&&isWeekend(now))effectiveOffset=1;
    let sendTime=getScheduledTime(now,effectiveOffset,hourStart,hourEnd,campaign.skip_weekends,tz);
    // Safety: if computed time is still in the past (e.g. window already closed today), push to next day
    if(isBefore(sendTime,now))sendTime=getScheduledTime(now,effectiveOffset+1,hourStart,hourEnd,campaign.skip_weekends,tz);
    const randomDelay=Math.floor(Math.random()*(campaign.random_delay_max||30));
    sendTime=addMinutes(sendTime,randomDelay);
    await supabase.from('contacts').update({assigned_inbox:inbox.email,current_step:1,next_send_at:sendTime.toISOString(),status:'active'}).eq('id',contact.id);
    countOnCurrentDay++;
  }
  await supabase.from('campaigns').update({status:'active',updated_at:new Date().toISOString()}).eq('id',req.params.id);
  res.json({ok:true,scheduled:contacts.length});
});

app.post('/api/campaigns/:id/send-now',async(req,res)=>{
  const{data:campaign}=await supabase.from('campaigns').select('id,name,status').eq('id',req.params.id).single();
  if(!campaign)return res.status(404).json({error:'Campaign not found'});
  const sendAt=new Date(Date.now()+30000).toISOString();
  const{data,error}=await supabase.from('contacts').update({next_send_at:sendAt}).eq('campaign_id',req.params.id).eq('status','active').gt('current_step',0).not('next_send_at','is',null).select('id');
  if(error)return res.status(500).json({error:error.message});
  const count=data?.length||0;
  await logSchedulerActivity('info',`Force-send triggered for campaign "${campaign.name}"`,{campaign_id:req.params.id,contacts_rescheduled:count});
  res.json({ok:true,rescheduled:count,message:`${count} contacts rescheduled — click Run Now to send immediately`});
});

// ANALYTICS
app.get('/api/campaigns/:id/analytics',async(req,res)=>{
  const cid=req.params.id;
  const{data:camp}=await supabase.from('campaigns').select('name').eq('id',cid).single();
  // FIX: filter by campaign_id (UUID), not by campaign name. Previously used .or(`campaign.eq.${campName},campaign.eq.${cid}`)
  // which matched by name string — any campaign with a UUID-looking name would miss all its events.
  const events=await fetchAll(()=>supabase.from('email_events').select('type,created_at,inbox,recipient,subject,contact_id,send_id').eq('campaign_id',cid));
  const ev=events||[];
  const sends=ev.filter(e=>e.type==='send').length;
  const opens=ev.filter(e=>e.type==='open').length;
  const clicks=ev.filter(e=>e.type==='click').length;
  const replies=ev.filter(e=>e.type==='reply'||e.type==='replied').length;
  const bounces=ev.filter(e=>e.type==='bounce').length;
  const failed=ev.filter(e=>e.type==='send_failed').length;
  const sbs=await fetchAll(()=>supabase.from('sequence_sends').select('step_number').eq('campaign_id',cid));
  const stepBreakdown={};(sbs||[]).forEach(s=>{stepBreakdown[s.step_number]=(stepBreakdown[s.step_number]||0)+1;});
  const cs=await fetchAll(()=>supabase.from('contacts').select('status').eq('campaign_id',cid));
  const statusBreakdown={};(cs||[]).forEach(c=>{statusBreakdown[c.status]=(statusBreakdown[c.status]||0)+1;});
  res.json({
    totals:{sends,opens,clicks,replies,bounces,failed},
    rates:{
      open_rate:sends>0?((opens/sends)*100).toFixed(1):'0.0',
      click_rate:sends>0?((clicks/sends)*100).toFixed(1):'0.0',
      reply_rate:sends>0?((replies/sends)*100).toFixed(1):'0.0',
      bounce_rate:sends>0?((bounces/sends)*100).toFixed(1):'0.0'
    },
    step_breakdown:stepBreakdown,
    status_breakdown:statusBreakdown
  });
});

// CONTACTS
app.get('/api/campaigns/:id/contacts',async(req,res)=>{
  const page=parseInt(req.query.page||'1'),pageSize=parseInt(req.query.pageSize||'50'),offset=(page-1)*pageSize;
  let q=supabase.from('contacts').select('*',{count:'exact'}).eq('campaign_id',req.params.id).order('enrolled_at',{ascending:false}).range(offset,offset+pageSize-1);
  if(req.query.status&&req.query.status!=='all')q=q.eq('status',req.query.status);
  if(req.query.search)q=q.or(`email.ilike.%${req.query.search}%,first_name.ilike.%${req.query.search}%,company.ilike.%${req.query.search}%`);
  const{data,count,error}=await q;if(error)return res.status(500).json({error:error.message});
  res.json({contacts:data||[],total:count||0,page,pageSize});
});
app.get('/api/contacts',async(req,res)=>{
  const page=parseInt(req.query.page||'1'),pageSize=parseInt(req.query.pageSize||'50'),offset=(page-1)*pageSize;
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
  else if(action==='unpause'){
    // BUG10 FIX: was setting next_send_at = now+60s ignoring campaign send window entirely.
    // Fetch the contacts' campaigns and reschedule within the proper send window.
    const{data:cs}=await supabase.from('contacts').select('id,campaign_id,current_step,campaigns!inner(send_hour_start,send_hour_end,skip_weekends,timezone,random_delay_max,campaign_steps(*))').in('id',contact_ids);
    const now=new Date();
    for(const c of cs||[]){
      const camp=c.campaigns;
      const steps=(camp?.campaign_steps||[]).sort((a,b)=>a.step_number-b.step_number);
      const stepDef=steps.find(s=>s.step_number===c.current_step);
      const hs=stepDef?.send_hour_start||camp?.send_hour_start||9;
      const he=stepDef?.send_hour_end||camp?.send_hour_end||17;
      const tz=camp?.timezone||'America/New_York';
      const sw=camp?.skip_weekends!==undefined?camp.skip_weekends:true;
      let nextSend=getScheduledTime(now,0,hs,he,sw,tz);
      if(isBefore(nextSend,now))nextSend=getScheduledTime(now,1,hs,he,sw,tz);
      nextSend=addMinutes(nextSend,Math.floor(Math.random()*(camp?.random_delay_max||30)));
      await supabase.from('contacts').update({status:'active',next_send_at:nextSend.toISOString()}).eq('id',c.id);
    }
  }
  else return res.status(400).json({error:'Unknown action'});
  res.json({ok:true,affected:contact_ids.length});
});
app.get('/api/campaigns/:id/contacts/export',async(req,res)=>{
  const statusFilter=req.query.status&&req.query.status!=='all'?req.query.status:null;
  const data=await fetchAll(()=>{let q=supabase.from('contacts').select('*').eq('campaign_id',req.params.id).order('enrolled_at',{ascending:false});if(statusFilter)q=q.eq('status',statusFilter);return q;});
  if(!data?.length)return res.status(404).json({error:'No contacts'});
  const headers=['email','first_name','last_name','company','city','phone','business_url','timezone','status','lead_label','current_step','enrolled_at','next_send_at','assigned_inbox'];
  const rows=data.map(c=>headers.map(h=>`"${String(c[h]||'').replace(/"/g,'""')}"`).join(','));
  res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition',`attachment; filename="contacts.csv"`);
  res.send([headers.join(','),...rows].join('\n'));
});

// PREVIEW
app.post('/api/preview',async(req,res)=>{
  const{subject,body,contact}=req.body;
  const c=contact||{first_name:'John',last_name:'Smith',company:'Acme Corp',city:'Lagos',phone:'080-1234-5678',business_url:'acmecorp.com',timezone:'Africa/Lagos'};
  const missingVars=[];const varRegex=/\{\{(\w+)\s*(?:\|[^}]*)?\}\}/g;let match;
  while((match=varRegex.exec(body||''))!==null){const key=match[1];const hasFallback=/\|\s*"?[^"}\n]+"?/.test(match[0]);if(!c[key]&&!c[key?.toLowerCase()]&&!hasFallback)missingVars.push(key);}
  res.json({subject:applyVariables(processSpintax(subject||''),c),body:applyVariables(processSpintax(body||''),c),missingVars:[...new Set(missingVars)]});
});

// BLACKLIST
app.get('/api/blacklist',async(req,res)=>{const page=parseInt(req.query.page||'1'),pageSize=parseInt(req.query.pageSize||'50'),offset=(page-1)*pageSize;const{data,count}=await supabase.from('blacklist').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(offset,offset+pageSize-1);res.json({items:data||[],total:count||0,page,pageSize});});
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
  const defaultFrom=fromDate||new Date(Date.now()-90*86400000).toISOString();
  const campaignFilter=campaign_id||null;
  // FIX: filter by campaign_id (UUID) not by campaign (name string). Previously passing campaign_id
  // as the filter value against the `campaign` (name) column always returned 0 results.
  // Also selecting campaign_id and contact_id for the event log enrichment.
  const ev=await fetchAll(()=>{let q=supabase.from('email_events').select('type,inbox,campaign,campaign_id,contact_id,recipient,subject,is_bot,created_at').gte('created_at',defaultFrom);if(campaignFilter)q=q.eq('campaign_id',campaignFilter);return q;});

  const sends=ev.filter(e=>e.type==='send').length;
  const delivered=ev.filter(e=>e.type==='delivered').length;
  const allOpens=ev.filter(e=>e.type==='open').length;
  const botOpens=ev.filter(e=>e.type==='open'&&e.is_bot===true).length;
  const opens=allOpens-botOpens; // human opens only — bot opens shown separately
  const clicks=ev.filter(e=>e.type==='click').length;
  const replies=ev.filter(e=>e.type==='reply'||e.type==='replied').length;
  const bounces=ev.filter(e=>e.type==='bounce').length;
  const failed=ev.filter(e=>e.type==='send_failed').length;
  // Real delivered = confirmed delivered if available, otherwise sent minus known failures
  const realDelivered=delivered>0?delivered:Math.max(0,sends-failed);

  const dailyMap={};
  ev.forEach(e=>{
    const day=e.created_at?.split('T')[0];if(!day)return;
    if(!dailyMap[day])dailyMap[day]={date:day,sends:0,opens:0,bot_opens:0,clicks:0,replies:0,bounces:0,failed:0};
    if(e.type==='send')dailyMap[day].sends++;
    else if(e.type==='open'){if(e.is_bot)dailyMap[day].bot_opens++;else dailyMap[day].opens++;}
    else if(e.type==='click')dailyMap[day].clicks++;
    else if(e.type==='reply'||e.type==='replied')dailyMap[day].replies++;
    else if(e.type==='bounce')dailyMap[day].bounces++;
    else if(e.type==='send_failed')dailyMap[day].failed++;
  });

  // Inbox breakdown — include bounces
  const inboxMap={};
  ev.forEach(e=>{
    if(!e.inbox)return;
    if(!inboxMap[e.inbox])inboxMap[e.inbox]={inbox:e.inbox,sends:0,opens:0,replies:0,bounces:0};
    if(e.type==='send')inboxMap[e.inbox].sends++;
    if(e.type==='open')inboxMap[e.inbox].opens++;
    if(e.type==='reply'||e.type==='replied')inboxMap[e.inbox].replies++;
    if(e.type==='bounce')inboxMap[e.inbox].bounces++;
  });

  // Campaign breakdown — which campaigns actually sent emails (for UI dropdown verification)
  const campaignMap={};
  ev.filter(e=>e.type==='send'&&e.campaign_id).forEach(e=>{
    if(!campaignMap[e.campaign_id])campaignMap[e.campaign_id]={campaign_id:e.campaign_id,name:e.campaign||e.campaign_id,sends:0,opens:0,replies:0};
    campaignMap[e.campaign_id].sends++;
  });
  ev.filter(e=>e.type==='open'&&e.campaign_id).forEach(e=>{if(campaignMap[e.campaign_id])campaignMap[e.campaign_id].opens++;});
  ev.filter(e=>(e.type==='reply'||e.type==='replied')&&e.campaign_id).forEach(e=>{if(campaignMap[e.campaign_id])campaignMap[e.campaign_id].replies++;});

  res.json({
    totals:{sends,opens,bot_opens:botOpens,all_opens:allOpens,clicks,replies,bounces,failed,delivered:realDelivered,total:ev.length},
    rates:{
      open_rate:sends>0?((opens/sends)*100).toFixed(1):'0.0',
      click_rate:sends>0?((clicks/sends)*100).toFixed(1):'0.0',
      reply_rate:sends>0?((replies/sends)*100).toFixed(1):'0.0',
      bounce_rate:sends>0?((bounces/sends)*100).toFixed(1):'0.0'
    },
    daily:Object.values(dailyMap).sort((a,b)=>a.date.localeCompare(b.date)).slice(-30),
    inboxes:Object.values(inboxMap),
    campaigns:Object.values(campaignMap)
  });
});

// ── EMAIL BODY PREVIEW ───────────────────────────────────────────────────────
app.get('/api/email/body/:sendId',async(req,res)=>{
  const{data,error}=await supabase.from('sequence_sends')
    .select('body,subject,email,inbox,sent_at,step_number,campaign_id')
    .eq('id',req.params.sendId)
    .single();
  if(error||!data){
    console.error('[EmailBody] Not found:',req.params.sendId,error?.message);
    return res.status(404).json({error:'Email body not found. This send may have been recorded before body storage was enabled.'});
  }
  // Fetch campaign name separately — avoids FK join issues
  let campaignName='';
  if(data.campaign_id){
    const{data:camp}=await supabase.from('campaigns').select('name').eq('id',data.campaign_id).single();
    campaignName=camp?.name||'';
  }
  res.json({
    body:data.body||'',
    subject:data.subject||'',
    recipient:data.email||'',
    inbox:data.inbox||'',
    sent_at:data.sent_at||'',
    step_number:data.step_number||null,
    campaign_name:campaignName
  });
});
app.get('/api/analytics/events',async(req,res)=>{
  const{campaign_id,date,type,search,human_only}=req.query;
  const page=parseInt(req.query.page||'1');
  const pageSize=parseInt(req.query.pageSize||'50');
  const offset=(page-1)*pageSize;
  const now=new Date();
  let fromDate=null;
  if(date==='today')fromDate=new Date(now.getFullYear(),now.getMonth(),now.getDate()).toISOString();
  else if(date==='week')fromDate=new Date(now.getTime()-7*86400000).toISOString();
  else if(date==='month')fromDate=new Date(now.getTime()-30*86400000).toISOString();
  else fromDate=new Date(Date.now()-90*86400000).toISOString();

  let q=supabase.from('email_events')
    .select('id,type,recipient,subject,inbox,campaign,campaign_id,contact_id,step_number,send_id,is_bot,user_agent,clicked_url,created_at',{count:'exact'})
    .gte('created_at',fromDate)
    .order('created_at',{ascending:false})
    .range(offset,offset+pageSize-1);

  if(campaign_id)q=q.eq('campaign_id',campaign_id);
  if(type&&type!=='all')q=q.eq('type',type);
  // human_only: exclude bot opens (still shows them by default so you can see them labeled)
  if(human_only==='true')q=q.neq('is_bot',true);
  if(search&&search.trim())q=q.ilike('recipient',`%${search.trim()}%`);

  const{data:events,count,error}=await q;
  if(error)return res.status(500).json({error:error.message});

  // Enrich with contact first_name, last_name, company
  const contactIds=[...new Set((events||[]).map(e=>e.contact_id).filter(Boolean))];
  let contactNameMap={};
  if(contactIds.length>0){
    const{data:contacts}=await supabase.from('contacts').select('id,first_name,last_name,company').in('id',contactIds);
    (contacts||[]).forEach(c=>{
      contactNameMap[c.id]={
        first_name:c.first_name||'',
        last_name:c.last_name||'',
        company:c.company||''
      };
    });
  }

  const enriched=(events||[]).map(e=>{
    const c=e.contact_id?contactNameMap[e.contact_id]:null;
    return{
      ...e,
      contact_name:c?[c.first_name,c.last_name].filter(Boolean).join(' ')||null:null,
      contact_company:c?c.company||null:null
    };
  });

  // Summary counts for this filtered view
  const botOpens=enriched.filter(e=>e.type==='open'&&e.is_bot).length;
  const humanOpens=enriched.filter(e=>e.type==='open'&&!e.is_bot).length;

  res.json({events:enriched,total:count||0,page,pageSize,bot_opens:botOpens,human_opens:humanOpens});
});


app.post('/api/reply-received',async(req,res)=>{
  const{sender_email,subject,body,is_auto_reply,inbox}=req.body;
  const email=normalizeEmail(sender_email||'');if(!email)return res.json({ok:true});
  const autoReply=is_auto_reply||detectAutoReply(subject,body);
  const unsub=detectUnsubscribe(body);const bounce=detectBounce(subject,body);
  const{data:contactRow}=await supabase.from('contacts').select('id,campaign_id,campaigns!inner(name,stop_on_auto_reply)').eq('email',email).limit(1).single();
  const campaignName=contactRow?.campaigns?.name||null;
  const eventType=bounce?'bounce':unsub?'unsubscribe':autoReply?'auto_reply':'reply';
  await supabase.from('email_events').insert({type:eventType,recipient:sender_email,inbox,subject,reply_body:body,campaign:campaignName,created_at:new Date().toISOString()});
  if(bounce){
    await addToBlacklist(email,'bounce');
    await logSchedulerActivity('warn',`Bounce for ${email}`,{email,subject});
  }else if(unsub){
    await addToBlacklist(email,'unsubscribed');
    await logSchedulerActivity('info',`Unsubscribe from ${email}`,{email});
  }else if(autoReply){
    if(contactRow?.campaigns?.stop_on_auto_reply){
      await supabase.from('contacts').update({status:'auto_replied',next_send_at:null}).eq('email',email);
      await logSchedulerActivity('info',`Auto-reply from ${email} — paused`,{email,campaign:campaignName});
    }else{
      await logSchedulerActivity('info',`Auto-reply from ${email} — continues`,{email});
    }
  }else{
    await supabase.from('contacts').update({status:'replied',finished_at:new Date().toISOString(),next_send_at:null}).eq('email',email);
    await logSchedulerActivity('info',`Reply from ${email} — sequence stopped`,{email,campaign:campaignName});
  }
  res.json({ok:true,detected:{bounce,unsub,autoReply,eventType}});
});

// ── N8N DELIVERY CONFIRMATION ─────────────────────────────────────────────────
// n8n calls this after attempting to send each email.
// POST /api/email/delivery-report
// Body: { send_id, email, contact_id, campaign_id, inbox, step, status, reason, message_id }
// status: "delivered" | "bounced" | "failed" | "spam_complaint"
// Called by n8n after each individual email send attempt.
app.post('/api/email/delivery-report',async(req,res)=>{
  const{send_id,contact_id,email,campaign_id,inbox,step,status,reason,message_id}=req.body;
  if(!email||!status)return res.status(400).json({error:'email and status are required'});
  const cleanEmail=normalizeEmail(email);
  const validStatuses=['delivered','bounced','failed','spam_complaint'];
  if(!validStatuses.includes(status))return res.status(400).json({error:`status must be one of: ${validStatuses.join(', ')}`});

  // Find the sequence_send record — prefer by send_id (most precise), fall back to email+campaign+step
  let sendRecord=null;
  if(send_id){
    const{data}=await supabase.from('sequence_sends').select('id,status,subject,campaign_id,contact_id,inbox,step_number,email').eq('id',send_id).single();
    sendRecord=data;
  }else if(contact_id&&campaign_id&&step){
    const{data}=await supabase.from('sequence_sends').select('id,status,subject,campaign_id,contact_id,inbox,step_number,email').eq('contact_id',contact_id).eq('campaign_id',campaign_id).eq('step_number',step).order('sent_at',{ascending:false}).limit(1).single();
    sendRecord=data;
  }else{
    const{data}=await supabase.from('sequence_sends').select('id,status,subject,campaign_id,contact_id,inbox,step_number,email').eq('email',cleanEmail).order('sent_at',{ascending:false}).limit(1).single();
    sendRecord=data;
  }

  // Use data from the send record where available — more reliable than what n8n passes back
  const resolvedCampaignId=sendRecord?.campaign_id||campaign_id||null;
  const resolvedContactId=sendRecord?.contact_id||contact_id||null;
  const resolvedInbox=sendRecord?.inbox||inbox||null;
  const resolvedSubject=sendRecord?.subject||null;
  const resolvedStep=sendRecord?.step_number||step||null;

  await logSchedulerActivity(
    status==='delivered'?'send':status==='bounced'?'warn':'error',
    `Delivery report [${cleanEmail}]: ${status}${reason?` — ${reason}`:''}`,
    {email:cleanEmail,status,reason,message_id,inbox:resolvedInbox,step:resolvedStep,campaign_id:resolvedCampaignId}
  );

  if(sendRecord){
    const dbStatus=status==='delivered'?'sent':status==='bounced'?'bounced':status==='spam_complaint'?'spam':status;
    await supabase.from('sequence_sends').update({status:dbStatus,error_message:reason||null}).eq('id',sendRecord.id);
  }

  if(status==='delivered'){
    // FIX: was storing campaign_id in the `campaign` (name) column, and missing campaign_id, contact_id, subject
    await supabase.from('email_events').insert({
      type:'delivered',
      recipient:cleanEmail,
      inbox:resolvedInbox,
      subject:resolvedSubject,
      campaign_id:resolvedCampaignId,
      contact_id:resolvedContactId,
      step_number:resolvedStep,
      send_id:send_id||null,
      created_at:new Date().toISOString()
    });
    return res.json({ok:true,action:'logged_delivery',email:cleanEmail});
  }

  if(status==='bounced'){
    await addToBlacklist(cleanEmail,'bounce');
    await supabase.from('contacts').update({status:'bounced',next_send_at:null,finished_at:new Date().toISOString()}).eq('email',cleanEmail);
    await supabase.from('email_events').insert({
      type:'bounce',
      recipient:cleanEmail,
      inbox:resolvedInbox,
      subject:resolvedSubject,
      campaign_id:resolvedCampaignId,
      contact_id:resolvedContactId,
      step_number:resolvedStep,
      send_id:send_id||null,
      created_at:new Date().toISOString()
    });
    return res.json({ok:true,action:'blacklisted',email:cleanEmail,reason});
  }

  if(status==='spam_complaint'){
    await addToBlacklist(cleanEmail,'spam_complaint');
    await supabase.from('contacts').update({status:'blacklisted',next_send_at:null,finished_at:new Date().toISOString()}).eq('email',cleanEmail);
    await supabase.from('email_events').insert({
      type:'spam_complaint',
      recipient:cleanEmail,
      inbox:resolvedInbox,
      subject:resolvedSubject,
      campaign_id:resolvedCampaignId,
      contact_id:resolvedContactId,
      step_number:resolvedStep,
      send_id:send_id||null,
      created_at:new Date().toISOString()
    });
    return res.json({ok:true,action:'blacklisted_spam',email:cleanEmail});
  }

  if(status==='failed'){
    const reason_lower=(reason||'').toLowerCase();
    const isPermanent=(
      reason_lower.includes('no recipients')||
      reason_lower.includes('all recipients')||
      reason_lower.includes('recipient rejected')||
      reason_lower.includes('none were accepted')||
      reason_lower.includes('550')||
      reason_lower.includes('551')||
      reason_lower.includes('552')||
      reason_lower.includes('553')||
      reason_lower.includes('554')||
      reason_lower.includes('user unknown')||
      reason_lower.includes('does not exist')||
      reason_lower.includes('invalid address')||
      reason_lower.includes('invalid recipient')||
      reason_lower.includes('no such user')||
      reason_lower.includes('address rejected')||
      reason_lower.includes('domain not found')||
      reason_lower.includes('undeliverable')||
      reason_lower.includes('blacklisted')||
      reason_lower.includes('blocked')||
      reason_lower.includes('spam')||
      reason_lower.includes('undefined')
    );

    if(isPermanent){
      // Permanent failure — blacklist immediately, no second chance
      await addToBlacklist(cleanEmail,'permanent_failure');
      await supabase.from('contacts').update({
        status:'bounced',next_send_at:null,
        finished_at:new Date().toISOString(),fail_count:2
      }).eq('email',cleanEmail);
      await supabase.from('email_events').insert({
        type:'bounce',recipient:cleanEmail,inbox:resolvedInbox,
        subject:resolvedSubject,campaign_id:resolvedCampaignId,
        contact_id:resolvedContactId,step_number:resolvedStep,
        send_id:send_id||null,created_at:new Date().toISOString()
      });
      await logSchedulerActivity('warn',`Permanent failure for ${cleanEmail} — blacklisted`,{email:cleanEmail,reason});
      return res.json({ok:true,action:'blacklisted_permanent',email:cleanEmail,reason});
    }

    // Temporary failure — check fail_count
    // 1st failure → warning, reschedule tomorrow
    // 2nd failure → blacklist, stop permanently
    const{data:contactData}=await supabase.from('contacts')
      .select('id,fail_count,status')
      .eq('email',cleanEmail).single();

    const currentFailCount=(contactData?.fail_count||0)+1;

    if(currentFailCount>=2){
      // Second failure — blacklist now
      await addToBlacklist(cleanEmail,'two_failures');
      await supabase.from('contacts').update({
        status:'bounced',next_send_at:null,
        finished_at:new Date().toISOString(),fail_count:currentFailCount
      }).eq('email',cleanEmail);
      await supabase.from('email_events').insert({
        type:'bounce',recipient:cleanEmail,inbox:resolvedInbox,
        subject:resolvedSubject,campaign_id:resolvedCampaignId,
        contact_id:resolvedContactId,step_number:resolvedStep,
        send_id:send_id||null,created_at:new Date().toISOString()
      });
      await logSchedulerActivity('warn',`2nd failure for ${cleanEmail} — blacklisted`,{email:cleanEmail,reason});
      return res.json({ok:true,action:'blacklisted_second_failure',email:cleanEmail});
    }else{
      // First failure — reschedule to tomorrow, mark as warning
      if(resolvedContactId){
        const{data:camp}=await supabase.from('campaigns')
          .select('send_hour_start,send_hour_end,skip_weekends,timezone,random_delay_max,campaign_steps(*)')
          .eq('id',resolvedCampaignId).single();
        if(camp){
          const steps=(camp.campaign_steps||[]).sort((a,b)=>a.step_number-b.step_number);
          const stepDef=steps.find(s=>s.step_number===resolvedStep);
          const hs=stepDef?.send_hour_start?parseInt(stepDef.send_hour_start):(camp.send_hour_start||9);
          const he=stepDef?.send_hour_end?parseInt(stepDef.send_hour_end):(camp.send_hour_end||17);
          const now=new Date();
          let nextSend=getScheduledTime(now,1,hs,he,camp.skip_weekends,camp.timezone||'America/New_York');
          nextSend=addMinutes(nextSend,Math.floor(Math.random()*(camp.random_delay_max||30)));
          await supabase.from('contacts').update({
            next_send_at:nextSend.toISOString(),
            fail_count:currentFailCount
          }).eq('id',resolvedContactId).eq('status','active');
        }
      }
      await supabase.from('email_events').insert({
        type:'send_failed',recipient:cleanEmail,inbox:resolvedInbox,
        subject:resolvedSubject,campaign_id:resolvedCampaignId,
        contact_id:resolvedContactId,step_number:resolvedStep,
        send_id:send_id||null,created_at:new Date().toISOString()
      });
      await logSchedulerActivity('warn',`1st failure for ${cleanEmail} — rescheduled to tomorrow (1/2 strikes)`,{email:cleanEmail,reason});
      return res.json({ok:true,action:'rescheduled_first_failure',email:cleanEmail,strikes:`${currentFailCount}/2`});
    }
  }
});

// Bounce rate stats
app.get('/api/email/bounce-stats',async(req,res)=>{
  const{count:totalSent}=await supabase.from('sequence_sends').select('*',{count:'exact',head:true}).eq('status','sent');
  const{count:totalBounced}=await supabase.from('sequence_sends').select('*',{count:'exact',head:true}).eq('status','bounced');
  const{count:totalFailed}=await supabase.from('sequence_sends').select('*',{count:'exact',head:true}).eq('status','failed');
  const{count:spamComplaints}=await supabase.from('blacklist').select('*',{count:'exact',head:true}).eq('reason','spam_complaint');
  const{count:hardBounces}=await supabase.from('blacklist').select('*',{count:'exact',head:true}).eq('reason','bounce');
  const total=totalSent||0;
  res.json({total_sent:total,total_bounced:totalBounced||0,total_failed:totalFailed||0,hard_bounces:hardBounces||0,spam_complaints:spamComplaints||0,bounce_rate:total>0?(((totalBounced||0)/total)*100).toFixed(2)+'%':'0.00%',spam_rate:total>0?(((spamComplaints||0)/total)*100).toFixed(2)+'%':'0.00%',health:((totalBounced||0)/Math.max(total,1))<0.02?'healthy':((totalBounced||0)/Math.max(total,1))<0.05?'warning':'critical'});
});

// ── SCHEDULER ─────────────────────────────────────────────────────────────────

let lastSchedulerRun=null;
let schedulerRunning=false;
let lastRunResult=null;

async function runScheduler(manual=false){
  if(schedulerRunning){console.log('[Scheduler] Already running, skipping');return{skipped:true,reason:'already_running'};}
  schedulerRunning=true;lastSchedulerRun=new Date();
  const runId=generateRunId();
  const result={run_id:runId,sent:0,skipped:0,errors:0,skip_reasons:{},reason:null};
  await logSchedulerActivity('info',`Scheduler started (${manual?'manual':'cron'})`,{manual},runId);
  try{
    const settings=await getSettings();
    if(!settings.webhook_url){result.reason='no_webhook';await logSchedulerActivity('warn','No webhook URL configured — go to Settings to add one.',{},runId);return result;}
    const settingsTz=settings.timezone||'America/New_York';
    const totalToday=await getTotalDailyCount(settingsTz);
    const dailyCap=settings.daily_cap||500;
    if(totalToday>=dailyCap){result.reason='daily_cap_reached';await logSchedulerActivity('warn',`Daily cap reached: ${totalToday}/${dailyCap} sent today`,{sent:totalToday,cap:dailyCap},runId);return result;}

    const{data:activeCampaigns,error:campError}=await supabase.from('campaigns').select('id,name,status,timezone,send_hour_start,send_hour_end,skip_weekends,per_inbox_cap,max_new_leads_per_day,random_delay_max,start_date,end_date,campaign_steps(*)').eq('status','active');
    if(campError){result.reason='db_error';await logSchedulerActivity('error',`Failed to fetch active campaigns: ${campError.message}`,{},runId);return result;}
    if(!activeCampaigns?.length){result.reason='no_active_campaigns';await logSchedulerActivity('warn','No active campaigns found.',{},runId);return result;}

    const inboxes=await getInboxes();
    // Hard absolute cap per inbox — the number set in the Inboxes UI. NEVER exceeded.
    const inboxCapMap=Object.fromEntries(inboxes.map(i=>[i.email,i.daily_cap||100]));
    const inboxCounts={};

    // ── PRE-FETCH inbox sent counts from DB once ──────────────────────────────
    for(const inbox of inboxes){
      inboxCounts[inbox.email]=await getDailyCount(inbox.email,settingsTz);
    }

    // Sent counts per campaign per inbox THIS RUN (for fair-share enforcement)
    const campaignInboxSent={};// key: `${campaign_id}:${inbox}`

    // ── PRE-FETCH blacklist and replied sets ──────────────────────────────────
    const blacklistRows=await fetchAll(()=>supabase.from('blacklist').select('email'));
    const blacklistSet=new Set(blacklistRows.map(r=>normalizeEmail(r.email)));
    const repliedRows=await fetchAll(()=>supabase.from('email_events').select('recipient').in('type',['reply','replied']));
    const repliedContactRows=await fetchAll(()=>supabase.from('contacts').select('email').in('status',['replied','bounced','blacklisted','completed','removed']));
    const repliedSet=new Set([
      ...repliedRows.map(r=>normalizeEmail(r.recipient)),
      ...repliedContactRows.map(r=>normalizeEmail(r.email))
    ]);
    await logSchedulerActivity('info',`Pre-fetched ${blacklistSet.size} blacklisted, ${repliedSet.size} replied/finished`,{},runId);

    const numCampaigns=activeCampaigns.length;
    await logSchedulerActivity('info',
      `${numCampaigns} active campaign(s). Inbox caps: ${JSON.stringify(Object.fromEntries(inboxes.map(i=>[i.email,{cap:inboxCapMap[i.email],used:inboxCounts[i.email]||0,remaining:Math.max(0,(inboxCapMap[i.email]||100)-(inboxCounts[i.email]||0)),share_per_campaign:Math.floor(Math.max(0,(inboxCapMap[i.email]||100)-(inboxCounts[i.email]||0))/numCampaigns)}])))}`,
      {},runId
    );
    const activeCampaignIds=activeCampaigns.map(c=>c.id);
    const campaignMap=Object.fromEntries(activeCampaigns.map(c=>[c.id,c]));
    const newLeadsCache={};
    let totalSentThisRun=0;
    let batchOffset=0;

    while(true){
      const now=new Date();
      const dailyRemaining=dailyCap-totalToday-totalSentThisRun;
      if(dailyRemaining<=0){await logSchedulerActivity('info','Daily cap reached mid-run',{},runId);break;}

      // ── PER-CAMPAIGN PROCESSING ───────────────────────────────────────────
      // For each active campaign independently:
      //   1. Check if right now is inside THIS campaign's send window
      //   2. If yes — send its fair share of contacts
      //   3. If no  — skip this campaign entirely this run (window not open)
      // This means Campaign A (9-11am) and Campaign B (2-4pm) never compete.
      // Each campaign only fires when ITS window is open, using ITS allocation.
      let anyBatchSent=false;

      // Re-fetch total sent today from DB on every iteration — not just at start.
      // This ensures if the cron ran multiple times or another process sent emails,
      // we always have the accurate count before deciding how many more to send.
      const totalTodayNow=await getTotalDailyCount(settingsTz)+totalSentThisRun;
      if(totalTodayNow>=dailyCap){await logSchedulerActivity('info',`Daily cap reached mid-run (${totalTodayNow}/${dailyCap})`,{},runId);break;}

      for(const campaign of activeCampaigns){
        if((await getTotalDailyCount(settingsTz)+totalSentThisRun)>=dailyCap)break;
        if(!activeCampaignIds.includes(campaign.id))continue;

        const tz=campaign.timezone||'America/New_York';
        const hs=parseInt(campaign.send_hour_start)||9;
        const he=parseInt(campaign.send_hour_end)||17;
        const steps=(campaign.campaign_steps||[]).sort((a,b)=>a.step_number-b.step_number);
        const nowInTz=new Date(now.toLocaleString('en-US',{timeZone:tz}));
        const currentHour=nowInTz.getHours()+(nowInTz.getMinutes()/60);

        // ── FOLLOW-UPS FIRST (step > 1) ──────────────────────────────────────
        // Check if any follow-up step window is open right now.
        // Follow-ups take higher priority than new contacts.
        // If follow-ups are due but their window is not open yet — we do NOT
        // fall through to new contacts. We wait. Follow-ups go first.
        const followupSteps=steps.filter(s=>s.step_number>1);
        const newContactStep=steps.find(s=>s.step_number===1);

        // Check if any follow-up window is open right now
        let followupWindowOpen=false;
        if(!manual){
          for(const fs of followupSteps){
            const fsHs=fs.send_hour_start?parseInt(fs.send_hour_start):hs;
            const fsHe=fs.send_hour_end?parseInt(fs.send_hour_end):he;
            if(currentHour>=fsHs&&currentHour<fsHe){followupWindowOpen=true;break;}
          }
        }else{
          followupWindowOpen=true;// manual trigger ignores windows
        }

        // Check if there are any follow-ups actually due right now
        const{count:followupsDueCount}=await supabase.from('contacts')
          .select('id',{count:'exact',head:true})
          .eq('status','active')
          .eq('campaign_id',campaign.id)
          .gt('current_step',1)
          .lte('next_send_at',now.toISOString())
          .not('next_send_at','is',null);

        const hasFollowupsDue=(followupsDueCount||0)>0;

        // Decision tree:
        // 1. Follow-ups due + window open → send follow-ups, skip new contacts this run
        // 2. Follow-ups due + window NOT open → skip entire campaign, wait for follow-up window
        // 3. No follow-ups due → check new contact window, send step 1 if open
        if(hasFollowupsDue&&!followupWindowOpen&&!manual){
          // Follow-ups are waiting but their window isn't open yet — skip new contacts too
          // Follow-ups take priority so new contacts must wait
          await logSchedulerActivity('skip',
            `Campaign "${campaign.name}" — ${followupsDueCount} follow-ups due but window not open yet. Holding new contacts too until follow-up window opens.`,
            {campaign:campaign.name,followups_due:followupsDueCount},runId
          );
          continue;
        }

        // Determine what to fetch:
        // If follow-ups are due and window is open → fetch follow-ups only (step > 1)
        // If no follow-ups due → fetch new contacts (step 1) if their window is open
        let minStep=1;
        let maxStep=999;
        let windowCheckHs=hs;
        let windowCheckHe=he;

        if(hasFollowupsDue){
          // Only process follow-ups this run
          minStep=2;
          maxStep=999;
          await logSchedulerActivity('info',
            `Campaign "${campaign.name}" — ${followupsDueCount} follow-ups due. Processing follow-ups only.`,
            {campaign:campaign.name},runId
          );
        }else{
          // No follow-ups — process new contacts if their window is open
          minStep=1;
          maxStep=1;
          const step1Hs=newContactStep?.send_hour_start?parseInt(newContactStep.send_hour_start):hs;
          const step1He=newContactStep?.send_hour_end?parseInt(newContactStep.send_hour_end):he;
          windowCheckHs=step1Hs;
          windowCheckHe=step1He;
          if(!manual&&(currentHour<step1Hs||currentHour>=step1He)){
            await logSchedulerActivity('skip',
              `Campaign "${campaign.name}" — no follow-ups due. New contact window not open yet (${step1Hs}:00–${step1He}:00 ${tz}, now: ${nowInTz.getHours()}:${String(nowInTz.getMinutes()).padStart(2,'0')})`,
              {campaign:campaign.name},runId
            );
            continue;
          }
          await logSchedulerActivity('info',
            `Campaign "${campaign.name}" — no follow-ups due. Processing new contacts (step 1).`,
            {campaign:campaign.name},runId
          );
        }

        // Fetch the right contacts
        const{data:batch,error:queryError}=await supabase.from('contacts')
          .select('id,email,first_name,last_name,company,custom_fields,current_step,next_send_at,assigned_inbox,campaign_id')
          .eq('status','active')
          .eq('campaign_id',campaign.id)
          .gte('current_step',minStep)
          .lte('current_step',maxStep)
          .lte('next_send_at',now.toISOString())
          .not('next_send_at','is',null)
          .order('current_step',{ascending:false})// higher steps first within follow-ups
          .order('next_send_at',{ascending:true})
          .range(0,SCHEDULER_BATCH_SIZE-1);

        if(queryError){
          await logSchedulerActivity('error',`DB query failed for campaign "${campaign.name}": ${queryError.message}`,{},runId);
          continue;
        }
        if(!batch?.length){
          await logSchedulerActivity('info',`Campaign "${campaign.name}" — no contacts due in this window`,{},runId);
          continue;
        }

        await logSchedulerActivity('info',`Campaign "${campaign.name}" — ${batch.length} contacts to process`,{},runId);

        const emailBatch=[];
        const batchMeta=[];

        for(const contact of batch){
          if((totalToday+totalSentThisRun)>=dailyCap)break;

          const inbox=contact.assigned_inbox;
          if(!inbox){result.skipped++;result.skip_reasons.no_inbox_assigned=(result.skip_reasons.no_inbox_assigned||0)+1;continue;}

          // ── HARD ABSOLUTE INBOX CAP ─────────────────────────────────────────
          const hardInboxCap=inboxCapMap[inbox]||100;
          const inboxUsedToday=inboxCounts[inbox]||0;
          if(inboxUsedToday>=hardInboxCap){
            result.skipped++;
            result.skip_reasons.inbox_at_hard_cap=(result.skip_reasons.inbox_at_hard_cap||0)+1;
            continue;
          }

          // ── FAIR-SHARE CAP ──────────────────────────────────────────────────
          // Live recalculation: remaining ÷ active campaigns = this campaign's share
          const numActiveCampaigns=activeCampaignIds.length||1;
          const remainingInboxSlots=Math.max(0,hardInboxCap-inboxUsedToday);
          const campaignShareForInbox=Math.floor(remainingInboxSlots/numActiveCampaigns);
          const shareKey=`${campaign.id}:${inbox}`;
          const campaignUsedFromInbox=campaignInboxSent[shareKey]||0;
          if(campaignUsedFromInbox>=campaignShareForInbox){
            result.skipped++;
            result.skip_reasons.campaign_inbox_share_used=(result.skip_reasons.campaign_inbox_share_used||0)+1;
            continue;
          }

          // ── NEW LEADS CAP ───────────────────────────────────────────────────
          if(contact.current_step===1&&campaign.max_new_leads_per_day>0){
            if(newLeadsCache[campaign.id]===undefined)newLeadsCache[campaign.id]=await getNewLeadsTodayCount(campaign.id,tz);
            if(newLeadsCache[campaign.id]>=campaign.max_new_leads_per_day){
              result.skipped++;result.skip_reasons.new_leads_cap=(result.skip_reasons.new_leads_cap||0)+1;continue;
            }
          }

          // ── BLACKLIST / REPLIED ─────────────────────────────────────────────
          if(blacklistSet.has(normalizeEmail(contact.email))){
            await supabase.from('contacts').update({status:'blacklisted',next_send_at:null}).eq('id',contact.id);
            result.skipped++;result.skip_reasons.blacklisted=(result.skip_reasons.blacklisted||0)+1;continue;
          }
          if(repliedSet.has(normalizeEmail(contact.email))){
            await supabase.from('contacts').update({status:'replied',finished_at:new Date().toISOString(),next_send_at:null}).eq('id',contact.id);
            result.skipped++;result.skip_reasons.already_replied=(result.skip_reasons.already_replied||0)+1;continue;
          }

          // ── BUILD EMAIL ─────────────────────────────────────────────────────
          const steps=(campaign.campaign_steps||[]).sort((a,b)=>a.step_number-b.step_number);
          const stepIndex=steps.findIndex(s=>s.step_number===contact.current_step);
          const step=steps[stepIndex];
          if(!step){
            await supabase.from('contacts').update({status:'completed',finished_at:new Date().toISOString(),next_send_at:null}).eq('id',contact.id);
            result.skipped++;result.skip_reasons.sequence_complete=(result.skip_reasons.sequence_complete||0)+1;continue;
          }

          if(campaign.start_date){const sd=new Date(campaign.start_date+'T12:00:00');if(isBefore(now,sd)){result.skipped++;result.skip_reasons.campaign_not_started=(result.skip_reasons.campaign_not_started||0)+1;continue;}}
          if(campaign.end_date){
            const ed=new Date(campaign.end_date+'T23:59:59');
            if(isAfter(now,ed)){
              await supabase.from('campaigns').update({status:'completed'}).eq('id',campaign.id);
              activeCampaignIds.splice(activeCampaignIds.indexOf(campaign.id),1);
              result.skipped++;result.skip_reasons.campaign_ended=(result.skip_reasons.campaign_ended||0)+1;break;
            }
          }

          const customFields=contact.custom_fields||{};
          const subject=applyVariables(processSpintax(step.subject),contact,customFields);
          const rawBody=applyVariables(processSpintax(step.body),contact,customFields);
          const sendId=randomUUID();
          const trackedBody=injectTracking(rawBody,{email:contact.email,inbox,campaign_id:campaign.id,campaign_name:campaign.name,contact_id:contact.id,step:contact.current_step,send_id:sendId,subject});

          // Build advance payload — committed ONLY after webhook success
          const nextStep=steps[stepIndex+1];
          let advancePayload=null;
          if(nextStep){
            // Use next step's own hours if set, fall back to campaign hours
            const shs=nextStep.send_hour_start?parseInt(nextStep.send_hour_start):(campaign.send_hour_start||9);
            const she=nextStep.send_hour_end?parseInt(nextStep.send_hour_end):(campaign.send_hour_end||17);
            let nextSend=getScheduledTime(now,nextStep.delay_days,shs,she,campaign.skip_weekends,tz);
            nextSend=addMinutes(nextSend,Math.floor(Math.random()*(campaign.random_delay_max||30)));
            advancePayload={current_step:nextStep.step_number,next_send_at:nextSend.toISOString()};
          }else{
            advancePayload={status:'completed',finished_at:new Date().toISOString(),next_send_at:null};
          }

          // Update counters
          inboxCounts[inbox]=(inboxCounts[inbox]||0)+1;
          campaignInboxSent[shareKey]=(campaignInboxSent[shareKey]||0)+1;
          totalSentThisRun++;
          if(contact.current_step===1)newLeadsCache[campaign.id]=(newLeadsCache[campaign.id]||0)+1;

          emailBatch.push({to:contact.email,subject,body:trackedBody,inbox,campaign_id:campaign.id,campaign_name:campaign.name,contact_id:contact.id,step:contact.current_step,send_id:sendId,first_name:contact.first_name,last_name:contact.last_name,company:contact.company});
          batchMeta.push({sendId,campaign_id:campaign.id,contact_id:contact.id,email:contact.email,inbox,step_number:contact.current_step,subject,body:rawBody,campaign_name:campaign.name,advancePayload});
        }

        // ── FIRE WEBHOOK FOR THIS CAMPAIGN ──────────────────────────────────
        if(emailBatch.length>0){
          anyBatchSent=true;
          await logSchedulerActivity('info',`Firing webhook: ${emailBatch.length} emails for campaign "${campaign.name}"`,{count:emailBatch.length},runId);
          try{
            await axios.post(settings.webhook_url,{batch:emailBatch},{timeout:60000});
            for(const m of batchMeta){
              await supabase.from('contacts').update(m.advancePayload).eq('id',m.contact_id);
            }
            await supabase.from('sequence_sends').insert(batchMeta.map(m=>({id:m.sendId,campaign_id:m.campaign_id,contact_id:m.contact_id,email:m.email,inbox:m.inbox,step_number:m.step_number,subject:m.subject,body:m.body,sent_at:new Date().toISOString(),status:'sent'})));
            await supabase.from('email_events').insert(batchMeta.map(m=>({type:'send',recipient:m.email,inbox:m.inbox,campaign:m.campaign_name,campaign_id:m.campaign_id,contact_id:m.contact_id,step_number:m.step_number,send_id:m.sendId,subject:m.subject,created_at:new Date().toISOString()})));
            result.sent+=emailBatch.length;
            await logSchedulerActivity('send',`✓ Sent ${emailBatch.length} emails for "${campaign.name}"`,{count:emailBatch.length,emails:emailBatch.map(e=>e.to)},runId);
          }catch(webhookErr){
            const errMsg=webhookErr.response?`HTTP ${webhookErr.response.status}: ${JSON.stringify(webhookErr.response.data)}`:webhookErr.message;
            await supabase.from('sequence_sends').insert(batchMeta.map(m=>({id:m.sendId,campaign_id:m.campaign_id,contact_id:m.contact_id,email:m.email,inbox:m.inbox,step_number:m.step_number,subject:m.subject,body:m.body,sent_at:new Date().toISOString(),status:'failed',error_message:errMsg})));
            result.errors+=emailBatch.length;
            await logSchedulerActivity('error',`✗ Webhook FAILED for "${campaign.name}": ${errMsg}`,{error:errMsg},runId);
          }
        }
      }// end for each campaign

      // Only continue the while loop if we actually sent something this pass
      // If no campaign had its window open or had contacts due — we're done
      if(!anyBatchSent)break;
    }// end while

    await logSchedulerActivity('info',`Run complete — sent:${result.sent} skipped:${result.skipped} errors:${result.errors}`,{...result,skip_breakdown:result.skip_reasons},runId);
  }catch(err){
    result.reason='fatal_error';result.errors++;
    await logSchedulerActivity('error',`FATAL: ${err.message}`,{error:err.message,stack:err.stack?.slice(0,500)},runId);
  }finally{schedulerRunning=false;lastRunResult=result;}
  return result;
}

cron.schedule('*/5 * * * *',()=>runScheduler(false));

// ── STARTUP: RESCHEDULE ALL OVERDUE CONTACTS ──────────────────────────────────
// When the server starts (or restarts after a crash/deploy), any contacts whose
// next_send_at is in the past are "overdue". Without this, they would all fire
// immediately on the first cron tick, blasting potentially thousands of emails.
// Instead we push every overdue contact to the next valid send window for their campaign.
async function rescheduleOverdueOnStartup(){
  console.log('[Startup] Checking for overdue contacts to reschedule...');
  try{
    const{data:campaigns}=await supabase.from('campaigns').select('id,send_hour_start,send_hour_end,skip_weekends,timezone,random_delay_max,campaign_steps(*)').eq('status','active');
    if(!campaigns?.length){console.log('[Startup] No active campaigns.');return;}
    const now=new Date();
    let totalRescheduled=0;
    for(const camp of campaigns){
      const steps=(camp.campaign_steps||[]).sort((a,b)=>a.step_number-b.step_number);
      // Find all overdue active contacts in this campaign
      const{data:overdue}=await supabase.from('contacts')
        .select('id,current_step')
        .eq('campaign_id',camp.id)
        .eq('status','active')
        .lt('next_send_at',now.toISOString())
        .not('next_send_at','is',null)
        .gt('current_step',0);
      if(!overdue?.length)continue;
      console.log(`[Startup] ${overdue.length} overdue contacts in campaign ${camp.id} — rescheduling...`);
      for(const c of overdue){
        const stepDef=steps.find(s=>s.step_number===c.current_step);
        // Use step's own hours if set, fall back to campaign hours
        const hs=stepDef?.send_hour_start?parseInt(stepDef.send_hour_start):(camp.send_hour_start||9);
        const he=stepDef?.send_hour_end?parseInt(stepDef.send_hour_end):(camp.send_hour_end||17);
        const tz=camp.timezone||'America/New_York';
        const sw=camp.skip_weekends!==undefined?camp.skip_weekends:true;
        // Schedule into TODAY's window if it hasn't passed, otherwise TOMORROW
        let nextSend=getScheduledTime(now,0,hs,he,sw,tz);
        if(isBefore(nextSend,now))nextSend=getScheduledTime(now,1,hs,he,sw,tz);
        // Spread rescheduled contacts with random delay to avoid synchronised sends
        nextSend=addMinutes(nextSend,Math.floor(Math.random()*(camp.random_delay_max||30)));
        await supabase.from('contacts').update({next_send_at:nextSend.toISOString()}).eq('id',c.id);
        totalRescheduled++;
      }
    }
    console.log(`[Startup] Rescheduled ${totalRescheduled} overdue contacts into next valid send windows.`);
  }catch(e){
    console.error('[Startup] Reschedule failed:',e.message);
  }
}
// Run after 10 second delay to let DB connections settle
setTimeout(rescheduleOverdueOnStartup, 10000);

// SCHEDULER API
app.get('/api/scheduler/status',async(req,res)=>{
  const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const{count:sentToday}=await supabase.from('sequence_sends').select('*',{count:'exact',head:true}).gte('sent_at',today.toISOString()).eq('status','sent');
  const{count:failedToday}=await supabase.from('sequence_sends').select('*',{count:'exact',head:true}).gte('sent_at',today.toISOString()).eq('status','failed');
  const{count:pendingCount}=await supabase.from('contacts').select('*',{count:'exact',head:true}).eq('status','active').not('next_send_at','is',null).lte('next_send_at',now.toISOString()).gt('current_step',0);
  const{count:scheduledToday}=await supabase.from('contacts').select('*',{count:'exact',head:true}).eq('status','active').not('next_send_at','is',null).gt('next_send_at',now.toISOString()).lte('next_send_at',new Date(today.getTime()+86400000).toISOString()).gt('current_step',0);
  const inboxSends=await fetchAll(()=>supabase.from('sequence_sends').select('inbox').gte('sent_at',today.toISOString()).eq('status','sent'));
  const inboxCounts={};(inboxSends||[]).forEach(s=>{inboxCounts[s.inbox]=(inboxCounts[s.inbox]||0)+1;});
  const{data:inboxes}=await supabase.from('inboxes').select('email,daily_cap,active').eq('active',true);
  const inboxStatus=(inboxes||[]).map(i=>({email:i.email,sent:inboxCounts[i.email]||0,cap:i.daily_cap||100,pct:Math.round(((inboxCounts[i.email]||0)/(i.daily_cap||100))*100)}));
  const settings=await getSettings();
  res.json({last_run:lastSchedulerRun,is_running:schedulerRunning,last_run_result:lastRunResult,next_run:lastSchedulerRun?new Date(lastSchedulerRun.getTime()+5*60000):null,webhook_configured:!!settings.webhook_url,sent_today:sentToday||0,failed_today:failedToday||0,pending_now:pendingCount||0,scheduled_today:scheduledToday||0,daily_cap:settings.daily_cap||500,inbox_status:inboxStatus});
});

app.post('/api/scheduler/run',async(req,res)=>{
  if(schedulerRunning)return res.status(409).json({ok:false,message:'Scheduler is already running — wait for it to finish'});
  try{const result=await runScheduler(true);res.json({ok:true,message:'Scheduler run complete',result});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.get('/api/scheduler/queue',async(req,res)=>{
  const page=parseInt(req.query.page||'1'),pageSize=parseInt(req.query.pageSize||'500'),offset=(page-1)*pageSize;
  const{data:pending,count,error}=await supabase.from('contacts').select('id,email,first_name,last_name,company,current_step,next_send_at,assigned_inbox,campaign_id,campaigns!inner(name,status,timezone)',{count:'exact'}).eq('status','active').not('next_send_at','is',null).gt('current_step',0).order('next_send_at',{ascending:true}).range(offset,offset+pageSize-1);
  if(error)return res.status(500).json({error:error.message});
  res.json({contacts:pending||[],total:count||0,page,pageSize});
});

app.get('/api/scheduler/recent',async(req,res)=>{
  const page=parseInt(req.query.page||'1'),pageSize=parseInt(req.query.pageSize||'500'),offset=(page-1)*pageSize;
  const{data,count,error}=await supabase.from('sequence_sends').select('*',{count:'exact'}).order('sent_at',{ascending:false}).range(offset,offset+pageSize-1);
  if(error)return res.status(500).json({error:error.message});
  res.json({sends:data||[],total:count||0,page,pageSize});
});

app.post('/api/scheduler/retry/:sendId',async(req,res)=>{
  const{data:send}=await supabase.from('sequence_sends').select('*').eq('id',req.params.sendId).single();
  if(!send)return res.status(404).json({error:'Send record not found'});
  if(send.status==='sent')return res.status(400).json({error:'This email was already sent successfully — retrying would cause a duplicate'});
  if(!send.body)return res.status(400).json({error:'No body stored for this send — re-run the scheduler instead to regenerate it'});
  if((send.retry_count||0)>=3)return res.status(400).json({error:'Max retries (3) reached for this send. Check your webhook/n8n configuration.'});
  const settings=await getSettings();
  if(!settings.webhook_url)return res.status(400).json({error:'No webhook URL configured'});
  try{
    // FIX: send in batch format — same format the scheduler uses — not the old single-email format
    await axios.post(settings.webhook_url,{
      batch:[{to:send.email,subject:send.subject,body:send.body,inbox:send.inbox,
        campaign_id:send.campaign_id,contact_id:send.contact_id,
        step:send.step_number,send_id:send.id,is_retry:true}]
    },{timeout:15000});

    // Mark as sent and increment retry count
    await supabase.from('sequence_sends').update({status:'sent',sent_at:new Date().toISOString(),error_message:null,retry_count:(send.retry_count||0)+1}).eq('id',req.params.sendId);

    // FIX: advance the contact to the next step now that the email is confirmed sent
    const{data:campaign}=await supabase.from('campaigns').select('id,send_hour_start,send_hour_end,skip_weekends,timezone,random_delay_max,campaign_steps(*)').eq('id',send.campaign_id).single();
    if(campaign){
      const steps=(campaign.campaign_steps||[]).sort((a,b)=>a.step_number-b.step_number);
      const stepIndex=steps.findIndex(s=>s.step_number===send.step_number);
      const nextStep=steps[stepIndex+1];
      const now=new Date();
      if(nextStep){
        // Use next step's own hours if set, fall back to campaign hours
        const hs=nextStep.send_hour_start?parseInt(nextStep.send_hour_start):(campaign.send_hour_start||9);
        const he=nextStep.send_hour_end?parseInt(nextStep.send_hour_end):(campaign.send_hour_end||17);
        let nextSend=getScheduledTime(now,nextStep.delay_days,hs,he,campaign.skip_weekends,campaign.timezone||'America/New_York');
        nextSend=addMinutes(nextSend,Math.floor(Math.random()*(campaign.random_delay_max||30)));
        await supabase.from('contacts').update({current_step:nextStep.step_number,next_send_at:nextSend.toISOString()}).eq('id',send.contact_id);
      }else{
        await supabase.from('contacts').update({status:'completed',finished_at:now.toISOString(),next_send_at:null}).eq('id',send.contact_id);
      }
    }
    await logSchedulerActivity('send',`Manual retry succeeded for ${send.email}`,{email:send.email,send_id:send.id});
    res.json({ok:true});
  }catch(e){
    const errMsg=e.response?`HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`:e.message;
    await supabase.from('sequence_sends').update({retry_count:(send.retry_count||0)+1,error_message:errMsg}).eq('id',req.params.sendId);
    await logSchedulerActivity('error',`Manual retry failed for ${send.email}: ${errMsg}`,{email:send.email,error:errMsg});
    res.status(500).json({error:errMsg});
  }
});

app.get('/api/scheduler/logs',async(req,res)=>{
  const page=parseInt(req.query.page||'1'),pageSize=parseInt(req.query.pageSize||'500'),offset=(page-1)*pageSize;
  const{type,run_id}=req.query;
  let q=supabase.from('scheduler_logs').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(offset,offset+pageSize-1);
  if(type&&type!=='all')q=q.eq('type',type);
  if(run_id)q=q.eq('run_id',run_id);
  const{data,count,error}=await q;
  if(error)return res.status(500).json({error:error.message+' — Run db-migration.sql?'});
  res.json({logs:data||[],total:count||0,page,pageSize});
});

app.get('/api/scheduler/diagnostics',async(req,res)=>{
  const now=new Date();const settings=await getSettings();const inboxes=await getInboxes();
  const{data:activeCampaigns,count:activeCampCount}=await supabase.from('campaigns').select('id,name,status,timezone,send_hour_start,send_hour_end',{count:'exact'}).eq('status','active');
  const{data:allCampaigns}=await supabase.from('campaigns').select('id,name,status').order('created_at',{ascending:false});
  const{count:activeContactCount}=await supabase.from('contacts').select('*',{count:'exact',head:true}).eq('status','active').gt('current_step',0).not('next_send_at','is',null);
  const{count:overdueCount}=await supabase.from('contacts').select('*',{count:'exact',head:true}).eq('status','active').gt('current_step',0).not('next_send_at','is',null).lte('next_send_at',now.toISOString());
  const{count:noInboxCount}=await supabase.from('contacts').select('*',{count:'exact',head:true}).eq('status','active').gt('current_step',0).is('assigned_inbox',null);
  const{data:recentErrors}=await supabase.from('scheduler_logs').select('message,details,created_at').eq('type','error').order('created_at',{ascending:false}).limit(10);
  res.json({timestamp:now.toISOString(),server_timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,webhook_configured:!!settings.webhook_url,webhook_url_preview:settings.webhook_url?settings.webhook_url.slice(0,80)+'...':null,daily_cap:settings.daily_cap,active_inboxes:inboxes.length,active_campaigns:activeCampCount||0,all_campaigns:allCampaigns||[],active_campaign_list:activeCampaigns||[],active_contacts_in_queue:activeContactCount||0,overdue_contacts:overdueCount||0,contacts_with_no_inbox:noInboxCount||0,recent_errors:recentErrors||[],scheduler_state:{is_running:schedulerRunning,last_run:lastSchedulerRun,last_result:lastRunResult}});
});

app.delete('/api/scheduler/logs',async(req,res)=>{
  const{type}=req.query;let q=supabase.from('scheduler_logs').delete();
  if(type&&type!=='all')q=q.eq('type',type);else q=q.gte('created_at','2000-01-01');
  const{error}=await q;if(error)return res.status(500).json({error:error.message});
  res.json({ok:true});
});

app.get('/api/scheduler/logs/stream',(req,res)=>{
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
  res.write(`data: ${JSON.stringify({type:'connected',message:'Live log stream connected',created_at:new Date().toISOString()})}\n\n`);
  sseClients.add(res);console.log(`[SSE] Client connected (${sseClients.size} total)`);
  const heartbeat=setInterval(()=>{try{res.write(`: heartbeat\n\n`);}catch(e){clearInterval(heartbeat);sseClients.delete(res);}},25000);
  req.on('close',()=>{clearInterval(heartbeat);sseClients.delete(res);console.log(`[SSE] Client disconnected (${sseClients.size} remaining)`);});
});

app.post('/api/campaigns/pause-all',async(req,res)=>{
  // Store which campaign IDs we are pausing so resume-all only wakes those up
  const{data:active}=await supabase.from('campaigns').select('id').eq('status','active');
  const ids=(active||[]).map(c=>c.id);
  if(ids.length===0)return res.json({ok:true,paused:0});
  await supabase.from('campaigns').update({status:'paused',bulk_paused:true}).in('id',ids);
  // Also null out next_send_at on all active contacts so they don't pile up as overdue on resume
  await supabase.from('contacts').update({status:'paused',next_send_at:null}).in('campaign_id',ids).eq('status','active');
  res.json({ok:true,paused:ids.length});
});

app.post('/api/campaigns/resume-all',async(req,res)=>{
  // Only resume campaigns that were bulk-paused — don't wake campaigns paused individually
  const{data:bulkPaused}=await supabase.from('campaigns').select('id,send_hour_start,send_hour_end,skip_weekends,timezone,random_delay_max,campaign_steps(*)').eq('status','paused').eq('bulk_paused',true);
  if(!bulkPaused?.length)return res.json({ok:true,resumed:0});
  const ids=bulkPaused.map(c=>c.id);
  await supabase.from('campaigns').update({status:'active',bulk_paused:false}).in('id',ids);
  // Reschedule paused contacts back into the next valid send window — not raw now
  const now=new Date();
  for(const camp of bulkPaused){
    const steps=(camp.campaign_steps||[]).sort((a,b)=>a.step_number-b.step_number);
    const{data:pausedContacts}=await supabase.from('contacts').select('id,current_step').eq('campaign_id',camp.id).eq('status','paused');
    for(const c of pausedContacts||[]){
      const stepDef=steps.find(s=>s.step_number===c.current_step);
      const hs=stepDef?.send_hour_start||camp.send_hour_start||9;
      const he=stepDef?.send_hour_end||camp.send_hour_end||17;
      const tz=camp.timezone||'America/New_York';
      const sw=camp.skip_weekends!==undefined?camp.skip_weekends:true;
      let nextSend=getScheduledTime(now,0,hs,he,sw,tz);
      if(isBefore(nextSend,now))nextSend=getScheduledTime(now,1,hs,he,sw,tz);
      nextSend=addMinutes(nextSend,Math.floor(Math.random()*(camp.random_delay_max||30)));
      await supabase.from('contacts').update({status:'active',next_send_at:nextSend.toISOString()}).eq('id',c.id);
    }
  }
  res.json({ok:true,resumed:ids.length});
});

app.post('/api/contacts/:id/send-now',async(req,res)=>{
  const{data:contact}=await supabase.from('contacts').select('id,email,status').eq('id',req.params.id).single();
  if(!contact)return res.status(404).json({error:'Contact not found'});
  if(contact.status!=='active')return res.status(400).json({error:`Cannot send — contact status is "${contact.status}". Only active contacts can be force-scheduled.`});
  await supabase.from('contacts').update({next_send_at:new Date(Date.now()+30000).toISOString()}).eq('id',req.params.id);
  res.json({ok:true,message:`${contact.email} rescheduled — click Run Now to send immediately`});
});

app.get('/api/contacts/check',async(req,res)=>{
  const email=req.query.email?.trim().toLowerCase();if(!email)return res.status(400).json({found:false,error:'email param required'});
  const{data,error}=await supabase.from('contacts').select('id,email,first_name,last_name,company,city,phone,status,current_step,campaign_id,assigned_inbox,enrolled_at').eq('email',email).limit(1);
  if(error||!data||data.length===0)return res.json({found:false});
  const contact=data[0];
  const{data:camp}=await supabase.from('campaigns').select('name,status').eq('id',contact.campaign_id).single();
  res.json({found:true,contact:{...contact,campaign_name:camp?.name||'Unknown',campaign_status:camp?.status||'unknown'}});
});

// CALCULATOR LEADS
app.get('/api/calculator-leads', async (req, res) => {
  const { table, search } = req.query;
  const page = parseInt(req.query.page || '1');
  const pageSize = parseInt(req.query.pageSize || '50');
  const offset = (page - 1) * pageSize;

  // Map frontend param values to real Supabase table names
  const tableMap = {
    missed_revenue: 'calculator_form_submissions',
    ad_calculator:  'ad_calculator_submissions',
  };

  const realTable = tableMap[table];
  if (!realTable) {
    return res.status(400).json({ error: 'Invalid table name. Must be missed_revenue or ad_calculator.' });
  }

  let query = supabase
    .from(realTable)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (search && search.trim()) {
    query = query.ilike('email', `%${search.trim()}%`);
  }

  const { data, count, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ leads: data || [], total: count || 0, page, pageSize });
});

// REPLIES
// Queries email_events for all reply-type events.
// Handles variations: 'reply', 'replied', 'auto_reply', 'unsubscribe'
// Enriches each event with the matching contact + campaign from contacts table.
app.get('/api/replies', async (req, res) => {
  const { type, search } = req.query;
  const page = parseInt(req.query.page || '1');
  const pageSize = parseInt(req.query.pageSize || '50');
  const offset = (page - 1) * pageSize;

  // All reply-type keywords saved to email_events — covers past + future variations
  const ALL_REPLY_TYPES = ['reply', 'replied', 'auto_reply', 'unsubscribe'];

  let typeFilter;
  if (type === 'reply') {
    // Real human replies only
    typeFilter = ['reply', 'replied'];
  } else if (type === 'auto_reply') {
    typeFilter = ['auto_reply'];
  } else {
    // 'all' — everything reply-ish
    typeFilter = ALL_REPLY_TYPES;
  }

  let q = supabase
    .from('email_events')
    .select('*', { count: 'exact' })
    .in('type', typeFilter)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (search && search.trim()) {
    q = q.ilike('recipient', `%${search.trim()}%`);
  }

  const { data: events, count, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Batch-fetch contacts for this page of emails — one query, not N queries
  const emails = [...new Set((events || []).map(e => normalizeEmail(e.recipient || '')).filter(Boolean))];
  let contactMap = {};
  if (emails.length > 0) {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, email, first_name, last_name, campaign_id, campaigns(name)')
      .in('email', emails);
    (contacts || []).forEach(c => {
      contactMap[normalizeEmail(c.email || '')] = c;
    });
  }

  const replies = (events || []).map(e => ({
    ...e,
    contact: contactMap[normalizeEmail(e.recipient || '')] || null,
  }));

  res.json({ replies, total: count || 0, page, pageSize });
});

app.use(express.static(path.join(__dirname,'dist')));
app.get('*',(req,res)=>{if(req.path.startsWith('/api')||req.path.startsWith('/track'))return res.status(404).json({error:'Not found'});res.sendFile(path.join(__dirname,'dist/index.html'));});

const PORT=process.env.PORT||3001;
app.listen(PORT,()=>console.log(`BotCipher Mail running on port ${PORT}`));
