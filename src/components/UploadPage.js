'use client';

import { LocaleProvider } from '@/context/LocaleContext';
import { UploadTokenProvider, useUploadTokenContext } from '@/context/UploadTokenContext';
import { useT } from '@/context/LocaleContext';
import Uploader from '@/components/Uploader';
import { DEFAULT_LOCALE } from '@/lib/locales';

function UploadPageChrome({ children }) {
  const t = useT();
  return (
    <div className="glass-panel">
      <h1>{t('page.title')}</h1>
      <p className="subtitle">{t('page.subtitle')}</p>
      {children}
    </div>
  );
}

function UploadPageContent() {
  const { locale, tokenStatus } = useUploadTokenContext();
  const effectiveLocale =
    tokenStatus === 'valid' && locale ? locale : DEFAULT_LOCALE;

  return (
    <LocaleProvider locale={effectiveLocale}>
      <UploadPageChrome>
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
