'use client';

import { useState, useEffect, useCallback } from 'react';

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export default function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState(null); // null = checking
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      const res = await fetch('/api/admin/sessions', { credentials: 'include' });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load sessions');
      }
      const data = await res.json();
      setSessions(data.sessions || []);
      setFetchedAt(data.fetchedAt);
      setAuthenticated(true);
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Auto-refresh every 60s while authenticated
  useEffect(() => {
    if (!authenticated) return;
    const interval = setInterval(fetchSessions, 60_000);
    return () => clearInterval(interval);
  }, [authenticated, fetchSessions]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }
      setPassword('');
      setAuthenticated(true);
      await fetchSessions();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
    setAuthenticated(false);
    setSessions([]);
    setFetchedAt(null);
  };

  if (authenticated === null) {
    return (
      <div className="admin-loading">
        <p>Loading…</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <form className="admin-login-form" onSubmit={handleLogin}>
        <h2>Admin Login</h2>
        <p className="admin-login-hint">Enter the admin password to view upload sessions.</p>
        <input
          type="password"
          className="glass-input admin-input"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
        />
        {loginError && <p className="admin-error">{loginError}</p>}
        <button type="submit" className="btn admin-btn" disabled={loggingIn}>
          {loggingIn ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-toolbar">
        <div>
          <h2>Upload Sessions</h2>
          <p className="admin-meta">
            {sessions.length} session{sessions.length !== 1 ? 's' : ''}
            {fetchedAt && <> · updated {formatDate(fetchedAt)}</>}
            {' · '}auto-refresh 60s
          </p>
        </div>
        <div className="admin-toolbar-actions">
          <button
            type="button"
            className="btn admin-btn-secondary"
            onClick={fetchSessions}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="btn admin-btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      {fetchError && <p className="admin-error admin-error-banner">{fetchError}</p>}

      {sessions.length === 0 && !loading && !fetchError && (
        <p className="admin-empty">No upload sessions found in the main Drive folder yet.</p>
      )}

      {sessions.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Email</th>
                <th>Files</th>
                <th>Size</th>
                <th>Last activity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.folderId}>
                  <td className="admin-cell-name">{s.uploaderName}</td>
                  <td className="admin-cell-email">{s.uploaderEmail || '—'}</td>
                  <td>{s.fileCount}</td>
                  <td>{s.totalSizeFormatted}</td>
                  <td className="admin-cell-date">{formatDate(s.modifiedTime)}</td>
                  <td>
                    <a
                      href={s.driveLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="admin-drive-link"
                    >
                      Open ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="admin-footnote">
        Shows completed files on Google Drive. Uploads in progress appear here only after each file reaches 100%.
      </p>
    </div>
  );
}
