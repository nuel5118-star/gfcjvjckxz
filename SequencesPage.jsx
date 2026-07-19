import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';

export default function SequencesPage() {
  const [sequences, setSequences] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => api.getSequences().then(s => setSequences(s || [])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="topbar-title">Sequences</div>
          <div className="topbar-sub">Reusable email sets — build once, pull emails into any campaign</div>
        </div>
        <Link to="/sequences/new" className="btn btn-primary">+ New Sequence</Link>
      </div>
      <div className="page fade-in">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
            : sequences.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">📚</div>
                <div className="empty-title">No sequences yet</div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>
                  Build a sequence, then pull individual emails from it into any campaign.
                </div>
                <Link to="/sequences/new" className="btn btn-primary" style={{ display: 'inline-flex' }}>Create Sequence</Link>
              </div>
            ) : sequences.map(s => {
              const count = (s.sequence_steps || []).length;
              return (
                <Link key={s.id} to={`/sequences/${s.id}/edit`} className="campaign-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {count} email{count !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Link to={`/sequences/${s.id}/edit`} onClick={e => e.stopPropagation()} className="btn btn-secondary btn-sm">Edit</Link>
                    <button onClick={async e => { e.preventDefault(); if (!confirm(`Delete "${s.name}"? Campaigns that already pulled emails from it keep their own copies.`)) return; await api.deleteSequence(s.id); load(); }} className="btn btn-danger btn-sm">Delete</button>
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
