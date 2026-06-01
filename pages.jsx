import { useState, useEffect } from 'react';
import { api } from './api.js';

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
export function AnalyticsPage() {
  const [date, setDate] = useState('week');
  const [campaignId, setCampaignId] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [events, setEvents] = useState([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsType, setEventsType] = useState('all');
  const [eventsSearch, setEventsSearch] = useState('');
  const [eventsSearchInput, setEventsSearchInput] = useState('');
  const EVENT_PAGE_SIZE = 50;

  useEffect(() => {
    api.getCampaigns().then(c => setCampaigns(c || []));
  }, []);

  useEffect(() => {
    setLoading(true);
    const p = { date };
    if (campaignId) p.campaign_id = campaignId;
    api.getAnalytics(p).then(setData).finally(() => setLoading(false));
  }, [date, campaignId]);

  useEffect(() => {
    setEventsLoading(true);
    const p = { date, page: eventsPage, pageSize: EVENT_PAGE_SIZE };
    if (campaignId) p.campaign_id = campaignId;
    if (eventsType !== 'all') p.type = eventsType;
    if (eventsSearch) p.search = eventsSearch;
    api.getAnalyticsEvents(p)
      .then(d => { setEvents(d.events || []); setEventsTotal(d.total || 0); })
      .catch(() => {})
      .finally(() => setEventsLoading(false));
  }, [date, campaignId, eventsPage, eventsType, eventsSearch]);

  const t = data?.totals || {}, r = data?.rates || {};

  // FIX: show bounces and failed in stat cards
  const statCards = [
    { l:'Sent',     v: t.sends   || 0, s: null },
    { l:'Opens',    v: t.opens   || 0, s: `${r.open_rate   || 0}% rate`, accent: true },
    { l:'Clicks',   v: t.clicks  || 0, s: `${r.click_rate  || 0}% rate`, accent: true },
    { l:'Replies',  v: t.replies || 0, s: `${r.reply_rate  || 0}% rate`, accent: true },
    { l:'Bounces',  v: t.bounces || 0, s: `${r.bounce_rate || 0}% rate`, danger: true },
    { l:'Failed',   v: t.failed  || 0, s: null, warn: true },
  ];

  const EVENT_COLORS = {
    send:        { bg:'#e8f0fe', color:'#1a56db' },
    open:        { bg:'#def7ec', color:'#057a55' },
    click:       { bg:'#edebfe', color:'#7e3af2' },
    reply:       { bg:'#fdf6b2', color:'#8e4b10' },
    replied:     { bg:'#fdf6b2', color:'#8e4b10' },
    bounce:      { bg:'#fde8e8', color:'#c81e1e' },
    auto_reply:  { bg:'#feecdc', color:'#c2410c' },
    unsubscribe: { bg:'#fde8e8', color:'#9b1c1c' },
    delivered:   { bg:'#f0fdf4', color:'#166534' },
    send_failed: { bg:'#fff7ed', color:'#9a3412' },
    spam_complaint:{ bg:'#fde8e8', color:'#7f1d1d' },
  };
  const EVENT_LABELS = {
    send:'Sent', open:'Opened', click:'Clicked', reply:'Replied', replied:'Replied',
    bounce:'Bounced', auto_reply:'Auto-Reply', unsubscribe:'Unsubscribed',
    delivered:'Delivered', send_failed:'Failed', spam_complaint:'Spam'
  };

  const eventBadge = (type) => {
    const s = EVENT_COLORS[type] || { bg:'var(--bg-muted)', color:'var(--text-secondary)' };
    return (
      <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99,
        background:s.bg, color:s.color, letterSpacing:'0.02em', textTransform:'uppercase', whiteSpace:'nowrap' }}>
        {EVENT_LABELS[type] || type}
      </span>
    );
  };

  const fmtTime = iso => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true });
  };

  const totalEventPages = Math.ceil(eventsTotal / EVENT_PAGE_SIZE);

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="topbar-title">Analytics</div>
          <div className="topbar-sub">Email performance</div>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <select className="input" style={{ width:210, fontSize:13 }} value={campaignId}
            onChange={e => { setCampaignId(e.target.value); setEventsPage(1); }}>
            <option value="">All Campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ display:'flex', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
            {[['today','Today'],['week','7 Days'],['month','30 Days'],['all','All Time']].map(([v,l]) => (
              <button key={v} onClick={() => { setDate(v); setEventsPage(1); }} className="btn"
                style={{ borderRadius:0, border:'none', borderRight:'1px solid var(--border)',
                  background:date===v?'var(--accent)':'var(--bg)',
                  color:date===v?'white':'var(--text-secondary)', padding:'6px 14px', fontSize:12 }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="page fade-in">
        {/* Stat cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:12, marginBottom:24 }}>
          {statCards.map(s => (
            <div key={s.l} className="stat-card" style={{
              borderTop: s.danger ? '3px solid var(--danger)' : s.warn ? '3px solid var(--warning)' : s.accent ? '3px solid var(--accent)' : undefined }}>
              <div className="stat-label">{s.l}</div>
              <div className="stat-value" style={{
                color: s.danger && (t.bounces||0)>0 ? 'var(--danger)'
                     : s.warn && (t.failed||0)>0 ? 'var(--warning)' : undefined }}>{s.v}</div>
              {s.s && <div className="stat-sub">{s.s}</div>}
            </div>
          ))}
        </div>

        {/* Daily breakdown */}
        <div className="card" style={{ marginBottom:16 }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:14 }}>Daily Breakdown</div>
          {loading
            ? <div style={{ padding:20, textAlign:'center', color:'var(--text-muted)' }}>Loading...</div>
            : data?.daily?.length > 0
              ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Date</th><th>Sent</th><th>Opens</th><th>Clicks</th><th>Replies</th><th>Bounces</th><th>Failed</th><th>Open %</th><th>Reply %</th><th>Bounce %</th></tr>
                    </thead>
                    <tbody>
                      {data.daily.slice(-14).reverse().map(d => (
                        <tr key={d.date}>
                          <td style={{ fontWeight:500 }}>{d.date}</td>
                          <td>{d.sends||0}</td>
                          <td style={{ color:(d.opens||0)>0?'var(--success)':undefined }}>{d.opens||0}</td>
                          <td>{d.clicks||0}</td>
                          <td>{d.replies||0}</td>
                          <td style={{ color:(d.bounces||0)>0?'var(--danger)':undefined, fontWeight:(d.bounces||0)>0?600:undefined }}>{d.bounces||0}</td>
                          <td style={{ color:(d.failed||0)>0?'var(--warning)':undefined }}>{d.failed||0}</td>
                          <td>{d.sends>0?((d.opens/d.sends)*100).toFixed(1)+'%':'—'}</td>
                          <td>{d.sends>0?((d.replies/d.sends)*100).toFixed(1)+'%':'—'}</td>
                          <td style={{ color:(d.bounces||0)>0?'var(--danger)':undefined }}>{d.sends>0?(((d.bounces||0)/d.sends)*100).toFixed(1)+'%':'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
              : <div style={{ padding:20, textAlign:'center', color:'var(--text-muted)' }}>No data for this period</div>
          }
        </div>

        {/* Inbox performance */}
        {data?.inboxes?.length > 0 && (
          <div className="card" style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, fontSize:13, marginBottom:14 }}>Inbox Performance</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Inbox</th><th>Sent</th><th>Opens</th><th>Replies</th><th>Bounces</th><th>Open %</th><th>Bounce %</th></tr></thead>
                <tbody>
                  {data.inboxes.map(i => (
                    <tr key={i.inbox}>
                      <td style={{ fontFamily:'monospace', fontSize:12 }}>{i.inbox}</td>
                      <td>{i.sends}</td>
                      <td style={{ color:i.opens>0?'var(--success)':undefined }}>{i.opens}</td>
                      <td>{i.replies}</td>
                      <td style={{ color:(i.bounces||0)>0?'var(--danger)':undefined, fontWeight:(i.bounces||0)>0?600:undefined }}>{i.bounces||0}</td>
                      <td>{i.sends>0?((i.opens/i.sends)*100).toFixed(1)+'%':'—'}</td>
                      <td style={{ color:(i.bounces||0)>0?'var(--danger)':undefined }}>{i.sends>0?(((i.bounces||0)/i.sends)*100).toFixed(1)+'%':'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── EVENT LOG ── */}
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
            <div>
              <div style={{ fontWeight:600, fontSize:13 }}>Event Log</div>
              <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>
                {eventsTotal.toLocaleString()} events — shows who opened, clicked, replied, bounced
              </div>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <select className="input" style={{ width:150, fontSize:12 }} value={eventsType}
                onChange={e => { setEventsType(e.target.value); setEventsPage(1); }}>
                <option value="all">All events</option>
                <option value="open">Opens only</option>
                <option value="click">Clicks only</option>
                <option value="send">Sends only</option>
                <option value="reply">Replies only</option>
                <option value="bounce">Bounces only</option>
                <option value="unsubscribe">Unsubscribes</option>
                <option value="auto_reply">Auto-replies</option>
                <option value="send_failed">Failed only</option>
              </select>
              <div style={{ display:'flex', gap:4 }}>
                <input className="input" style={{ width:190, fontSize:12 }} placeholder="Search email…"
                  value={eventsSearchInput}
                  onChange={e => setEventsSearchInput(e.target.value)}
                  onKeyDown={e => { if(e.key==='Enter'){ setEventsSearch(eventsSearchInput); setEventsPage(1); }}}
                />
                <button className="btn btn-secondary" style={{ fontSize:12, padding:'0 12px' }}
                  onClick={() => { setEventsSearch(eventsSearchInput); setEventsPage(1); }}>Go</button>
                {eventsSearch && (
                  <button className="btn btn-secondary" style={{ fontSize:12, padding:'0 10px' }}
                    onClick={() => { setEventsSearch(''); setEventsSearchInput(''); setEventsPage(1); }}>✕</button>
                )}
              </div>
            </div>
          </div>

          {eventsLoading ? (
            <div style={{ padding:30, textAlign:'center', color:'var(--text-muted)' }}>Loading events…</div>
          ) : events.length === 0 ? (
            <div style={{ padding:30, textAlign:'center', color:'var(--text-muted)' }}>No events found for this filter</div>
          ) : (
            <>
              <div className="table-wrap" style={{ borderRadius:0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Contact</th>
                      <th>Email Address</th>
                      <th>Subject Line</th>
                      <th>Sent From (Inbox)</th>
                      <th>Campaign</th>
                      <th>Step</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev, idx) => (
                      <tr key={ev.id || idx} style={{
                        background: ev.type==='open'?'rgba(5,122,85,0.03)'
                          : ev.type==='bounce'||ev.type==='send_failed'?'rgba(220,38,38,0.03)' : undefined }}>
                        <td style={{ whiteSpace:'nowrap' }}>{eventBadge(ev.type)}</td>
                        <td style={{ fontSize:13, fontWeight:500, whiteSpace:'nowrap' }}>
                          {ev.contact_name || <span style={{ color:'var(--text-muted)', fontSize:12 }}>—</span>}
                          {ev.contact_company && <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:400 }}>{ev.contact_company}</div>}
                        </td>
                        <td style={{ fontFamily:'monospace', fontSize:12, maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                          title={ev.recipient}>{ev.recipient || '—'}</td>
                        <td style={{ fontSize:12, maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text-secondary)' }}
                          title={ev.subject}>{ev.subject || '—'}</td>
                        <td style={{ fontFamily:'monospace', fontSize:11, color:'var(--text-muted)', maxWidth:190, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                          title={ev.inbox}>{ev.inbox || '—'}</td>
                        <td style={{ fontSize:12, color:'var(--text-secondary)', maxWidth:150, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                          title={ev.campaign}>{ev.campaign || '—'}</td>
                        <td style={{ fontSize:12, color:'var(--text-muted)', textAlign:'center' }}>{ev.step_number || '—'}</td>
                        <td style={{ fontSize:12, color:'var(--text-muted)', whiteSpace:'nowrap' }}>{fmtTime(ev.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
    </div>
  );
}



// ── INBOXES ───────────────────────────────────────────────────────────────────
export function InboxesPage() {
  const [inboxes, setInboxes] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email:'', label:'', daily_cap:100 });
  const [error, setError] = useState('');
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const load = () => api.getInboxes().then(setInboxes);
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!form.email.trim()) { setError('Email is required'); return; }
    setError('');
    try { await api.createInbox(form); setForm({ email:'', label:'', daily_cap:100 }); setAdding(false); load(); }
    catch(e) { setError(e.message); }
  };

  const totalCap = inboxes.filter(i => i.active).reduce((s, i) => s + (i.daily_cap || 100), 0);

  return (
    <div>
      <div className="topbar">
        <div><div className="topbar-title">Inboxes</div><div className="topbar-sub">{inboxes.filter(i=>i.active).length} active · {totalCap} emails/day capacity</div></div>
        <button onClick={() => setAdding(true)} className="btn btn-primary">+ Add Inbox</button>
      </div>
      <div className="page fade-in" style={{ maxWidth:700 }}>
        {adding && (
          <div className="card" style={{ marginBottom:16, borderColor:'var(--accent)' }}>
            <div style={{ fontWeight:600, marginBottom:14 }}>Add New Inbox</div>
            <div className="form-row">
              <div className="form-group"><label className="label">Email Address *</label><input className="input" placeholder="sender@yourdomain.com" value={form.email} onChange={e => setForm(f => ({ ...f, email:e.target.value }))} /></div>
              <div className="form-group"><label className="label">Label (optional)</label><input className="input" placeholder="e.g. Main inbox" value={form.label} onChange={e => setForm(f => ({ ...f, label:e.target.value }))} /></div>
              <div className="form-group"><label className="label">Daily cap</label><input type="number" className="input" value={form.daily_cap} onChange={e => setForm(f => ({ ...f, daily_cap:parseInt(e.target.value)||100 }))} /></div>
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => { setAdding(false); setError(''); }} className="btn btn-secondary">Cancel</button>
              <button onClick={handleAdd} className="btn btn-primary">Add Inbox</button>
            </div>
          </div>
        )}
        {inboxes.length === 0 && !adding ? (
          <div className="card"><div className="empty"><div className="empty-icon">📬</div><div className="empty-title">No inboxes yet</div><div className="empty-sub">Add your sending email addresses</div><button onClick={() => setAdding(true)} className="btn btn-primary" style={{ display:'inline-flex' }}>Add First Inbox</button></div></div>
        ) : (
          <div className="card" style={{ padding:0, overflow:'hidden' }}>
            {inboxes.map((inbox, i) => (
              <div key={inbox.id} style={{ padding:'14px 20px', borderBottom:i<inboxes.length-1?'1px solid var(--border)':'none', display:'flex', alignItems:'center', justifyContent:'space-between', opacity:inbox.active?1:0.5 }}>
                {editId === inbox.id ? (
                  <div style={{ display:'flex', gap:8, flex:1, alignItems:'center' }}>
                    <input className="input" style={{ flex:1 }} value={editForm.label||''} onChange={e => setEditForm(f => ({ ...f, label:e.target.value }))} placeholder="Label" />
                    <input type="number" className="input" style={{ width:80 }} value={editForm.daily_cap||100} onChange={e => setEditForm(f => ({ ...f, daily_cap:parseInt(e.target.value)||100 }))} />
                    <button onClick={async () => { await api.updateInbox(inbox.id, editForm); setEditId(null); load(); }} className="btn btn-primary btn-sm">Save</button>
                    <button onClick={() => setEditId(null)} className="btn btn-secondary btn-sm">Cancel</button>
                  </div>
                ) : (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <div style={{ width:8, height:8, borderRadius:'50%', background:inbox.active?'var(--success)':'var(--text-muted)' }} />
                      <div>
                        <div style={{ fontFamily:'monospace', fontSize:13, fontWeight:500 }}>{inbox.email}</div>
                        <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>
                          {inbox.label && <span style={{ marginRight:8 }}>{inbox.label} ·</span>}
                          {inbox.daily_cap} emails/day cap
                        </div>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={async () => { await api.updateInbox(inbox.id, { active:!inbox.active }); load(); }} className="btn btn-secondary btn-sm">{inbox.active ? 'Disable' : 'Enable'}</button>
                      <button onClick={() => { setEditId(inbox.id); setEditForm({ label:inbox.label||'', daily_cap:inbox.daily_cap||100 }); }} className="btn btn-secondary btn-sm">Edit</button>
                      <button onClick={async () => { if (!confirm('Delete?')) return; await api.deleteInbox(inbox.id); load(); }} className="btn btn-danger btn-sm">Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── BLACKLIST ──────────────────────────────────────────────────────────────────
export function BlacklistPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newReason, setNewReason] = useState('');
  const [importResult, setImportResult] = useState(null);

  const load = () => api.getBlacklist({ page }).then(d => { setItems(d.items||[]); setTotal(d.total||0); });
  useEffect(() => { load(); }, [page]);

  const handleImport = async e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const csv = ev.target.result;
      const firstLine = csv.split('\n')[0]?.toLowerCase() || '';
      if (!firstLine.includes('email')) { setImportResult({ error: 'CSV must have an "email" column header' }); return; }
      const res = await api.importBlacklist(csv).catch(err => ({ error:err.message }));
      setImportResult(res); load();
    };
    reader.readAsText(file); e.target.value = '';
  };

  const totalPages = Math.ceil(total / 50);

  // Colour-code reason badges
  const reasonColor = (reason) => {
    if (!reason) return 'var(--text-muted)';
    const r = reason.toLowerCase();
    if (r.includes('bounce')) return 'var(--danger)';
    if (r.includes('spam')) return 'var(--danger)';
    if (r.includes('unsub')) return 'var(--warning)';
    if (r.includes('24h') || r.includes('confirmation')) return 'var(--warning)';
    return 'var(--text-secondary)';
  };

  return (
    <div>
      <div className="topbar">
        <div><div className="topbar-title">Blacklist</div><div className="topbar-sub">{total} addresses — never contacted</div></div>
        <div style={{ display:'flex', gap:8 }}>
          <label className="btn btn-secondary" style={{ cursor:'pointer' }}>
            📥 Import CSV <input type="file" accept=".csv" style={{ display:'none' }} onChange={handleImport} />
          </label>
          <button onClick={() => setAdding(true)} className="btn btn-primary">+ Add Email</button>
        </div>
      </div>
      <div className="page fade-in" style={{ maxWidth:700 }}>
        {importResult && (
          <div className={`alert ${importResult.error?'alert-error':'alert-success'}`}>
            {importResult.error || `${importResult.added} emails added to blacklist`}
            <button onClick={() => setImportResult(null)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', fontSize:16 }}>×</button>
          </div>
        )}
        {adding && (
          <div className="card" style={{ marginBottom:16, borderColor:'var(--accent)' }}>
            <div style={{ fontWeight:600, marginBottom:12 }}>Add to Blacklist</div>
            <div className="form-row">
              <div className="form-group"><label className="label">Email</label><input className="input" placeholder="email@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} /></div>
              <div className="form-group"><label className="label">Reason (optional)</label><input className="input" placeholder="e.g. unsubscribed, bounce" value={newReason} onChange={e => setNewReason(e.target.value)} /></div>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => { setAdding(false); setNewEmail(''); setNewReason(''); }} className="btn btn-secondary">Cancel</button>
              <button onClick={async () => { if (!newEmail) return; await api.addToBlacklist(newEmail, newReason||'Manually blacklisted'); setAdding(false); setNewEmail(''); setNewReason(''); load(); }} className="btn btn-primary">Add</button>
            </div>
          </div>
        )}
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          {items.length === 0 ? (
            <div className="empty"><div className="empty-icon">🚫</div><div className="empty-title">Blacklist is empty</div><div className="empty-sub">Emails here will never be contacted</div></div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Email</th><th>Reason</th><th>Date Added</th><th></th></tr></thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id}>
                        <td style={{ fontFamily:'monospace', fontSize:12 }}>{item.email}</td>
                        <td>
                          <span style={{ fontSize:11, fontWeight:600, color: reasonColor(item.reason) }}>
                            {item.reason || 'manual'}
                          </span>
                        </td>
                        <td style={{ fontSize:12, color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                          {new Date(item.created_at).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' })}
                        </td>
                        <td><button onClick={async () => { await api.removeFromBlacklist(item.id); load(); }} className="btn btn-danger btn-sm">Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="pagination">
                  <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} className="btn btn-secondary btn-sm">← Prev</button>
                  <span className="page-info">Page {page} of {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} className="btn btn-secondary btn-sm">Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const [s, setS] = useState({ webhook_url:'', daily_cap:500, per_inbox_cap:100, send_hour_start:9, send_hour_end:17, skip_weekends:true, timezone:'America/New_York' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => { api.getSettings().then(d => { if (d) setS(p => ({ ...p, ...d })); }).catch(() => {}); }, []);
  const set = (k, v) => setS(p => ({ ...p, [k]:v }));

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try { await api.updateSettings(s); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    catch(e) { setError(e.message); } finally { setSaving(false); }
  };

  const handleTest = async () => {
    if (!s.webhook_url) { setError('Enter a webhook URL first'); return; }
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(s.webhook_url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ to:'test@example.com', subject:'Test from BotCipher Mail', body:'This is a test webhook call.', inbox:'test@yourdomain.com' }) });
      setTestResult({ ok:res.ok, status:res.status });
    } catch(e) { setTestResult({ ok:false, error:e.message }); }
    finally { setTesting(false); }
  };

  const TIMEZONES = ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Africa/Lagos','Africa/Nairobi','Asia/Dubai','Asia/Kolkata','Asia/Singapore'];

  return (
    <div>
      <div className="topbar">
        <div><div className="topbar-title">Settings</div><div className="topbar-sub">Global defaults for all campaigns</div></div>
        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saved ? '✓ Saved!' : saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
      <div className="page fade-in" style={{ maxWidth:660 }}>
        {error && <div className="alert alert-error">{error}</div>}
        {saved && <div className="alert alert-success">Settings saved successfully</div>}
        <div className="card" style={{ marginBottom:16 }}>
          <div style={{ fontWeight:600, marginBottom:4 }}>🔗 Webhook URL</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:12 }}>
            The endpoint that receives send instructions. Must accept POST with: <code style={{ background:'var(--bg-muted)', padding:'1px 6px', borderRadius:4 }}>to, subject, body, inbox</code>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <input className="input" style={{ flex:1, fontFamily:'monospace', fontSize:12 }} placeholder="https://your-webhook.com/send" value={s.webhook_url||''} onChange={e => set('webhook_url', e.target.value)} />
            <button onClick={handleTest} disabled={testing} className="btn btn-secondary">{testing ? 'Testing...' : 'Test'}</button>
          </div>
          {testResult && (
            <div className={`alert ${testResult.ok?'alert-success':'alert-error'}`} style={{ marginTop:10, marginBottom:0 }}>
              {testResult.ok ? `✓ Webhook responded ${testResult.status} — working!` : `✗ Failed: ${testResult.error || `Status ${testResult.status}`}`}
            </div>
          )}
        </div>
        <div className="card" style={{ marginBottom:16 }}>
          <div style={{ fontWeight:600, marginBottom:14 }}>⚡ Global Sending Defaults</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14 }}>These are defaults — each campaign can override them individually.</div>
          <div className="form-row">
            <div className="form-group"><label className="label">Total daily cap</label><input type="number" className="input" value={s.daily_cap} onChange={e => set('daily_cap', parseInt(e.target.value)||500)} /><div className="form-hint">Max emails/day across all inboxes</div></div>
            <div className="form-group"><label className="label">Per inbox cap</label><input type="number" className="input" value={s.per_inbox_cap} onChange={e => set('per_inbox_cap', parseInt(e.target.value)||100)} /></div>
            <div className="form-group"><label className="label">Send window start (0-23h)</label><input type="number" min="0" max="23" className="input" value={s.send_hour_start} onChange={e => set('send_hour_start', parseInt(e.target.value))} /></div>
            <div className="form-group"><label className="label">Send window end (0-23h)</label><input type="number" min="0" max="23" className="input" value={s.send_hour_end} onChange={e => set('send_hour_end', parseInt(e.target.value))} /></div>
            <div className="form-group"><label className="label">Fallback timezone</label>
              <select className="input" value={s.timezone} onChange={e => set('timezone', e.target.value)}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ display:'flex', alignItems:'center', gap:10, paddingTop:22 }}>
              <input type="checkbox" className="checkbox" id="sw" checked={s.skip_weekends} onChange={e => set('skip_weekends', e.target.checked)} />
              <label htmlFor="sw" style={{ fontSize:13, cursor:'pointer' }}>Skip weekends</label>
            </div>
          </div>
        </div>
        <div className="card" style={{ background:'var(--bg-subtle)' }}>
          <div style={{ fontWeight:600, marginBottom:4 }}>🗄 Database</div>
          <div style={{ fontSize:13, color:'var(--text-secondary)' }}>
            Connected to Supabase · <code style={{ fontSize:12, background:'var(--bg-muted)', padding:'1px 6px', borderRadius:4 }}>rgqaptfxmcvuptfuwike</code>
          </div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:4 }}>Unlimited event tracking. No row cap.</div>
        </div>
      </div>
    </div>
  );
}
