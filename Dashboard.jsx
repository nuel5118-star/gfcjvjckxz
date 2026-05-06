import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';

export default function Dashboard() {
  const [campaigns, setCampaigns] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getCampaigns(), api.getAnalytics({ date: 'today' })])
      .then(([c, a]) => { setCampaigns(c || []); setAnalytics(a); })
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
