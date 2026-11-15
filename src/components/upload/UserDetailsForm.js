'use client';

import { useT } from '@/context/LocaleContext';

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export default function UserDetailsForm({
  projectName,
  uploaderName,
  uploaderEmail,
  onProjectChange,
  onNameChange,
  onEmailChange,
  identityLocked,
  identityIncomplete,
  disabled,
  showProjectHint = false,
  projectRequired = true,
}) {
  const t = useT();
  return (
    <div className="upload-user-form">
      <label className="upload-field-label" htmlFor="upload-project-name">
        <span>{t('form.projectLabel')}</span>
        {projectRequired ? (
          <span className="upload-field-required">{t('form.projectRequired')}</span>
        ) : null}
      </label>
      <input
        id="upload-project-name"
        type="text"
        placeholder={t('form.projectPlaceholder')}
        value={projectName}
        onChange={(e) => onProjectChange(e.target.value)}
        disabled={disabled}
        className={`glass-input${showProjectHint ? ' glass-input--attention' : ''}`}
        autoComplete="off"
        required={projectRequired}
        aria-required={projectRequired}
        aria-invalid={showProjectHint}
      />
      {showProjectHint ? (
        <p className="upload-project-hint" role="status">
          {t('form.projectHint')}
        </p>
      ) : null}

      {identityLocked ? (
        <div className="upload-identity-card">
          <div className="upload-identity-main">
            <span className="upload-identity-avatar" aria-hidden="true">
              {initialsFromName(uploaderName)}
            </span>
            <div>
              <span className="upload-identity-label">{t('form.uploadingAs')}</span>
              <span className="upload-identity-name">{uploaderName}</span>
              <span className="upload-identity-email">{uploaderEmail}</span>
            </div>
          </div>
          <span className="upload-identity-ok">{t('form.authorized')}</span>
        </div>
      ) : (
        <>
          {identityIncomplete ? (
            <p className="upload-identity-hint">{t('form.identityIncomplete')}</p>
          ) : null}
          <input
            type="text"
            placeholder={t('form.namePlaceholder')}
            value={uploaderName}
            onChange={(e) => onNameChange(e.target.value)}
            disabled={disabled}
            className="glass-input"
          />
          <input
            type="email"
            placeholder={t('form.emailPlaceholder')}
            value={uploaderEmail}
            onChange={(e) => onEmailChange(e.target.value)}
            disabled={disabled}
            className="glass-input"
          />
        </>
      )}
    </div>
  );
}
