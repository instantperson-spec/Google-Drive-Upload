'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LocaleProvider, useT } from '@/context/LocaleContext';
import { UploadTokenProvider, useUploadTokenContext } from '@/context/UploadTokenContext';
import Uploader from '@/components/Uploader';
import LocaleSwitch from '@/components/LocaleSwitch';
import { DEFAULT_LOCALE, normalizeLocale } from '@/lib/locales';

function ClientUploadInner() {
  const router = useRouter();
  const t = useT();
  const { locale: tokenLocale, tokenStatus } = useUploadTokenContext();
  const [override, setOverride] = useState(null);

  useEffect(() => {
    if (tokenStatus === 'invalid') {
      router.replace('/client');
    }
  }, [tokenStatus, router]);

  const tokenEffective =
    tokenStatus === 'valid' && tokenLocale
      ? normalizeLocale(tokenLocale)
      : DEFAULT_LOCALE;
  const effectiveLocale = override || tokenEffective;

  const onLocaleChange = useCallback((next) => {
    setOverride(normalizeLocale(next));
  }, []);

  if (tokenStatus === 'checking') {
    return (
      <div className="glass-panel client-hub-panel">
        <p className="share-muted">{t('clientHub.loading')}</p>
      </div>
    );
  }

  if (tokenStatus !== 'valid') {
    return (
      <div className="glass-panel client-hub-panel">
        <p className="share-muted">{t('clientHub.hubLoginRequired')}</p>
        <Link href="/client">{t('clientHub.backToHub')}</Link>
      </div>
    );
  }

  return (
    <LocaleProvider locale={effectiveLocale}>
      <div className="glass-panel">
        <div className="upload-page-head">
          <div>
            <p className="client-hub-back">
              <Link href="/client">{t('clientHub.backToHub')}</Link>
            </p>
            <h1>{t('clientHub.uploadTitle')}</h1>
            <p className="subtitle">{t('clientHub.uploadSubtitle')}</p>
          </div>
          <LocaleSwitch locale={effectiveLocale} onChange={onLocaleChange} />
        </div>
        <Uploader />
      </div>
    </LocaleProvider>
  );
}

export default function ClientUploadPage() {
  return (
    <UploadTokenProvider mode="clientHub">
      <LocaleProvider locale={DEFAULT_LOCALE}>
        <ClientUploadInner />
      </LocaleProvider>
    </UploadTokenProvider>
  );
}
