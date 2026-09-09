'use client';

export default function SessionResumeBanner({ onCancel }) {
  return (
    <div className="upload-resume-banner">
      <h4 className="upload-resume-title">⚠️ Previous session was interrupted</h4>
      <p className="upload-resume-text">
        Select the exact same files again to resume your upload. Already completed files will be automatically skipped.
      </p>
      <button type="button" className="upload-resume-cancel" onClick={onCancel}>
        Cancel session and start fresh
      </button>
    </div>
  );
}
