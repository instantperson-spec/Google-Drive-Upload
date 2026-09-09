'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminTokenManager from '@/components/AdminTokenManager';
import AdminOAuthCheck from '@/components/AdminOAuthCheck';

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

const MAX_FILES_SHOWN = 8;

function ActiveSessionCard({ session }) {
  const [showLogs, setShowLogs] = useState(false);
  const isDone = session.sessionStatus === 'completed';
  
  // Sort files: uploading first, then pending, then completed
  const sortedFiles = [...session.files].sort((a, b) => {
    const score = { uploading: 0, error: 1, pending: 2, completed: 3 };
    return (score[a.status] ?? 4) - (score[b.status] ?? 4);
  });

  return (
    <div className={`admin-active-card ${isDone ? 'admin-active-card-done' : ''}`}>
      <div className="admin-active-card-header">
        <div>
          <strong>{session.uploaderName}</strong>
          {session.uploaderEmail && (
            <span className="admin-active-email"> · {session.uploaderEmail}</span>
          )}
          {session.token && (
            <span className="admin-active-token"> · token: {session.token}</span>
          )}
        </div>
        <div className="admin-active-card-meta">
          {isDone ? (
            <span className="admin-badge admin-badge-success">Completed</span>
          ) : (
            <span className="admin-badge admin-badge-live">Live</span>
          )}
          <span className="admin-active-overall">{session.overallProgress}%</span>
          <a
            href={session.driveLink}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-drive-link"
          >
            Open ↗
          </a>
        </div>
      </div>

      <div className="admin-active-summary">
        {session.completedCount}/{session.fileCount} files · {session.totalSizeFormatted}
        {' · '}updated {formatDate(session.updatedAt)}
      </div>

      <ul className="admin-active-files" style={{ maxHeight: '250px', overflowY: 'auto', paddingRight: '5px' }}>
        {sortedFiles.map((f) => (
          <li key={f.name} className="admin-active-file">
            <div className="admin-active-file-row">
              <span className="admin-active-file-name" title={f.name}>{f.name}</span>
              <span className="admin-active-file-meta">
                {formatBytes(f.size)} · {f.progress}%
              </span>
            </div>
            <div className="admin-progress-track">
              <div
                className={`admin-progress-fill ${f.status === 'completed' ? 'admin-progress-done' : ''}`}
                style={{ width: `${f.progress}%` }}
              />
            </div>
          </li>
        ))}
      </ul>


      <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.5rem' }}>
        <button 
          className="btn admin-btn-secondary" 
          onClick={() => setShowLogs(!showLogs)}
          style={{ fontSize: '0.75rem', padding: '4px 8px' }}
        >
          {showLogs ? 'Hide Terminal' : `Show Terminal Logs (${session.logs?.length || 0})`}
        </button>
      </div>

      {showLogs && (
        <div className="admin-terminal" style={{ 
          marginTop: '0.5rem', 
          background: 'rgba(0,0,0,0.8)', 
          color: '#4af626', 
          fontFamily: 'monospace', 
          padding: '10px', 
          fontSize: '0.75rem',
          maxHeight: '200px',
          overflowY: 'auto',
          borderRadius: '4px',
          border: '1px solid #333'
        }}>
          {(!session.logs || session.logs.length === 0) ? 'No logs recorded...' : session.logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState(null);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [activeSessions, setActiveSessions] = useState([]);
  const [activeFetchedAt, setActiveFetchedAt] = useState(null);
  const [activeLoading, setActiveLoading] = useState(false);
  const [liveMonitor, setLiveMonitor] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const fetchActive = useCallback(async () => {
    setActiveLoading(true);
    try {
      const res = await fetch('/api/admin/active', { credentials: 'include' });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setActiveSessions(data.active || []);
      setActiveFetchedAt(data.fetchedAt);
      setAuthenticated(true);
    } catch {
      // non-critical — history still works
    } finally {
      setActiveLoading(false);
    }
  }, []);

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
    fetchActive();
    fetchSessions();
  }, [fetchActive, fetchSessions]);

  // Active uploads: refresh every 5s ONLY when Live Monitor is ON
  useEffect(() => {
    if (!authenticated || !liveMonitor) return;
    const interval = setInterval(fetchActive, 5_000);
    return () => clearInterval(interval);
  }, [authenticated, liveMonitor, fetchActive]);

  // When Live Monitor is turned ON, immediately fetch fresh data
  useEffect(() => {
    if (authenticated && liveMonitor) fetchActive();
  }, [liveMonitor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drive history: refresh every 60s
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
      if (!res.ok) throw new Error(data.error || 'Login failed');
      setPassword('');
      setAuthenticated(true);
      await Promise.all([fetchActive(), fetchSessions()]);
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
    setAuthenticated(false);
    setActiveSessions([]);
    setSessions([]);
    setActiveFetchedAt(null);
    setFetchedAt(null);
  };

  const refreshAll = () => {
    fetchActive();
    fetchSessions();
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
          <h2>Admin Console</h2>
          <p className="admin-meta">
            {liveMonitor
              ? <>🟢 Live Monitor ON · refresh 5s{activeFetchedAt && <> · updated {formatDate(activeFetchedAt)}</>}</>
              : <>⚫ Live Monitor OFF · per-file events only · history refresh 60s</>}
          </p>
        </div>
        <div className="admin-toolbar-actions">
          <button
            type="button"
            className={`btn ${liveMonitor ? 'admin-btn' : 'admin-btn-secondary'}`}
            onClick={() => setLiveMonitor((v) => !v)}
            title={liveMonitor ? 'Turn off live polling (saves Vercel invocations)' : 'Turn on live polling (5s refresh)'}
          >
            {liveMonitor ? '🟢 Live Monitor ON' : '⚫ Live Monitor OFF'}
          </button>
          <button
            type="button"
            className="btn admin-btn-secondary"
            onClick={refreshAll}
            disabled={loading || activeLoading}
          >
            {loading || activeLoading ? 'Refreshing…' : 'Refresh all'}
          </button>
          <button type="button" className="btn admin-btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      {/* Phase B: Live uploads */}
      <section className="admin-section">
        <h3 className="admin-section-title">
          Active now
          {activeSessions.length > 0 && (
            <span className="admin-section-count">{activeSessions.length}</span>
          )}
        </h3>

        {activeSessions.length === 0 && !activeLoading && (
          <p className="admin-empty-inline">No uploads in progress right now.</p>
        )}

        <div className="admin-active-grid">
          {activeSessions.map((s) => (
            <ActiveSessionCard key={s.sessionId} session={s} />
          ))}
        </div>
      </section>

      {/* Phase A: Drive history */}
      <section className="admin-section">
        <h3 className="admin-section-title">
          History (Google Drive)
          {sessions.length > 0 && (
            <span className="admin-section-count">{sessions.length}</span>
          )}
        </h3>

        {fetchError && <p className="admin-error admin-error-banner">{fetchError}</p>}

        {sessions.length === 0 && !loading && !fetchError && (
          <p className="admin-empty-inline">No upload sessions found in the main Drive folder yet.</p>
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

        {fetchedAt && (
          <p className="admin-footnote">Drive history updated {formatDate(fetchedAt)}</p>
        )}
      </section>

      {/* Phase C: Token manager */}
      <AdminTokenManager />

      {/* System: OAuth scope diagnostic */}
      <AdminOAuthCheck />
    </div>
  );
}
