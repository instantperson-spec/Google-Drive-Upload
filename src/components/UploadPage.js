'use client';

import { useCallback, useEffect, useState } from 'react';
import { LocaleProvider, useT } from '@/context/LocaleContext';
import { UploadTokenProvider, useUploadTokenContext } from '@/context/UploadTokenContext';
import Uploader from '@/components/Uploader';
import LocaleSwitch from '@/components/LocaleSwitch';
import { DEFAULT_LOCALE, normalizeLocale } from '@/lib/locales';

/** Legacy global key that permanently overrode token.locale — clear on load. */
const LEGACY_UPLOAD_LOCALE_KEY = 'uploadPortal.locale';

function sessionUploadLocaleKey(token) {
  return `uploadPortal.sessionLocale:${token || 'unknown'}`;
}

function clearLegacyUploadLocale() {
  try {
    localStorage.removeItem(LEGACY_UPLOAD_LOCALE_KEY);
  } catch {
    /* ignore */
  }
}

function readSessionUploadLocale(token) {
  try {
    const saved = sessionStorage.getItem(sessionUploadLocaleKey(token));
    if (saved === 'pl' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return null;
}

function storeSessionUploadLocale(token, locale) {
  try {
    sessionStorage.setItem(sessionUploadLocaleKey(token), normalizeLocale(locale));
  } catch {
    /* ignore */
  }
}

function UploadPageChrome({ locale, onLocaleChange, children }) {
  const t = useT();
  return (
    <div className="glass-panel">
      <div className="upload-page-head">
        <div>
          <h1>{t('page.title')}</h1>
          <p className="subtitle">{t('page.subtitle')}</p>
        </div>
        <LocaleSwitch locale={locale} onChange={onLocaleChange} />
      </div>
      {children}
    </div>
  );
}

function UploadPageContent() {
  const { locale: tokenLocale, tokenStatus, accessToken } = useUploadTokenContext();
  const tokenSlug = accessToken || '';

  useEffect(() => {
    clearLegacyUploadLocale();
  }, []);

  const tokenEffective =
    tokenStatus === 'valid' && tokenLocale
      ? normalizeLocale(tokenLocale)
      : DEFAULT_LOCALE;

  const [override, setOverride] = useState(() =>
    readSessionUploadLocale(tokenSlug)
  );

  // When token resolves, prefer token locale unless this tab already switched.
  useEffect(() => {
    if (tokenStatus !== 'valid') return;
    const session = readSessionUploadLocale(tokenSlug);
    setOverride(session);
  }, [tokenStatus, tokenLocale, tokenSlug]);

  const effectiveLocale = override || tokenEffective;

  const onLocaleChange = useCallback(
    (next) => {
      const normalized = normalizeLocale(next);
      storeSessionUploadLocale(tokenSlug, normalized);
      setOverride(normalized);
    },
    [tokenSlug]
  );

  return (
    <LocaleProvider locale={effectiveLocale}>
      <UploadPageChrome locale={effectiveLocale} onLocaleChange={onLocaleChange}>
        <Uploader />
      </UploadPageChrome>
    </LocaleProvider>
  );
}

export default function UploadPage() {
  return (
    <UploadTokenProvider>
      <UploadPageContent />
    </UploadTokenProvider>
  );
}
