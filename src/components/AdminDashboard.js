'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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

function uploadedBytesFromActive(active) {
  const files = active?.files || [];
  return files.reduce((sum, f) => {
    if (f.status === 'completed') return sum + (Number(f.size) || 0);
    const pct = Math.min(100, Math.max(0, Number(f.progress) || 0)) / 100;
    return sum + (Number(f.size) || 0) * pct;
  }, 0);
}

function ClientCell({ projectName, uploaderName }) {
  return (
    <td className="admin-cell-name">
      {projectName ? <strong>{projectName}</strong> : null}
      {projectName ? <br /> : null}
      {uploaderName || '—'}
    </td>
  );
}

function DriveLink({ href }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="admin-drive-link">
      Open ↗
    </a>
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

  const [sessions, setSessions] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [tokenStats, setTokenStats] = useState({ active: 0, total: 0 });
  const [oauthScopeLabel, setOauthScopeLabel] = useState('—');

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

  const fetchTokenStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tokens', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const list = data.tokens || [];
      setTokenStats({
        active: list.filter((t) => t.status === 'active').length,
        total: list.length,
      });
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/me', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (data.authenticated) {
          setAuthenticated(true);
          await Promise.all([fetchActive(), fetchSessions(), fetchTokenStats()]);
        } else {
          setAuthenticated(false);
        }
      } catch {
        setAuthenticated(false);
      }
    })();
  }, [fetchActive, fetchSessions, fetchTokenStats]);

  // Passive refresh: Drive history + active progress every 60s
  useEffect(() => {
    if (!authenticated) return;
    const interval = setInterval(() => {
      fetchSessions();
      fetchActive();
    }, 60_000);
    return () => clearInterval(interval);
  }, [authenticated, fetchSessions, fetchActive]);

  const { inProgressRows, completedSessions } = useMemo(() => {
    const liveActive = activeSessions.filter((a) => a.sessionStatus !== 'completed');
    const activeByFolder = new Map();
    for (const a of liveActive) {
      if (a.folderId) activeByFolder.set(a.folderId, a);
    }

    const historyFolderIds = new Set(sessions.map((s) => s.folderId));
    const inProgress = [];

    for (const s of sessions) {
      const active = activeByFolder.get(s.folderId);
      if (!active) continue;
      const completedCount = active.completedCount ?? active.files?.filter((f) => f.status === 'completed').length ?? 0;
      const fileCount = active.fileCount ?? active.files?.length ?? s.fileCount;
      const uploaded = uploadedBytesFromActive(active);
      const total = active.totalSize ?? active.files?.reduce((sum, f) => sum + (Number(f.size) || 0), 0) ?? s.totalSize;
      inProgress.push({
        key: s.folderId,
        folderId: s.folderId,
        projectName: active.projectName || s.projectName,
        uploaderName: active.uploaderName || s.uploaderName,
        uploaderEmail: active.uploaderEmail || s.uploaderEmail,
        completedCount,
        fileCount,
        overallProgress: active.overallProgress,
        uploadedBytes: uploaded,
        totalBytes: total,
        updatedAt: active.updatedAt || s.modifiedTime,
        driveLink: s.driveLink || active.driveLink,
      });
    }

    for (const a of liveActive) {
      if (!a.folderId || historyFolderIds.has(a.folderId)) continue;
      const completedCount = a.completedCount ?? a.files?.filter((f) => f.status === 'completed').length ?? 0;
      const fileCount = a.fileCount ?? a.files?.length ?? 0;
      const uploaded = uploadedBytesFromActive(a);
      const total = a.totalSize ?? a.files?.reduce((sum, f) => sum + (Number(f.size) || 0), 0) ?? 0;
      inProgress.push({
        key: a.sessionId || a.folderId,
        folderId: a.folderId,
        projectName: a.projectName,
        uploaderName: a.uploaderName,
        uploaderEmail: a.uploaderEmail,
        completedCount,
        fileCount,
        overallProgress: a.overallProgress,
        uploadedBytes: uploaded,
        totalBytes: total,
        updatedAt: a.updatedAt,
        driveLink: a.driveLink || `https://drive.google.com/drive/folders/${a.folderId}`,
      });
    }

    const inProgressIds = new Set(inProgress.map((r) => r.folderId));
    const completed = sessions.filter((s) => !inProgressIds.has(s.folderId));

    return { inProgressRows: inProgress, completedSessions: completed };
  }, [activeSessions, sessions]);

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
      await Promise.all([fetchActive(), fetchSessions(), fetchTokenStats()]);
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
      <div className="admin-loading glass-panel admin-login-card">
        <p>Loading…</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <form className="admin-login-form glass-panel admin-login-card" onSubmit={handleLogin}>
        <div className="admin-hero-pills">
          <span className="admin-pill admin-pill-accent">ADMIN PANEL</span>
        </div>
        <h2>Admin Login</h2>
        <p className="admin-login-hint">Enter the admin password to view upload sessions.</p>
        <input
          type="password"
          className="glass-input admin-input"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
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

  const historyCount = inProgressRows.length + completedSessions.length;
  const storedBytes = completedSessions.reduce(
    (sum, s) => sum + (Number(s.totalSize) || 0),
    0
  );
  const storedFiles = completedSessions.reduce(
    (sum, s) => sum + (Number(s.fileCount) || 0),
    0
  );

  return (
    <div className="admin-dashboard">
      <section className="admin-hero glass-panel">
        <div className="admin-hero-top">
          <div className="admin-hero-copy">
            <div className="admin-hero-pills">
              <span className="admin-pill admin-pill-accent">ADMIN PANEL · GOOGLE DRIVE</span>
              <span className="admin-pill admin-pill-ok">
                <span className="admin-pulse-dot" aria-hidden="true" />
                Sesja aktywna
              </span>
            </div>
            <h1>Admin Console</h1>
            <p className="admin-hero-sub">
              Session history from Google Drive, active client tokens and OAuth security diagnostics.
            </p>
            <div className="admin-telemetry">
              <span className="admin-telemetry-pill">
                Drive: <strong>{fetchedAt ? formatDate(fetchedAt) : '—'}</strong>
              </span>
              <span className="admin-telemetry-pill">
                Progress: <strong>{activeFetchedAt ? formatDate(activeFetchedAt) : '—'}</strong>
              </span>
              <span className="admin-telemetry-pill admin-telemetry-accent">Auto-refresh: 60s</span>
            </div>
          </div>
          <div className="admin-toolbar-actions">
            <button
              type="button"
              className="btn admin-btn-primary"
              onClick={() => {
                refreshAll();
                fetchTokenStats();
              }}
              disabled={loading || activeLoading}
            >
              {loading || activeLoading ? 'Refreshing…' : 'Refresh all'}
            </button>
            <button type="button" className="btn admin-btn-secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>

        <div className="admin-kpi-row">
          <div className="admin-kpi-tile">
            <div className="admin-kpi-label">Completed Sessions</div>
            <div className="admin-kpi-value">
              {completedSessions.length}
              <span className="admin-kpi-hint">{inProgressRows.length ? `${inProgressRows.length} live` : 'Drive synced'}</span>
            </div>
          </div>
          <div className="admin-kpi-tile">
            <div className="admin-kpi-label">Stored Volume</div>
            <div className="admin-kpi-value">
              {formatBytes(storedBytes)}
              <span className="admin-kpi-hint">{storedFiles.toLocaleString('pl-PL')} files</span>
            </div>
          </div>
          <div className="admin-kpi-tile">
            <div className="admin-kpi-label">Client Tokens</div>
            <div className="admin-kpi-value admin-kpi-accent">
              {tokenStats.active} active
              <span className="admin-kpi-hint">of {tokenStats.total} total</span>
            </div>
          </div>
          <div className="admin-kpi-tile">
            <div className="admin-kpi-label">OAuth Scope</div>
            <div className="admin-kpi-value admin-kpi-ok">
              {oauthScopeLabel}
              <span className="admin-kpi-hint">VULN-05</span>
            </div>
          </div>
        </div>
      </section>

      <section className="admin-section glass-panel">
        <h3 className="admin-section-title">
          History (Google Drive)
          {historyCount > 0 && <span className="admin-section-count">{historyCount}</span>}
        </h3>
        <p className="admin-empty-inline" style={{ marginTop: 0 }}>
          Sesje z folderu głównego Google Drive po odfiltrowaniu plików technicznych.
        </p>

        {fetchError && <p className="admin-error admin-error-banner">{fetchError}</p>}

        {!loading && !fetchError && historyCount === 0 && (
          <p className="admin-empty-inline">No upload sessions found in the main Drive folder yet.</p>
        )}

        {inProgressRows.length > 0 && (
          <div className="admin-history-block">
            <h4 className="admin-history-subtitle">
              In progress
              <span className="admin-section-count">{inProgressRows.length}</span>
            </h4>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Project &amp; Client</th>
                    <th>Email</th>
                    <th>Progress</th>
                    <th>Size</th>
                    <th>Last activity</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {inProgressRows.map((row) => (
                    <tr key={row.key} className="admin-row-in-progress">
                      <ClientCell projectName={row.projectName} uploaderName={row.uploaderName} />
                      <td className="admin-cell-email">{row.uploaderEmail || '—'}</td>
                      <td>
                        <span className="admin-badge admin-badge-live">Live</span>{' '}
                        {row.completedCount}/{row.fileCount} files
                        {typeof row.overallProgress === 'number' ? ` · ${row.overallProgress}%` : null}
                      </td>
                      <td>
                        {formatBytes(row.uploadedBytes)} / {formatBytes(row.totalBytes)}
                      </td>
                      <td className="admin-cell-date">{formatDate(row.updatedAt)}</td>
                      <td>
                        <DriveLink href={row.driveLink} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {completedSessions.length > 0 && (
          <div className="admin-history-block">
            <h4 className="admin-history-subtitle">
              Completed
              <span className="admin-section-count">{completedSessions.length}</span>
            </h4>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Project &amp; Client</th>
                    <th>Email</th>
                    <th>Files</th>
                    <th>Size</th>
                    <th>Last activity</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {completedSessions.map((s) => (
                    <tr key={s.folderId}>
                      <ClientCell projectName={s.projectName} uploaderName={s.uploaderName} />
                      <td className="admin-cell-email">{s.uploaderEmail || '—'}</td>
                      <td>{s.fileCount}</td>
                      <td>{s.totalSizeFormatted}</td>
                      <td className="admin-cell-date">{formatDate(s.modifiedTime)}</td>
                      <td>
                        <DriveLink href={s.driveLink} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <AdminTokenManager onStatsChange={setTokenStats} />
      <AdminOAuthCheck onScopeLabel={setOauthScopeLabel} />
    </div>
  );
}
