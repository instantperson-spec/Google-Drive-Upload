'use client';

export default function UserDetailsForm({
  uploaderName,
  uploaderEmail,
  onNameChange,
  onEmailChange,
  disabled,
}) {
  return (
    <div className="upload-user-form">
      <input
        type="text"
        placeholder="Full Name / Company Name"
        value={uploaderName}
        onChange={(e) => onNameChange(e.target.value)}
        disabled={disabled}
        className="glass-input"
      />
      <input
        type="email"
        placeholder="Your Email Address"
        value={uploaderEmail}
        onChange={(e) => onEmailChange(e.target.value)}
        disabled={disabled}
        className="glass-input"
      />
    </div>
  );
}
