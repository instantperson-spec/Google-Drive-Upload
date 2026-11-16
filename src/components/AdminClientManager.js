'use client';

import { useCallback, useEffect, useState } from 'react';

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(
    new Date(iso)
  );
}

export default function AdminClientManager() {
  const [clients, setClients] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [shares, setShares] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState(null);
  const [assignFolderId, setAssignFolderId] = useState('');
  const [assignLabel, setAssignLabel] = useState('');
  const [passwordFor, setPasswordFor] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  const [form, setForm] = useState({
    email: '',
    password: '',
    displayName: '',
    linkedToken: '',
    locale: 'en',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cRes, sRes, shRes, tRes] = await Promise.all([
        fetch('/api/admin/clients', { credentials: 'include' }),
        fetch('/api/admin/sessions?limit=80', { credentials: 'include' }),
        fetch('/api/admin/shares', { credentials: 'include' }),
        fetch('/api/admin/tokens', { credentials: 'include' }),
      ]);
      const cData = await cRes.json().catch(() => ({}));
      if (!cRes.ok) throw new Error(cData.error || 'Failed to load clients');
      setClients(cData.clients || []);
      setMemberships(cData.memberships || []);

      if (sRes.ok) {
        const sData = await sRes.json();
        setSessions(sData.sessions || []);
      }
      if (shRes.ok) {
        const shData = await shRes.json();
        setShares(shData.shares || []);
      }
      if (tRes.ok) {
        const tData = await tRes.json();
        setTokens((tData.tokens || []).filter((t) => t.status === 'active'));
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const shareByFolder = new Map(
    shares.map((s) => [s.folderId, s])
  );

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/admin/clients', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          displayName: form.displayName.trim(),
          linkedToken: form.linkedToken.trim() || null,
          locale: form.locale,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Create failed');
      setForm({
        email: '',
        password: '',
        displayName: '',
        linkedToken: '',
        locale: 'en',
      });
      setShowForm(false);
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setCreating(false);
    }
  }

  async function patchClient(id, body) {
    setError('');
    const res = await fetch(`/api/admin/clients/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Update failed');
    await refresh();
    return data;
  }

  async function handleAssign(e) {
    e.preventDefault();
    if (!assignFor || !assignFolderId) return;
    setError('');
    try {
      const share = shareByFolder.get(assignFolderId);
      const session = sessions.find((s) => s.folderId === assignFolderId);
      await patchClient(assignFor.id, {
        action: 'assign',
        folderId: assignFolderId,
        shareId: share?.id || null,
        label:
          assignLabel.trim() ||
          session?.projectName ||
          session?.folderName ||
          share?.label ||
          null,
      });
      setAssignFor(null);
      setAssignFolderId('');
      setAssignLabel('');
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    if (!passwordFor) return;
    try {
      await patchClient(passwordFor.id, {
        action: 'password',
        password: newPassword,
      });
      setPasswordFor(null);
      setNewPassword('');
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  const membershipsFor = (email) =>
    memberships.filter((m) => m.clientEmail === email);

  return (
    <section className="admin-section glass-panel">
      <div className="admin-section-head">
        <h2>Client hub accounts</h2>
        <button
          type="button"
          className="btn tiny"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancel' : '+ New client account'}
        </button>
      </div>
      <p className="admin-hint">
        Email + password hub at <code>/client</code>. Link a retainer upload token
        so they can start new uploads. Assign Drive sessions for projects they did
        not create.
      </p>

      {error ? <p className="admin-error">{error}</p> : null}

      {showForm ? (
        <form className="admin-token-form-grid" onSubmit={handleCreate}>
          <input
            required
            type="email"
            placeholder="client@email.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            required
            type="password"
            minLength={8}
            placeholder="Temporary password (min 8)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <input
            type="text"
            placeholder="Display name"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
          <select
            value={form.linkedToken}
            onChange={(e) => setForm({ ...form, linkedToken: e.target.value })}
          >
            <option value="">Linked upload token (optional)</option>
            {tokens.map((t) => (
              <option key={t.id} value={t.token}>
                {t.token} — {t.clientName}
              </option>
            ))}
          </select>
          <select
            value={form.locale}
            onChange={(e) => setForm({ ...form, locale: e.target.value })}
          >
            <option value="en">EN</option>
            <option value="pl">PL</option>
          </select>
          <button type="submit" className="btn" disabled={creating}>
            {creating ? 'Creating…' : 'Create account'}
          </button>
        </form>
      ) : null}

      {assignFor ? (
        <form className="admin-token-form-grid" onSubmit={handleAssign}>
          <p className="admin-hint">
            Assign project → <strong>{assignFor.email}</strong>
          </p>
          <select
            required
            value={assignFolderId}
            onChange={(e) => setAssignFolderId(e.target.value)}
          >
            <option value="">Select session folder…</option>
            {sessions.map((s) => (
              <option key={s.folderId} value={s.folderId}>
                {(s.projectName || s.folderName || s.folderId).slice(0, 80)}
                {shareByFolder.has(s.folderId) ? ' · share' : ''}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Label (optional)"
            value={assignLabel}
            onChange={(e) => setAssignLabel(e.target.value)}
          />
          <button type="submit" className="btn">
            Assign
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setAssignFor(null)}
          >
            Cancel
          </button>
        </form>
      ) : null}

      {passwordFor ? (
        <form className="admin-token-form-grid" onSubmit={handleSetPassword}>
          <p className="admin-hint">
            Reset password → <strong>{passwordFor.email}</strong>
          </p>
          <input
            required
            type="password"
            minLength={8}
            placeholder="New password (min 8)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <button type="submit" className="btn">
            Set password
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setPasswordFor(null);
              setNewPassword('');
            }}
          >
            Cancel
          </button>
        </form>
      ) : null}

      {loading ? (
        <p className="admin-hint">Loading…</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Token</th>
                <th>Assigned</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>{c.email}</td>
                  <td>{c.displayName || '—'}</td>
                  <td>
                    <code>{c.linkedToken || '—'}</code>
                  </td>
                  <td>{membershipsFor(c.email).length}</td>
                  <td>
                    <span
                      className={`admin-token-badge ${
                        c.status === 'active'
                          ? 'admin-token-badge-active'
                          : 'admin-token-badge-revoked'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td>{formatDate(c.createdAt)}</td>
                  <td className="admin-actions-cell">
                    <button
                      type="button"
                      className="btn ghost tiny"
                      onClick={() => setAssignFor(c)}
                    >
                      Assign
                    </button>
                    <button
                      type="button"
                      className="btn ghost tiny"
                      onClick={() => {
                        setPasswordFor(c);
                        setNewPassword('');
                      }}
                    >
                      Password
                    </button>
                    {c.status === 'active' ? (
                      <button
                        type="button"
                        className="btn ghost tiny"
                        onClick={() =>
                          patchClient(c.id, { action: 'revoke' }).catch((err) =>
                            setError(err.message)
                          )
                        }
                      >
                        Revoke
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn ghost tiny"
                        onClick={() =>
                          patchClient(c.id, { action: 'restore' }).catch((err) =>
                            setError(err.message)
                          )
                        }
                      >
                        Restore
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn ghost tiny danger"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Delete hub account ${c.email}? Memberships removed.`
                          )
                        ) {
                          return;
                        }
                        fetch(`/api/admin/clients/${encodeURIComponent(c.id)}`, {
                          method: 'DELETE',
                          credentials: 'include',
                        })
                          .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
                          .then(({ ok, d }) => {
                            if (!ok) throw new Error(d.error || 'Delete failed');
                            return refresh();
                          })
                          .catch((err) => setError(err.message));
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!clients.length ? (
                <tr>
                  <td colSpan={7} className="admin-hint">
                    No client hub accounts yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {memberships.length ? (
        <div className="admin-table-wrap" style={{ marginTop: '1rem' }}>
          <h3 className="admin-subhead">Assignments</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Folder</th>
                <th>Label</th>
                <th>Share</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => {
                const client = clients.find((c) => c.email === m.clientEmail);
                return (
                  <tr key={m.id}>
                    <td>{m.clientEmail}</td>
                    <td>
                      <code>{String(m.folderId).slice(0, 12)}…</code>
                    </td>
                    <td>{m.label || '—'}</td>
                    <td>{m.shareId ? <code>{m.shareId}</code> : '—'}</td>
                    <td>{formatDate(m.assignedAt)}</td>
                    <td>
                      {client ? (
                        <button
                          type="button"
                          className="btn ghost tiny"
                          onClick={() =>
                            patchClient(client.id, {
                              action: 'unassign',
                              membershipId: m.id,
                            }).catch((err) => setError(err.message))
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
