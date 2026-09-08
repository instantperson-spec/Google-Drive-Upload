'use client';
import React, { useState, useRef } from 'react';

export default function Uploader() {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [status, setStatus] = useState('idle'); // idle, uploading, success, error
  const [errorMessage, setErrorMessage] = useState('');
  
  // User details state
  const [uploaderName, setUploaderName] = useState('');
  const [uploaderEmail, setUploaderEmail] = useState('');

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...selectedFiles]);
    }
  };

  const removeFile = (indexToRemove) => {
    setFiles(files.filter((_, index) => index !== indexToRemove));
  };

  const startUpload = async () => {
    if (files.length === 0 || !uploaderName.trim() || !uploaderEmail.trim()) return;
    
    setStatus('uploading');
    setUploadProgress(0);
    setCurrentFileIndex(0);
    setErrorMessage('');

    try {
      // 1. Create User Wrapper Folder
      const folderRes = await fetch('/api/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploaderName: uploaderName,
          uploaderEmail: uploaderEmail,
        }),
      });

      if (!folderRes.ok) {
        const errorData = await folderRes.json();
        throw new Error(errorData.error || 'Failed to create wrapper folder');
      }

      const { folderId } = await folderRes.json();

      // 2. Upload Files Sequentially
      for (let i = 0; i < files.length; i++) {
        setCurrentFileIndex(i);
        setUploadProgress(0);
        const file = files[i];

        // 2a. Init upload session for this specific file
        // We use webkitRelativePath if it's from a folder to preserve the name like "Folder/Sub/Video.mp4"
        const fileNameToSave = file.webkitRelativePath ? file.webkitRelativePath : file.name;
        
        const initRes = await fetch('/api/upload-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: fileNameToSave,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            folderId: folderId,
          }),
        });

        if (!initRes.ok) {
          const errorData = await initRes.json();
          throw new Error(errorData.error || `Failed to initialize upload for ${file.name}`);
        }

        const { uploadUrl } = await initRes.json();

        // 2b. Upload the file to the resumable URL
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percentComplete = Math.round((event.loaded / event.total) * 100);
              setUploadProgress(percentComplete);
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload failed for ${file.name} with status ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error(`Network error during upload of ${file.name}`));
          
          xhr.open('PUT', uploadUrl, true);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.send(file);
        });
      }

      // 3. Trigger Final Notification
      const uploadedFilesInfo = files.map(f => ({ name: f.name, size: f.size }));
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          files: uploadedFilesInfo,
          uploaderName: uploaderName,
          uploaderEmail: uploaderEmail
        })
      }).catch(notifyErr => console.error('Notification failed:', notifyErr));

      setStatus('success');
    } catch (error) {
      console.error('Upload Error:', error);
      setStatus('error');
      setErrorMessage(error.message || 'An error occurred during upload.');
    }
  };

  if (status === 'success') {
    return (
      <div className="uploader-container">
        <div className="success-message" style={{ textAlign: 'center' }}>
          <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" style={{ width: '80px', margin: '0 auto 20px', display: 'block' }}>
            <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none" stroke="#4ade80" strokeWidth="2" />
            <path className="checkmark-check" fill="none" stroke="#4ade80" strokeWidth="4" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
          </svg>
          <h2 style={{ color: 'white', marginBottom: '10px' }}>Upload Complete!</h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '30px' }}>Files ({files.length}) have been successfully uploaded.</p>
          <button className="btn" onClick={() => {
            setFiles([]);
            setStatus('idle');
            setUploadProgress(0);
            setCurrentFileIndex(0);
            setUploaderName('');
            setUploaderEmail('');
          }}>
            Upload more files
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="uploader-container">
      <div className="user-details-form" style={{ marginBottom: '25px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <input 
          type="text" 
          placeholder="Full Name / Company Name" 
          value={uploaderName}
          onChange={(e) => setUploaderName(e.target.value)}
          disabled={status === 'uploading'}
          className="glass-input"
          style={{ padding: '15px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'white', fontSize: '16px', outline: 'none', transition: 'all 0.3s ease' }}
        />
        <input 
          type="email" 
          placeholder="Your Email Address" 
          value={uploaderEmail}
          onChange={(e) => setUploaderEmail(e.target.value)}
          disabled={status === 'uploading'}
          className="glass-input"
          style={{ padding: '15px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'white', fontSize: '16px', outline: 'none', transition: 'all 0.3s ease' }}
        />
      </div>

      <div 
        className={`dropzone ${isDragging ? 'active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ minHeight: '180px' }}
      >
        <svg className="dropzone-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: '10px' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <div className="dropzone-text">
          <p>Drag and drop files or folders here</p>
          <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', marginTop: '15px' }}>
            <button 
              className="btn" 
              onClick={() => { 
                if (status !== 'uploading' && fileInputRef.current) {
                  fileInputRef.current.value = null;
                  fileInputRef.current.click(); 
                }
              }}
              disabled={status === 'uploading'}
              style={{ padding: '8px 16px', fontSize: '14px', borderRadius: '8px', cursor: status === 'uploading' ? 'not-allowed' : 'pointer' }}
            >
              Select Files
            </button>
            <button 
              className="btn" 
              onClick={() => { 
                if (status !== 'uploading' && folderInputRef.current) {
                  folderInputRef.current.value = null;
                  folderInputRef.current.click(); 
                }
              }}
              disabled={status === 'uploading'}
              style={{ padding: '8px 16px', fontSize: '14px', borderRadius: '8px', cursor: status === 'uploading' ? 'not-allowed' : 'pointer', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}
            >
              Select Folder
            </button>
          </div>
        </div>
        <input 
          type="file" 
          multiple
          ref={fileInputRef} 
          onChange={handleFileSelect} 
          style={{ display: 'none' }} 
        />
        <input 
          type="file" 
          webkitdirectory="true"
          directory="true"
          multiple
          ref={folderInputRef} 
          onChange={handleFileSelect} 
          style={{ display: 'none' }} 
        />
      </div>

      {files.length > 0 && (
        <div className="file-list" style={{ marginTop: '20px', background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '12px' }}>
          <h4 style={{ margin: '0 0 10px 0', color: 'rgba(255,255,255,0.8)', fontSize: '14px' }}>Selected files ({files.length}):</h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '200px', overflowY: 'auto' }}>
            {files.map((f, index) => (
              <li key={index} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                padding: '8px 10px',
                borderBottom: index < files.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                color: (status === 'uploading' && index === currentFileIndex) ? '#4ade80' : 'white',
                opacity: (status === 'uploading' && index < currentFileIndex) ? 0.5 : 1
              }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%' }}>
                  {f.name}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '12px', opacity: 0.7 }}>{(f.size / (1024 * 1024)).toFixed(2)} MB</span>
                  {status !== 'uploading' && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 5px' }}
                    >×</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {errorMessage && (
        <div className="error-message" style={{ color: '#ef4444', marginTop: '15px', textAlign: 'center' }}>
          {errorMessage}
        </div>
      )}

      {status === 'uploading' && (
        <div className="progress-container" style={{ marginTop: '25px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: 'rgba(255,255,255,0.8)', fontSize: '14px' }}>
            <span>Uploading file {currentFileIndex + 1} of {files.length}...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="progress-bar-bg" style={{ width: '100%', height: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '5px', overflow: 'hidden' }}>
            <div className="progress-bar-fill" style={{ width: `${uploadProgress}%`, height: '100%', background: '#4ade80', transition: 'width 0.2s ease' }}></div>
          </div>
        </div>
      )}

      <button 
        className="btn" 
        onClick={startUpload}
        disabled={files.length === 0 || status === 'uploading' || !uploaderName.trim() || !uploaderEmail.trim()}
        style={{
          marginTop: '25px',
          width: '100%',
          padding: '16px',
          borderRadius: '12px',
          border: 'none',
          background: (files.length === 0 || status === 'uploading' || !uploaderName.trim() || !uploaderEmail.trim()) ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #4ade80 0%, #3b82f6 100%)',
          color: (files.length === 0 || status === 'uploading' || !uploaderName.trim() || !uploaderEmail.trim()) ? 'rgba(255,255,255,0.3)' : 'white',
          fontSize: '18px',
          fontWeight: 'bold',
          cursor: (files.length === 0 || status === 'uploading' || !uploaderName.trim() || !uploaderEmail.trim()) ? 'not-allowed' : 'pointer',
          transition: 'all 0.3s ease'
        }}
      >
        {status === 'uploading' ? 'Upload in progress...' : `Start Upload (${files.length} files)`}
      </button>
    </div>
  );
}
