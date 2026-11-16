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

function ClientAuthCard({ onLoggedIn, locale, onLocale }) {
  const t = useT();
  const [mode, setMode] = useState('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupLocale, setSignupLocale] = useState(locale || 'en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'signup') {
        const res = await fetch('/api/client/register', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: name,
            email,
            password,
            locale: signupLocale,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || t('clientHub.signupError'));
        onLoggedIn(data.client);
        return;
      }

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
    <div className="glass-panel client-hub-panel client-hub-auth-card">
      <div className="upload-page-head">
        <div className="client-hub-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`client-hub-tab${mode === 'signup' ? ' is-active' : ''}`}
            aria-selected={mode === 'signup'}
            onClick={() => {
              setMode('signup');
              setError('');
            }}
          >
            {t('clientHub.tabSignup')}
          </button>
          <button
            type="button"
            role="tab"
            className={`client-hub-tab${mode === 'signin' ? ' is-active' : ''}`}
            aria-selected={mode === 'signin'}
            onClick={() => {
              setMode('signin');
              setError('');
            }}
          >
            {t('clientHub.tabSignin')}
          </button>
        </div>
        <LocaleSwitch locale={locale} onChange={onLocale} />
      </div>

      <h1 className="client-hub-auth-title">
        {mode === 'signup' ? t('clientHub.signupTitle') : t('clientHub.loginTitle')}
      </h1>
      <p className="subtitle">
        {mode === 'signup'
          ? t('clientHub.signupSubtitle')
          : t('clientHub.loginSubtitle')}
      </p>

      <form className="client-hub-form" onSubmit={onSubmit}>
        {mode === 'signup' ? (
          <label className="client-hub-label">
            {t('clientHub.name')}
            <input
              type="text"
              autoComplete="name"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        ) : null}
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
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={mode === 'signup' ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {mode === 'signup' ? (
          <fieldset className="client-hub-locale">
            <legend>{t('clientHub.locale')}</legend>
            <label>
              <input
                type="radio"
                name="signup-locale"
                checked={signupLocale === 'pl'}
                onChange={() => setSignupLocale('pl')}
              />
              PL
            </label>
            <label>
              <input
                type="radio"
                name="signup-locale"
                checked={signupLocale === 'en'}
                onChange={() => setSignupLocale('en')}
              />
              EN
            </label>
          </fieldset>
        ) : null}
        {error ? <p className="client-hub-error">{error}</p> : null}
        <button type="submit" className="btn" disabled={busy}>
          {busy
            ? t('clientHub.busy')
            : mode === 'signup'
              ? t('clientHub.signUp')
              : t('clientHub.signIn')}
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
        <ClientAuthCard
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
