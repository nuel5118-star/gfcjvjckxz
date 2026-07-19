import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from './api.js';

const VARS = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'company', label: 'Company' },
  { key: 'city', label: 'City' },
  { key: 'phone', label: 'Phone' },
  { key: 'business_url', label: 'Website' },
];

function SeqStepCard({ step, index, total, onChange, onRemove, onMoveUp, onMoveDown }) {
  const insertVar = (field, v) => onChange({ ...step, [field]: (step[field] || '') + v });
  const [showPerStepTime, setShowPerStepTime] = useState(step.send_hour_start != null || step.send_hour_end != null);

  return (
    <div className="step-card">
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <div className="step-number">{index + 1}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:600, fontSize:13 }}>Email {index + 1}</div>
          {index > 0 && <div style={{ fontSize:12, color:'var(--text-muted)' }}>Suggested wait: {step.delay_days} day{step.delay_days !== 1 ? 's' : ''} after the previous email</div>}
        </div>
        <div style={{ display:'flex', gap:4 }}>
          <button type="button" onClick={() => onMoveUp(index)} disabled={index === 0} className="action-btn" title="Move up">▲</button>
          <button type="button" onClick={() => onMoveDown(index)} disabled={index === total - 1} className="action-btn" title="Move down">▼</button>
          {total > 1 && <button type="button" onClick={() => onRemove(index)} className="action-btn danger">✕</button>}
        </div>
      </div>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginBottom:10 }}>
        <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:500 }}>Insert into subject:</span>
        {VARS.map(v => <span key={v.key} className="var-pill" onClick={() => insertVar('subject', `{{${v.key}}}`)}>{`{{${v.key}}}`}</span>)}
      </div>

      <div className="form-group">
        <label className="label">Subject Line</label>
        <input className="input" placeholder="e.g. Quick question about {{company}}" value={step.subject} onChange={e => onChange({ ...step, subject: e.target.value })} />
      </div>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginBottom:6 }}>
        <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:500 }}>Insert into body:</span>
        {VARS.map(v => <span key={v.key} className="var-pill" onClick={() => insertVar('body', `{{${v.key}}}`)}>{`{{${v.key}}}`}</span>)}
      </div>

      <div className="form-group">
        <label className="label">Email Body</label>
        <textarea className="input" style={{ minHeight:160 }} placeholder={`Hi {{first_name | "there"}},\n\n...`} value={step.body} onChange={e => onChange({ ...step, body: e.target.value })} />
      </div>

      {index > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
          <span style={{ fontSize:13, color:'var(--text-secondary)' }}>⏱ Suggested wait</span>
          <input type="number" min="1" max="30" className="input" style={{ width:64 }} value={step.delay_days} onChange={e => onChange({ ...step, delay_days: parseInt(e.target.value) || 2 })} />
          <span style={{ fontSize:13, color:'var(--text-secondary)' }}>days (used as the default when this email is pulled into a campaign)</span>
        </div>
      )}

      {/* Initial custom send time — carried into any campaign this email is pulled into,
          and can still be tweaked per-campaign after inserting. */}
      <div style={{ marginBottom:4 }}>
        <button type="button" onClick={() => setShowPerStepTime(!showPerStepTime)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--info)', padding:0 }}>
          {showPerStepTime ? '▾' : '▸'} Custom send time for this email {showPerStepTime ? '(using per-step time)' : '(using campaign default)'}
        </button>
        {showPerStepTime && (
          <div style={{ display:'flex', gap:12, marginTop:8, alignItems:'center' }}>
            <div>
              <label className="label" style={{ fontSize:11 }}>Send from (hour)</label>
              <input type="number" min="0" max="23" className="input" style={{ width:70 }} placeholder="9" value={step.send_hour_start ?? ''} onChange={e => onChange({ ...step, send_hour_start: e.target.value === '' ? null : parseInt(e.target.value) })} />
            </div>
            <div>
              <label className="label" style={{ fontSize:11 }}>Send until (hour)</label>
              <input type="number" min="0" max="23" className="input" style={{ width:70 }} placeholder="17" value={step.send_hour_end ?? ''} onChange={e => onChange({ ...step, send_hour_end: e.target.value === '' ? null : parseInt(e.target.value) })} />
            </div>
            <div style={{ fontSize:11, color:'var(--text-muted)', paddingTop:18 }}>
              24h format. This is just the default — you can still change it (or turn it off) after pulling this email into a campaign.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SequenceBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [steps, setSteps] = useState([{ subject:'', body:'', delay_days:2, send_hour_start:null, send_hour_end:null }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (!isEdit) return;
    api.getSequence(id).then(s => {
      setName(s.name);
      const sorted = (s.sequence_steps || []).sort((a, b) => a.step_number - b.step_number);
      setSteps(sorted.length > 0
        ? sorted.map(x => ({ subject:x.subject, body:x.body, delay_days:x.delay_days, send_hour_start:x.send_hour_start ?? null, send_hour_end:x.send_hour_end ?? null }))
        : [{ subject:'', body:'', delay_days:2, send_hour_start:null, send_hour_end:null }]
      );
    }).finally(() => setLoading(false));
  }, [id]);

  const save = async () => {
    if (!name.trim()) { setError('Sequence name is required'); return; }
    for (let i = 0; i < steps.length; i++) {
      if (!steps[i].subject.trim()) { setError(`Email ${i+1} needs a subject line`); return; }
      if (!steps[i].body.trim()) { setError(`Email ${i+1} needs a body`); return; }
    }
    setError('');
    setSaving(true);
    try {
      const payload = { name, steps };
      if (isEdit) { await api.updateSequence(id, payload); navigate('/sequences'); }
      else { const s = await api.createSequence(payload); navigate('/sequences'); }
    } catch (e) {
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
            <div className="topbar-title">{isEdit ? 'Edit Sequence' : 'New Sequence'}</div>
            <div className="topbar-sub">A reusable set of emails you can pull into any campaign</div>
          </div>
        </div>
        <button onClick={save} disabled={saving} className="btn btn-primary">
          💾 {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Sequence'}
        </button>
      </div>

      <div className="page fade-in" style={{ maxWidth:780 }}>
        {error && <div className="alert alert-error">{error}</div>}

        <div className="card" style={{ marginBottom:16 }}>
          <label className="label">Sequence Name *</label>
          <input className="input" style={{ fontSize:15, fontWeight:500 }} placeholder="e.g. Roofing — Cold Outreach v2" value={name} onChange={e => setName(e.target.value)} />
          <div className="form-hint" style={{ marginTop:6 }}>
            Editing this later won't change campaigns that already pulled emails from it — they keep their own copy.
          </div>
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div style={{ fontWeight:700, fontSize:15 }}>
              ✉️ Emails
              <span style={{ fontWeight:400, fontSize:12, color:'var(--text-muted)', marginLeft:8 }}>{steps.length} email{steps.length !== 1 ? 's' : ''}</span>
            </div>
            {steps.length < 20 && (
              <button type="button" onClick={() => setSteps(s => [...s, { subject:'', body:'', delay_days:2, send_hour_start:null, send_hour_end:null }])} className="btn btn-secondary btn-sm">
                + Add Email
              </button>
            )}
          </div>

          {steps.map((step, i) => (
            <div key={i}>
              <SeqStepCard
                step={step} index={i} total={steps.length}
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
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Sequence'}
          </button>
        </div>
      </div>
    </div>
  );
}
