import { useState, useEffect, useRef } from 'react';
import { api } from './api.js';

// ── SCROLL TABLE — shows horizontal scrollbar on top AND bottom ───────────────
function ScrollTable({ children, style }) {
  const topRef = useRef(null);
  const botRef = useRef(null);
  const innerRef = useRef(null);
  useEffect(() => {
    const top = topRef.current;
    const bot = botRef.current;
    const inner = innerRef.current;
    if (!top || !bot || !inner) return;
    const syncWidth = () => { top.firstChild.style.width = inner.scrollWidth + 'px'; };
    syncWidth();
    const ro = new ResizeObserver(syncWidth);
    ro.observe(inner);
    const onTopScroll = () => { bot.scrollLeft = top.scrollLeft; };
    const onBotScroll = () => { top.scrollLeft = bot.scrollLeft; };
    top.addEventListener('scroll', onTopScroll);
    bot.addEventListener('scroll', onBotScroll);
    return () => { top.removeEventListener('scroll', onTopScroll); bot.removeEventListener('scroll', onBotScroll); ro.disconnect(); };
  }, []);
  return (
    <div style={style}>
      <div ref={topRef} style={{ overflowX:'auto', overflowY:'hidden', height:10, marginBottom:2 }}>
        <div style={{ height:1 }} />
      </div>
      <div ref={botRef} style={{ overflowX:'auto' }}>
        <div ref={innerRef}>{children}</div>
      </div>
    </div>
  );
}

