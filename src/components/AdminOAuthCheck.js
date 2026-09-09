'use client';

import { useState } from 'react';

function LevelBanner({ level, message }) {
  const cls =
    level === 'ok'
      ? 'admin-oauth-banner-ok'
      : level === 'warn'
        ? 'admin-oauth-banner-warn'
        : 'admin-oauth-banner-error';
  return (
    <div className={`admin-oauth-banner ${cls}`}>
      <strong>{level === 'ok' ? 'Pass' : level === 'warn' ? 'Warning' : 'Action required'}</strong>
      <p>{message}</p>
    </div>
  );
}

function ScopeRow({ scope, status }) {
  const label = status === 'ok' ? 'Recommended' : status === 'error' ? 'Too broad' : 'Other';
  const cls = `admin-oauth-scope-${status}`;
  return (
    <li className={`admin-oauth-scope-row ${cls}`}>
      <span className="admin-oauth-scope-label">{label}</span>
      <code className="admin-code">{scope}</code>
    </li>
  );
}

export default function AdminOAuthCheck() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runCheck = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/check-oauth-scopes', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Check failed');
      setReport(data);
    } catch (err) {
      setError(err.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="admin-section">
      <div className="admin-section-header-row">
        <h3 className="admin-section-title">OAuth scope test (VULN-05)</h3>
        <button
          type="button"
          className="btn admin-btn-secondary"
          onClick={runCheck}
          disabled={loading}
        >
          {loading ? 'Running…' : 'Run test'}
        </button>
      </div>

      <p className="admin-empty-inline" style={{ marginTop: 0 }}>
        Checks whether the Google refresh token has the recommended{' '}
        <code className="admin-code">drive.file</code> scope (not full Drive access).
        Same as <code className="admin-code">npm run check-oauth-scopes</code>.
      </p>

      {error && <p className="admin-error admin-error-banner">{error}</p>}

      {report && (
        <div className="admin-oauth-report">
          <LevelBanner level={report.summary.level} message={report.summary.message} />

          <div className="admin-oauth-grid">
            <div className="admin-oauth-block">
              <h4>Configuration</h4>
              <ul className="admin-oauth-meta">
                <li>Client ID: <code className="admin-code">{report.config.clientId}</code></li>
                <li>Refresh token: <code className="admin-code">{report.config.refreshToken}</code></li>
                <li>Folder ID: <code className="admin-code">{report.config.mainFolderId || '(missing)'}</code></li>
              </ul>
            </div>

            <div className="admin-oauth-block">
              <h4>Refresh token</h4>
              {report.refresh.ok ? (
                <p className="admin-oauth-ok-text">Access token obtained successfully</p>
              ) : (
                <p className="admin-oauth-err-text">{report.refresh.error}</p>
              )}
              {report.tokenInfo && (
                <p className="admin-oauth-meta-line">
                  Expires in {report.tokenInfo.expiresIn}s
                </p>
              )}
            </div>
          </div>

          {report.scopes.length > 0 && (
            <div className="admin-oauth-block">
              <h4>Granted scopes</h4>
              <ul className="admin-oauth-scope-list">
                {report.scopes.map((s) => (
                  <ScopeRow key={s.scope} scope={s.scope} status={s.status} />
                ))}
              </ul>
            </div>
          )}

          {report.driveTests.length > 0 && (
            <div className="admin-oauth-block">
              <h4>Drive API smoke tests</h4>
              <ul className="admin-oauth-test-list">
                {report.driveTests.map((t) => {
                  const optional = t.critical === false;
                  const failCls = t.passed ? 'admin-oauth-test-pass' : optional ? 'admin-oauth-test-optional' : 'admin-oauth-test-fail';
                  return (
                    <li key={t.name} className={failCls}>
                      <span>
                        {t.passed ? '✓' : optional ? '○' : '✗'} {t.name}
                        {optional && !t.passed && ' (expected with drive.file)'}
                      </span>
                      {t.detail && <span className="admin-oauth-test-detail">{t.detail}</span>}
                      {t.error && <span className="admin-oauth-test-detail">{t.error}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <p className="admin-footnote">
            Checked {new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.checkedAt))}
            {' · '}If full Drive scope is detected, regenerate the refresh token — see{' '}
            <code className="admin-code">dokumentacja/regeneracja_oauth_scope.md</code>
          </p>
        </div>
      )}
    </section>
  );
}
