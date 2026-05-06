import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';

const LEAD_LABEL_COLORS = { 'Interested':'var(--success)', 'Not Interested':'var(--danger)', 'Meeting Booked':'#7c3aed', 'Wrong Person':'var(--warning)', 'Unsubscribed':'var(--text-muted)', 'Follow Up':'var(--info)' };

export default function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [campaigns, setCampaigns] = useState([]);
  const [campaignFilter, setCampaignFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.getCampaigns().then(c => setCampaigns(c || [])); }, []);

  const load = (overrideSearch) => {
    setLoading(true);
    const p = { page, status: statusFilter };
    const s = overrideSearch !== undefined ? overrideSearch : search;
    if (s) p.search = s.trim();
    if (campaignFilter) p.campaign_id = campaignFilter;
    api.getAllContacts(p)
      .then(d => { setContacts(d.contacts || []); setTotal(d.total || 0); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, statusFilter, campaignFilter]); // search triggered manually via button/enter

  const totalPages = Math.ceil(total / 50);
  const STATUS_FILTERS = ['all','active','completed','replied','bounced','blacklisted','unsubscribed'];

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="topbar-title">Contacts</div>
          <div className="topbar-sub">{total} total across all campaigns</div>
        </div>
      </div>

      <div className="page fade-in">
        {/* Filters */}
        <div className="card" style={{ marginBottom:16, padding:'14px 16px' }}>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
            <input className="input" style={{ maxWidth:260 }} placeholder="Search email, name, company..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key==='Enter') { setPage(1); load(); } }} />
            <select className="input" style={{ width:200 }} value={campaignFilter} onChange={e => { setCampaignFilter(e.target.value); setPage(1); }}>
              <option value="">All Campaigns</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => { setPage(1); load(search); }} className="btn btn-primary btn-sm">Search</button>
          </div>
          <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }}>
            {STATUS_FILTERS.map(s => (
              <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }} className="btn btn-sm" style={{ background:statusFilter===s?'var(--accent)':'var(--bg)', color:statusFilter===s?'white':'var(--text-secondary)', border:`1px solid ${statusFilter===s?'var(--accent)':'var(--border)'}` }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          {loading ? (
            <div style={{ padding:32, textAlign:'center', color:'var(--text-muted)' }}>Loading contacts...</div>
          ) : contacts.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">👥</div>
              <div className="empty-title">No contacts found</div>
              <div className="empty-sub">Import contacts through a campaign to see them here</div>
              <Link to="/campaigns" className="btn btn-primary" style={{ display:'inline-flex' }}>Go to Campaigns</Link>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Name</th>
                      <th>Company</th>
                      <th>City</th>
                      <th>TZ</th>
                      <th>Campaign</th>
                      <th>Status</th>
                      <th>Label</th>
                      <th>Step</th>
                      <th>Enrolled</th>
                      <th>Next Send</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map(c => (
                      <tr key={c.id}>
                        <td style={{ fontFamily:'monospace', fontSize:11 }}>{c.email}</td>
                        <td style={{ fontWeight:500, fontSize:13 }}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
                        <td style={{ fontSize:12, color:'var(--text-secondary)' }}>{c.company || '—'}</td>
                        <td style={{ fontSize:12, color:'var(--text-secondary)' }}>{c.city || '—'}</td>
                        <td style={{ fontSize:11, color:'var(--text-muted)' }}>{c.timezone ? c.timezone.split('/').pop() : '—'}</td>
                        <td>
                          {c.campaign_id ? (
                            <Link to={`/campaigns/${c.campaign_id}`} style={{ color:'var(--info)', textDecoration:'none', fontSize:12 }}>
                              {campaigns.find(x => x.id === c.campaign_id)?.name || 'View'}
                            </Link>
                          ) : '—'}
                        </td>
                        <td><span className={`badge badge-${c.status}`}>{c.status}</span></td>
                        <td>
                          {c.lead_label ? (
                            <span style={{ fontSize:11, fontWeight:600, color: LEAD_LABEL_COLORS[c.lead_label] || 'var(--text-secondary)' }}>
                              {c.lead_label}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ fontSize:12, color:'var(--text-secondary)' }}>{c.current_step > 0 ? `Step ${c.current_step}` : '—'}</td>
                        <td style={{ fontSize:11, color:'var(--text-muted)' }}>{c.enrolled_at ? new Date(c.enrolled_at).toLocaleDateString() : '—'}</td>
                        <td style={{ fontSize:11, color:'var(--text-muted)' }}>{c.next_send_at ? new Date(c.next_send_at).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="pagination">
                  <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1} className="btn btn-secondary btn-sm">← Prev</button>
                  <span className="page-info">Page {page} of {totalPages} · {total} contacts</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages} className="btn btn-secondary btn-sm">Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