// ── ANALYTICS LOGS — the raw, searchable event-by-event log (moved out of Analytics) ──
export default function AnalyticsLogsPage() {
  const [date, setDate] = useState('week');
  const [campaignId, setCampaignId] = useState('');
  const [campaigns, setCampaigns] = useState([]);

  const [events, setEvents] = useState([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsType, setEventsType] = useState('all');
  const [eventsSearch, setEventsSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [humanOnly, setHumanOnly] = useState(false);
  const [botOpenCount, setBotOpenCount] = useState(0);
  const [bodyModal, setBodyModal] = useState(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const EVENT_PAGE_SIZE = 100;

  const openBodyModal = async (sendId, fallback) => {
    if (!sendId) return;
    setBodyLoading(true);
    setBodyModal({ loading: true, ...fallback });
    try {
      const data = await api.getEmailBody(sendId);
      let body = data.body || '';
      const isPlainText = !/<[a-z][\s\S]*>/i.test(body);
      if (isPlainText && body) {
        body = `<!DOCTYPE html><html><head><style>
          body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.8;
                 color: #222; padding: 24px; max-width: 600px; margin: 0 auto; }
          p { margin: 0 0 12px 0; }
        </style></head><body>${
          body
            .split(/\n\n+/)
            .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
            .join('')
        }</body></html>`;
      } else if (body && !body.toLowerCase().includes('<html')) {
        body = `<!DOCTYPE html><html><head><style>
          body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.8;
                 color: #222; padding: 24px; max-width: 600px; margin: 0 auto; }
        </style></head><body>${body}</body></html>`;
      }
      setBodyModal({ ...data, body });
    } catch (e) {
      setBodyModal({ ...fallback, body: 'Could not load email body.', error: true });
    } finally {
      setBodyLoading(false);
    }
  };

  useEffect(() => { api.getCampaigns().then(c => setCampaigns(c || [])); }, []);

  // Pull bot-open count from the summary endpoint just for the banner — the log itself
  // is driven entirely by /analytics/events below.
  useEffect(() => {
    const p = { date };
    if (campaignId) p.campaign_id = campaignId;
    api.getAnalytics(p).then(d => setBotOpenCount(d?.totals?.bot_opens || 0)).catch(() => {});
  }, [date, campaignId]);

  useEffect(() => {
    setEventsLoading(true);
    const p = { date, page: eventsPage, pageSize: EVENT_PAGE_SIZE };
    if (campaignId) p.campaign_id = campaignId;
    if (eventsType !== 'all') p.type = eventsType;
    if (appliedSearch) p.search = appliedSearch;
    if (humanOnly) p.human_only = 'true';
    api.getAnalyticsEvents(p)
      .then(d => { setEvents(d.events || []); setEventsTotal(d.total || 0); })
      .catch(() => {})
      .finally(() => setEventsLoading(false));
  }, [date, campaignId, eventsPage, eventsType, appliedSearch, humanOnly]);

  const EVENT_COLORS = {
    send:        { bg:'#e8f0fe', color:'#1a56db', label:'Sent' },
    open:        { bg:'#def7ec', color:'#057a55', label:'Opened' },
    click:       { bg:'#edebfe', color:'#7e3af2', label:'Clicked' },
    reply:       { bg:'#fdf6b2', color:'#8e4b10', label:'Replied' },
    replied:     { bg:'#fdf6b2', color:'#8e4b10', label:'Replied' },
    bounce:      { bg:'#fde8e8', color:'#c81e1e', label:'Bounced' },
    auto_reply:  { bg:'#feecdc', color:'#c2410c', label:'Auto-Reply' },
    unsubscribe: { bg:'#fde8e8', color:'#9b1c1c', label:'Unsub' },
    send_failed: { bg:'#fff7ed', color:'#9a3412', label:'Failed' },
    spam_complaint: { bg:'#fde8e8', color:'#7f1d1d', label:'Spam' },
  };

  const badge = (type, isBot) => {
    const s = EVENT_COLORS[type] || { bg:'var(--bg-muted)', color:'var(--text-secondary)', label:type };
    return (
      <div style={{ display:'flex', gap:4, alignItems:'center' }}>
        <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99,
          background:s.bg, color:s.color, letterSpacing:'0.02em', textTransform:'uppercase', whiteSpace:'nowrap' }}>
          {s.label}
        </span>
        {isBot && (
          <span style={{ fontSize:10, fontWeight:600, padding:'1px 6px', borderRadius:99,
            background:'#f3f4f6', color:'#6b7280', border:'1px solid #e5e7eb', whiteSpace:'nowrap' }}>
            🤖 bot
          </span>
        )}
      </div>
    );
  };

  const fmtTime = iso => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
      month:'short', day:'numeric', year:'numeric',
      hour:'numeric', minute:'2-digit', hour12:true
    });
  };

  const totalEventPages = Math.ceil(eventsTotal / EVENT_PAGE_SIZE);

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="topbar-title">Analytics Logs</div>
          <div className="topbar-sub">Every event, every contact — the full raw log</div>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <select className="input" style={{ width:210, fontSize:13 }} value={campaignId}
            onChange={e => { setCampaignId(e.target.value); setEventsPage(1); }}>
            <option value="">All Campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ display:'flex', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
            {[['today','Today'],['week','7d'],['month','30d'],['all','All']].map(([v,l]) => (
              <button key={v} onClick={() => { setDate(v); setEventsPage(1); }} className="btn"
                style={{ borderRadius:0, border:'none', borderRight:'1px solid var(--border)',
                  background:date===v?'var(--accent)':'var(--bg)',
                  color:date===v?'white':'var(--text-secondary)', padding:'6px 12px', fontSize:12 }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="page fade-in">

        {/* ── Bot warning ── */}
        {botOpenCount > 0 && !humanOnly && (
          <div style={{ marginBottom:16, padding:'10px 16px', background:'#fefce8', border:'1px solid #fde047', borderRadius:8, fontSize:13, color:'#713f12', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>🤖 <strong>{botOpenCount} bot opens detected</strong> — these are email security scanners (like cipher.co.site), not real people. They're labeled in the table below.</span>
            <button className="btn btn-secondary" style={{ fontSize:12, padding:'4px 12px', marginLeft:16, whiteSpace:'nowrap' }}
              onClick={() => setHumanOnly(true)}>Hide bots</button>
          </div>
        )}
        {humanOnly && (
          <div style={{ marginBottom:16, padding:'8px 16px', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, fontSize:13, color:'#166534', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>✓ Showing human opens only — bot opens are hidden</span>
            <button className="btn btn-secondary" style={{ fontSize:12, padding:'4px 12px', marginLeft:16 }}
              onClick={() => setHumanOnly(false)}>Show all</button>
          </div>
        )}

        {/* ── Event Log ── */}
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
            <div>
              <div style={{ fontWeight:600, fontSize:14 }}>Event Log</div>
              <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>
                {eventsTotal.toLocaleString()} events · every open, click, reply, bounce — with the contact's name and email
              </div>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <div style={{ display:'flex', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                {[['all','All'],['open','Opens'],['click','Clicks'],['reply','Replies'],['send','Sends'],['bounce','Bounces'],['send_failed','Failed']].map(([v,l]) => (
                  <button key={v} onClick={() => { setEventsType(v); setEventsPage(1); }} className="btn"
                    style={{ borderRadius:0, border:'none', borderRight:'1px solid var(--border)',
                      background:eventsType===v?'var(--accent)':'var(--bg)',
                      color:eventsType===v?'white':'var(--text-secondary)', padding:'5px 12px', fontSize:12 }}>
                    {l}
                  </button>
                ))}
              </div>
              <div style={{ display:'flex', gap:4 }}>
                <input className="input" style={{ width:200, fontSize:12 }} placeholder="Search email or name…"
                  value={eventsSearch}
                  onChange={e => setEventsSearchInput(e.target.value)}
                  onKeyDown={e => { if(e.key==='Enter'){ setAppliedSearch(eventsSearch); setEventsPage(1); }}}
                />
                <button className="btn btn-secondary" style={{ fontSize:12, padding:'0 12px' }}
                  onClick={() => { setAppliedSearch(eventsSearch); setEventsPage(1); }}>Go</button>
                {appliedSearch && (
                  <button className="btn btn-secondary" style={{ fontSize:12, padding:'0 10px' }}
                    onClick={() => { setAppliedSearch(''); setEventsSearchInput(''); setEventsPage(1); }}>✕</button>
                )}
              </div>
            </div>
          </div>

          {eventsLoading ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>Loading…</div>
          ) : events.length === 0 ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>
              No events found for this filter
              {eventsType !== 'all' && <div style={{ marginTop:8, fontSize:12 }}>Try switching to "All" to see everything</div>}
            </div>
          ) : (
            <>
              <ScrollTable style={{ borderRadius:0 }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ whiteSpace:'nowrap' }}>When</th>
                      <th>Event</th>
                      <th>Contact Name</th>
                      <th>Email Address</th>
                      <th>Subject Line</th>
                      <th>Sent From</th>
                      <th>Campaign</th>
                      <th style={{ textAlign:'center' }}>Step</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev, idx) => {
                      const canPreview = ['send','open','delivered','click'].includes(ev.type) && ev.send_id;
                      return (
                      <tr key={ev.id || idx} style={{
                        background:
                          ev.type==='open' && !ev.is_bot ? 'rgba(5,122,85,0.04)' :
                          ev.type==='reply' || ev.type==='replied' ? 'rgba(234,179,8,0.04)' :
                          ev.type==='bounce' || ev.type==='send_failed' ? 'rgba(220,38,38,0.04)' :
                          ev.is_bot ? 'rgba(107,114,128,0.04)' : undefined
                      }}>
                        <td style={{ fontSize:12, color:'var(--text-muted)', whiteSpace:'nowrap' }}>{fmtTime(ev.created_at)}</td>
                        <td style={{ whiteSpace:'nowrap' }}>{badge(ev.type, ev.is_bot)}</td>
                        <td style={{ fontSize:13, fontWeight:500 }}>
                          {ev.contact_name
                            ? <span>{ev.contact_name}</span>
                            : <span style={{ color:'var(--text-muted)', fontSize:12 }}>—</span>}
                          {ev.contact_company && <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:400 }}>{ev.contact_company}</div>}
                        </td>
                        <td style={{ fontFamily:'monospace', fontSize:12 }} title={ev.recipient}>
                          {ev.recipient || '—'}
                        </td>
                        <td style={{ fontSize:12, color:'var(--text-secondary)', maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                          title={ev.subject}>{ev.subject || '—'}</td>
                        <td style={{ fontFamily:'monospace', fontSize:11, color:'var(--text-muted)', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                          title={ev.inbox}>{ev.inbox || '—'}</td>
                        <td style={{ fontSize:12, color:'var(--text-secondary)', maxWidth:150, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                          title={ev.campaign}>{ev.campaign || '—'}</td>
                        <td style={{ fontSize:12, color:'var(--text-muted)', textAlign:'center' }}>{ev.step_number || '—'}</td>
                        <td>
                          {canPreview && (
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize:11, padding:'2px 10px', whiteSpace:'nowrap' }}
                              onClick={() => openBodyModal(ev.send_id, { subject: ev.subject, recipient: ev.recipient, inbox: ev.inbox, campaign_name: ev.campaign })}
                            >
                              View Email
                            </button>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollTable>

              {totalEventPages > 1 && (
                <div className="pagination">
                  <button onClick={() => setEventsPage(p => Math.max(1,p-1))} disabled={eventsPage===1} className="btn btn-secondary btn-sm">← Prev</button>
                  <span className="page-info">Page {eventsPage} of {totalEventPages} · {eventsTotal.toLocaleString()} total</span>
                  <button onClick={() => setEventsPage(p => Math.min(totalEventPages,p+1))} disabled={eventsPage===totalEventPages} className="btn btn-secondary btn-sm">Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── EMAIL BODY PREVIEW MODAL ── */}
      {bodyModal && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000,
          display:'flex', alignItems:'center', justifyContent:'center', padding:20
        }} onClick={() => setBodyModal(null)}>
          <div style={{
            background:'var(--bg)', borderRadius:12, width:'100%', maxWidth:720,
            maxHeight:'90vh', display:'flex', flexDirection:'column',
            boxShadow:'0 20px 60px rgba(0,0,0,0.4)', overflow:'hidden'
          }} onClick={e => e.stopPropagation()}>

            <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>
                  {bodyModal.loading ? 'Loading…' : bodyModal.subject || '(no subject)'}
                </div>
                <div style={{ fontSize:12, color:'var(--text-muted)', display:'flex', gap:16, flexWrap:'wrap' }}>
                  {bodyModal.recipient && <span>To: <span style={{ fontFamily:'monospace' }}>{bodyModal.recipient}</span></span>}
                  {bodyModal.inbox && <span>From: <span style={{ fontFamily:'monospace' }}>{bodyModal.inbox}</span></span>}
                  {bodyModal.campaign_name && <span>Campaign: {bodyModal.campaign_name}</span>}
                  {bodyModal.sent_at && <span>Sent: {fmtTime(bodyModal.sent_at)}</span>}
                </div>
              </div>
              <button onClick={() => setBodyModal(null)} style={{
                background:'none', border:'none', fontSize:20, cursor:'pointer',
                color:'var(--text-muted)', lineHeight:1, padding:'0 4px', marginLeft:16
              }}>✕</button>
            </div>

            <div style={{ flex:1, overflow:'auto' }}>
              {bodyModal.loading ? (
                <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>Loading email body…</div>
              ) : bodyModal.error ? (
                <div style={{ padding:40, textAlign:'center', color:'var(--danger)' }}>{bodyModal.body}</div>
              ) : bodyModal.body ? (
                <iframe
                  srcDoc={bodyModal.body}
                  style={{ width:'100%', height:'500px', border:'none', display:'block' }}
                  sandbox="allow-same-origin"
                  title="Email preview"
                />
              ) : (
                <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>No body stored for this send.</div>
              )}
            </div>

            <div style={{ padding:'12px 20px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setBodyModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
