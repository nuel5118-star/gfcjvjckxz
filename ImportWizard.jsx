import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from './api.js';

const SYSTEM_FIELDS = [
  { value: 'email', label: 'Email Address *' },
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'company', label: 'Company' },
  { value: 'city', label: 'City' },
  { value: 'phone', label: 'Phone' },
  { value: 'business_url', label: 'Business URL / Website' },
  { value: 'timezone', label: 'Timezone (e.g. America/New_York)' },
  { value: 'custom', label: 'Keep as custom variable {{column_name}}' },
  { value: 'skip', label: "Don't import this column" },
];

function Step1({ onFileLoad }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => onFileLoad(e.target.result, file.name);
    reader.readAsText(file);
  };

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>📂</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Upload your CSV file</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Any CSV format — we'll help you map the columns in the next step
        </div>
      </div>

      <div
        className={`upload-zone ${dragging ? 'active' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        style={{ cursor: 'pointer', padding: 48 }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>⬆️</div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Click to select or drag & drop</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Supports .csv files of any size</div>
        <input ref={inputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
      </div>

      <div style={{ marginTop: 20, background: 'var(--bg-subtle)', borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Example CSV format:</div>
        <code style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', lineHeight: 1.8 }}>
          email,first_name,last_name,company,city,phone,timezone<br />
          john@acme.com,John,Smith,Acme Corp,New York,555-1234,America/New_York<br />
          jane@beta.com,Jane,Doe,Beta Inc,Lagos,,Africa/Lagos
        </code>
      </div>
    </div>
  );
}

function Step2({ headers, preview, suggestions, mapping, setMapping }) {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Map your columns</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Match each column from your CSV to our system fields. We've auto-detected the obvious ones.
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
        {headers.map(header => (
          <div key={header} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center', background: 'var(--bg-subtle)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{header}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Sample: {preview[0]?.[header] || '(empty)'}
              </div>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 18 }}>→</div>
            <select
              className="input"
              value={mapping[header] || 'skip'}
              onChange={e => setMapping(m => ({ ...m, [header]: e.target.value }))}
            >
              {SYSTEM_FIELDS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Validation */}
      {!Object.values(mapping).includes('email') && (
        <div className="alert alert-error">⚠️ You must map at least one column to "Email Address"</div>
      )}

      <div style={{ background: 'var(--info-bg)', border: '1px solid var(--info-border)', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--info)', marginBottom: 4 }}>💡 Custom variables</div>
        <div style={{ fontSize: 12, color: 'var(--info)' }}>
          Columns mapped as "custom variable" become available in your emails as{' '}
          <code style={{ background: 'var(--info-border)', padding: '1px 4px', borderRadius: 3 }}>{'{{column_name}}'}</code>
          {' '}— so a column called "industry" becomes{' '}
          <code style={{ background: 'var(--info-border)', padding: '1px 4px', borderRadius: 3 }}>{'{{industry}}'}</code>
        </div>
      </div>
    </div>
  );
}

function Step3({ preview, mapping }) {
  // Show first 5 rows with mapping applied
  const mappedHeaders = Object.entries(mapping).filter(([, v]) => v !== 'skip');

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Preview — first 5 rows</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Confirm this looks correct before importing</div>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-subtle)' }}>
              {mappedHeaders.map(([csvCol, sysField]) => (
                <th key={csvCol} style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>{csvCol}</div>
                  <div style={{ color: sysField === 'custom' ? 'var(--info)' : 'var(--text)' }}>
                    {sysField === 'custom' ? `{{${csvCol.toLowerCase().replace(/\s+/g, '_')}}}` : sysField}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                {mappedHeaders.map(([csvCol]) => (
                  <td key={csvCol} style={{ padding: '8px 12px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row[csvCol] || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Step4({ result }) {
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>{result.imported > 0 ? '✅' : '⚠️'}</div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Import Complete</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Imported', val: result.imported, bg: 'var(--success-bg)', color: 'var(--success)' },
          { label: 'Duplicates', val: result.duplicates, bg: 'var(--bg-muted)', color: 'var(--text-secondary)' },
          { label: 'Invalid Emails', val: result.invalid, bg: 'var(--danger-bg)', color: 'var(--danger)' },
          { label: 'Blacklisted (skipped)', val: result.blacklisted, bg: 'var(--warning-bg)', color: 'var(--warning)' },
          { label: 'Other Campaigns', val: result.cross_campaign_dupes || 0, bg: 'var(--info-bg)', color: 'var(--info)' },
          { label: 'Errors', val: result.errors?.length || 0, bg: 'var(--danger-bg)', color: 'var(--danger)' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, padding: '14px', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {result.errors?.length > 0 && (
        <div style={{ background: 'var(--bg-subtle)', borderRadius: 8, padding: 12, maxHeight: 120, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--danger)' }}>Errors:</div>
          {result.errors.slice(0, 20).map((e, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--danger)', padding: '2px 0' }}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ImportWizard() {
  const { id: campaignId } = useParams();
  const navigate = useNavigate();
  const onClose = () => navigate(`/campaigns/${campaignId}`);
  const onDone = () => {};
  const [step, setStep] = useState(1);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [preview, setPreview] = useState([]);
  const [mapping, setMapping] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileLoad = async (csvText, name) => {
    setCsv(csvText);
    setFileName(name);
    setLoading(true);
    setError('');
    try {
      const res = await api.parseCSV(csvText);
      setHeaders(res.headers);
      setPreview(res.preview);
      setMapping(res.suggestions);
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!Object.values(mapping).includes('email')) {
      setError('You must map a column to Email Address');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.importContacts(campaignId, csv, mapping);
      setResult(res);
      setStep(4);
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const STEPS = ['Upload CSV', 'Map Columns', 'Preview', 'Done'];

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 680 }}>
        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, gap: 0 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, flexShrink: 0,
                background: step > i + 1 ? 'var(--success)' : step === i + 1 ? 'var(--accent)' : 'var(--bg-muted)',
                color: step >= i + 1 ? 'white' : 'var(--text-muted)'
              }}>
                {step > i + 1 ? '✓' : i + 1}
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, marginLeft: 6, color: step === i + 1 ? 'var(--text)' : 'var(--text-muted)', whiteSpace: 'nowrap', marginRight: 8 }}>{s}</div>
              {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: 'var(--border)', marginRight: 8 }} />}
            </div>
          ))}
        </div>

        {fileName && step > 1 && step < 4 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            📄 {fileName} — {headers.length} columns detected
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        {step === 1 && <Step1 onFileLoad={handleFileLoad} />}
        {step === 2 && <Step2 headers={headers} preview={preview} suggestions={{}} mapping={mapping} setMapping={setMapping} />}
        {step === 3 && <Step3 preview={preview} mapping={mapping} />}
        {step === 4 && result && <Step4 result={result} />}

        {loading && (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>Processing...</div>
          </div>
        )}

        {/* Footer buttons */}
        <div className="modal-footer" style={{ marginTop: 20 }}>
          {step < 4 && <button onClick={onClose} className="btn btn-secondary">Cancel</button>}
          {step === 2 && (
            <button onClick={() => { if (Object.values(mapping).includes('email')) { setStep(3); } else { setError('Map a column to Email Address first'); } }} className="btn btn-primary" disabled={loading}>
              Preview →
            </button>
          )}
          {step === 3 && (
            <>
              <button onClick={() => setStep(2)} className="btn btn-secondary">← Back</button>
              <button onClick={handleImport} className="btn btn-primary" disabled={loading}>
                {loading ? 'Importing...' : `Import Contacts`}
              </button>
            </>
          )}
          {step === 4 && (
            <button onClick={onClose} className="btn btn-primary">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
