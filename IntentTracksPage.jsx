import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';

export default function IntentTracksPage() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => api.getIntentTracks().then(t => setTracks(t || [])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="topbar-title">Intent Tracks</div>
          <div className="topbar-sub">Reusable sequences for contacts who show interest — build once, attach to any campaign</div>
        </div>
        <Link to="/intent-tracks/new" className="btn btn-primary">+ New Intent Track</Link>
      </div>
      <div className="page fade-in">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
            : tracks.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">🎯</div>
                <div className="empty-title">No Intent Tracks yet</div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>
                  Build a track (e.g. "Engaged — Used Calculator"), then go to any campaign and attach it with a trigger — like "switch here when someone submits the calculator."
                </div>
                <Link to="/intent-tracks/new" className="btn btn-primary" style={{ display: 'inline-flex' }}>Create Intent Track</Link>
              </div>
            ) : tracks.map(t => {
              const count = (t.intent_track_steps || []).length;
              return (
                <Link key={t.id} to={`/intent-tracks/${t.id}/edit`} className="campaign-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                      {t.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t.description}</div>}
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {count} email{count !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Link to={`/intent-tracks/${t.id}/edit`} onClick={e => e.stopPropagation()} className="btn btn-secondary btn-sm">Edit</Link>
                    <button onClick={async e => { e.preventDefault(); if (!confirm(`Delete "${t.name}"? Campaigns that already attached it keep their own copy of its emails.`)) return; await api.deleteIntentTrack(t.id); load(); }} className="btn btn-danger btn-sm">Delete</button>
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
