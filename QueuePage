import { useState, useEffect, useRef } from 'react';

const BASE = '/api';
async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
}

function StatusDot({ ok }) {
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: ok ? 'var(--success)' : 'var(--danger)', marginRight: 6 }} />;
}

function ProgressBar({ value, max, color = 'var(--accent)' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const barColor = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : color;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
        <span>{value} / {max}</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg-muted)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export default function QueuePage() {
  const [status, setStatus] = useState(null);
  const [queue, setQueue] = useState([]);
  const [recent, setRecent] = useState([]);
  const [logs, setLogs] = useState([]);
  const [tab, setTab] = useState('overview');
  const [triggering, setTriggering] = useState(false);
  const [pausingAll, setPausingAll] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef();

  const load = async () => {
    try {
      const [s, q, r, l] = await Promise.all([
        req('GET', '/scheduler/status'),
        req('GET', '/scheduler/queue'),
        req('GET', '/scheduler/recent'),
        req('GET', '/scheduler/logs'),
      ]);
      setStatus(s);
      setQueue(q);
      setRecent(r);
      setLogs(l);
      setLastRefresh(new Date());
    } catch (e) {
      console.error('Failed to load queue:', e);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(load, 15000); // refresh every 15s
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await req('POST', '/scheduler/run');
      setTimeout(load, 2000); // reload after 2s
    } catch (e) { alert(e.message); }
    finally { setTriggering(false); }
  };

  const handlePauseAll = async () => {
    if (!confirm('Pause ALL active campaigns?')) return;
    setPausingAll(true);
    try { await req('POST', '/campaigns/pause-all'); load(); }
    catch (e) { alert(e.message); }
    finally { setPausingAll(false); }
  };

  const handleResumeAll = async () => {
    if (!confirm('Resume ALL paused campaigns?')) return;
    try { await req('POST', '/campaigns/resume-all'); load(); }
    catch (e) { alert(e.message); }
  };

  const handleSendNow = async (contactId, email) => {
    if (!confirm(`Force send to ${email} in next scheduler tick?`)) return;
    try {
      await req('POST', `/contacts/${contactId}/send-now`);
      alert('Scheduled for next tick (30 seconds)');
      load();
    } catch (e) { alert(e.message); }
  };

  const handleRetry = async (sendId) => {
    try { await req('POST', `/scheduler/retry/${sendId}`); load(); }
    catch (e) { alert(e.message); }
  };

  const failed = recent.filter(r => r.status === 'failed');
  const webhookAlert = status && !status.webhook_configured;
  const highFailRate = failed.length >= 3;

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="topbar-title">Scheduler Queue</div>
          <div className="topbar-sub">
            {lastRefresh ? `Last refreshed ${lastRefresh.toLocaleTimeString()}` : 'Loading...'}
            {autoRefresh && <span style={{ marginLeft: 8, color: 'var(--success)', fontSize: 11 }}>● Auto-refreshing every 15s</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setAutoRefresh(!autoRefresh)} className="btn btn-secondary btn-sm">
            {autoRefresh ? '⏸ Pause refresh' : '▶ Auto refresh'}
          </button>
          <button onClick={load} className="btn btn-secondary btn-sm">↻ Refresh now</button>
          <button onClick={handleResumeAll} className="btn btn-secondary btn-sm">▶ Resume all</button>
          <button onClick={handlePauseAll} disabled={pausingAll} className="btn btn-danger btn-sm">
            ⏸ {pausingAll ? 'Pausing...' : 'Pause all'}
          </button>
          <button onClick={handleTrigger} disabled={triggering || status?.is_running} className="btn btn-primary">
            {triggering || status?.is_running ? '⚡ Running...' : '⚡ Run Scheduler Now'}
          </button>
        </div>
      </div>

      <div className="page fade-in">

        {/* Alerts */}
        {webhookAlert && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            ⚠️ <strong>No webhook URL configured.</strong> Emails cannot be sent. Go to <a href="/settings" style={{ color: 'var(--danger)', fontWeight: 600 }}>Settings</a> and add your webhook URL.
          </div>
        )}
        {highFailRate && (
          <div className="alert alert-warning" style={{ marginBottom: 16 }}>
            ⚠️ <strong>{failed.length} failed sends detected.</strong> Your webhook may be down. Check the Failed tab below.
          </div>
        )}

        {/* Overview stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Sent Today', value: status?.sent_today || 0, sub: `cap: ${status?.daily_cap || 500}`, color: 'var(--success)' },
            { label: 'Failed Today', value: status?.failed_today || 0, sub: 'webhook errors', color: status?.failed_today > 0 ? 'var(--danger)' : 'var(--text-muted)' },
            { label: 'Pending Now', value: status?.pending_now || 0, sub: 'overdue sends', color: status?.pending_now > 0 ? 'var(--warning)' : 'var(--text-muted)' },
            { label: 'Scheduled Today', value: status?.scheduled_today || 0, sub: 'upcoming sends', color: 'var(--info)' },
            { label: 'Scheduler', value: status?.is_running ? 'Running' : 'Idle', sub: status?.last_run ? `Last: ${new Date(status.last_run).toLocaleTimeString()}` : 'Never ran', color: status?.is_running ? 'var(--success)' : 'var(--text-muted)' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ fontSize: 22, color: s.color }}>{s.value}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Daily progress */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Daily Cap Progress</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Total</div>
            <ProgressBar value={status?.sent_today || 0} max={status?.daily_cap || 500} />
          </div>
          {status?.inbox_status?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Per Inbox</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
                {status.inbox_status.map(i => (
                  <div key={i.email} style={{ padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text)', marginBottom: 6, fontWeight: 500 }}>{i.email}</div>
                    <ProgressBar value={i.sent} max={i.cap} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Scheduler info */}
        <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Webhook</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                <StatusDot ok={status?.webhook_configured} />
                {status?.webhook_configured ? 'Configured' : 'Not configured'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Last run</div>
              <div style={{ fontSize: 13 }}>{status?.last_run ? new Date(status.last_run).toLocaleTimeString() : 'Never'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Next run (approx)</div>
              <div style={{ fontSize: 13 }}>{status?.next_run ? new Date(status.next_run).toLocaleTimeString() : '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Status</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: status?.is_running ? 'var(--success)' : 'var(--text-muted)' }}>
                <StatusDot ok={status?.is_running} />
                {status?.is_running ? 'Running now' : 'Idle'}
              </div>
            </div>
          </div>
          <button onClick={handleTrigger} disabled={triggering || status?.is_running} className="btn btn-primary">
            ⚡ {triggering ? 'Triggering...' : 'Run Now'}
          </button>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <div className={`tab${tab === 'queue' ? ' active' : ''}`} onClick={() => setTab('queue')}>
            Pending Queue ({status?.pending_now || 0} overdue · {status?.scheduled_today || 0} today)
          </div>
          <div className={`tab${tab === 'recent' ? ' active' : ''}`} onClick={() => setTab('recent')}>
            Recent Sends ({recent.filter(r => r.status === 'sent').length} sent)
          </div>
          <div className={`tab${tab === 'failed' ? ' active' : ''}`} onClick={() => setTab('failed')} style={{ color: failed.length > 0 ? 'var(--danger)' : undefined }}>
            Failed ({failed.length})
          </div>
          <div className={`tab${tab === 'logs' ? ' active' : ''}`} onClick={() => setTab('logs')}>
            Activity Log
          </div>
        </div>

        {/* PENDING QUEUE */}
        {tab === 'queue' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {queue.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">✅</div>
                <div className="empty-title">Queue is clear</div>
                <div className="empty-sub">No pending sends right now</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Name</th>
                      <th>Campaign</th>
                      <th>Step</th>
                      <th>Scheduled</th>
                      <th>Inbox</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map(c => {
                      const isOverdue = new Date(c.next_send_at) < new Date();
                      return (
                        <tr key={c.id} style={{ background: isOverdue ? 'rgba(251,191,36,0.05)' : undefined }}>
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{c.email}</td>
                          <td style={{ fontSize: 13 }}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.campaigns?.name || '—'}</td>
                          <td style={{ fontSize: 12 }}>Step {c.current_step}</td>
                          <td style={{ fontSize: 11 }}>
                            <span style={{ color: isOverdue ? 'var(--danger)' : 'var(--text-muted)' }}>
                              {isOverdue ? '⚠️ OVERDUE — ' : ''}{new Date(c.next_send_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </td>
                          <td style={{ fontSize: 11, fontFamily: 'monospace' }}>{c.assigned_inbox || '—'}</td>
                          <td><span className={`badge ${isOverdue ? 'badge-bounced' : 'badge-active'}`}>{isOverdue ? 'overdue' : 'scheduled'}</span></td>
                          <td>
                            <button onClick={() => handleSendNow(c.id, c.email)} className="btn btn-primary btn-sm" style={{ fontSize: 11 }}>
                              Send now
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* RECENT SENDS */}
        {tab === 'recent' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {recent.filter(r => r.status === 'sent').length === 0 ? (
              <div className="empty">
                <div className="empty-icon">📭</div>
                <div className="empty-title">No sends yet</div>
                <div className="empty-sub">Emails will appear here after the scheduler runs</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Email</th><th>Subject</th><th>Inbox</th><th>Step</th><th>Sent At</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {recent.filter(r => r.status === 'sent').map(s => (
                      <tr key={s.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.email}</td>
                        <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.subject}</td>
                        <td style={{ fontSize: 11, fontFamily: 'monospace' }}>{s.inbox}</td>
                        <td style={{ fontSize: 12 }}>Step {s.step_number}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(s.sent_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                        <td><span className="badge badge-active">sent</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* FAILED */}
        {tab === 'failed' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {failed.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">✅</div>
                <div className="empty-title">No failures</div>
                <div className="empty-sub">All sends completed successfully</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Email</th><th>Subject</th><th>Inbox</th><th>Step</th><th>Failed At</th><th></th></tr>
                  </thead>
                  <tbody>
                    {failed.map(s => (
                      <tr key={s.id} style={{ background: 'rgba(220,38,38,0.03)' }}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.email}</td>
                        <td style={{ fontSize: 12 }}>{s.subject}</td>
                        <td style={{ fontSize: 11, fontFamily: 'monospace' }}>{s.inbox}</td>
                        <td style={{ fontSize: 12 }}>Step {s.step_number}</td>
                        <td style={{ fontSize: 11, color: 'var(--danger)' }}>{new Date(s.sent_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                        <td><button onClick={() => handleRetry(s.id)} className="btn btn-secondary btn-sm">Retry</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ACTIVITY LOG */}
        {tab === 'logs' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {logs.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">📋</div>
                <div className="empty-title">No activity yet</div>
                <div className="empty-sub">Scheduler events will appear here</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Time</th><th>Type</th><th>Message</th></tr>
                  </thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id}>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                        <td><span className={`badge ${l.type === 'error' ? 'badge-bounced' : l.type === 'warn' ? 'badge-paused' : 'badge-active'}`}>{l.type}</span></td>
                        <td style={{ fontSize: 12 }}>{l.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
