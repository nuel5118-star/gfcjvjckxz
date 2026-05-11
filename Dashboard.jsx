import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';

async function getSchedulerStatus() {
  const res = await fetch('/api/scheduler/status');
  return res.ok ? res.json() : null;
}

export default function Dashboard() {
  const [campaigns, setCampaigns] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scheduler, setScheduler] = useState(null);

  useEffect(() => {
    Promise.all([api.getCampaigns(), api.getAnalytics({ date: 'today' }), getSchedulerStatus()])
      .then(([c, a, s]) => { setCampaigns(c || []); setAnalytics(a); setScheduler(s); })
      .finally(() => setLoading(false));
  }, []);

  const active = campaigns.filter(c => c.status === 'active').length;
  const t = analytics?.totals || {};
  const r = analytics?.rates || {};

  return (
    <div>
      <div className="topbar">
        <div><div className="topbar-title">Dashboard</div><div className="topbar-sub">Today's overview</div></div>
        <Link to="/campaigns/new" className="btn btn-primary">+ New Campaign</Link>
      </div>
      <div className="page fade-in">
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
          {[
            { label: 'Sent Today', value: t.sends || 0, sub: 'emails dispatched' },
            { label: 'Opens', value: t.opens || 0, sub: `${r.open_rate || 0}% rate` },
            { label: 'Clicks', value: t.clicks || 0, sub: `${r.click_rate || 0}% rate` },
            { label: 'Replies', value: t.replies || 0, sub: `${r.reply_rate || 0}% rate` },
            { label: 'Active Campaigns', value: active, sub: `${campaigns.length} total` },
          ].map(s => (
            <div className="stat-card" key={s.label}>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>
        {/* Scheduler status banner */}
        {scheduler && (
          <div style={{ background: scheduler.webhook_configured ? 'var(--success-bg)' : 'var(--danger-bg)', border: `1px solid ${scheduler.webhook_configured ? 'var(--success-border)' : 'var(--danger-border)'}`, borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: scheduler.webhook_configured ? 'var(--success)' : 'var(--danger)' }}>
                {scheduler.webhook_configured ? '✅ Scheduler Active' : '⚠️ Webhook not configured'}
              </span>
              {scheduler.webhook_configured && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Sent today: <strong>{scheduler.sent_today}/{scheduler.daily_cap}</strong></span>
                  {scheduler.pending_now > 0 && <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>⚡ {scheduler.pending_now} overdue sends</span>}
                  {scheduler.scheduled_today > 0 && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{scheduler.scheduled_today} scheduled today</span>}
                </>
              )}
            </div>
            <Link to="/queue" style={{ fontSize: 12, color: 'var(--info)', textDecoration: 'none', fontWeight: 500 }}>View Queue →</Link>
          </div>
        )}

        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Campaigns</span>
            <Link to="/campaigns" style={{ fontSize: 13, color: 'var(--info)', textDecoration: 'none' }}>View all →</Link>
          </div>
          {loading ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
            : campaigns.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">✉️</div>
                <div className="empty-title">No campaigns yet</div>
                <div className="empty-sub">Create your first campaign to start sending</div>
                <Link to="/campaigns/new" className="btn btn-primary" style={{ display: 'inline-flex' }}>New Campaign</Link>
              </div>
            ) : campaigns.slice(0, 8).map(c => (
              <Link key={c.id} to={`/campaigns/${c.id}`} className="campaign-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className={`dot dot-${c.status}`} />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {c.campaign_steps?.length || 0} steps · {c.daily_cap}/day
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className={`badge badge-${c.status}`}>{c.status}</span>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg>
                </div>
              </Link>
            ))}
        </div>
      </div>
    </div>
  );
}
