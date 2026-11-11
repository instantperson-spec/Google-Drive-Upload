'use client';

import { useT } from '@/context/LocaleContext';

export function UploadCheckingScreen() {
  const t = useT();
  return (
    <div className="uploader-container">
      <div className="upload-status-screen">
        <p className="upload-status-muted">{t('status.checking')}</p>
      </div>
    </div>
  );
}

export function UploadInvalidScreen({ isRevoked }) {
  const t = useT();
  return (
    <div className="uploader-container">
      <div className="upload-status-screen">
        <h2 className="upload-status-title">
          {isRevoked ? t('status.revokedTitle') : t('status.invalidTitle')}
        </h2>
        <p className="upload-status-muted">
          {isRevoked ? t('status.revokedBody') : t('status.invalidBody')}
        </p>
      </div>
    </div>
  );
}

export function UploadStructuringScreen() {
  const t = useT();
  return (
    <div className="uploader-container">
      <div className="upload-status-screen">
        <div className="structuring-spinner" aria-hidden="true" />
        <h2 className="upload-status-title">{t('status.structuringTitle')}</h2>
        <p className="upload-status-muted">{t('status.structuringBody')}</p>
      </div>
    </div>
  );
}

export function UploadSuccessScreen({ onReset }) {
  const t = useT();
  return (
    <div className="uploader-container">
      <div className="upload-success-screen">
        <svg className="upload-checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" aria-hidden="true">
          <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none" stroke="#4ade80" strokeWidth="2" />
          <path className="checkmark-check" fill="none" stroke="#4ade80" strokeWidth="4" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
        </svg>
        <h2 className="upload-status-title">{t('status.successTitle')}</h2>
        <p className="upload-status-muted upload-success-subtitle">{t('status.successBody')}</p>
        <button type="button" className="btn" onClick={onReset}>
          {t('status.successButton')}
        </button>
      </div>
    </div>
  );
}
