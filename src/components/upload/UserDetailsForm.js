'use client';

import { useT } from '@/context/LocaleContext';

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
        <p className="upload-identity-locked">
          {t('form.identityLocked', { name: uploaderName, email: uploaderEmail })}
        </p>
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
