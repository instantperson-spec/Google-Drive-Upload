'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocaleProvider, useT } from '@/context/LocaleContext';
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

function Shell({ children }) {
  return (
    <div className="client-shell">
      <div className="aurora-container" aria-hidden="true">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>
      <div className="noise-overlay" aria-hidden="true" />
      <main className="client-shell-main">{children}</main>
    </div>
  );
}

/** Markup/CSS from mockups/signup.html — only API wiring differs. */
function ClientAuthCard({ onLoggedIn, onLocale }) {
  const t = useT();
  const [mode, setMode] = useState('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupLocale, setSignupLocale] = useState('pl');
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [showSigninPw, setShowSigninPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function go(next) {
    setMode(next);
    setError('');
  }

  async function onSignup(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/client/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: name.trim(),
          email: email.trim(),
          password,
          locale: signupLocale,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('clientHub.signupError'));
      onLocale(normalizeLocale(signupLocale));
      onLoggedIn(data.client);
    } catch (err) {
      setError(err.message || t('clientHub.signupError'));
    } finally {
      setBusy(false);
    }
  }

  async function onSignin(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/client/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('clientHub.loginError'));
      if (data.client?.locale) onLocale(normalizeLocale(data.client.locale));
      onLoggedIn(data.client);
    } catch (err) {
      setError(err.message || t('clientHub.loginError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="modern-glass-card" aria-label={t('clientHub.authAria')}>
      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          className="tab-btn"
          role="tab"
          aria-selected={mode === 'signup'}
          aria-controls="panel-signup"
          onClick={() => go('signup')}
        >
          {t('clientHub.tabSignup')}
        </button>
        <button
          type="button"
          className="tab-btn"
          role="tab"
          aria-selected={mode === 'signin'}
          aria-controls="panel-signin"
          onClick={() => go('signin')}
        >
          {t('clientHub.tabSignin')}
        </button>
      </div>

      {mode === 'signup' ? (
        <div id="panel-signup" role="tabpanel">
          <h1 className="auth-title">{t('clientHub.signupTitle')}</h1>
          <p className="auth-subtitle">{t('clientHub.signupSubtitle')}</p>
          <form onSubmit={onSignup} noValidate>
            <div className="field">
              <label className="field-label" htmlFor="signup-name">
                {t('clientHub.name')}
                <span className="req-star">*</span>
              </label>
              <span className="hint">{t('clientHub.nameHint')}</span>
              <input
                className="form-input"
                id="signup-name"
                name="name"
                type="text"
                required
                minLength={2}
                autoComplete="name"
                placeholder={t('clientHub.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="signup-email">
                {t('clientHub.email')}
                <span className="req-star">*</span>
              </label>
              <span className="hint">{t('clientHub.emailHint')}</span>
              <input
                className="form-input"
                id="signup-email"
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder={t('clientHub.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <div className="pw-row">
                <label className="field-label" htmlFor="signup-password">
                  {t('clientHub.password')}
                  <span className="req-star">*</span>
                </label>
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowSignupPw((v) => !v)}
                >
                  {showSignupPw ? t('clientHub.hidePassword') : t('clientHub.showPassword')}
                </button>
              </div>
              <span className="hint">{t('clientHub.passwordHint')}</span>
              <input
                className="form-input"
                id="signup-password"
                name="password"
                type={showSignupPw ? 'text' : 'password'}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <fieldset className="field">
              <legend className="field-label">{t('clientHub.locale')}</legend>
              <div className="locale-grid">
                <label className="locale-opt">
                  <input
                    type="radio"
                    name="locale"
                    value="pl"
                    checked={signupLocale === 'pl'}
                    onChange={() => setSignupLocale('pl')}
                  />
                  {t('clientHub.localePl')}
                </label>
                <label className="locale-opt">
                  <input
                    type="radio"
                    name="locale"
                    value="en"
                    checked={signupLocale === 'en'}
                    onChange={() => setSignupLocale('en')}
                  />
                  {t('clientHub.localeEn')}
                </label>
              </div>
            </fieldset>
            {error ? <p className="error">{error}</p> : null}
            <button className="primary-cta" type="submit" disabled={busy}>
              {busy ? t('clientHub.busy') : t('clientHub.signUpCta')}
            </button>
          </form>
          <p className="auth-footer">
            {t('clientHub.alreadyHaveAccount')}
            <button type="button" onClick={() => go('signin')}>
              {t('clientHub.switchToSignIn')}
            </button>
          </p>
        </div>
      ) : (
        <div id="panel-signin" role="tabpanel">
          <h1 className="auth-title">{t('clientHub.loginTitle')}</h1>
          <p className="auth-subtitle">{t('clientHub.loginSubtitle')}</p>
          <form onSubmit={onSignin} noValidate>
            <div className="field">
              <label className="field-label" htmlFor="signin-email">
                {t('clientHub.email')}
                <span className="req-star">*</span>
              </label>
              <input
                className="form-input"
                id="signin-email"
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder={t('clientHub.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <div className="pw-row">
                <label className="field-label" htmlFor="signin-password">
                  {t('clientHub.password')}
                  <span className="req-star">*</span>
                </label>
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowSigninPw((v) => !v)}
                >
                  {showSigninPw ? t('clientHub.hidePassword') : t('clientHub.showPassword')}
                </button>
              </div>
              <input
                className="form-input"
                id="signin-password"
                name="password"
                type={showSigninPw ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? <p className="error">{error}</p> : null}
            <button className="primary-cta" type="submit" disabled={busy}>
              {busy ? t('clientHub.busy') : t('clientHub.signInCta')}
            </button>
          </form>
          <p className="auth-footer">
            {t('clientHub.noAccountYet')}
            <button type="button" onClick={() => go('signup')}>
              {t('clientHub.switchToSignUp')}
            </button>
          </p>
        </div>
      )}
    </section>
  );
}

function ClientHubHome({ client, onLogout }) {
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
    <section className="modern-glass-card" style={{ maxWidth: '40rem' }}>
      <div className="hub-head">
        <div>
          <h1 className="auth-title">{t('clientHub.hubTitle')}</h1>
          <p className="auth-subtitle" style={{ marginBottom: 0 }}>
            {t('clientHub.hubHello', { name })}
          </p>
        </div>
        <div className="hub-actions">
          <button type="button" className="ghost-btn" onClick={onLogout}>
            {t('clientHub.logout')}
          </button>
        </div>
      </div>

      <button
        type="button"
        className="primary-cta"
        style={{ marginBottom: '0.75rem' }}
        onClick={() => router.push('/client/upload')}
        disabled={!client?.hasLinkedToken}
      >
        {t('clientHub.newUpload')}
      </button>

      {loading ? <p className="muted">{t('clientHub.loading')}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && !projects.length ? (
        <p className="muted">{t('clientHub.empty')}</p>
      ) : null}

      <ul className="hub-list">
        {projects.map((p) => (
          <li key={p.folderId} className="hub-item">
            <div>
              <strong>{p.label}</strong>
              <div className="muted" style={{ marginTop: '0.25rem' }}>
                <span className="hub-badge">{sourceBadge(p.source, t)}</span>
                {p.updatedAt ? formatWhen(p.updatedAt) : null}
              </div>
            </div>
            {p.openUrl ? (
              <a href={p.openUrl}>{t('clientHub.openProject')}</a>
            ) : (
              <span className="muted">{t('clientHub.noShareYet')}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ClientHub() {
  const [locale, setLocale] = useState('pl');
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

  return (
    <LocaleProvider locale={locale}>
      <Shell>
        {checking ? (
          <section className="modern-glass-card">
            <p className="muted">…</p>
          </section>
        ) : client ? (
          <ClientHubHome client={client} onLogout={handleLogout} />
        ) : (
          <ClientAuthCard
            onLoggedIn={setClient}
            onLocale={setLocale}
          />
        )}
      </Shell>
    </LocaleProvider>
  );
}
