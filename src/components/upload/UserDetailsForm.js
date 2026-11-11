'use client';

import { useT } from '@/context/LocaleContext';

export default function UserDetailsForm({
  uploaderName,
  uploaderEmail,
  onNameChange,
  onEmailChange,
  disabled,
}) {
  const t = useT();
  return (
    <div className="upload-user-form">
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
    </div>
  );
}
