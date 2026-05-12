import { useState, useEffect, useRef, useCallback } from 'react';

const BASE = '/api';
async function apiFetch(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
}

const TYPE_COLOR  = { error:'#ef4444', warn:'#f59e0b', send:'#22c55e', skip:'#6b7280', info:'#60a5fa', connected:'#a78bfa' };
const TYPE_EMOJI  = { error:'✗', warn:'⚠', send:'✓', skip:'↷', info:'·', connected:'⚡' };
const TYPE_BG     = { error:'rgba(239,68,68,0.07)', warn:'rgba(245,158,11,0.06)', send:'rgba(34,197,94,0.06)', skip:'transparent', info:'transparent', connected:'rgba(167,139,250,0.07)' };

// ── LIVE FEED ROW ────────────────────────────────────────────────────────────
function LogRow({ log, expanded, onToggle, isNew }) {
  const detailsObj = typeof log.details === 'string' ? (() => { try { return JSON.parse(log.details); } catch { return {}; } })() : (log.details || {});
  const hasDetails = Object.keys(detailsObj).length > 0;
  const color = TYPE_COLOR[log.type] || '#9ca3af';
  const ts = new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div style={{ background: isNew ? 'rgba(96,165,250,0.06)' : TYPE_BG[log.type], borderLeft: `3px solid ${color}`, marginBottom: 2, borderRadius: '0 6px 6px 0', transition: 'background 1s' }}>
      <div onClick={hasDetails ? onToggle : undefined} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 12px', cursor: hasDetails ? 'pointer' : 'default', userSelect: 'none' }}>
        <span style={{ color, fontSize: 13, fontWeight: 700, minWidth: 14, lineHeight: '20px' }}>{TYPE_EMOJI[log.type] || '·'}</span>
        <span style={{ color: '#4b5563', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap', lineHeight: '20px', minWidth: 70 }}>{ts}</span>
        <span style={{ color, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', minWidth: 46, lineHeight: '20px' }}>{log.type}</span>
        <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, lineHeight: '20px' }}>{log.message}</span>
        {hasDetails && <span style={{ fontSize: 10, color: '#6b7280', whiteSpace: 'nowrap', lineHeight: '20px' }}>{expanded ? '▲' : '▼'}</span>}
      </div>
      {expanded && hasDetails && (
        <div style={{ padding: '6px 12px 10px 49px' }}>
          <pre style={{ margin: 0, fontSize: 11, color: '#9ca3af', background: 'rgba(0,0,0,0.15)', padding: '8px 12px', borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>
            {JSON.stringify(detailsObj, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function ErrorLogsPage() {
  const [liveLogs, setLiveLogs] = useState([]);        // streamed in real-time via SSE
  const [historyLogs, setHistoryLogs] = useState([]);  // loaded from DB
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState('live');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  const [newIds, setNewIds] = useState(new Set());
  const [diag, setDiag] = useState(null);
  const [loadingDiag, setLoadingDiag] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [paused, setPaused] = useState(false);
  const liveRef = useRef([]);
  const feedRef = useRef();
  const esRef = useRef();
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // Connect SSE
  useEffect(() => {
    function connect() {
      if (esRef.current) esRef.current.close();
      const es = new EventSource('/api/scheduler/logs/stream');
      esRef.current = es;

      es.onopen = () => { setConnected(true); };

      es.onmessage = (e) => {
        try {
          const log = JSON.parse(e.data);
          if (pausedRef.current) return;
          liveRef.current = [log, ...liveRef.current].slice(0, 2000);
          setLiveLogs([...liveRef.current]);
          setNewIds(prev => { const s = new Set(prev); s.add(log.id); setTimeout(() => setNewIds(p => { const n = new Set(p); n.delete(log.id); return n; }), 2000); return s; });
          // auto-scroll to top of live feed
          if (feedRef.current && tab === 'live') feedRef.current.scrollTop = 0;
        } catch {}
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        // reconnect after 3 seconds
        setTimeout(connect, 3000);
      };
    }
    connect();
    return () => { if (esRef.current) esRef.current.close(); };
  }, []);

  // Load history from DB
  const loadHistory = useCallback(async (page = 1) => {
    try {
      const data = await apiFetch('GET', `/scheduler/logs?type=${typeFilter}&page=${page}&pageSize=200`);
      setHistoryLogs(data.logs || []);
      setHistoryTotal(data.total || 0);
      setHistoryPage(page);
    } catch (e) { console.error('History load failed:', e); }
  }, [typeFilter]);

  useEffect(() => { if (tab === 'history') loadHistory(1); }, [tab, typeFilter]);

  const toggleExpand = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  const handleClear = async () => {
    if (!confirm('Clear all logs from the database? Live feed is not affected.')) return;
    setClearing(true);
    try { await apiFetch('DELETE', `/scheduler/logs`); await loadHistory(1); }
    catch (e) { alert(e.message); }
    finally { setClearing(false); }
  };

  const handleDiag = async () => {
    setLoadingDiag(true);
    try { const d = await apiFetch('GET', '/scheduler/diagnostics'); setDiag(d); }
    catch (e) { alert(e.message); }
    finally { setLoadingDiag(false); }
  };

  const filteredLive = liveLogs.filter(l => {
    if (typeFilter !== 'all' && l.type !== typeFilter) return false;
    if (search) { const s = search.toLowerCase(); return l.message?.toLowerCase().includes(s) || JSON.stringify(l.details || {}).toLowerCase().includes(s); }
    return true;
  });

  const filteredHistory = historyLogs.filter(l => {
    if (search) { const s = search.toLowerCase(); return l.message?.toLowerCase().includes(s) || JSON.stringify(l.details || {}).toLowerCase().includes(s); }
    return true;
  });

  // Stats from live logs
  const liveErrors = liveLogs.filter(l => l.type === 'error').length;
  const liveSends  = liveLogs.filter(l => l.type === 'send').length;
  const liveSkips  = liveLogs.filter(l => l.type === 'skip').length;
  const liveWarns  = liveLogs.filter(l => l.type === 'warn').length;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* TOPBAR */}
      <div className="topbar" style={{ flexShrink: 0 }}>
        <div>
          <div className="topbar-title">Live Scheduler Logs</div>
          <div className="topbar-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: connected ? '#22c55e' : '#ef4444', boxShadow: connected ? '0 0 6px #22c55e' : 'none', animation: connected ? 'pulse 2s infinite' : 'none' }} />
            <span style={{ color: connected ? '#22c55e' : '#ef4444', fontWeight: 600, fontSize: 12 }}>{connected ? 'LIVE' : 'Reconnecting...'}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{liveLogs.length} events captured this session</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setPaused(!paused)} className={`btn btn-sm ${paused ? 'btn-primary' : 'btn-secondary'}`}>
            {paused ? '▶ Resume' : '⏸ Pause'} feed
          </button>
          <button onClick={() => { liveRef.current = []; setLiveLogs([]); }} className="btn btn-secondary btn-sm">
            🗑 Clear live
          </button>
          <button onClick={handleDiag} disabled={loadingDiag} className="btn btn-secondary btn-sm">
            🩺 {loadingDiag ? '...' : 'Diagnostics'}
          </button>
          <button onClick={handleClear} disabled={clearing} className="btn btn-danger btn-sm">
            🗑 {clearing ? 'Clearing...' : 'Clear DB logs'}
          </button>
        </div>
      </div>

      <div className="page fade-in" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* STATS BAR */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, flexShrink: 0 }}>
          {[
            { label: 'Errors', value: liveErrors, color: liveErrors > 0 ? '#ef4444' : '#6b7280' },
            { label: 'Sent', value: liveSends, color: liveSends > 0 ? '#22c55e' : '#6b7280' },
            { label: 'Skipped', value: liveSkips, color: '#6b7280' },
            { label: 'Warnings', value: liveWarns, color: liveWarns > 0 ? '#f59e0b' : '#6b7280' },
            { label: 'Total', value: liveLogs.length, color: 'var(--text)' },
          ].map(s => (
            <div key={s.label} className="stat-card" style={{ padding: '10px 14px' }}>
              <div className="stat-label">{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>this session</div>
            </div>
          ))}
        </div>

        {/* DIAGNOSTICS PANEL */}
        {diag && (
          <div className="card" style={{ flexShrink: 0, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <strong>🩺 Diagnostics snapshot — {new Date(diag.timestamp).toLocaleTimeString()}</strong>
              <button onClick={() => setDiag(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8, marginBottom: 10 }}>
              {[
                { label: 'Webhook', ok: diag.webhook_configured, detail: diag.webhook_url_preview || 'Not set' },
                { label: 'Active inboxes', ok: diag.active_inboxes > 0, detail: `${diag.active_inboxes} inbox(es)` },
                { label: 'Active campaigns', ok: diag.active_campaigns > 0, detail: `${diag.active_campaigns} active` },
                { label: 'Contacts in queue', ok: diag.active_contacts_in_queue > 0, detail: `${diag.active_contacts_in_queue} scheduled` },
                { label: 'Overdue now', ok: true, detail: `${diag.overdue_contacts} due immediately` },
                { label: 'No inbox assigned', ok: diag.contacts_with_no_inbox === 0, detail: `${diag.contacts_with_no_inbox} contacts missing inbox` },
              ].map(c => (
                <div key={c.label} style={{ padding: '8px 12px', background: c.ok ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', borderRadius: 8, border: `1px solid ${c.ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                  <span style={{ marginRight: 6 }}>{c.ok ? '✅' : '❌'}</span>
                  <strong>{c.label}</strong>
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{c.detail}</div>
                </div>
              ))}
            </div>
            {diag.all_campaigns?.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>All campaigns:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {diag.all_campaigns.map(c => (
                    <span key={c.id} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, background: c.status === 'active' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.08)', color: c.status === 'active' ? '#22c55e' : '#ef4444', border: `1px solid ${c.status === 'active' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.2)'}` }}>
                      {c.name} — <strong>{c.status}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* FILTERS */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
          {['all','error','warn','send','skip','info'].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} className={`btn btn-sm ${typeFilter === t ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 11, color: typeFilter === t ? undefined : TYPE_COLOR[t] || 'inherit' }}>
              {t === 'all' ? 'All' : t}
            </button>
          ))}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search messages or details..."
            style={{ flex: 1, minWidth: 180, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', fontSize: 12 }} />
          <div className="tabs" style={{ margin: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div className={`tab${tab === 'live' ? ' active' : ''}`} onClick={() => setTab('live')} style={{ padding: '6px 14px', fontSize: 12 }}>
              ⚡ Live feed {paused && <span style={{ color: '#f59e0b' }}>(paused)</span>}
            </div>
            <div className={`tab${tab === 'history' ? ' active' : ''}`} onClick={() => { setTab('history'); loadHistory(1); }} style={{ padding: '6px 14px', fontSize: 12 }}>
              🗂 History ({historyTotal})
            </div>
          </div>
        </div>

        {/* LOG FEED */}
        <div ref={feedRef} style={{ flex: 1, overflow: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, fontFamily: 'monospace' }}>

          {tab === 'live' && (
            filteredLive.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>{connected ? '👁' : '🔌'}</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                  {connected ? 'Watching for scheduler activity...' : 'Connecting to live stream...'}
                </div>
                <div style={{ fontSize: 12 }}>
                  {connected
                    ? 'Every scheduler decision will appear here in real time. Click "Run Scheduler Now" on the Queue page to trigger a run.'
                    : 'Reconnecting automatically...'}
                </div>
              </div>
            ) : (
              <div style={{ padding: '4px 0' }}>
                {filteredLive.map(log => (
                  <LogRow key={log.id} log={log} expanded={!!expanded[log.id]} onToggle={() => toggleExpand(log.id)} isNew={newIds.has(log.id)} />
                ))}
              </div>
            )
          )}

          {tab === 'history' && (
            filteredHistory.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>No logs in database</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>Trigger a scheduler run to generate logs. Make sure db-migration.sql was run in Supabase.</div>
              </div>
            ) : (
              <div style={{ padding: '4px 0' }}>
                {filteredHistory.map(log => (
                  <LogRow key={log.id} log={log} expanded={!!expanded[log.id]} onToggle={() => toggleExpand(log.id)} isNew={false} />
                ))}
                {historyTotal > historyLogs.length && (
                  <div style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <button onClick={() => loadHistory(historyPage + 1)} className="btn btn-secondary btn-sm">
                      Load more ({historyLogs.length} of {historyTotal})
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>

      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
      `}</style>
    </div>
  );
}
