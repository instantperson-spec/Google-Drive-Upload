'use client';

import { useState, useEffect, useCallback } from 'react';

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(new Date(iso));
}

function StatusBadge({ status }) {
  const cls =
    status === 'active'
      ? 'admin-token-badge-active'
      : status === 'expired'
        ? 'admin-token-badge-expired'
        : 'admin-token-badge-revoked';
  return <span className={`admin-token-badge ${cls}`}>{status}</span>;
}

export default function AdminTokenManager() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const [form, setForm] = useState({
    token: '',
    clientName: '',
    type: 'retainer',
    expiresAt: '',
    notes: '',
  });

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/tokens', { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load tokens');
      }
      const data = await res.json();
      setTokens(data.tokens || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const copyLink = async (id, url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          token: form.token.trim(),
          clientName: form.clientName.trim(),
          type: form.type,
          expiresAt: form.expiresAt || null,
          notes: form.notes.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create token');

      setForm({ token: '', clientName: '', type: 'retainer', expiresAt: '', notes: '' });
      setShowForm(false);
      await fetchTokens();
      if (data.token?.uploadUrl) {
        await copyLink(data.token.id, data.token.uploadUrl);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const patchToken = async (id, action) => {
    setError('');
    try {
      const res = await fetch(`/api/admin/tokens/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update token');
      await fetchTokens();
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteTokenAction = async (id) => {
    if (!window.confirm('Are you sure you want to permanently delete this token?')) return;
    setError('');
    try {
      const res = await fetch(`/api/admin/tokens/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete token');
      await fetchTokens();
    } catch (err) {
      setError(err.message);
    }
  };

  const activeCount = tokens.filter((t) => t.status === 'active').length;

  return (
    <section className="admin-section">
      <div className="admin-section-header-row">
        <h3 className="admin-section-title">
          Client tokens
          {activeCount > 0 && <span className="admin-section-count">{activeCount} active</span>}
        </h3>
        <button
          type="button"
          className="btn admin-btn-secondary"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancel' : '+ New token'}
        </button>
      </div>

      <p className="admin-empty-inline" style={{ marginTop: 0 }}>
        Tokens are stored in <code className="admin-code">_uploader_tokens.json</code> on Google Drive.
        Revoke takes effect immediately — no redeploy needed.
      </p>

      {error && <p className="admin-error admin-error-banner">{error}</p>}

      {showForm && (
        <form className="admin-token-form" onSubmit={handleCreate}>
          <div className="admin-token-form-grid">
            <label>
              Token (URL slug)
              <input
                className="glass-input admin-input"
                placeholder="StudioAlfa"
                value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
                pattern="[a-zA-Z0-9_-]{2,64}"
                title="Letters, numbers, hyphen, underscore — 2–64 chars"
                required
              />
            </label>
            <label>
              Client name
              <input
                className="glass-input admin-input"
                placeholder="Studio Alfa Sp. z o.o."
                value={form.clientName}
                onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                required
              />
            </label>
            <label>
              Type
              <select
                className="glass-input admin-input"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="retainer">Retainer (permanent)</option>
                <option value="one-time">One-time project</option>
              </select>
            </label>
            <label>
              Expires (optional)
              <input
                type="date"
                className="glass-input admin-input"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </label>
          </div>
          <label>
            Notes (optional)
            <input
              className="glass-input admin-input"
              placeholder="Internal note…"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <button type="submit" className="btn admin-btn" disabled={creating}>
            {creating ? 'Creating…' : 'Create token & copy link'}
          </button>
        </form>
      )}

      {loading && <p className="admin-empty-inline">Loading tokens…</p>}

      {!loading && tokens.length === 0 && (
        <p className="admin-empty-inline">No tokens yet. Create one above or import via UPLOAD_TOKENS on first boot.</p>
      )}

      {!loading && tokens.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Token</th>
                <th>Type</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Link</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className={t.status !== 'active' ? 'admin-token-row-inactive' : ''}>
                  <td className="admin-cell-name">{t.clientName}</td>
                  <td><code className="admin-code">{t.token}</code></td>
                  <td>{t.type === 'retainer' ? 'Retainer' : 'One-time'}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td className="admin-cell-date">{formatDate(t.expiresAt)}</td>
                  <td>
                    {t.status === 'active' && (
                      <button
                        type="button"
                        className="admin-copy-btn"
                        onClick={() => copyLink(t.id, t.uploadUrl)}
                      >
                        {copiedId === t.id ? 'Copied!' : 'Copy link'}
                      </button>
                    )}
                  </td>
                  <td style={{ display: 'flex', gap: '5px' }}>
                    {t.status === 'active' ? (
                      <button
                        type="button"
                        className="admin-revoke-btn"
                        onClick={() => patchToken(t.id, 'revoke')}
                      >
                        Revoke
                      </button>
                    ) : t.status === 'revoked' ? (
                      <button
                        type="button"
                        className="admin-restore-btn"
                        onClick={() => patchToken(t.id, 'restore')}
                      >
                        Restore
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="admin-revoke-btn"
                      onClick={() => deleteTokenAction(t.id)}
                      title="Permanently delete this token"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
