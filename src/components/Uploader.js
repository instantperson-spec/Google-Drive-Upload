'use client';
import React, { useState, useRef, useEffect } from 'react';
import { deriveUploadName, manifestNeedsStructure } from '@/lib/pathManifest';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

// Mirrors the server-side blacklist in src/lib/validation.js (server is authoritative)
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'com', 'scr', 'pif', 'msi', 'msp',
  'vbs', 'vbe', 'ws', 'wsf', 'wsh', 'ps1', 'psm1',
  'sh', 'bash', 'zsh', 'jar', 'hta', 'cpl', 'lnk', 'reg',
]);

const isBlockedFile = (name) => {
  const baseName = name.split('/').pop();
  const ext = baseName.includes('.') ? baseName.split('.').pop().toLowerCase() : '';
  return BLOCKED_EXTENSIONS.has(ext);
};

/** Map API error responses to user-friendly messages. */
async function getApiErrorMessage(res, fallback) {
  if (res.status === 401) {
    return 'This upload link is no longer valid. It may have been revoked or expired. Please contact the studio for a new link.';
  }
  if (res.status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  try {
    const data = await res.json();
    if (data?.error) return data.error;
  } catch {
    // ignore parse errors
  }
  return fallback;
}

export default function Uploader() {
  const [files, setFiles] = useState([]); // { file, name, size, type, status, progress, uploadUrl }
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState('idle'); // idle, uploading, structuring, success, error
  const [errorMessage, setErrorMessage] = useState('');
  
  const [uploaderName, setUploaderName] = useState('');
  const [uploaderEmail, setUploaderEmail] = useState('');
  const [sessionData, setSessionData] = useState(null);
  // undefined = not yet read from URL, '' = missing, string = present
  const [accessToken, setAccessToken] = useState(undefined);
  // checking | valid | invalid — server-side token verification
  const [tokenStatus, setTokenStatus] = useState('checking');

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const uploadSessionIdRef = useRef(null);
  const uploadFolderIdRef = useRef(null);
  const filesRef = useRef(files);

  // Read the per-project access token from the URL (?token=X)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setAccessToken(params.get('token') || '');
  }, []);

  // Verify token with server (revoked/expired tokens must not show upload UI)
  useEffect(() => {
    if (!accessToken) {
      setTokenStatus(accessToken === '' ? 'invalid' : 'checking');
      return;
    }

    let cancelled = false;
    setTokenStatus('checking');

    (async () => {
      try {
        const res = await fetch('/api/validate-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-upload-token': accessToken,
          },
        });
        if (cancelled) return;
        setTokenStatus(res.ok ? 'valid' : 'invalid');
      } catch {
        if (!cancelled) setTokenStatus('invalid');
      }
    })();

    return () => { cancelled = true; };
  }, [accessToken]);

  const apiHeaders = () => ({
    'Content-Type': 'application/json',
    'x-upload-token': accessToken || '',
  });

  const sendProgressHeartbeat = async (sessionStatus = 'uploading', filesSnapshot = null) => {
    const sessionId = uploadSessionIdRef.current;
    const folderId = uploadFolderIdRef.current;
    if (!sessionId || !folderId || !accessToken) return;

    const fileList = (filesSnapshot ?? files).map((f) => ({
      name: f.name,
      size: f.size,
      progress: f.progress ?? 0,
      status: f.status || 'pending',
    }));

    await fetch('/api/upload-progress', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        sessionId,
        uploaderName,
        uploaderEmail,
        folderId,
        files: fileList,
        sessionStatus,
      }),
    }).catch(() => {});
  };

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Live progress heartbeat for admin console (every 10s while uploading)
  useEffect(() => {
    if (status !== 'uploading' || !accessToken) return;
    const tick = () => sendProgressHeartbeat('uploading', filesRef.current);
    tick();
    const interval = setInterval(tick, 10_000);
    return () => clearInterval(interval);
  }, [status, accessToken, uploaderName, uploaderEmail]);

  // Load session on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('drive_uploader_session');
      if (saved) {
        const session = JSON.parse(saved);
        if (session.uploaderName && session.uploaderEmail && session.folderId) {
          setUploaderName(session.uploaderName);
          setUploaderEmail(session.uploaderEmail);
          setSessionData(session);
        }
      }
    } catch (e) {
      console.error('Failed to parse session data', e);
    }
  }, []);

  const saveSession = (data) => {
    setSessionData(data);
    localStorage.setItem('drive_uploader_session', JSON.stringify(data));
  };

  const clearSession = () => {
    setSessionData(null);
    localStorage.removeItem('drive_uploader_session');
  };

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
  };

  const addFiles = (newFiles) => {
    const accepted = [];
    const rejected = [];
    const usedUploadNames = new Set(
      files.map((f) => f.uploadName).filter(Boolean)
    );
    for (const f of newFiles) {
      const relativePath = f.webkitRelativePath ? f.webkitRelativePath : f.name;
      if (isBlockedFile(relativePath)) {
        rejected.push(relativePath);
      } else {
        const uploadName = deriveUploadName(relativePath, usedUploadNames);
        accepted.push({
          id: crypto.randomUUID(),
          file: f,
          name: relativePath,
          relativePath,
          uploadName,
          size: f.size,
          type: f.type || 'application/octet-stream',
          status: 'pending',
          progress: 0,
          uploadUrl: null
        });
      }
    }
    if (rejected.length > 0) {
      setErrorMessage(`Skipped ${rejected.length} file(s) with disallowed type: ${rejected.slice(0, 5).join(', ')}${rejected.length > 5 ? '…' : ''}`);
    }
    setFiles(prev => [...prev, ...accepted]);
  };

  const removeFile = (idToRemove) => {
    setFiles(prev => prev.filter(f => f.id !== idToRemove));
  };

  const updateFileState = (index, updates) => {
    setFiles(prev => {
      const newFiles = [...prev];
      newFiles[index] = { ...newFiles[index], ...updates };
      return newFiles;
    });
  };

  // Helper to query existing URL status
  const queryUploadStatus = async (uploadUrl) => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Range', 'bytes */*');
      xhr.onload = () => {
        if (xhr.status === 308) {
          const range = xhr.getResponseHeader('Range');
          if (range) {
            const endByte = parseInt(range.split('-')[1], 10);
            resolve({ status: 'incomplete', nextByte: endByte + 1 });
          } else {
            resolve({ status: 'incomplete', nextByte: 0 });
          }
        } else if (xhr.status === 200 || xhr.status === 201) {
          resolve({ status: 'completed' });
        } else {
          resolve({ status: 'error' });
        }
      };
      xhr.onerror = () => resolve({ status: 'error' });
      xhr.send();
    });
  };

  const uploadChunk = async (url, file, start, end, fileIndex) => {
    return new Promise((resolve, reject) => {
      const chunk = file.slice(start, end);
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${file.size}`);
      
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const totalLoaded = start + e.loaded;
          const progress = Math.round((totalLoaded / file.size) * 100);
          updateFileState(fileIndex, { progress });
        }
      };

      xhr.onload = () => {
        if (xhr.status === 308 || (xhr.status >= 200 && xhr.status < 300)) {
          resolve();
        } else {
          reject(new Error(`Chunk upload failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during chunk upload'));
      xhr.send(chunk);
    });
  };

  // Single source of truth for "ready to upload" — used by startUpload and the button UI
  const canUpload =
    tokenStatus === 'valid' &&
    files.length > 0 &&
    status !== 'uploading' &&
    !!uploaderName.trim() &&
    !!uploaderEmail.trim();

  const startUpload = async () => {
    if (!canUpload) return;
    
    setStatus('uploading');
    setErrorMessage('');

    uploadSessionIdRef.current = crypto.randomUUID();
    uploadFolderIdRef.current = null;

    try {
      let currentFolderId = sessionData?.folderId;
      let sessionFiles = sessionData?.files || {};

      // 1. Create wrapper folder if we don't have an active session
      if (!currentFolderId) {
        const folderRes = await fetch('/api/create-folder', {
          method: 'POST',
          headers: apiHeaders(),
          body: JSON.stringify({ uploaderName, uploaderEmail }),
        });
        if (!folderRes.ok) {
          throw new Error(await getApiErrorMessage(folderRes, 'Failed to create upload folder.'));
        }
        const { folderId } = await folderRes.json();
        currentFolderId = folderId;
      }

      uploadFolderIdRef.current = currentFolderId;

      saveSession({
        uploaderName,
        uploaderEmail,
        folderId: currentFolderId,
        files: sessionFiles
      });

      // 2. Check existing files in folder to silently skip duplicates
      const checkRes = await fetch('/api/check-folder', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ folderId: currentFolderId })
      });
      if (!checkRes.ok) {
        throw new Error(await getApiErrorMessage(checkRes, 'Failed to verify upload folder.'));
      }
      const { files: existingDriveFiles = [] } = await checkRes.json();

      // 3. Upload loop
      for (let i = 0; i < files.length; i++) {
        const fObj = files[i];
        if (fObj.status === 'completed') continue; // already completed in UI

        updateFileState(i, { status: 'uploading' });

        // Check if fully uploaded on Drive
        const exists = existingDriveFiles.find(
          (df) => df.name === fObj.uploadName && Number(df.size) === fObj.size
        );
        if (exists) {
          updateFileState(i, { status: 'completed', progress: 100 });
          continue;
        }

        let uploadUrl = sessionFiles[fObj.uploadName];
        let nextByte = 0;

        if (uploadUrl) {
          const statusCheck = await queryUploadStatus(uploadUrl);
          if (statusCheck.status === 'completed') {
            updateFileState(i, { status: 'completed', progress: 100 });
            continue;
          } else if (statusCheck.status === 'incomplete') {
            nextByte = statusCheck.nextByte;
          } else {
            // URL expired or error, get a new one
            uploadUrl = null;
          }
        }

        if (!uploadUrl) {
          const initRes = await fetch('/api/upload-session', {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({
              name: fObj.uploadName,
              mimeType: fObj.type,
              size: fObj.size,
              folderId: currentFolderId,
            }),
          });
          if (!initRes.ok) {
            throw new Error(await getApiErrorMessage(initRes, `Failed to init upload for ${fObj.name}`));
          }
          const data = await initRes.json();
          uploadUrl = data.uploadUrl;
          
          sessionFiles[fObj.uploadName] = uploadUrl;
          saveSession({ uploaderName, uploaderEmail, folderId: currentFolderId, files: sessionFiles });
        }

        updateFileState(i, { uploadUrl });

        // Chunk upload loop
        let retries = 3;
        while (nextByte < fObj.size) {
          const endByte = Math.min(nextByte + CHUNK_SIZE, fObj.size);
          try {
            await uploadChunk(uploadUrl, fObj.file, nextByte, endByte, i);
            nextByte = endByte;
            retries = 3; // reset retries on success
          } catch (chunkErr) {
            console.error(chunkErr);
            retries--;
            if (retries === 0) {
              throw new Error(`Failed to upload ${fObj.name} after multiple retries.`);
            }
            // Wait 2 seconds before retry
            await new Promise(res => setTimeout(res, 2000));
            // Query actual status before retrying in case it was partially received
            const statusCheck = await queryUploadStatus(uploadUrl);
            if (statusCheck.status === 'incomplete') nextByte = statusCheck.nextByte;
            if (statusCheck.status === 'completed') break;
          }
        }

        updateFileState(i, { status: 'completed', progress: 100 });
      }

      // 4. Rebuild nested folder structure (Phase 3) + write _manifest.json
      const manifestEntries = files.map((f) => ({
        uploadName: f.uploadName,
        relativePath: f.relativePath,
        size: f.size,
      }));

      const hasNestedPaths = manifestNeedsStructure(manifestEntries);
      if (hasNestedPaths) {
        setStatus('structuring');
      }

      const structureRes = await fetch('/api/build-structure', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ folderId: currentFolderId, entries: manifestEntries }),
      });
      if (!structureRes.ok) {
        throw new Error(await getApiErrorMessage(structureRes, 'Failed to compile folder structure on Drive.'));
      }

      // 5. Final progress ping for admin console
      const completedFiles = files.map((f) => ({
        name: f.relativePath,
        size: f.size,
        progress: 100,
        status: 'completed',
      }));
      await sendProgressHeartbeat('completed', completedFiles);

      // 6. Trigger Final Notification
      const uploadedFilesInfo = files.map((f) => ({
        name: f.relativePath,
        size: f.size,
        status: 'completed',
      }));
      fetch('/api/notify', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ files: uploadedFilesInfo, uploaderName, uploaderEmail, folderId: currentFolderId })
      }).catch(err => console.error('Notification failed:', err));

      setStatus('success');
      uploadSessionIdRef.current = null;
      uploadFolderIdRef.current = null;
      clearSession();

    } catch (error) {
      console.error('Upload Error:', error);
      await sendProgressHeartbeat('error');
      uploadSessionIdRef.current = null;
      uploadFolderIdRef.current = null;

      if (error.message?.includes('no longer valid')) {
        setTokenStatus('invalid');
        setStatus('idle');
        return;
      }

      setStatus('error');
      setErrorMessage(error.message || 'An error occurred during upload. You can retry safely.');
    }
  };

  // Token not yet read from URL — avoid flashing the wrong screen
  if (accessToken === undefined || tokenStatus === 'checking') {
    return (
      <div className="uploader-container">
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255,255,255,0.7)' }}>
          <p>Verifying upload link…</p>
        </div>
      </div>
    );
  }

  if (accessToken === '' || tokenStatus === 'invalid') {
    const isRevoked = accessToken !== '';
    return (
      <div className="uploader-container">
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <h2 style={{ color: 'white', marginBottom: '10px' }}>
            {isRevoked ? 'Upload link no longer valid' : 'Access link required'}
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.7)' }}>
            {isRevoked
              ? 'This link has been revoked or has expired. Please contact the studio to receive a new upload link.'
              : 'This page can only be used with a dedicated upload link. Please open the exact link you received from the studio, or contact us to get one.'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'structuring') {
    return (
      <div className="uploader-container">
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div className="structuring-spinner" aria-hidden="true" />
          <h2 style={{ color: 'white', marginBottom: '10px' }}>Compiling folder structure…</h2>
          <p style={{ color: 'rgba(255,255,255,0.7)' }}>
            Upload finished. Reorganizing files into subfolders on Google Drive — please keep this tab open.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="uploader-container">
        <div className="success-message" style={{ textAlign: 'center' }}>
          <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" style={{ width: '80px', margin: '0 auto 20px', display: 'block' }}>
            <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none" stroke="#4ade80" strokeWidth="2" />
            <path className="checkmark-check" fill="none" stroke="#4ade80" strokeWidth="4" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
          </svg>
          <h2 style={{ color: 'white', marginBottom: '10px' }}>Upload Complete!</h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '30px' }}>All files have been successfully uploaded to the server.</p>
          <button className="btn" onClick={() => {
            setFiles([]);
            setStatus('idle');
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

      {sessionData && status !== 'uploading' && files.length === 0 && (
        <div style={{ marginBottom: '20px', padding: '15px', background: 'rgba(96, 165, 250, 0.15)', border: '1px solid rgba(96, 165, 250, 0.3)', borderRadius: '12px', textAlign: 'center' }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#60a5fa' }}>⚠️ Previous session was interrupted</h4>
          <p style={{ margin: 0, fontSize: '14px', color: 'rgba(255,255,255,0.8)' }}>
            Select the exact same files again to resume your upload. Already completed files will be automatically skipped.
          </p>
          <button 
            onClick={() => { clearSession(); setUploaderName(''); setUploaderEmail(''); }} 
            style={{ marginTop: '10px', background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' }}
          >
            Cancel session and start fresh
          </button>
        </div>
      )}

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
        <input type="file" multiple ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} />
        <input type="file" webkitdirectory="true" multiple ref={folderInputRef} onChange={handleFileSelect} style={{ display: 'none' }} />
      </div>

      {files.length > 0 && (
        <div className="file-list" style={{ marginTop: '20px', background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h4 style={{ margin: 0, color: 'rgba(255,255,255,0.8)', fontSize: '14px' }}>Selected files ({files.length})</h4>
            {sessionData && status !== 'uploading' && (
              <span style={{ fontSize: '12px', color: '#60a5fa', background: 'rgba(96, 165, 250, 0.1)', padding: '4px 8px', borderRadius: '4px' }}>
                Resumable Session Active
              </span>
            )}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '250px', overflowY: 'auto' }}>
            {files.map((fObj, index) => (
              <li key={fObj.id} style={{ 
                padding: '10px',
                borderBottom: index < files.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                opacity: (fObj.status === 'completed' || fObj.status === 'pending') && status === 'uploading' ? 0.6 : 1
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%', color: fObj.status === 'completed' ? '#4ade80' : 'white' }}>
                    {fObj.name}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '12px', opacity: 0.7 }}>{(fObj.size / (1024 * 1024)).toFixed(2)} MB</span>
                    {status !== 'uploading' && fObj.status !== 'completed' && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); removeFile(fObj.id); }}
                        style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 5px', fontSize: '16px' }}
                      >×</button>
                    )}
                  </div>
                </div>
                {(fObj.status === 'uploading' || fObj.progress > 0) && (
                  <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
                    <div style={{ width: `${fObj.progress}%`, height: '100%', background: fObj.status === 'completed' ? '#4ade80' : '#3b82f6', transition: 'width 0.2s ease' }}></div>
                  </div>
                )}
                {fObj.status === 'completed' && <div style={{ fontSize: '11px', color: '#4ade80', marginTop: '4px' }}>Completed</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {errorMessage && (
        <div className="error-message" style={{ color: '#ef4444', marginTop: '15px', textAlign: 'center', background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '8px' }}>
          {errorMessage}
        </div>
      )}

      <button 
        className="btn" 
        onClick={startUpload}
        disabled={!canUpload}
        style={{
          marginTop: '25px',
          width: '100%',
          padding: '16px',
          borderRadius: '12px',
          border: 'none',
          background: !canUpload ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #4ade80 0%, #3b82f6 100%)',
          color: !canUpload ? 'rgba(255,255,255,0.3)' : 'white',
          fontSize: '18px',
          fontWeight: 'bold',
          cursor: !canUpload ? 'not-allowed' : 'pointer',
          transition: 'all 0.3s ease'
        }}
      >
        {status === 'uploading' ? 'Upload in progress...' : `Start Upload (${files.filter(f => f.status !== 'completed').length} files)`}
      </button>
    </div>
  );
}
