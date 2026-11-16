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
      setInviteForm({
        email: '',
        locale: inviteForm.locale,
        note: '',
        sendEmail: inviteForm.sendEmail,
      });
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
  const activeCount = clients.filter((c) => c.status === 'active').length;

  return (
    <section className="admin-section glass-panel">
      <div className="admin-section-header-row">
        <h3 className="admin-section-title">
          Client hub
          {activeCount > 0 ? (
            <span className="admin-section-count">{activeCount} active</span>
          ) : null}
          {pendingInvites.length > 0 ? (
            <span className="admin-section-count admin-section-count-warn">
              {pendingInvites.length} pending
            </span>
          ) : null}
        </h3>
        <button
          type="button"
          className="btn admin-btn-secondary"
          onClick={() => refresh()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p className="admin-empty-inline" style={{ marginTop: 0 }}>
        Signup tylko po zaproszeniu. Tworzysz invite → kopiujesz link i/lub
        wysyłasz mail SMTP. Potem: suspend, hasło, assign projektu, delete.
      </p>

      {error ? <p className="admin-error admin-error-banner">{error}</p> : null}

      <form className="admin-token-form admin-invite-form" onSubmit={handleCreateInvite}>
        <div className="admin-invite-form-head">
          <h4 className="admin-block-title">Invite client</h4>
          <span className="admin-invite-ttl">TTL 7 days · one-time</span>
        </div>

        <div className="admin-token-form-grid">
          <label>
            Email
            <input
              required
              type="email"
              className="glass-input admin-input"
              placeholder="client@email.com"
              value={inviteForm.email}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, email: e.target.value })
              }
            />
          </label>
          <label>
            Language
            <select
              className="glass-input admin-input"
              value={inviteForm.locale}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, locale: e.target.value })
              }
            >
              <option value="en">English</option>
              <option value="pl">Polski</option>
            </select>
          </label>
          <label>
            Note (optional)
            <input
              type="text"
              className="glass-input admin-input"
              placeholder="Internal note…"
              value={inviteForm.note}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, note: e.target.value })
              }
            />
          </label>
        </div>

        <div className="admin-invite-form-footer">
          <label
            className={`admin-check${smtpConfigured ? '' : ' is-disabled'}`}
            title={
              smtpConfigured
                ? 'Send invite email via SMTP'
                : 'Configure SMTP env vars to enable'
            }
          >
            <input
              type="checkbox"
              checked={inviteForm.sendEmail && smtpConfigured}
              disabled={!smtpConfigured}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, sendEmail: e.target.checked })
              }
            />
            <span>
              Send email
              {!smtpConfigured ? (
                <em className="admin-check-muted"> · SMTP not configured</em>
              ) : null}
            </span>
          </label>
          <button
            type="submit"
            className="btn admin-btn admin-btn-primary"
            disabled={creatingInvite}
          >
            {creatingInvite ? 'Creating…' : 'Create invite + copy URL'}
          </button>
        </div>
      </form>

      {lastInviteUrl ? (
        <div className="admin-invite-url">
          <div className="admin-invite-url-meta">
            <span className="admin-invite-url-label">
              {copied ? 'Copied to clipboard' : 'Invite URL'}
            </span>
            <button
              type="button"
              className="btn admin-btn-secondary admin-btn-compact"
              onClick={() => copyText(lastInviteUrl)}
            >
              Copy again
            </button>
          </div>
          <code className="admin-invite-url-code">{lastInviteUrl}</code>
        </div>
      ) : null}

      {pendingInvites.length ? (
        <div className="admin-block">
          <h4 className="admin-block-title">
            Pending invites
            <span className="admin-section-count">{pendingInvites.length}</span>
          </h4>
          <div className="admin-table-wrap">
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
                    <td className="admin-cell-email">{inv.email}</td>
                    <td>
                      <span className="admin-locale-pill">
                        {inv.locale === 'pl' ? 'PL' : 'EN'}
                      </span>
                    </td>
                    <td>{formatDate(inv.expiresAt)}</td>
                    <td className="admin-actions-cell">
                      <button
                        type="button"
                        className="btn admin-btn-secondary admin-btn-compact"
                        onClick={() => inviteAction(inv.id, 'copy')}
                        title="Rotate token + copy new URL"
                      >
                        New URL
                      </button>
                      <button
                        type="button"
                        className="btn admin-btn-secondary admin-btn-compact"
                        disabled={!smtpConfigured}
                        onClick={() => inviteAction(inv.id, 'resend')}
                      >
                        Resend
                      </button>
                      <button
                        type="button"
                        className="btn admin-btn-danger admin-btn-compact"
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
        </div>
      ) : null}

      {assignFor ? (
        <form className="admin-token-form" onSubmit={handleAssign}>
          <h4 className="admin-block-title">
            Assign project
            <span className="admin-section-count">{assignFor.email}</span>
          </h4>
          <div className="admin-token-form-grid">
            <label>
              Session folder
              <select
                required
                className="glass-input admin-input"
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
            </label>
            <label>
              Label (optional)
              <input
                type="text"
                className="glass-input admin-input"
                placeholder="Project label"
                value={assignLabel}
                onChange={(e) => setAssignLabel(e.target.value)}
              />
            </label>
          </div>
          <div className="admin-invite-form-footer">
            <button type="submit" className="btn admin-btn admin-btn-primary">
              Assign
            </button>
            <button
              type="button"
              className="btn admin-btn-secondary"
              onClick={() => setAssignFor(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {passwordFor ? (
        <form className="admin-token-form" onSubmit={handleSetPassword}>
          <h4 className="admin-block-title">
            Reset password
            <span className="admin-section-count">{passwordFor.email}</span>
          </h4>
          <label>
            New password (min 8)
            <input
              required
              type="password"
              minLength={8}
              className="glass-input admin-input"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <div className="admin-invite-form-footer">
            <button type="submit" className="btn admin-btn admin-btn-primary">
              Set password
            </button>
            <button
              type="button"
              className="btn admin-btn-secondary"
              onClick={() => {
                setPasswordFor(null);
                setNewPassword('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="admin-block">
        <h4 className="admin-block-title">
          Accounts
          {clients.length ? (
            <span className="admin-section-count">{clients.length}</span>
          ) : null}
        </h4>

        {loading ? (
          <p className="admin-empty-inline">Loading accounts…</p>
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
                  <tr
                    key={c.id}
                    className={
                      c.status !== 'active' ? 'admin-token-row-inactive' : ''
                    }
                  >
                    <td className="admin-cell-email">{c.email}</td>
                    <td className="admin-cell-name">{c.displayName || '—'}</td>
                    <td>
                      {c.linkedToken ? (
                        <span
                          className="admin-hubbound-badge"
                          title="Upload only via /client session — not a /?token= link"
                        >
                          Linked · hub-bound
                        </span>
                      ) : (
                        '—'
                      )}
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
                        className="btn admin-btn-secondary admin-btn-compact"
                        onClick={() => setAssignFor(c)}
                      >
                        Assign
                      </button>
                      <button
                        type="button"
                        className="btn admin-btn-secondary admin-btn-compact"
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
                          className="btn admin-btn-secondary admin-btn-compact"
                          onClick={() =>
                            patchClient(c.id, { action: 'revoke' }).catch(
                              (err) => setError(err.message)
                            )
                          }
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn admin-btn-secondary admin-btn-compact"
                          onClick={() =>
                            patchClient(c.id, { action: 'restore' }).catch(
                              (err) => setError(err.message)
                            )
                          }
                        >
                          Restore
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn admin-btn-danger admin-btn-compact"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete hub account ${c.email}? Memberships removed.`
                            )
                          ) {
                            return;
                          }
                          fetch(
                            `/api/admin/clients/${encodeURIComponent(c.id)}`,
                            {
                              method: 'DELETE',
                              credentials: 'include',
                            }
                          )
                            .then((r) =>
                              r.json().then((d) => ({ ok: r.ok, d }))
                            )
                            .then(({ ok, d }) => {
                              if (!ok)
                                throw new Error(d.error || 'Delete failed');
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
                    <td colSpan={7}>
                      <p className="admin-empty-inline" style={{ margin: 0 }}>
                        Brak kont — wyślij zaproszenie powyżej.
                      </p>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {memberships.length ? (
        <div className="admin-block">
          <h4 className="admin-block-title">
            Assignments
            <span className="admin-section-count">{memberships.length}</span>
          </h4>
          <div className="admin-table-wrap">
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
                      <td className="admin-cell-email">{m.clientEmail}</td>
                      <td>
                        <code className="admin-code">
                          {String(m.folderId).slice(0, 12)}…
                        </code>
                      </td>
                      <td>{m.label || '—'}</td>
                      <td>
                        {m.shareId ? (
                          <code className="admin-code">{m.shareId}</code>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{formatDate(m.assignedAt)}</td>
                      <td className="admin-actions-cell">
                        {client ? (
                          <button
                            type="button"
                            className="btn admin-btn-secondary admin-btn-compact"
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
        </div>
      ) : null}
    </section>
  );
}
