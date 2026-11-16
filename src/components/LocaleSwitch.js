'use client';

import { useT } from '@/context/LocaleContext';

/**
 * PL/EN toggle — labels from i18n JSON only.
 */
export default function LocaleSwitch({ locale, onChange, className = '' }) {
  const t = useT();
  const current = locale === 'pl' ? 'pl' : 'en';

  return (
    <div
      className={`locale-switch ${className}`.trim()}
      role="group"
      aria-label={t('lang.aria')}
    >
      <button
        type="button"
        className={`locale-switch-btn${current === 'en' ? ' is-active' : ''}`}
        onClick={() => onChange('en')}
        aria-pressed={current === 'en'}
      >
        {t('lang.en')}
      </button>
      <button
        type="button"
        className={`locale-switch-btn${current === 'pl' ? ' is-active' : ''}`}
        onClick={() => onChange('pl')}
        aria-pressed={current === 'pl'}
      >
        {t('lang.pl')}
      </button>
    </div>
  );
}
