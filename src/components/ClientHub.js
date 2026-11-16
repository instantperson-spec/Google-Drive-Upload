'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocaleProvider, useT } from '@/context/LocaleContext';
import LocaleSwitch from '@/components/LocaleSwitch';
import { normalizeLocale } from '@/lib/locales';

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

function parseLangParam(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  if (v === 'pl' || v.startsWith('pl-')) return 'pl';
  if (v === 'en' || v === 'eng' || v.startsWith('en-')) return 'en';
  return null;
}

function clearSensitiveQueryParams() {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of ['invite', 'signup']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    /* ignore */
  }
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

function ClientAuthCard({
  locale,
  onLoggedIn,
  onLocale,
  initialMode,
  inviteToken,
  inviteEmail,
  inviteError,
  inviteLoading,
}) {
  const t = useT();
  const canSignup = Boolean(inviteToken && inviteEmail && !inviteError);
  const [mode, setMode] = useState(
    initialMode === 'signup' && canSignup ? 'signup' : 'signin'
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState(inviteEmail || '');
  const [password, setPassword] = useState('');
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [showSigninPw, setShowSigninPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (inviteEmail) setEmail(inviteEmail);
  }, [inviteEmail]);

  useEffect(() => {
    if (initialMode === 'signup' && canSignup) setMode('signup');
    else if (initialMode === 'login' || !canSignup) setMode('signin');
  }, [initialMode, canSignup]);

  function go(next) {
    if (next === 'signup' && !canSignup) {
      setError(inviteError || t('clientHub.inviteRequired'));
      setMode('signin');
      return;
    }
    setMode(next);
    setError('');
  }

  async function onSignup(e) {
    e.preventDefault();
    if (!canSignup) {
      setError(t('clientHub.inviteRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/client/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: name.trim(),
          email: (inviteEmail || email).trim(),
          password,
          locale: normalizeLocale(locale),
          invite: inviteToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('clientHub.signupError'));
      clearSensitiveQueryParams();
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
      clearSensitiveQueryParams();
      onLoggedIn(data.client);
    } catch (err) {
      setError(err.message || t('clientHub.loginError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="modern-glass-card" aria-label={t('clientHub.authAria')}>
      <div className="auth-top">
        <LocaleSwitch locale={locale} onChange={onLocale} />
      </div>

      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          className="tab-btn"
          role="tab"
          aria-selected={mode === 'signup'}
          disabled={!canSignup}
          title={canSignup ? undefined : t('clientHub.inviteRequired')}
          onClick={() => go('signup')}
        >
          {t('clientHub.tabSignup')}
        </button>
        <button
          type="button"
          className="tab-btn"
          role="tab"
          aria-selected={mode === 'signin'}
          onClick={() => go('signin')}
        >
          {t('clientHub.tabSignin')}
        </button>
      </div>

      {inviteLoading ? <p className="muted">{t('clientHub.loading')}</p> : null}
      {!inviteLoading && inviteToken && inviteError ? (
        <p className="error">{inviteError}</p>
      ) : null}
      {!inviteLoading && !inviteToken && mode === 'signin' ? (
        <p className="hint" style={{ marginBottom: '1rem' }}>
          {t('clientHub.inviteRequiredHint')}
        </p>
      ) : null}

      {mode === 'signup' && canSignup ? (
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
              <span className="hint">{t('clientHub.emailLockedHint')}</span>
              <input
                className="form-input"
                id="signup-email"
                name="email"
                type="email"
                required
                readOnly
                autoComplete="username"
                value={inviteEmail || email}
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
            {t('clientHub.noAccountYet')}{' '}
            <span className="muted">{t('clientHub.inviteRequiredHint')}</span>
          </p>
        </div>
      )}
    </section>
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
    <section className="modern-glass-card" style={{ maxWidth: '40rem' }}>
      <div className="hub-head">
        <div>
          <h1 className="auth-title">{t('clientHub.hubTitle')}</h1>
          <p className="auth-subtitle" style={{ marginBottom: 0 }}>
            {t('clientHub.hubHello', { name })}
          </p>
        </div>
        <div className="hub-actions">
          <LocaleSwitch locale={locale} onChange={onLocale} />
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
  const [initialMode, setInitialMode] = useState('signin');
  const [inviteToken, setInviteToken] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [bootDone, setBootDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const lang = parseLangParam(params.get('lang'));
      if (lang) setLocale(lang);

      const invite = String(params.get('invite') || '').trim();
      const wantLogin =
        params.get('login') === '1' ||
        params.get('login') === 'true' ||
        params.get('mode') === 'login';
      const wantSignup =
        params.get('signup') === '1' ||
        params.get('signup') === 'true' ||
        params.get('mode') === 'signup';

      if (invite) {
        setInviteToken(invite);
        setInviteLoading(true);
        try {
          const res = await fetch(
            `/api/client/invite?token=${encodeURIComponent(invite)}`
          );
          const data = await res.json().catch(() => ({}));
          if (cancelled) return;
          if (res.ok && data.ok) {
            setInviteEmail(data.email || '');
            setInviteError('');
            if (data.locale) setLocale(normalizeLocale(data.locale));
            setInitialMode(wantLogin && !wantSignup ? 'login' : 'signup');
          } else {
            setInviteError(data.error || 'Invalid invite.');
            setInitialMode('login');
          }
        } catch {
          if (!cancelled) {
            setInviteError('Could not validate invite.');
            setInitialMode('login');
          }
        } finally {
          if (!cancelled) setInviteLoading(false);
        }
      } else {
        setInitialMode(wantLogin || !wantSignup ? 'login' : 'login');
      }

      try {
        const res = await fetch('/api/client/me', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data.authenticated && data.client) {
          setClient(data.client);
          if (data.client.locale && !lang) {
            setLocale(normalizeLocale(data.client.locale));
          }
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
          setBootDone(true);
        }
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
        {checking || !bootDone ? (
          <section className="modern-glass-card">
            <p className="muted">…</p>
          </section>
        ) : client ? (
          <ClientHubHome
            client={client}
            onLogout={handleLogout}
            locale={locale}
            onLocale={setLocale}
          />
        ) : (
          <ClientAuthCard
            locale={locale}
            onLoggedIn={setClient}
            onLocale={setLocale}
            initialMode={initialMode}
            inviteToken={inviteToken}
            inviteEmail={inviteEmail}
            inviteError={inviteError}
            inviteLoading={inviteLoading}
          />
        )}
      </Shell>
    </LocaleProvider>
  );
}
