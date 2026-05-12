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
        <span>{value} / {max}</span><span>{pct}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg-muted)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

function RunResultBanner({ result, onClose }) {
  if (!result) return null;
  const isOk = result.errors === 0;
  const bg = result.errors > 0 ? 'rgba(220,38,38,0.08)' : result.sent === 0 ? 'rgba(251,191,36,0.08)' : 'rgba(34,197,94,0.08)';
  const border = result.errors > 0 ? 'var(--danger)' : result.sent === 0 ? 'var(--warning)' : 'var(--success)';
  const reasonMessages = {
    no_webhook: '⚠️ No webhook URL is configured. Go to Settings → paste your n8n/webhook URL.',
    daily_cap_reached: '📊 Daily sending cap has been reached for today. Sending resumes tomorrow.',
    no_contacts_due: '🕐 No contacts are due right now. The 10 scheduled contacts will send automatically when their scheduled time arrives today. Use "Force Send Campaign" to override.',
    db_error: '🔴 Database query error — check Activity Logs for details.',
    fatal_error: '🔴 Fatal scheduler error — check Activity Logs for details.',
    already_running: '⏳ Scheduler was already running.',
  };
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: border }}>
          Last Run Result — {new Date().toLocaleTimeString()}
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 13, marginBottom: result.reason ? 8 : 0 }}>
          <span>✅ Sent: <strong>{result.sent}</strong></span>
          <span>⏭ Skipped: <strong>{result.skipped}</strong></span>
          <span>❌ Errors: <strong style={{ color: result.errors > 0 ? 'var(--danger)' : 'inherit' }}>{result.errors}</strong></span>
        </div>
        {result.reason && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            {reasonMessages[result.reason] || `Reason: ${result.reason}`}
          </div>
        )}
      </div>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', padding: '0 4px' }}>×</button>
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
  const [runResult, setRunResult] = useState(null);
  const [logFilter, setLogFilter] = useState('all');
  const [forceSendCampaignId, setForceSendCampaignId] = useState('');
  const [forceSending, setForceSending] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [expandedLog, setExpandedLog] = useState(null);
  const intervalRef = useRef();

  const load = async () => {
    try {
      const [s, q, r] = await Promise.all([
        req('GET', '/scheduler/status'),
        req('GET', '/scheduler/queue?pageSize=2000'),
        req('GET', '/scheduler/recent?pageSize=1000'),
      ]);
      setStatus(s);
      setQueue(q.contacts || []);
      setRecent(r.sends || []);
      setLastRefresh(new Date());
    } catch (e) { console.error('Failed to load queue:', e); }
  };

  const loadLogs = async () => {
    try {
      const data = await req('GET', `/scheduler/logs?type=${logFilter}&pageSize=500`);
      setLogs(data.logs || []);
    } catch (e) { console.error('Failed to load logs:', e); }
  };

  const loadCampaigns = async () => {
    try {
      const data = await req('GET', '/campaigns');
      setCampaigns((data || []).filter(c => c.status === 'active'));
    } catch (e) {}
  };

  useEffect(() => { load(); loadCampaigns(); }, []);
  useEffect(() => { if (tab === 'logs') loadLogs(); }, [tab, logFilter]);

  useEffect(() => {
    if (autoRefresh) { intervalRef.current = setInterval(load, 15000); }
    else { clearInterval(intervalRef.current); }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh]);

  // FIX: handleTrigger now waits for the scheduler to finish and shows what happened
  const handleTrigger = async () => {
    setTriggering(true);
    setRunResult(null);
    try {
      const res = await req('POST', '/scheduler/run');
      if (res.result) setRunResult(res.result);
      await load();
      if (tab === 'logs') await loadLogs();
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
    if (!confirm(`Reschedule ${email} to send in the next scheduler tick?`)) return;
    try {
      await req('POST', `/contacts/${contactId}/send-now`);
      await handleTrigger();
    } catch (e) { alert(e.message); }
  };

  const handleRetry = async (sendId) => {
    try { await req('POST', `/scheduler/retry/${sendId}`); load(); }
    catch (e) { alert(e.message); }
  };

  // FIX: campaign-level force send — reschedules all contacts then runs scheduler
  const handleForceSendCampaign = async () => {
    if (!forceSendCampaignId) return alert('Select a campaign first');
    const camp = campaigns.find(c => c.id === forceSendCampaignId);
    if (!confirm(`Force send ALL active contacts in "${camp?.name}" right now?\n\nThis overrides their scheduled times.`)) return;
    setForceSending(true);
    try {
      const res = await req('POST', `/campaigns/${forceSendCampaignId}/send-now`);
      alert(`✅ ${res.rescheduled} contacts rescheduled.\n\nRunning scheduler now...`);
      await handleTrigger();
    } catch (e) { alert(e.message); }
    finally { setForceSending(false); }
  };

  const handleClearLogs = async () => {
    if (!confirm(`Clear all ${logFilter === 'all' ? '' : logFilter + ' '}logs? This cannot be undone.`)) return;
    try { await req('DELETE', `/scheduler/logs${logFilter !== 'all' ? `?type=${logFilter}` : ''}`); await loadLogs(); }    catch (e) { alert(e.message); }
  };

  const failed = recent.filter(r => r.status === 'failed');
  const webhookAlert = status && !status.webhook_configured;
  const highFailRate = failed.length >= 3;

  const logTypeColor = { error: 'var(--danger)', warn: 'var(--warning)', send: 'var(--success)', skip: 'var(--text-muted)', info: 'var(--info)' };
  const logTypeBadge = { error: 'badge-bounced', warn: 'badge-paused', send: 'badge-active', skip: 'badge-draft', info: 'badge-active' };

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="topbar-title">Scheduler Queue</div>
          <div className="topbar-sub">
            {lastRefresh ? `Refreshed ${lastRefresh.toLocaleTimeString()}` : 'Loading...'}
            {autoRefresh && <span style={{ marginLeft: 8, color: 'var(--success)', fontSize: 11 }}>● Auto-refreshing every 15s</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setAutoRefresh(!autoRefresh)} className="btn btn-secondary btn-sm">
            {autoRefresh ? '⏸ Pause refresh' : '▶ Auto refresh'}
          </button>
          <button onClick={load} className="btn btn-secondary btn-sm">↻ Refresh</button>
          <button onClick={handleResumeAll} className="btn btn-secondary btn-sm">▶ Resume all</button>
          <button onClick={handlePauseAll} disabled={pausingAll} className="btn btn-danger btn-sm">
            ⏸ {pausingAll ? 'Pausing...' : 'Pause all'}
          </button>
          <button onClick={handleTrigger} disabled={triggering || status?.is_running} className="btn btn-primary">
            {triggering ? '⚡ Running...' : status?.is_running ? '⚡ Running...' : '⚡ Run Scheduler Now'}
          </button>
        </div>
      </div>

      <div className="page fade-in">
        {/* Alerts */}
        {webhookAlert && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            ⚠️ <strong>No webhook URL configured.</strong> Emails cannot be sent. Go to <a href="/settings" style={{ color: 'var(--danger)', fontWeight: 600 }}>Settings</a> and add your n8n webhook URL.
          </div>
        )}
        {highFailRate && (
          <div className="alert alert-warning" style={{ marginBottom: 16 }}>
            ⚠️ <strong>{failed.length} failed sends detected.</strong> Check the Failed tab and Activity Log for error details.
          </div>
        )}

        {/* FIX: Last run result banner */}
        <RunResultBanner result={runResult} onClose={() => setRunResult(null)} />

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Sent Today', value: status?.sent_today || 0, sub: `cap: ${status?.daily_cap || 500}`, color: 'var(--success)' },
            { label: 'Failed Today', value: status?.failed_today || 0, sub: 'webhook errors', color: status?.failed_today > 0 ? 'var(--danger)' : 'var(--text-muted)' },
            { label: 'Pending Now', value: status?.pending_now || 0, sub: 'overdue — pick up now', color: status?.pending_now > 0 ? 'var(--warning)' : 'var(--text-muted)' },
            { label: 'Scheduled Today', value: status?.scheduled_today || 0, sub: 'will send at scheduled time', color: 'var(--info)' },
            { label: 'Scheduler', value: status?.is_running ? 'Running' : 'Idle', sub: status?.last_run ? `Last: ${new Date(status.last_run).toLocaleTimeString()}` : 'Never ran', color: status?.is_running ? 'var(--success)' : 'var(--text-muted)' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ fontSize: 22, color: s.color }}>{s.value}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Daily cap progress */}
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

        {/* Scheduler info + FIX: Force Send Campaign */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
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
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Next cron</div>
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
              ⚡ {triggering ? 'Running...' : 'Run Now'}
            </button>
          </div>

          {/* FIX: Force Send Campaign — overrides scheduled times */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
              🚀 Force Send Campaign Now
              <span style={{ fontWeight: 400, marginLeft: 8, color: 'var(--text-muted)' }}>— overrides scheduled times, sends all active contacts immediately</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={forceSendCampaignId}
                onChange={e => setForceSendCampaignId(e.target.value)}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', fontSize: 13, maxWidth: 340 }}
              >
                <option value="">Select active campaign…</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                onClick={handleForceSendCampaign}
                disabled={forceSending || !forceSendCampaignId}
                className="btn btn-primary"
                style={{ background: 'var(--warning)', borderColor: 'var(--warning)', color: '#000' }}
              >
                {forceSending ? '⏳ Sending...' : '⚡ Force Send Now'}
              </button>
            </div>
            {campaigns.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>No active campaigns found.</div>
            )}
          </div>
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
          <div className={`tab${tab === 'logs' ? ' active' : ''}`} onClick={() => { setTab('logs'); loadLogs(); }}>
            Activity Log {logs.filter(l => l.type === 'error').length > 0 && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>● {logs.filter(l => l.type === 'error').length} errors</span>}
          </div>
        </div>

        {/* PENDING QUEUE */}
        {tab === 'queue' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {queue.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">✅</div>
                <div className="empty-title">Queue is clear</div>
                <div className="empty-sub">No active contacts with a scheduled send time</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Email</th><th>Name</th><th>Campaign</th><th>Step</th><th>Scheduled</th><th>Inbox</th><th>Status</th><th></th></tr>
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
                <div className="empty-sub">Emails will appear here after the scheduler runs successfully</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Email</th><th>Subject</th><th>Inbox</th><th>Step</th><th>Sent At</th><th>Status</th></tr></thead>
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
                  <thead><tr><th>Email</th><th>Subject</th><th>Inbox</th><th>Step</th><th>Error</th><th>Failed At</th><th></th></tr></thead>
                  <tbody>
                    {failed.map(s => (
                      <tr key={s.id} style={{ background: 'rgba(220,38,38,0.03)' }}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.email}</td>
                        <td style={{ fontSize: 12 }}>{s.subject}</td>
                        <td style={{ fontSize: 11, fontFamily: 'monospace' }}>{s.inbox}</td>
                        <td style={{ fontSize: 12 }}>Step {s.step_number}</td>
                        {/* FIX: show stored error_message */}
                        <td style={{ fontSize: 11, color: 'var(--danger)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.error_message}>
                          {s.error_message || '—'}
                        </td>
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

        {/* ACTIVITY LOG — FIX: full logging with filter, details expand, clear */}
        {tab === 'logs' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Filter:</span>
              {['all', 'error', 'warn', 'send', 'skip', 'info'].map(t => (
                <button key={t} onClick={() => setLogFilter(t)} className={`btn btn-sm ${logFilter === t ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 11, color: logFilter === t ? undefined : logTypeColor[t] }}>
                  {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button onClick={loadLogs} className="btn btn-secondary btn-sm">↻ Refresh</button>
              <button onClick={handleClearLogs} className="btn btn-danger btn-sm" style={{ fontSize: 11 }}>🗑 Clear {logFilter !== 'all' ? logFilter : 'all'} logs</button>
            </div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {logs.length === 0 ? (
                <div className="empty">
                  <div className="empty-icon">📋</div>
                  <div className="empty-title">No activity logs yet</div>
                  <div className="empty-sub">
                    {logFilter !== 'all' ? `No "${logFilter}" logs found.` : 'Run the scheduler or check that db-migration.sql has been run in Supabase.'}
                  </div>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th style={{ width: 130 }}>Time</th><th style={{ width: 80 }}>Type</th><th>Message</th><th style={{ width: 80 }}>Details</th></tr>
                    </thead>
                    <tbody>
                      {logs.map(l => (
                        <>
                          <tr key={l.id} style={{ background: l.type === 'error' ? 'rgba(220,38,38,0.04)' : l.type === 'warn' ? 'rgba(251,191,36,0.03)' : undefined }}>
                            <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {new Date(l.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </td>
                            <td>
                              <span className={`badge ${logTypeBadge[l.type] || 'badge-draft'}`} style={{ color: logTypeColor[l.type] }}>
                                {l.type}
                              </span>
                            </td>
                            <td style={{ fontSize: 12 }}>{l.message}</td>
                            <td>
                              {l.details && Object.keys(typeof l.details === 'string' ? JSON.parse(l.details || '{}') : l.details).length > 0 && (
                                <button onClick={() => setExpandedLog(expandedLog === l.id ? null : l.id)} className="btn btn-secondary btn-sm" style={{ fontSize: 10 }}>
                                  {expandedLog === l.id ? 'Hide' : 'Details'}
                                </button>
                              )}
                            </td>
                          </tr>
                          {expandedLog === l.id && (
                            <tr key={`${l.id}-detail`} style={{ background: 'var(--bg-subtle)' }}>
                              <td colSpan={4} style={{ padding: '8px 16px' }}>
                                <pre style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                                  {JSON.stringify(typeof l.details === 'string' ? JSON.parse(l.details || '{}') : l.details, null, 2)}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
