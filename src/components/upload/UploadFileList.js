'use client';

function formatMb(size) {
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export default function UploadFileList({
  files,
  uploadStatus,
  hasSession,
  onRemoveFile,
}) {
  if (!files.length) return null;

  const isUploading = uploadStatus === 'uploading';

  return (
    <div className="upload-file-list">
      <div className="upload-file-list-header">
        <h4 className="upload-file-list-title">Selected files ({files.length})</h4>
        {hasSession && !isUploading && (
          <span className="upload-session-badge">Resumable Session Active</span>
        )}
      </div>
      <ul className="upload-file-list-items">
        {files.map((fObj, index) => {
          const dimmed =
            (fObj.status === 'completed' || fObj.status === 'pending') && isUploading;
          const isCompleted = fObj.status === 'completed';

          return (
            <li
              key={fObj.id}
              className={`upload-file-item${index < files.length - 1 ? ' upload-file-item--bordered' : ''}${dimmed ? ' upload-file-item--dimmed' : ''}`}
            >
              <div className="upload-file-item-row">
                <span className={`upload-file-name${isCompleted ? ' upload-file-name--done' : ''}`}>
                  {fObj.name}
                </span>
                <div className="upload-file-item-meta">
                  <span className="upload-file-size">{formatMb(fObj.size)}</span>
                  {!isUploading && !isCompleted && (
                    <button
                      type="button"
                      className="upload-file-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveFile(fObj.id);
                      }}
                      aria-label={`Remove ${fObj.name}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
              {(fObj.status === 'uploading' || fObj.progress > 0) && (
                <div className="progress-bar-container upload-file-progress">
                  <div
                    className={`progress-bar${isCompleted ? ' progress-bar--done' : ''}`}
                    style={{ width: `${fObj.progress}%` }}
                  />
                </div>
              )}
              {isCompleted && <div className="upload-file-done-label">Completed</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
