import { useState, useEffect, useRef } from 'react';

const BASE = '/api';
async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
}

const TYPE_COLOR = { error: 'var(--danger)', warn: 'var(--warning)', send: 'var(--success)', skip: 'var(--text-muted)', info: 'var(--info, #60a5fa)' };
const TYPE_BG    = { error: 'rgba(220,38,38,0.08)', warn: 'rgba(251,191,36,0.08)', send: 'rgba(34,197,94,0.06)', skip: 'transparent', info: 'transparent' };
const TYPE_BADGE = { error: 'badge-bounced', warn: 'badge-paused', send: 'badge-active', skip: 'badge-draft', info: 'badge-active' };

function StatCard({ label, value, sub, color }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 24, color: color || 'var(--text)' }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function DiagnosticsPanel({ diag }) {
  if (!diag) return null;
  const checks = [
    { label: 'Webhook configured', ok: diag.webhook_configured, detail: diag.webhook_url_preview || 'Not set — go to Settings' },
    { label: 'Active inboxes', ok: diag.active_inboxes > 0, detail: `${diag.active_inboxes} inbox(es) active` },
    { label: 'Active campaigns', ok: diag.active_campaigns > 0, detail: `${diag.active_campaigns} campaign(s) running` },
    { label: 'Contacts in queue', ok: diag.sample_active_contacts?.length > 0, detail: diag.sample_active_contacts?.length > 0 ? `${diag.sample_active_contacts.length}+ active contacts found` : 'No active contacts with next_send_at set' },
    { label: 'Server timezone', ok: true, detail: diag.server_timezone },
  ];
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>🩺 System Diagnostics</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: 10, marginBottom: 16 }}>
        {checks.map(c => (
          <div key={c.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: c.ok ? 'rgba(34,197,94,0.05)' : 'rgba(220,38,38,0.05)', borderRadius: 8, border: `1px solid ${c.ok ? 'rgba(34,197,94,0.2)' : 'rgba(220,38,38,0.2)'}` }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{c.ok ? '✅' : '❌'}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{c.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{c.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {diag.sample_active_contacts?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Sample Active Contacts (next scheduled sends)</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {diag.sample_active_contacts.map(c => {
              const isPast = c.next_send_at && new Date(c.next_send_at) < new Date();
              return (
                <div key={c.id} style={{ display: 'flex', gap: 16, padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 8, fontSize: 12, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{c.email}</span>
                  <span style={{ color: 'var(--text-muted)' }}>Step {c.current_step}</span>
                  <span style={{ color: 'var(--text-muted)' }}>via {c.assigned_inbox || 'no inbox'}</span>
                  <span style={{ color: isPast ? 'var(--danger)' : 'var(--success)', marginLeft: 'auto', fontWeight: 600 }}>
                    {c.next_send_at ? (isPast ? '⚠️ OVERDUE — ' : '🕐 ') + new Date(c.next_send_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'No send time set'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {diag.campaigns?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Active Campaigns</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {diag.campaigns.map(c => (
              <div key={c.id} style={{ padding: '6px 12px', background: 'var(--bg-subtle)', borderRadius: 8, fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{c.timezone} · {c.send_hour_start}:00–{c.send_hour_end}:00</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
        Snapshot taken at {new Date(diag.timestamp).toLocaleString()}
      </div>
    </div>
  );
}

export default function ErrorLogsPage() {
  const [logs, setLogs] = useState([]);
  const [diag, setDiag] = useState(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedLog, setExpandedLog] = useState(null);
  const [expandedRun, setExpandedRun] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [showDiag, setShowDiag] = useState(false);
  const [loadingDiag, setLoadingDiag] = useState(false);
  const [clearing, setClearing] = useState(false);
  const intervalRef = useRef();

  const loadLogs = async () => {
    try {
      const data = await req('GET', `/scheduler/logs?type=${typeFilter}&limit=500`);
      setLogs(data);
      setLastRefresh(new Date());
    } catch (e) {
      console.error('Failed to load logs:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadDiag = async () => {
    setLoadingDiag(true);
    try {
      const data = await req('GET', '/scheduler/diagnostics');
      setDiag(data);
      setShowDiag(true);
    } catch (e) { alert(e.message); }
    finally { setLoadingDiag(false); }
  };

  useEffect(() => { loadLogs(); }, [typeFilter]);

  useEffect(() => {
    if (autoRefresh) { intervalRef.current = setInterval(loadLogs, 10000); }
    else { clearInterval(intervalRef.current); }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, typeFilter]);

  const handleClear = async () => {
    const label = typeFilter === 'all' ? 'ALL logs' : `all "${typeFilter}" logs`;
    if (!confirm(`Clear ${label}? This cannot be undone.`)) return;
    setClearing(true);
    try {
      await req('DELETE', `/scheduler/logs${typeFilter !== 'all' ? `?type=${typeFilter}` : ''}`);
      await loadLogs();
    } catch (e) { alert(e.message); }
    finally { setClearing(false); }
  };

  // Group logs by run_id for better readability
  const filteredLogs = logs.filter(l => {
    if (search) {
      const s = search.toLowerCase();
      return l.message?.toLowerCase().includes(s) || JSON.stringify(l.details || {}).toLowerCase().includes(s);
    }
    return true;
  });

  // Stats
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayLogs = logs.filter(l => new Date(l.created_at) >= today);
  const errorsToday = todayLogs.filter(l => l.type === 'error').length;
  const sendsToday = todayLogs.filter(l => l.type === 'send').length;
  const warnsToday = todayLogs.filter(l => l.type === 'warn').length;
  const lastError = logs.find(l => l.type === 'error');

  // Group by run_id
  const runs = {};
  filteredLogs.forEach(l => {
    const key = l.run_id || 'no_run';
    if (!runs[key]) runs[key] = { run_id: l.run_id, logs: [], started_at: l.created_at };
    runs[key].logs.push(l);
  });
  const runGroups = Object.values(runs).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="topbar-title">Error Logs &amp; Diagnostics</div>
          <div className="topbar-sub">
            {lastRefresh ? `Refreshed ${lastRefresh.toLocaleTimeString()}` : 'Loading...'}
            {autoRefresh && <span style={{ marginLeft: 8, color: 'var(--success)', fontSize: 11 }}>● Live — refreshing every 10s</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setAutoRefresh(!autoRefresh)} className="btn btn-secondary btn-sm">
            {autoRefresh ? '⏸ Pause live' : '▶ Go live'}
          </button>
          <button onClick={loadLogs} className="btn btn-secondary btn-sm">↻ Refresh</button>
          <button onClick={loadDiag} disabled={loadingDiag} className="btn btn-secondary btn-sm">
            🩺 {loadingDiag ? 'Loading...' : 'Run Diagnostics'}
          </button>
          <button onClick={handleClear} disabled={clearing || logs.length === 0} className="btn btn-danger btn-sm">
            🗑 {clearing ? 'Clearing...' : `Clear ${typeFilter !== 'all' ? typeFilter : 'all'} logs`}
          </button>
        </div>
      </div>

      <div className="page fade-in">

        {/* Migration reminder */}
        <div className="alert alert-warning" style={{ marginBottom: 16, fontSize: 13 }}>
          <strong>⚠️ First-time setup:</strong> If you see no logs or get a "table not found" error, run <code style={{ background: 'rgba(0,0,0,0.1)', padding: '2px 6px', borderRadius: 4 }}>db-migration.sql</code> in your Supabase SQL Editor. This creates the <code style={{ background: 'rgba(0,0,0,0.1)', padding: '2px 6px', borderRadius: 4 }}>scheduler_logs</code> table and adds missing columns.
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
          <StatCard label="Errors Today" value={errorsToday} sub={lastError ? `Last: ${new Date(lastError.created_at).toLocaleTimeString()}` : 'None'} color={errorsToday > 0 ? 'var(--danger)' : 'var(--success)'} />
          <StatCard label="Sends Logged" value={sendsToday} sub="today (scheduler_logs)" color="var(--success)" />
          <StatCard label="Warnings Today" value={warnsToday} sub="cap, webhook, config" color={warnsToday > 0 ? 'var(--warning)' : 'var(--text-muted)'} />
          <StatCard label="Total Logs" value={logs.length} sub={`showing last 500`} color="var(--text-muted)" />
        </div>

        {/* Diagnostics panel */}
        {showDiag && <DiagnosticsPanel diag={diag} />}

        {/* Last error highlight */}
        {lastError && (
          <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--danger)', marginBottom: 6 }}>🔴 MOST RECENT ERROR</div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{lastError.message}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: lastError.details ? 8 : 0 }}>
              {new Date(lastError.created_at).toLocaleString()} · Run: {lastError.run_id || 'N/A'}
            </div>
            {lastError.details && Object.keys(typeof lastError.details === 'string' ? JSON.parse(lastError.details || '{}') : lastError.details).length > 0 && (
              <pre style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-subtle)', padding: 10, borderRadius: 6, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(typeof lastError.details === 'string' ? JSON.parse(lastError.details || '{}') : lastError.details, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Type:</span>
          {['all', 'error', 'warn', 'send', 'skip', 'info'].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} className={`btn btn-sm ${typeFilter === t ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 11, color: typeFilter === t ? undefined : TYPE_COLOR[t] }}>
              {t === 'all' ? `All (${logs.length})` : `${t.charAt(0).toUpperCase() + t.slice(1)} (${logs.filter(l => l.type === t).length})`}
            </button>
          ))}
          <div style={{ flex: 1, minWidth: 180 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search messages..."
              style={{ width: '100%', padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', fontSize: 12, boxSizing: 'border-box' }}
            />
          </div>
        </div>

        {/* Logs grouped by run */}
        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading logs…</div>
        ) : filteredLogs.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon">📋</div>
              <div className="empty-title">No logs found</div>
              <div className="empty-sub">
                {search ? 'No logs match your search.' : typeFilter !== 'all' ? `No "${typeFilter}" logs.` : 'Run the scheduler to generate logs. Make sure db-migration.sql has been executed in Supabase.'}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {runGroups.map(group => {
              const hasError = group.logs.some(l => l.type === 'error');
              const hasWarn = group.logs.some(l => l.type === 'warn');
              const sentCount = group.logs.filter(l => l.type === 'send').length;
              const isExpanded = expandedRun === group.run_id;
              const summary = group.logs.find(l => l.type === 'info' && l.message?.includes('complete'));
              const isManual = group.logs[group.logs.length - 1]?.message?.includes('manual');

              return (
                <div key={group.run_id} className="card" style={{ padding: 0, overflow: 'hidden', border: hasError ? '1px solid rgba(220,38,38,0.3)' : hasWarn ? '1px solid rgba(251,191,36,0.2)' : '1px solid var(--border)' }}>
                  {/* Run header */}
                  <div
                    onClick={() => setExpandedRun(isExpanded ? null : group.run_id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', background: hasError ? 'rgba(220,38,38,0.04)' : hasWarn ? 'rgba(251,191,36,0.03)' : 'transparent', userSelect: 'none' }}
                  >
                    <span style={{ fontSize: 14 }}>{isExpanded ? '▼' : '▶'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                          {group.run_id === 'no_run' ? 'Ungrouped Events' : (isManual ? '👤 Manual run' : '⏱ Cron run')}
                        </span>
                        {hasError && <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600 }}>● {group.logs.filter(l => l.type === 'error').length} error(s)</span>}
                        {sentCount > 0 && <span style={{ fontSize: 11, color: 'var(--success)' }}>✓ {sentCount} sent</span>}
                        {hasWarn && !hasError && <span style={{ fontSize: 11, color: 'var(--warning)' }}>⚠ warning</span>}
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{group.logs.length} events</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {new Date(group.started_at).toLocaleString()}
                        {group.run_id !== 'no_run' && <span style={{ marginLeft: 8, fontFamily: 'monospace' }}>{group.run_id}</span>}
                      </div>
                    </div>
                    {summary && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', maxWidth: 300 }}>
                        {summary.message}
                      </div>
                    )}
                  </div>

                  {/* Run events */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border)' }}>
                      {group.logs.map(l => (
                        <div key={l.id}>
                          <div
                            onClick={() => setExpandedLog(expandedLog === l.id ? null : l.id)}
                            style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '9px 16px 9px 32px', background: TYPE_BG[l.type], borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                          >
                            <div style={{ paddingTop: 2 }}>
                              <span className={`badge ${TYPE_BADGE[l.type] || 'badge-draft'}`} style={{ fontSize: 10, color: TYPE_COLOR[l.type] }}>
                                {l.type}
                              </span>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, color: 'var(--text)' }}>{l.message}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                {new Date(l.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </div>
                            </div>
                            {l.details && Object.keys(typeof l.details === 'string' ? JSON.parse(l.details || '{}') : l.details).length > 0 && (
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', paddingTop: 2 }}>
                                {expandedLog === l.id ? '▲ hide' : '▼ details'}
                              </span>
                            )}
                          </div>
                          {expandedLog === l.id && l.details && (
                            <div style={{ padding: '10px 16px 10px 32px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
                              <pre style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {JSON.stringify(typeof l.details === 'string' ? JSON.parse(l.details || '{}') : l.details, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
