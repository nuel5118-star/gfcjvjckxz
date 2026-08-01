import { useState, useEffect } from 'react';
import { api } from './api.js';

export default function UnsubscribesPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newReason, setNewReason] = useState('');

  const load = () => api.getUnsubscribes({ page }).then(d => { setItems(d.items || []); setTotal(d.total || 0); });
  useEffect(() => { load(); }, [page]);

  const totalPages = Math.ceil(total / 50);

  const reasonLabel = (reason) => {
    if (!reason) return 'manual';
    if (reason === 'link_click') return 'clicked unsubscribe link';
    return reason;
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="topbar-title">Unsubscribed</div>
          <div className="topbar-sub">{total} addresses — opted out, separate from Blacklist</div>
        </div>
        <button onClick={() => setAdding(true)} className="btn btn-primary">+ Add Email</button>
      </div>
      <div className="page fade-in" style={{ maxWidth: 700 }}>
        {adding && (
          <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Add to Unsubscribed</div>
            <div className="form-row">
              <div className="form-group"><label className="label">Email</label><input className="input" placeholder="email@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} /></div>
              <div className="form-group"><label className="label">Reason (optional)</label><input className="input" placeholder="e.g. asked to be removed by phone" value={newReason} onChange={e => setNewReason(e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setAdding(false); setNewEmail(''); setNewReason(''); }} className="btn btn-secondary">Cancel</button>
              <button onClick={async () => { if (!newEmail) return; await api.addUnsubscribe(newEmail, newReason || 'manual'); setAdding(false); setNewEmail(''); setNewReason(''); load(); }} className="btn btn-primary">Add</button>
            </div>
          </div>
        )}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {items.length === 0 ? (
            <div className="empty"><div className="empty-icon">✉️</div><div className="empty-title">No unsubscribes yet</div><div className="empty-sub">Anyone who clicks the unsubscribe link in an email shows up here</div></div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Email</th><th>Reason</th><th>Date</th><th></th></tr></thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.email}</td>
                        <td><span style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning)' }}>{reasonLabel(item.reason)}</span></td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td>
                          <button
                            onClick={async () => { if (!confirm(`Remove ${item.email} from the unsubscribed list? This does NOT automatically re-add them to any campaign — it just means they're no longer blocked if you re-import them.`)) return; await api.removeUnsubscribe(item.id); load(); }}
                            className="btn btn-danger btn-sm"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="pagination">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn btn-secondary btn-sm">← Prev</button>
                  <span className="page-info">Page {page} of {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn btn-secondary btn-sm">Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
