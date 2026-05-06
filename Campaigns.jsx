import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = () => api.getCampaigns().then(c => setCampaigns(c || [])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);
  const counts = { all: campaigns.length, active: 0, paused: 0, draft: 0, completed: 0 };
  campaigns.forEach(c => { if (counts[c.status] !== undefined) counts[c.status]++; });

  return (
    <div>
      <div className="topbar">
        <div><div className="topbar-title">Campaigns</div><div className="topbar-sub">{campaigns.length} total</div></div>
        <Link to="/campaigns/new" className="btn btn-primary">+ New Campaign</Link>
      </div>
      <div className="page fade-in">
        <div className="tabs">
          {['all', 'active', 'paused', 'draft', 'completed'].map(s => (
            <div key={s} className={`tab${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({counts[s] || 0})</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
            : filtered.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">✉️</div>
                <div className="empty-title">No campaigns</div>
                <Link to="/campaigns/new" className="btn btn-primary" style={{ display: 'inline-flex' }}>Create Campaign</Link>
              </div>
            ) : filtered.map(c => {
              const steps = c.campaign_steps?.length || 0;
              const contacts = c.contacts?.[0]?.count || 0;
              return (
                <Link key={c.id} to={`/campaigns/${c.id}`} className="campaign-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                    <span className={`dot dot-${c.status}`} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 12 }}>
                        <span>{steps} step{steps !== 1 ? 's' : ''}</span>
                        <span>{contacts} contacts</span>
                        <span>{c.daily_cap}/day cap</span>
                        {c.start_date && <span>Starts {c.start_date}</span>}
                        {c.end_date && <span>Ends {c.end_date}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge badge-${c.status}`}>{c.status}</span>
                    {c.status === 'active' && (
                      <button onClick={async e => { e.preventDefault(); await api.pauseCampaign(c.id); load(); }} className="btn btn-secondary btn-sm">Pause</button>
                    )}
                    {c.status === 'paused' && (
                      <button onClick={async e => { e.preventDefault(); await api.resumeCampaign(c.id); load(); }} className="btn btn-primary btn-sm">Resume</button>
                    )}
                    <Link to={`/campaigns/${c.id}/edit`} onClick={e => e.stopPropagation()} className="btn btn-secondary btn-sm">Edit</Link>
                    <button onClick={async e => { e.preventDefault(); if (!confirm(`Delete "${c.name}"?`)) return; await api.deleteCampaign(c.id); load(); }} className="btn btn-danger btn-sm">Delete</button>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </Link>
              );
            })}
        </div>
      </div>
    </div>
  );
}
