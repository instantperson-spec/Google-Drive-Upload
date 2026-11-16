'use client';

import { useCallback, useState } from 'react';
import { LocaleProvider, useT } from '@/context/LocaleContext';
import { UploadTokenProvider, useUploadTokenContext } from '@/context/UploadTokenContext';
import Uploader from '@/components/Uploader';
import LocaleSwitch from '@/components/LocaleSwitch';
import { DEFAULT_LOCALE, normalizeLocale } from '@/lib/locales';

const UPLOAD_LOCALE_KEY = 'uploadPortal.locale';

function readStoredUploadLocale() {
  try {
    const saved = localStorage.getItem(UPLOAD_LOCALE_KEY);
    if (saved === 'pl' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return null;
}

function storeUploadLocale(locale) {
  try {
    localStorage.setItem(UPLOAD_LOCALE_KEY, normalizeLocale(locale));
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
  const { locale: tokenLocale, tokenStatus } = useUploadTokenContext();
  const [override, setOverride] = useState(() => readStoredUploadLocale());

  const tokenEffective =
    tokenStatus === 'valid' && tokenLocale ? normalizeLocale(tokenLocale) : DEFAULT_LOCALE;
  const effectiveLocale = override || tokenEffective;

  const onLocaleChange = useCallback((next) => {
    const normalized = normalizeLocale(next);
    storeUploadLocale(normalized);
    setOverride(normalized);
  }, []);

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
