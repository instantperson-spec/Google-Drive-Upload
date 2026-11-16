'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocaleProvider, useT } from '@/context/LocaleContext';
import LocaleSwitch from '@/components/LocaleSwitch';
import { DEFAULT_LOCALE, normalizeLocale } from '@/lib/locales';

function formatWhen(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function sourceBadge(source, t) {
  if (source === 'assigned') return t('clientHub.badgeAssigned');
  if (source === 'both') return t('clientHub.badgeBoth');
  return t('clientHub.badgeOwned');
}

function ClientLogin({ onLoggedIn, locale, onLocale }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/client/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('clientHub.loginError'));
      onLoggedIn(data.client);
    } catch (err) {
      setError(err.message || t('clientHub.loginError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-panel client-hub-panel">
      <div className="upload-page-head">
        <div>
          <h1>{t('clientHub.loginTitle')}</h1>
          <p className="subtitle">{t('clientHub.loginSubtitle')}</p>
        </div>
        <LocaleSwitch locale={locale} onChange={onLocale} />
      </div>
      <form className="client-hub-form" onSubmit={onSubmit}>
        <label className="client-hub-label">
          {t('clientHub.email')}
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="client-hub-label">
          {t('clientHub.password')}
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className="client-hub-error">{error}</p> : null}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? t('clientHub.signingIn') : t('clientHub.signIn')}
        </button>
      </form>
    </div>
  );
}

function ClientHubHome({ client, onLogout, locale, onLocale }) {
  const t = useT();
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/client/projects', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('clientHub.loginError'));
      setProjects(data.projects || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const name = client?.displayName || client?.email || '';

  return (
    <div className="glass-panel client-hub-panel">
      <div className="upload-page-head">
        <div>
          <h1>{t('clientHub.hubTitle')}</h1>
          <p className="subtitle">{t('clientHub.hubHello', { name })}</p>
        </div>
        <div className="client-hub-actions">
          <LocaleSwitch locale={locale} onChange={onLocale} />
          <button type="button" className="btn btn-secondary" onClick={onLogout}>
            {t('clientHub.logout')}
          </button>
        </div>
      </div>

      <div className="client-hub-toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => router.push('/client/upload')}
          disabled={!client?.hasLinkedToken}
          title={
            client?.hasLinkedToken
              ? undefined
              : 'Ask the studio to link an upload token to your account'
          }
        >
          {t('clientHub.newUpload')}
        </button>
      </div>

      {loading ? <p className="share-muted">{t('clientHub.loading')}</p> : null}
      {error ? <p className="client-hub-error">{error}</p> : null}

      {!loading && !projects.length ? (
        <p className="share-muted">{t('clientHub.empty')}</p>
      ) : null}

      <ul className="client-hub-list">
        {projects.map((p) => (
          <li key={p.folderId} className="client-hub-item">
            <div className="client-hub-item-main">
              <strong className="client-hub-item-title">{p.label}</strong>
              <span className="client-hub-item-meta">
                <span className="client-hub-badge">{sourceBadge(p.source, t)}</span>
                {p.updatedAt ? <span>{formatWhen(p.updatedAt)}</span> : null}
              </span>
            </div>
            {p.openUrl ? (
              <a className="btn btn-secondary" href={p.openUrl}>
                {t('clientHub.openProject')}
              </a>
            ) : (
              <span className="share-muted">{t('clientHub.noShareYet')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ClientHub() {
  const [locale, setLocale] = useState(DEFAULT_LOCALE);
  const [checking, setChecking] = useState(true);
  const [client, setClient] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/client/me', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data.authenticated && data.client) {
          setClient(data.client);
          if (data.client.locale) setLocale(normalizeLocale(data.client.locale));
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    await fetch('/api/client/logout', { method: 'POST', credentials: 'include' });
    setClient(null);
  }

  if (checking) {
    return (
      <LocaleProvider locale={locale}>
        <div className="glass-panel client-hub-panel">
          <p className="share-muted">…</p>
        </div>
      </LocaleProvider>
    );
  }

  return (
    <LocaleProvider locale={locale}>
      {client ? (
        <ClientHubHome
          client={client}
          onLogout={handleLogout}
          locale={locale}
          onLocale={setLocale}
        />
      ) : (
        <ClientLogin
          onLoggedIn={(c) => {
            setClient(c);
            if (c?.locale) setLocale(normalizeLocale(c.locale));
          }}
          locale={locale}
          onLocale={setLocale}
        />
      )}
    </LocaleProvider>
  );
}
