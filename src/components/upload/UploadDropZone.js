'use client';

export default function UploadDropZone({
  isDragging,
  isScanning,
  uploadDisabled,
  fileInputRef,
  folderInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
  onOpenFilePicker,
  onOpenFolderPicker,
}) {
  return (
    <div
      className={`dropzone upload-dropzone ${isDragging ? 'active' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <svg className="dropzone-icon upload-dropzone-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
      <div className="dropzone-text">
        <p>Drag and drop files or an entire project folder here</p>
        <p className="upload-dropzone-hint">
          Nested subfolders are included automatically — select or drop the top-level folder.
        </p>
        {isScanning && (
          <p className="upload-dropzone-scanning">Scanning folder structure…</p>
        )}
        <div className="upload-dropzone-actions">
          <button
            type="button"
            className="btn upload-dropzone-btn"
            onClick={onOpenFilePicker}
            disabled={uploadDisabled}
          >
            Select Files
          </button>
          <button
            type="button"
            className="btn upload-dropzone-btn upload-dropzone-btn-secondary"
            onClick={onOpenFolderPicker}
            disabled={uploadDisabled}
          >
            Select Folder
          </button>
        </div>
      </div>
      <input type="file" multiple ref={fileInputRef} onChange={onFileSelect} className="file-input" />
      <input type="file" webkitdirectory="true" multiple ref={folderInputRef} onChange={onFileSelect} className="file-input" />
    </div>
  );
}
