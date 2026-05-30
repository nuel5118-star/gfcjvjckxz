import { useState, useEffect } from 'react';
import { api } from './api.js';

function formatCurrency(n) {
  if (!n && n !== 0) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function CalculatorLeadsPage() {
  const [activeTab, setActiveTab] = useState('missed_revenue');
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = (overrideSearch) => {
    setLoading(true);
    const s = overrideSearch !== undefined ? overrideSearch : search;
    const params = { table: activeTab, page, pageSize: 50 };
    if (s) params.search = s.trim();
    api.getCalculatorLeads(params)
      .then(d => { setLeads(d.leads || []); setTotal(d.total || 0); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { setPage(1); }, [activeTab]);
  useEffect(() => { load(); }, [page, activeTab]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="topbar-title">Calculator Leads</div>
          <div className="topbar-sub">{total} submissions</div>
        </div>
      </div>

      <div className="page fade-in">
        {/* Tab toggle */}
        <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginRight: 8 }}>
              {[
                ['missed_revenue', '📞 Missed Revenue Calculator'],
                ['ad_calculator', '📢 Ad Calculator'],
              ].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setActiveTab(val)}
                  className="btn"
                  style={{
                    borderRadius: 0,
                    border: 'none',
                    borderRight: '1px solid var(--border)',
                    background: activeTab === val ? 'var(--accent)' : 'var(--bg)',
                    color: activeTab === val ? 'white' : 'var(--text-secondary)',
                    padding: '7px 16px',
                    fontSize: 13,
                    fontWeight: activeTab === val ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="input"
              style={{ maxWidth: 240 }}
              placeholder="Search by email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setPage(1); load(search); } }}
            />
            <button onClick={() => { setPage(1); load(search); }} className="btn btn-primary btn-sm">Search</button>
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
          ) : leads.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📊</div>
              <div className="empty-title">No submissions yet</div>
              <div className="empty-sub">Calculator leads will appear here once people submit the form</div>
            </div>
          ) : activeTab === 'missed_revenue' ? (
            <MissedRevenueTable leads={leads} />
          ) : (
            <AdCalculatorTable leads={leads} />
          )}

          {totalPages > 1 && (
            <div className="pagination">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn btn-secondary btn-sm">← Prev</button>
              <span className="page-info">Page {page} of {totalPages} · {total} submissions</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn btn-secondary btn-sm">Next →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MissedRevenueTable({ leads }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Business Type</th>
            <th>Missed Calls/Day</th>
            <th>Avg Deal Value</th>
            <th>Close Rate</th>
            <th>Monthly Loss</th>
            <th>Yearly Loss</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {leads.map(l => (
            <tr key={l.id}>
              <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{l.email}</td>
              <td style={{ fontSize: 12 }}>{l.business_type || '—'}</td>
              <td style={{ fontSize: 12, textAlign: 'center' }}>{l.missed_calls_per_day ?? '—'}</td>
              <td style={{ fontSize: 12, fontWeight: 500 }}>{formatCurrency(l.avg_deal_value)}</td>
              <td style={{ fontSize: 12 }}>{l.close_rate ? Math.round(l.close_rate * 100) + '%' : '—'}</td>
              <td style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)' }}>{formatCurrency(l.monthly_loss)}</td>
              <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatCurrency(l.yearly_loss)}</td>
              <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(l.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdCalculatorTable({ leads }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Business Type</th>
            <th>Job Value</th>
            <th>Close Rate</th>
            <th>Running Ads?</th>
            <th>Ad Spend</th>
            <th>Current Leads</th>
            <th>Result</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {leads.map(l => (
            <tr key={l.id}>
              <td style={{ fontSize: 13, fontWeight: 500 }}>{l.first_name || '—'}</td>
              <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{l.email}</td>
              <td style={{ fontSize: 12 }}>{l.business_type || '—'}</td>
              <td style={{ fontSize: 12, fontWeight: 500 }}>{formatCurrency(l.job_value)}</td>
              <td style={{ fontSize: 12 }}>{l.close_rate ? Math.round(l.close_rate * 100) + '%' : '—'}</td>
              <td style={{ fontSize: 12, textAlign: 'center' }}>
                {l.is_running_ads === null || l.is_running_ads === undefined ? '—'
                  : l.is_running_ads
                    ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>Yes</span>
                    : <span style={{ color: 'var(--text-muted)' }}>No</span>
                }
              </td>
              <td style={{ fontSize: 12 }}>{formatCurrency(l.ad_spend)}</td>
              <td style={{ fontSize: 12, textAlign: 'center' }}>{l.current_leads ?? '—'}</td>
              <td>
                {l.result_type && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.result_type}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(l.result_amount)}</div>
                  </div>
                )}
              </td>
              <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(l.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
