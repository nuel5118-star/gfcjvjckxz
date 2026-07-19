import { useState, useEffect } from 'react';
import { api } from './api.js';

export default function LinksPage() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [copiedSlug, setCopiedSlug] = useState('');

  const load = () => api.getLinks().then(l => setLinks(l || [])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const resetForm = () => { setAdding(false); setEditingId(null); setName(''); setUrl(''); setError(''); };

  const startEdit = (link) => { setEditingId(link.id); setName(link.name); setUrl(link.url); setAdding(false); setError(''); };

  const save = async () => {
    if (!name.trim()) { setError('Give this link a name'); return; }
    if (!/^https?:\/\//i.test(url.trim())) { setError('URL must start with http:// or https://'); return; }
    try {
      if (editingId) await api.updateLink(editingId, { name, url });
      else await api.createLink({ name, url });
      resetForm();
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const copyToken = (slug) => {
    const token = `{{link:${slug}}}`;
    navigator.clipboard?.writeText(token);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(''), 1500);
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <div className="topbar-title">Links</div>
          <div className="topbar-sub">Saved links you can insert into any email — tracked automatically</div>
        </div>
        <button onClick={() => { resetForm(); setAdding(true); }} className="btn btn-primary">+ Add Link</button>
      </div>

      <div className="page fade-in" style={{ maxWidth: 700 }}>
        {(adding || editingId) && (
          <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>{editingId ? 'Edit Link' : 'Add Link'}</div>
            {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
            <div className="form-row">
              <div className="form-group">
                <label className="label">Name</label>
                <input className="input" placeholder="e.g. Roofer Demo Video" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">URL</label>
                <input className="input" placeholder="https://..." value={url} onChange={e => setUrl(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={resetForm} className="btn btn-secondary">Cancel</button>
              <button onClick={save} className="btn btn-primary">{editingId ? 'Save' : 'Add Link'}</button>
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
          ) : links.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">🔗</div>
              <div className="empty-title">No links saved yet</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Save a link once, then insert it into any email from the campaign or sequence builder.
              </div>
              <button onClick={() => { resetForm(); setAdding(true); }} className="btn btn-primary" style={{ display: 'inline-flex' }}>Add Link</button>
            </div>
          ) : links.map(link => (
            <div key={link.id} className="campaign-row" style={{ cursor: 'default' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{link.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.url}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <code style={{ fontSize: 11, background: 'var(--bg-muted)', padding: '2px 7px', borderRadius: 6, color: 'var(--accent)' }}>{`{{link:${link.slug}}}`}</code>
                  <button onClick={() => copyToken(link.slug)} className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '2px 8px' }}>
                    {copiedSlug === link.slug ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button onClick={() => startEdit(link)} className="btn btn-secondary btn-sm">Edit</button>
                <button onClick={async () => { if (!confirm(`Delete "${link.name}"? Any {{link:${link.slug}}} tokens already in campaigns will stop resolving.`)) return; await api.deleteLink(link.id); load(); }} className="btn btn-danger btn-sm">Delete</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
          💡 In an email body, use <code style={{ background: 'var(--bg-muted)', padding: '1px 5px', borderRadius: 4 }}>{`{{link:slug}}`}</code> to show the raw URL, or <code style={{ background: 'var(--bg-muted)', padding: '1px 5px', borderRadius: 4 }}>{`{{link:slug | "Watch the video"}}`}</code> to show custom text instead — same as the {`{{first_name | "there"}}`} fallback syntax. Every link is click-tracked automatically, same as one you type by hand.
        </div>
      </div>
    </div>
  );
}
