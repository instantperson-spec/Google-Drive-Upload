'use client';

import { useCallback, useEffect, useState } from 'react';

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export default function AdminClientManager() {
  const [clients, setClients] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [invites, setInvites] = useState([]);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignFor, setAssignFor] = useState(null);
  const [assignFolderId, setAssignFolderId] = useState('');
  const [assignLabel, setAssignLabel] = useState('');
  const [passwordFor, setPasswordFor] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [inviteForm, setInviteForm] = useState({
    email: '',
    locale: 'en',
    note: '',
    sendEmail: true,
  });
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cRes, sRes, shRes, iRes] = await Promise.all([
        fetch('/api/admin/clients', { credentials: 'include' }),
        fetch('/api/admin/sessions?limit=80', { credentials: 'include' }),
        fetch('/api/admin/shares', { credentials: 'include' }),
        fetch('/api/admin/client-invites', { credentials: 'include' }),
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
      if (iRes.ok) {
        const iData = await iRes.json();
        setInvites(iData.invites || []);
        setSmtpConfigured(Boolean(iData.smtpConfigured));
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

  const shareByFolder = new Map(shares.map((s) => [s.folderId, s]));

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy invite URL:', text);
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

  async function handleCreateInvite(e) {
    e.preventDefault();
    setCreatingInvite(true);
    setError('');
    setLastInviteUrl('');
    try {
      const res = await fetch('/api/admin/client-invites', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteForm.email.trim(),
          locale: inviteForm.locale,
          note: inviteForm.note.trim(),
          sendEmail: Boolean(inviteForm.sendEmail && smtpConfigured),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Invite failed');
      setLastInviteUrl(data.url || '');
      setInviteForm({ email: '', locale: inviteForm.locale, note: '', sendEmail: inviteForm.sendEmail });
      await refresh();
      if (data.url) await copyText(data.url);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setCreatingInvite(false);
    }
  }

  async function inviteAction(id, action) {
    setError('');
    try {
      const res = await fetch(
        `/api/admin/client-invites/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            sendEmail: action === 'resend',
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Action failed');
      if (data.url) {
        setLastInviteUrl(data.url);
        await copyText(data.url);
      }
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  async function handleAssign(e) {
    e.preventDefault();
    if (!assignFor || !assignFolderId) return;
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

  const pendingInvites = invites.filter((i) => i.status === 'pending');

  return (
    <section className="admin-section glass-panel">
      <div className="admin-section-head">
        <h2>Client hub accounts</h2>
        <button type="button" className="btn tiny ghost" onClick={() => refresh()}>
          Refresh
        </button>
      </div>
      <p className="admin-hint">
        Signup tylko po <strong>zaproszeniu</strong>. Tworzysz invite → copy link
        i/lub mail SMTP. Klienci: suspend / password / assign / delete.
      </p>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="admin-subhead" style={{ marginTop: '0.75rem' }}>
        Invite client
      </div>
      <form className="admin-token-form-grid" onSubmit={handleCreateInvite}>
        <input
          required
          type="email"
          placeholder="client@email.com"
          value={inviteForm.email}
          onChange={(e) =>
            setInviteForm({ ...inviteForm, email: e.target.value })
          }
        />
        <select
          value={inviteForm.locale}
          onChange={(e) =>
            setInviteForm({ ...inviteForm, locale: e.target.value })
          }
        >
          <option value="en">lang=en</option>
          <option value="pl">lang=pl</option>
        </select>
        <input
          type="text"
          placeholder="Note (optional)"
          value={inviteForm.note}
          onChange={(e) =>
            setInviteForm({ ...inviteForm, note: e.target.value })
          }
        />
        <label className="admin-hint" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={inviteForm.sendEmail}
            disabled={!smtpConfigured}
            onChange={(e) =>
              setInviteForm({ ...inviteForm, sendEmail: e.target.checked })
            }
          />
          Send email
          {!smtpConfigured ? ' (SMTP not configured)' : ''}
        </label>
        <button type="submit" className="btn" disabled={creatingInvite}>
          {creatingInvite ? 'Creating…' : 'Create invite + copy URL'}
        </button>
      </form>
      {lastInviteUrl ? (
        <p className="admin-hint" style={{ wordBreak: 'break-all' }}>
          {copied ? 'Copied: ' : 'URL: '}
          <code>{lastInviteUrl}</code>
          <button
            type="button"
            className="btn ghost tiny"
            style={{ marginLeft: '0.5rem' }}
            onClick={() => copyText(lastInviteUrl)}
          >
            Copy
          </button>
        </p>
      ) : null}

      {pendingInvites.length ? (
        <div className="admin-table-wrap" style={{ marginTop: '0.75rem' }}>
          <h3 className="admin-subhead">Pending invites</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Lang</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pendingInvites.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
                  <td>{inv.locale}</td>
                  <td>{formatDate(inv.expiresAt)}</td>
                  <td className="admin-actions-cell">
                    <button
                      type="button"
                      className="btn ghost tiny"
                      onClick={() => inviteAction(inv.id, 'copy')}
                      title="Rotate token + copy new URL"
                    >
                      New URL + copy
                    </button>
                    <button
                      type="button"
                      className="btn ghost tiny"
                      disabled={!smtpConfigured}
                      onClick={() => inviteAction(inv.id, 'resend')}
                    >
                      Resend mail
                    </button>
                    <button
                      type="button"
                      className="btn ghost tiny"
                      onClick={() => inviteAction(inv.id, 'revoke')}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <div className="admin-table-wrap" style={{ marginTop: '1rem' }}>
          <h3 className="admin-subhead">Accounts</h3>
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
                      {c.status === 'active' ? 'active' : 'suspended'}
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
                        Suspend
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
                    Brak kont — wyślij zaproszenie powyżej.
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
