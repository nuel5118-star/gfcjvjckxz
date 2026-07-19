import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from './api.js';

// VARS defined in VarInserter component
const TIMEZONES = ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Africa/Lagos','Africa/Nairobi','Asia/Dubai','Asia/Kolkata','Asia/Singapore'];

const VARS = [
  { key: 'first_name', label: 'First Name', default_fallback: 'dear' },
  { key: 'last_name', label: 'Last Name', default_fallback: '' },
  { key: 'company', label: 'Company', default_fallback: 'your company' },
  { key: 'city', label: 'City', default_fallback: 'your area' },
  { key: 'phone', label: 'Phone', default_fallback: '' },
  { key: 'business_url', label: 'Website', default_fallback: '' },
];

function VarInserter({ onInsert }) {
  const [popup, setPopup] = useState(null); // { key, label, fallback }

  const handleVarClick = (v) => {
    setPopup({ key: v.key, label: v.label, fallback: v.default_fallback });
  };

  const handleInsert = () => {
    if (!popup) return;
    const tag = popup.fallback
      ? `{{${popup.key} | "${popup.fallback}"}}`
      : `{{${popup.key}}}`;
    onInsert(tag);
    setPopup(null);
  };

  const handleInsertNoFallback = () => {
    if (!popup) return;
    onInsert(`{{${popup.key}}}`);
    setPopup(null);
  };

  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginBottom:6 }}>
        <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:500 }}>Insert variable:</span>
        {VARS.map(v => (
          <span key={v.key} className="var-pill" onClick={() => handleVarClick(v)}>
            {`{{${v.key}}}`}
          </span>
        ))}
        <span style={{ fontSize:11, color:'var(--text-muted)' }}>· Custom: <code style={{ fontSize:10, background:'var(--bg-muted)', padding:'1px 4px', borderRadius:3 }}>{'{{your_column}}'}</code></span>
      </div>

      {/* Hint */}
      <div style={{ fontSize:11, color:'var(--text-muted)', background:'var(--bg-subtle)', padding:'6px 10px', borderRadius:6, lineHeight:1.7 }}>
        💡 <strong>Fallback syntax:</strong> <code style={{ fontSize:10 }}>{'{{first_name | "dear"}}'}</code> → uses "dear" if contact has no first name.
        &nbsp;|&nbsp; No fallback: <code style={{ fontSize:10 }}>{'{{first_name | ""}}'}</code> → leaves blank.
        &nbsp;|&nbsp; Click a variable above to set fallback visually.
      </div>

      {/* Popup */}
      {popup && (
        <div style={{ marginTop:10, background:'var(--bg)', border:'2px solid var(--accent)', borderRadius:10, padding:16, maxWidth:400, position:'relative' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
            <div style={{ fontWeight:600, fontSize:13 }}>
              Insert <code style={{ fontSize:12, background:'var(--bg-muted)', padding:'1px 6px', borderRadius:4 }}>{`{{${popup.key}}}`}</code>
            </div>
            <button type="button" onClick={() => setPopup(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--text-muted)', lineHeight:1 }}>×</button>
          </div>
          <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:12 }}>
            What should appear if this contact has no {popup.label}?
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12 }}>
            <input
              className="input"
              style={{ flex:1, fontSize:13 }}
              placeholder={`e.g. dear, friend, there, (leave blank for nothing)`}
              value={popup.fallback}
              onChange={e => setPopup(p => ({ ...p, fallback: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleInsert(); if (e.key === 'Escape') setPopup(null); }}
              autoFocus
            />
          </div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:12, background:'var(--bg-subtle)', padding:'6px 10px', borderRadius:6 }}>
            Preview: <strong style={{ color:'var(--accent)' }}>
              {popup.fallback ? `{{${popup.key} | "${popup.fallback}"}}` : `{{${popup.key}}}`}
            </strong>
            {popup.fallback && <span style={{ color:'var(--text-muted)' }}> → "{popup.fallback}" when empty</span>}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => setPopup(null)} className="btn btn-secondary btn-sm">Cancel</button>
            <button onClick={handleInsertNoFallback} className="btn btn-secondary btn-sm">Insert without fallback</button>
            <button onClick={handleInsert} className="btn btn-primary btn-sm">
              Insert {popup.fallback ? `with fallback "${popup.fallback}"` : 'variable'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SequencePicker({ sequences, onPick }) {
  const [open, setOpen] = useState(false);
  const [seqId, setSeqId] = useState('');
  const seq = sequences.find(s => s.id === seqId);

  return (
    <div style={{ marginBottom: 10 }}>
      <button type="button" onClick={() => setOpen(!open)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--info)', padding:0 }}>
        {open ? '▾' : '▸'} 📚 Load an email from a sequence
      </button>
      {open && (
        <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap', alignItems:'center' }}>
          <select className="input" style={{ fontSize:12, maxWidth:220 }} value={seqId} onChange={e => setSeqId(e.target.value)}>
            <option value="">— Choose a sequence —</option>
            {sequences.map(s => <option key={s.id} value={s.id}>{s.name} ({(s.sequence_steps||[]).length} emails)</option>)}
          </select>
          {seq && (seq.sequence_steps||[]).map(ss => (
            <button
              key={ss.id}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => { onPick(ss); setOpen(false); setSeqId(''); }}
              title={ss.subject}
            >
              Email {ss.step_number}
            </button>
          ))}
          {seq && (seq.sequence_steps||[]).length === 0 && <span style={{ fontSize:12, color:'var(--text-muted)' }}>This sequence has no emails yet</span>}
        </div>
      )}
    </div>
  );
}

