'use client';

export function UploadCheckingScreen() {
  return (
    <div className="uploader-container">
      <div className="upload-status-screen">
        <p className="upload-status-muted">Verifying upload link…</p>
      </div>
    </div>
  );
}

export function UploadInvalidScreen({ isRevoked }) {
  return (
    <div className="uploader-container">
      <div className="upload-status-screen">
        <h2 className="upload-status-title">
          {isRevoked ? 'Upload link no longer valid' : 'Access link required'}
        </h2>
        <p className="upload-status-muted">
          {isRevoked
            ? 'This link has been revoked or has expired. Please contact the studio to receive a new upload link.'
            : 'This page can only be used with a dedicated upload link. Please open the exact link you received from the studio, or contact us to get one.'}
        </p>
      </div>
    </div>
  );
}

export function UploadStructuringScreen() {
  return (
    <div className="uploader-container">
      <div className="upload-status-screen">
        <div className="structuring-spinner" aria-hidden="true" />
        <h2 className="upload-status-title">Compiling folder structure…</h2>
        <p className="upload-status-muted">
          Upload finished. Reorganizing files into subfolders on Google Drive — please keep this tab open.
        </p>
      </div>
    </div>
  );
}

export function UploadSuccessScreen({ onReset }) {
  return (
    <div className="uploader-container">
      <div className="upload-success-screen">
        <svg className="upload-checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" aria-hidden="true">
          <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none" stroke="#4ade80" strokeWidth="2" />
          <path className="checkmark-check" fill="none" stroke="#4ade80" strokeWidth="4" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
        </svg>
        <h2 className="upload-status-title">Upload Complete!</h2>
        <p className="upload-status-muted upload-success-subtitle">
          All files have been successfully uploaded to the server.
        </p>
        <button type="button" className="btn" onClick={onReset}>
          Upload more files
        </button>
      </div>
    </div>
  );
}
