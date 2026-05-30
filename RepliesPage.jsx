import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function ReplyBodyModal({ reply, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg)', borderRadius: 12, padding: 28, maxWidth: 640, width: '100%',
        maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{reply.recipient}</div>
            {reply.contact && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {[reply.contact.first_name, reply.contact.last_name].filter(Boolean).join(' ')}
                {reply.contact.campaigns?.name && ` · ${reply.contact.campaigns.name}`}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Subject: {reply.subject || '(no subject)'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          {formatDateTime(reply.created_at)} · via {reply.inbox || '—'}
        </div>
        <div style={{
          background: 'var(--bg-subtle)', borderRadius: 8, padding: 16,
          fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: 'var(--text)'
        }}>
          {reply.reply_body || '(no body)'}
        </div>
      </div>
    </div>
  );
}

export default function RepliesPage() {
  const [replies, setReplies] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedReply, setSelectedReply] = useState(null);

  const load = (overrideSearch) => {
    setLoading(true);
    const s = overrideSearch !== undefined ? overrideSearch : search;
    const params = { page, pageSize: 50, type: typeFilter };
    if (s) params.search = s.trim();
    api.getReplies(params)
      .then(d => { setReplies(d.replies || []); setTotal(d.total || 0); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { setPage(1); }, [typeFilter]);
  useEffect(() => { load(); }, [page, typeFilter]);

  const totalPages = Math.ceil(total / 50);

  const typeLabel = (type) => {
    if (type === 'auto_reply') return { label: 'Auto Reply', color: 'var(--warning)' };
    return { label: 'Reply', color: 'var(--success)' };
  };

  return (
    <div>
      {selectedReply && <ReplyBodyModal reply={selectedReply} onClose={() => setSelectedReply(null)} />}

      <div className="topbar">
        <div>
          <div className="topbar-title">Replies</div>
          <div className="topbar-sub">{total} total replies received</div>
        </div>
      </div>

      <div className="page fade-in">
        {/* Filters */}
        <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Search by email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setPage(1); load(search); } }}
            />
            <button onClick={() => { setPage(1); load(search); }} className="btn btn-primary btn-sm">Search</button>
            <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
              {[['all', 'All'], ['reply', 'Real Replies'], ['auto_reply', 'Auto Replies']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => { setTypeFilter(val); setPage(1); }}
                  className="btn btn-sm"
                  style={{
                    background: typeFilter === val ? 'var(--accent)' : 'var(--bg)',
                    color: typeFilter === val ? 'white' : 'var(--text-secondary)',
                    border: `1px solid ${typeFilter === val ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading replies...</div>
          ) : replies.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">💬</div>
              <div className="empty-title">No replies yet</div>
              <div className="empty-sub">Replies from your contacts will appear here</div>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>From</th>
                      <th>Name</th>
                      <th>Campaign</th>
                      <th>Subject</th>
                      <th>Inbox</th>
                      <th>Received</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {replies.map(r => {
                      const tl = typeLabel(r.type);
                      const contact = r.contact;
                      return (
                        <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedReply(r)}>
                          <td>
                            <span style={{ fontSize: 11, fontWeight: 700, color: tl.color }}>
                              {tl.label}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.recipient}</td>
                          <td style={{ fontSize: 13, fontWeight: 500 }}>
                            {contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—' : '—'}
                          </td>
                          <td style={{ fontSize: 12 }}>
                            {contact?.campaign_id ? (
                              <Link
                                to={`/campaigns/${contact.campaign_id}`}
                                style={{ color: 'var(--info)', textDecoration: 'none', fontSize: 12 }}
                                onClick={e => e.stopPropagation()}
                              >
                                {contact.campaigns?.name || 'View'}
                              </Link>
                            ) : r.campaign || '—'}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.subject || '—'}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.inbox || '—'}</td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDateTime(r.created_at)}</td>
                          <td>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={e => { e.stopPropagation(); setSelectedReply(r); }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="pagination">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn btn-secondary btn-sm">← Prev</button>
                  <span className="page-info">Page {page} of {totalPages} · {total} replies</span>
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