function StepCard({ step, index, total, onChange, onRemove, onMoveUp, onMoveDown, campaignId, sequences }) {
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [testContact, setTestContact] = useState({ first_name:'John', last_name:'Smith', company:'Acme Plumbing', city:'Lagos', phone:'080-1234-5678', business_url:'acmeplumbing.com', timezone:'Africa/Lagos' });
  const [realContacts, setRealContacts] = useState([]);
  const [selectedContact, setSelectedContact] = useState('');
  const [activeField, setActiveField] = useState('body');
  const [missing, setMissing] = useState([]);
  const [showPerStepTime, setShowPerStepTime] = useState(!!(step.send_hour_start || step.send_hour_end));
  const subRef = useRef(); const bodyRef = useRef();

  const insertVar = (v) => {
    const ref = activeField === 'subject' ? subRef : bodyRef;
    const el = ref.current; if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    onChange({ ...step, [activeField]: el.value.slice(0, s) + v + el.value.slice(e) });
    setTimeout(() => { el.focus(); el.setSelectionRange(s + v.length, s + v.length); }, 0);
  };

  const loadPreview = async (contactOverride) => {
    const contactToUse = contactOverride || testContact;
    const res = await api.preview(step.subject, step.body, contactToUse).catch(() => null);
    if (res) { setPreviewData(res); setMissing(res.missingVars || []); }
  };

  const loadRealContacts = async () => {
    if (!campaignId) return;
    try {
      const res = await api.getContacts(campaignId, { page: 1 });
      setRealContacts(res.contacts || []);
    } catch(e) { console.error('Failed to load contacts:', e); }
  };

  useEffect(() => { if (campaignId) loadRealContacts(); }, [campaignId]);

  const handleRealContactSelect = (e) => {
    const contactId = e.target.value;
    setSelectedContact(contactId);
    if (!contactId) return;
    const contact = realContacts.find(c => c.id === contactId);
    if (contact) {
      const merged = {
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        company: contact.company || '',
        city: contact.city || '',
        phone: contact.phone || '',
        business_url: contact.business_url || '',
        timezone: contact.timezone || '',
        ...(contact.custom_fields || {})
      };
      setTestContact(merged);
      loadPreview(merged);
    }
  };

  const enabled = step.enabled !== false;

  return (
    <div className="step-card" style={{ borderColor: showPreview ? 'var(--accent)' : undefined, opacity: enabled ? 1 : 0.55 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <div className="step-number">{index + 1}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:600, fontSize:13, display:'flex', alignItems:'center', gap:8 }}>
            Email {index + 1}
            {!enabled && <span style={{ fontSize:10, background:'var(--bg-muted)', color:'var(--text-muted)', padding:'1px 7px', borderRadius:10, fontWeight:600 }}>OFF — will be skipped</span>}
          </div>
          <div style={{ fontSize:12, color:'var(--text-muted)' }}>
            {index === 0 ? 'First email — sent on launch day' : `Sent ${step.delay_days} business day${step.delay_days !== 1 ? 's' : ''} after the previous enabled email`}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--text-muted)', marginRight:6, cursor:'pointer', userSelect:'none' }} title="Toggle this email off to skip it without deleting it — contacts jump straight to the next enabled email">
            <input type="checkbox" className="checkbox" checked={enabled} onChange={e => onChange({ ...step, enabled: e.target.checked })} />
            {enabled ? 'On' : 'Off'}
          </label>
          <button type="button" onClick={() => onMoveUp(index)} disabled={index === 0} className="action-btn" title="Move up">▲</button>
          <button type="button" onClick={() => onMoveDown(index)} disabled={index === total - 1} className="action-btn" title="Move down">▼</button>
          <button type="button" onClick={() => { if (!showPreview) loadPreview(); setShowPreview(!showPreview); }} className="action-btn" style={{ color: showPreview ? 'var(--info)' : undefined }} title="Preview">
            👁
          </button>
          {total > 1 && <button type="button" onClick={() => onRemove(index)} className="action-btn danger">✕</button>}
        </div>
      </div>

      {/* Pull this email's content from a saved sequence */}
      {sequences && sequences.length > 0 && (
        <SequencePicker
          sequences={sequences}
          onPick={ss => onChange({
            ...step,
            subject: ss.subject,
            body: ss.body,
            delay_days: ss.delay_days || step.delay_days,
            send_hour_start: ss.send_hour_start || null,
            send_hour_end: ss.send_hour_end || null,
            source_sequence_step_id: ss.id,
          })}
        />
      )}

      {/* Variable pills with fallback editor */}
      <VarInserter onInsert={insertVar} />

      <div className="form-group">
        <label className="label" style={{ display:'flex', alignItems:'center', gap:6 }}>
          Subject Line
          {activeField === 'subject' && <span style={{ fontSize:10, background:'var(--accent)', color:'white', padding:'1px 6px', borderRadius:10 }}>← inserting here</span>}
        </label>
        <input ref={subRef} className="input" placeholder="e.g. {Hi|Hello} {{first_name | &quot;there&quot;}}, quick question about {{company}}" value={step.subject} onChange={e => onChange({ ...step, subject: e.target.value })} onFocus={() => setActiveField('subject')} />
      </div>

      <div className="form-group">
        <label className="label" style={{ display:'flex', alignItems:'center', gap:6 }}>
          Email Body
          {activeField === 'body' && <span style={{ fontSize:10, background:'var(--accent)', color:'white', padding:'1px 6px', borderRadius:10 }}>← inserting here</span>}
        </label>
        <textarea ref={bodyRef} className="input" style={{ minHeight:160 }} placeholder={`Hi {{first_name | "there"}},\n\nI came across {{company | "your company"}} and wanted to reach out...\n\nBest,`} value={step.body} onChange={e => onChange({ ...step, body: e.target.value })} onFocus={() => setActiveField('body')} />
      </div>

      {/* Delay (not for first step) */}
      {index > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
          <span style={{ fontSize:13, color:'var(--text-secondary)' }}>⏱ Wait</span>
          <input type="number" min="1" max="30" className="input" style={{ width:64 }} value={step.delay_days} onChange={e => onChange({ ...step, delay_days: parseInt(e.target.value) || 2 })} />
          <span style={{ fontSize:13, color:'var(--text-secondary)' }}>business days before sending this email</span>
        </div>
      )}

      {/* Per-step send window */}
      <div style={{ marginBottom:8 }}>
        <button type="button" onClick={() => setShowPerStepTime(!showPerStepTime)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--info)', padding:0 }}>
          {showPerStepTime ? '▾' : '▸'} Custom send time for this email {showPerStepTime ? '(using per-step time)' : '(using campaign default)'}
        </button>
        {showPerStepTime && (
          <div style={{ display:'flex', gap:12, marginTop:8, alignItems:'center' }}>
            <div>
              <label className="label" style={{ fontSize:11 }}>Send from (hour)</label>
              <input type="number" min="0" max="23" className="input" style={{ width:70 }} placeholder="9" value={step.send_hour_start || ''} onChange={e => onChange({ ...step, send_hour_start: parseInt(e.target.value) || null })} />
            </div>
            <div>
              <label className="label" style={{ fontSize:11 }}>Send until (hour)</label>
              <input type="number" min="0" max="23" className="input" style={{ width:70 }} placeholder="17" value={step.send_hour_end || ''} onChange={e => onChange({ ...step, send_hour_end: parseInt(e.target.value) || null })} />
            </div>
            <div style={{ fontSize:11, color:'var(--text-muted)', paddingTop:18 }}>24h format. Overrides campaign send window for this step only.</div>
          </div>
        )}
      </div>

      {/* Missing vars warning */}
      {missing.length > 0 && (
        <div className="alert alert-warning" style={{ marginTop:8, marginBottom:0 }}>
          ⚠️ Variables with no fallback: {missing.join(', ')} — will use default text if contact has no data
        </div>
      )}

      {/* Preview panel */}
      {showPreview && (
        <div className="preview-pane" style={{ marginTop:14 }}>
          <div className="preview-header">
            <div style={{ fontWeight:600, fontSize:12, color:'var(--text-secondary)', marginBottom:8 }}>Preview with contact data</div>
            {campaignId && (
              <div style={{ marginBottom:10 }}>
                <label style={{ fontSize:11, color:'var(--text-muted)', display:'block', marginBottom:4 }}>
                  Pick a real contact from this campaign:
                </label>
                <select className="input" style={{ fontSize:12 }} value={selectedContact} onChange={handleRealContactSelect}>
                  <option value="">— Use test data below —</option>
                  {realContacts.length === 0 && <option disabled>Loading contacts...</option>}
                  {realContacts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.email}{c.first_name ? ` — ${c.first_name} ${c.last_name||''}` : ''}{c.company ? ` (${c.company})` : ''}
                    </option>
                  ))}
                </select>
                {realContacts.length > 0 && <div style={{fontSize:10, color:'var(--text-muted)', marginTop:3}}>{realContacts.length} contacts loaded</div>}
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:10 }}>
              {Object.entries(testContact).map(([k, v]) => (
                <div key={k}>
                  <label className="label" style={{ fontSize:10 }}>{k}</label>
                  <input className="input" style={{ fontSize:11, padding:'3px 8px' }} value={v} onChange={e => setTestContact(p => ({ ...p, [k]: e.target.value }))} onBlur={loadPreview} />
                </div>
              ))}
            </div>
            <button type="button" onClick={loadPreview} className="btn btn-secondary btn-sm">Refresh Preview</button>
          </div>
          {previewData && (
            <div className="preview-body">
              <div style={{ fontWeight:600, marginBottom:8, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
                Subject: {previewData.subject || '(empty)'}
              </div>
              <div style={{ whiteSpace:'pre-wrap', lineHeight:1.8 }}>{previewData.body || '(empty body)'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CampaignBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [steps, setSteps] = useState([{ subject:'', body:'', delay_days:2, send_hour_start:null, send_hour_end:null, enabled:true, source_sequence_step_id:null }]);
  const [sequences, setSequences] = useState([]);
  const [dailyCap, setDailyCap] = useState(500);
  const [perInboxCap, setPerInboxCap] = useState(100);
  const [maxNewLeads, setMaxNewLeads] = useState(0);
  const [hourStart, setHourStart] = useState(9);
  const [hourEnd, setHourEnd] = useState(17);
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [timezone, setTimezone] = useState('America/New_York');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [stopOnAutoReply, setStopOnAutoReply] = useState(false);
  const [randomDelayMax, setRandomDelayMax] = useState(30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(isEdit);
  // NEW: holds the reschedule result to show a confirmation banner before navigating
  const [rescheduleInfo, setRescheduleInfo] = useState(null); // { rescheduled_contacts, send_window_updated }

  useEffect(() => { api.getSequences().then(setSequences).catch(() => setSequences([])); }, []);

  useEffect(() => {
    if (!isEdit) return;
    api.getCampaign(id).then(c => {
      setName(c.name);
      setDailyCap(c.daily_cap || 500);
      setPerInboxCap(c.per_inbox_cap || 100);
      setMaxNewLeads(c.max_new_leads_per_day || 0);
      setHourStart(c.send_hour_start || 9);
      setHourEnd(c.send_hour_end || 17);
      setSkipWeekends(c.skip_weekends !== false);
      setTimezone(c.timezone || 'America/New_York');
      setStartDate(c.start_date || '');
      setEndDate(c.end_date || '');
      setStopOnAutoReply(c.stop_on_auto_reply || false);
      setRandomDelayMax(c.random_delay_max || 30);
      const sorted = (c.campaign_steps || []).sort((a, b) => a.step_number - b.step_number);
      setSteps(sorted.length > 0
        ? sorted.map(s => ({ subject:s.subject, body:s.body, delay_days:s.delay_days, send_hour_start:s.send_hour_start||null, send_hour_end:s.send_hour_end||null, enabled:s.enabled!==false, source_sequence_step_id:s.source_sequence_step_id||null }))
        : [{ subject:'', body:'', delay_days:2, send_hour_start:null, send_hour_end:null, enabled:true, source_sequence_step_id:null }]
      );
    }).finally(() => setLoading(false));
  }, [id]);

  const save = async () => {
    if (!name.trim()) { setError('Campaign name is required'); return; }
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].enabled === false) continue; // disabled steps are skipped entirely — no content required
      if (!steps[i].subject.trim()) { setError(`Email ${i+1} needs a subject line`); return; }
      if (!steps[i].body.trim()) { setError(`Email ${i+1} needs a body`); return; }
    }
    if (steps.every(s => s.enabled === false)) { setError('At least one email needs to be turned on'); return; }
    setError('');
    setSaving(true);
    setRescheduleInfo(null);

    try {
      const payload = {
        name, steps,
        daily_cap: dailyCap,
        per_inbox_cap: perInboxCap,
        max_new_leads_per_day: maxNewLeads,
        send_hour_start: hourStart,
        send_hour_end: hourEnd,
        skip_weekends: skipWeekends,
        timezone,
        start_date: startDate || null,
        end_date: endDate || null,
        stop_on_auto_reply: stopOnAutoReply,
        random_delay_max: randomDelayMax,
      };

      if (isEdit) {
        // updateCampaign returns the full response including rescheduled_contacts
        const result = await api.updateCampaign(id, payload);

        // NEW: Check if the send window changed and show a confirmation before navigating.
        // This is critical UX — without it the user sees no feedback and assumes it broke.
        if (result?.send_window_updated) {
          setRescheduleInfo({
            rescheduled_contacts: result.rescheduled_contacts ?? 0,
            send_window_updated: true,
          });
          // Navigate after a short delay so the user can read the banner.
          // If they changed the window and 0 contacts were affected that's still
          // useful to know (e.g. all contacts already sent or paused).
          setTimeout(() => navigate(`/campaigns/${id}`), 3000);
        } else {
          // No send-window change — navigate immediately as before.
          navigate(`/campaigns/${id}`);
        }
      } else {
        const c = await api.createCampaign(payload);
        navigate(`/campaigns/${c.id}`);
      }
    } catch(e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding:32, color:'var(--text-muted)' }}>Loading...</div>;

  return (
    <div>
      <div className="topbar">
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={() => navigate(-1)} className="btn btn-secondary btn-sm">← Back</button>
          <div>
            <div className="topbar-title">{isEdit ? 'Edit Campaign' : 'New Campaign'}</div>
            <div className="topbar-sub">Build your email sequence</div>
          </div>
        </div>
        <button onClick={save} disabled={saving} className="btn btn-primary">
          💾 {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Campaign'}
        </button>
      </div>

      <div className="page fade-in" style={{ maxWidth:780 }}>
        {error && <div className="alert alert-error">{error}</div>}

        {/* NEW: Reschedule confirmation banner — shown after save when send window changed */}
        {rescheduleInfo && (
          <div className="alert" style={{
            background: 'var(--success-bg, #d1fae5)',
            border: '1px solid var(--success-border, #6ee7b7)',
            color: 'var(--success-text, #065f46)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ fontSize:18 }}>✅</span>
            <div>
              {rescheduleInfo.rescheduled_contacts > 0 ? (
                <>
                  <strong>Campaign saved.</strong> Send window changed —{' '}
                  <strong>{rescheduleInfo.rescheduled_contacts} contact{rescheduleInfo.rescheduled_contacts !== 1 ? 's' : ''}</strong>{' '}
                  rescheduled to the new time window. Redirecting…
                </>
              ) : (
                <>
                  <strong>Campaign saved.</strong> Send window updated — no contacts were in the future queue to reschedule. Redirecting…
                </>
              )}
            </div>
          </div>
        )}

        {/* Campaign name */}
        <div className="card" style={{ marginBottom:16 }}>
          <label className="label">Campaign Name *</label>
          <input className="input" style={{ fontSize:15, fontWeight:500 }} placeholder="e.g. Roofing Contractors — May 2026" value={name} onChange={e => setName(e.target.value)} />
        </div>

        {/* Sending rules */}
        <div className="card" style={{ marginBottom:16 }}>
          <div style={{ fontWeight:600, fontSize:14, marginBottom:16 }}>⚡ Sending Rules</div>
          <div className="form-row">
            <div className="form-group">
              <label className="label">Total daily cap</label>
              <input type="number" className="input" value={dailyCap} onChange={e => setDailyCap(parseInt(e.target.value)||500)} />
              <div className="form-hint">Max emails/day across all inboxes</div>
            </div>
            <div className="form-group">
              <label className="label">Per inbox daily cap</label>
              <input type="number" className="input" value={perInboxCap} onChange={e => setPerInboxCap(parseInt(e.target.value)||100)} />
              <div className="form-hint">Max per single inbox per day</div>
            </div>
            <div className="form-group">
              <label className="label">Max new leads/day</label>
              <input type="number" className="input" value={maxNewLeads} onChange={e => setMaxNewLeads(parseInt(e.target.value)||0)} />
              <div className="form-hint">0 = unlimited. Limits how many NEW contacts get Email 1 per day</div>
            </div>
            <div className="form-group">
              <label className="label">Random delay max (minutes)</label>
              <input type="number" className="input" value={randomDelayMax} onChange={e => setRandomDelayMax(parseInt(e.target.value)||30)} />
              <div className="form-hint">Spreads sends randomly. Looks human, improves deliverability</div>
            </div>
            <div className="form-group">
              <label className="label">Default send window start (0-23h)</label>
              <input type="number" min="0" max="23" className="input" value={hourStart} onChange={e => setHourStart(parseInt(e.target.value))} />
              <div className="form-hint">Can override per email step below</div>
            </div>
            <div className="form-group">
              <label className="label">Default send window end (0-23h)</label>
              <input type="number" min="0" max="23" className="input" value={hourEnd} onChange={e => setHourEnd(parseInt(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="label">Fallback timezone</label>
              <select className="input" value={timezone} onChange={e => setTimezone(e.target.value)}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
              <div className="form-hint">Used only if contact has no timezone in their data</div>
            </div>
            <div className="form-group" style={{ display:'flex', alignItems:'center', gap:10, paddingTop:22 }}>
              <input type="checkbox" className="checkbox" id="sw" checked={skipWeekends} onChange={e => setSkipWeekends(e.target.checked)} />
              <label htmlFor="sw" style={{ fontSize:13, cursor:'pointer' }}>Skip weekends</label>
            </div>
          </div>
        </div>

        {/* Schedule & options */}
        <div className="card" style={{ marginBottom:16 }}>
          <div style={{ fontWeight:600, fontSize:14, marginBottom:16 }}>📅 Schedule & Options</div>
          <div className="form-row">
            <div className="form-group">
              <label className="label">Campaign start date (optional)</label>
              <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
              <div className="form-hint">Don't send before this date even if launched earlier</div>
            </div>
            <div className="form-group">
              <label className="label">Campaign end date (optional)</label>
              <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} />
              <div className="form-hint">Auto-pause campaign after this date</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:4 }}>
            <input type="checkbox" className="checkbox" id="autoReply" checked={stopOnAutoReply} onChange={e => setStopOnAutoReply(e.target.checked)} />
            <label htmlFor="autoReply" style={{ fontSize:13, cursor:'pointer' }}>
              Stop sequence when out-of-office / auto-reply detected
              <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:6 }}>(default: continue sequence, flag contact)</span>
            </label>
          </div>
        </div>

        {/* Email sequence */}
        <div style={{ marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div style={{ fontWeight:700, fontSize:15 }}>
              ✉️ Email Sequence
              <span style={{ fontWeight:400, fontSize:12, color:'var(--text-muted)', marginLeft:8 }}>{steps.length} email{steps.length !== 1 ? 's' : ''}</span>
            </div>
            {steps.length < 10 && (
              <button type="button" onClick={() => setSteps(s => [...s, { subject:'', body:'', delay_days:2, send_hour_start:null, send_hour_end:null, enabled:true, source_sequence_step_id:null }])} className="btn btn-secondary btn-sm">
                + Add Email
              </button>
            )}
          </div>

          {/* Visual timeline */}
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:16, flexWrap:'wrap' }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:6, opacity: s.enabled === false ? 0.45 : 1 }}>
                <div style={{ padding:'6px 12px', borderRadius:8, border:`2px solid ${s.enabled === false ? 'var(--border)' : s.subject ? 'var(--accent)' : 'var(--border)'}`, background: s.enabled === false ? 'var(--bg)' : s.subject ? 'var(--accent-light)' : 'var(--bg)', fontSize:12, fontWeight:600, color: s.enabled === false ? 'var(--text-muted)' : s.subject ? 'var(--accent)' : 'var(--text-muted)', textAlign:'center' }}>
                  <div>Email {i+1}{s.enabled === false ? ' (off)' : ''}</div>
                  {i > 0 && <div style={{ fontSize:10, fontWeight:400, color:'var(--text-muted)' }}>+{s.delay_days}d</div>}
                  {(s.send_hour_start || s.send_hour_end) && <div style={{ fontSize:9, color:'var(--info)' }}>{s.send_hour_start||'?'}–{s.send_hour_end||'?'}h</div>}
                </div>
                {i < steps.length - 1 && <span style={{ color:'var(--border-strong)', fontSize:16 }}>›</span>}
              </div>
            ))}
          </div>

          {steps.map((step, i) => (
            <div key={i}>
              <StepCard
                step={step} index={i} total={steps.length} campaignId={id} sequences={sequences}
                onChange={updated => setSteps(s => s.map((x, idx) => idx === i ? updated : x))}
                onRemove={idx => setSteps(s => s.filter((_, j) => j !== idx))}
                onMoveUp={idx => setSteps(s => { const a = [...s]; [a[idx-1], a[idx]] = [a[idx], a[idx-1]]; return a; })}
                onMoveDown={idx => setSteps(s => { const a = [...s]; [a[idx], a[idx+1]] = [a[idx+1], a[idx]]; return a; })}
              />
              {i < steps.length - 1 && <div className="step-connector" />}
            </div>
          ))}
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingBottom:40 }}>
          <button onClick={() => navigate(-1)} className="btn btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary">
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}
