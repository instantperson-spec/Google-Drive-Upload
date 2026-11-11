'use client';

import { useT } from '@/context/LocaleContext';

export default function SessionResumeBanner({ onCancel }) {
  const t = useT();
  return (
    <div className="upload-resume-banner">
      <h4 className="upload-resume-title">⚠️ {t('resume.title')}</h4>
      <p className="upload-resume-text">{t('resume.body')}</p>
      <button type="button" className="upload-resume-cancel" onClick={onCancel}>
        {t('resume.cancel')}
      </button>
    </div>
  );
}
