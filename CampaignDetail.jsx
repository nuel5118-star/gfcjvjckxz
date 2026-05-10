import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from './api.js';

const LEAD_LABELS = ['', 'Interested', 'Not Interested', 'Meeting Booked', 'Wrong Person', 'Follow Up', 'Unsubscribed'];
const STATUS_FILTERS = ['all','active','completed','replied','bounced','blacklisted','unsubscribed','removed','auto_replied'];

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [launching, setLaunching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeTab, setActiveTab] = useState('contacts');

  const load = async () => {
    const [c, ct, an] = await Promise.all([
      api.getCampaign(id),
      api.getContacts(id, { page, status: statusFilter, search }),
      api.getCampaignAnalytics(id)
    ]);
    setCampaign(c);
    setContacts(ct.contacts || []);
    setTotal(ct.total || 0);
    setAnalytics(an);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id, page, statusFilter, search]);

  const handleLaunch = async () => {
    if (!confirm('Launch this campaign? Emails will start sending according to your schedule.')) return;
    setLaunching(true);
    try {
      const res = await api.launchCampaign(id);
      alert(`🚀 Launched! ${res.scheduled} contacts scheduled.`);
      load();
    } catch (e) { alert('Error: ' + e.message); }
    finally { setLaunching(false); }
  };

  const handleBulkAction = async (action) => {
    if (!selectedIds.length) return alert('Select contacts first');
    if (!confirm(`${action} ${selectedIds.length} contacts?`)) return;
    await api.bulkAction(id, action, selectedIds);
    setSelectedIds([]);
    load();
  };

  const toggleSelect = (contactId) => {
    setSelectedIds(prev => prev.includes(contactId) ? prev.filter(x => x !== contactId) : [...prev, contactId]);
  };

  const toggleSelectAll = () => {
    setSelectedIds(selectedIds.length === contacts.length ? [] : contacts.map(c => c.id));
  };

  const updateLabel = async (contactId, label) => {
    await api.updateContactStatus(contactId, { lead_label: label });
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, lead_label: label } : c));
  };

  if (loading) return <div style={{ padding: 32, color: 'var(--text-muted)' }}>Loading...</div>;
  if (!campaign) return <div style={{ padding: 32, color: 'var(--text-muted)' }}>Campaign not found</div>;

  const steps = (campaign.campaign_steps || []).sort((a, b) => a.step_number - b.step_number);
  const totalPages = Math.ceil(total / 50);
  const an = analytics || {};

  return (
    <div>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/campaigns')} className="btn btn-secondary btn-sm">← Back</button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="topbar-title">{campaign.name}</div>
              <span className={`badge badge-${campaign.status}`}>{campaign.status}</span>
            </div>
            <div className="topbar-sub">
              {total} contacts · {steps.length} steps · {campaign.daily_cap}/day cap
              {campaign.start_date && ` · Starts ${campaign.start_date}`}
              {campaign.end_date && ` · Ends ${campaign.end_date}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/campaigns/${id}/edit`} className="btn btn-secondary btn-sm">Edit</Link>
          <button onClick={() => navigate(`/campaigns/${id}/import`)} className="btn btn-secondary btn-sm">
            ⬆️ Import CSV
          </button>
          <button onClick={() => api.exportContacts(id, statusFilter)} className="btn btn-secondary btn-sm">
            ⬇️ Export CSV
          </button>
          {campaign.status === 'draft' && (
            <button onClick={handleLaunch} disabled={launching} className="btn btn-primary">
              ▶ {launching ? 'Launching...' : 'Launch'}
            </button>
          )}
          {campaign.status === 'active' && (
            <button onClick={async () => { await api.pauseCampaign(id); load(); }} className="btn btn-secondary btn-sm">⏸ Pause</button>
          )}
          {campaign.status === 'paused' && (
            <button onClick={async () => { await api.resumeCampaign(id); load(); }} className="btn btn-primary btn-sm">▶ Resume</button>
          )}
        </div>
      </div>

      <div className="page fade-in">
        {/* Analytics strip */}
        {an.totals && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { l: 'Sent', v: an.totals.sends || 0 },
              { l: 'Opens', v: an.totals.opens || 0, sub: `${an.rates?.open_rate || 0}%` },
              { l: 'Clicks', v: an.totals.clicks || 0, sub: `${an.rates?.click_rate || 0}%` },
              { l: 'Replies', v: an.totals.replies || 0, sub: `${an.rates?.reply_rate || 0}%` },
              { l: 'Active', v: an.status_breakdown?.active || 0 },
              { l: 'Completed', v: an.status_breakdown?.completed || 0 },
              { l: 'Bounced', v: an.status_breakdown?.bounced || 0 },
            ].map(s => (
              <div key={s.l} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>{s.l}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{s.v}</div>
                {s.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.sub}</div>}
              </div>
            ))}
          </div>
        )}

        {/* Step breakdown */}
        {an.step_breakdown && Object.keys(an.step_breakdown).length > 0 && (
          <div className="card" style={{ marginBottom: 16, padding: '14px 20px' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Sends per Step</div>
            <div style={{ display: 'flex', gap: 12 }}>
              {Object.entries(an.step_breakdown).sort(([a],[b])=>parseInt(a)-parseInt(b)).map(([step, count]) => (
                <div key={step} style={{ textAlign: 'center', padding: '8px 16px', background: 'var(--bg-subtle)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{count}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Email {step}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sequence preview */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Sequence</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {steps.map((s, i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', minWidth: 130 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5 }}>Email {i + 1}</div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginTop: 2, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.subject || '(no subject)'}</div>
                  {i > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>After {s.delay_days}d {s.send_hour_start ? `· ${s.send_hour_start}h-${s.send_hour_end}h` : ''}</div>}
                </div>
                {i < steps.length - 1 && <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Contacts table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              Contacts <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>({total})</span>
            </div>
            <input
              className="input" style={{ width: 200, fontSize: 12, padding: '5px 10px' }}
              placeholder="Search email, name, company..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {STATUS_FILTERS.map(s => (
                <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }} className="btn btn-sm"
                  style={{ background: statusFilter === s ? 'var(--accent)' : 'var(--bg)', color: statusFilter === s ? 'white' : 'var(--text-secondary)', border: `1px solid ${statusFilter === s ? 'var(--accent)' : 'var(--border)'}`, fontSize: 11, padding: '3px 8px' }}>
                  {s}
                </button>
              ))}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {selectedIds.length > 0 && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>{selectedIds.length} selected</span>
                  <button onClick={() => handleBulkAction('remove')} className="btn btn-sm btn-danger">Remove</button>
                  <button onClick={() => handleBulkAction('blacklist')} className="btn btn-sm btn-danger">Blacklist</button>
                  <button onClick={() => handleBulkAction('pause')} className="btn btn-sm btn-secondary">Pause</button>
                </>
              )}
              <button onClick={() => navigate(`/campaigns/${id}/import`)} className="btn btn-primary btn-sm">+ Import</button>
            </div>
          </div>

          {contacts.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">👥</div>
              <div className="empty-title">No contacts {statusFilter !== 'all' ? `with status "${statusFilter}"` : 'yet'}</div>
              <div className="empty-sub">Import a CSV file to add contacts to this campaign</div>
              <button onClick={() => navigate(`/campaigns/${id}/import`)} className="btn btn-primary" style={{ display: 'inline-flex' }}>⬆️ Import CSV</button>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input type="checkbox" className="checkbox" checked={selectedIds.length === contacts.length && contacts.length > 0} onChange={toggleSelectAll} />
                      </th>
                      <th>Email</th>
                      <th>Name</th>
                      <th>Company</th>
                      <th>Timezone</th>
                      <th>Status</th>
                      <th>Label</th>
                      <th>Step</th>
                      <th>Next Send</th>
                      <th>Inbox</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map(c => (
                      <tr key={c.id}>
                        <td>
                          <input type="checkbox" className="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} />
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.email}</td>
                        <td style={{ fontWeight: 500 }}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{c.company || '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.timezone || '—'}</td>
                        <td><span className={`badge badge-${c.status}`}>{c.status}</span></td>
                        <td>
                          <select
                            className="input" style={{ fontSize: 11, padding: '2px 6px', width: 120 }}
                            value={c.lead_label || ''}
                            onChange={e => updateLabel(c.id, e.target.value)}
                          >
                            {LEAD_LABELS.map(l => <option key={l} value={l}>{l || 'No label'}</option>)}
                          </select>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {c.current_step > 0 ? `Step ${c.current_step}` : 'Not started'}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {c.next_send_at ? new Date(c.next_send_at).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {c.assigned_inbox || '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={async () => { if (!confirm('Remove?')) return; await api.removeContact(id, c.id); load(); }} className="action-btn danger" title="Remove">✕</button>
                            <button onClick={async () => { if (!confirm('Blacklist?')) return; await api.blacklistContact(c.id, 'manual'); load(); }} className="action-btn danger" title="Blacklist">🚫</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="pagination">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn btn-secondary btn-sm">← Prev</button>
                  <span className="page-info">Page {page} of {totalPages} · {total} contacts</span>
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
