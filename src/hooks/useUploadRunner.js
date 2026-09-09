'use client';

import { useCallback } from 'react';
import { getApiErrorMessage } from '@/lib/apiErrors';
import { CHUNK_SIZE, queryUploadStatus, uploadChunk } from '@/lib/chunkUpload';
import { manifestNeedsStructure } from '@/lib/pathManifest';

export function useUploadRunner({
  files,
  updateFileState,
  sessionData,
  saveSession,
  clearSession,
  apiHeaders,
  uploaderName,
  uploaderEmail,
  uploadSessionIdRef,
  uploadFolderIdRef,
  sendProgressHeartbeat,
  setStatus,
  setErrorMessage,
  setTokenStatus,
}) {
  const startUpload = useCallback(async () => {
    setStatus('uploading');
    setErrorMessage('');

    uploadSessionIdRef.current = crypto.randomUUID();
    uploadFolderIdRef.current = null;

    try {
      let currentFolderId = sessionData?.folderId;
      let sessionFiles = sessionData?.files || {};

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
        files: sessionFiles,
      });

      const checkRes = await fetch('/api/check-folder', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ folderId: currentFolderId }),
      });
      if (!checkRes.ok) {
        throw new Error(await getApiErrorMessage(checkRes, 'Failed to verify upload folder.'));
      }
      const { files: existingDriveFiles = [] } = await checkRes.json();

      for (let i = 0; i < files.length; i++) {
        const fObj = files[i];
        if (fObj.status === 'completed') continue;

        updateFileState(i, { status: 'uploading' });

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
          }
          if (statusCheck.status === 'incomplete') {
            nextByte = statusCheck.nextByte;
          } else {
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

        let retries = 3;
        while (nextByte < fObj.size) {
          const endByte = Math.min(nextByte + CHUNK_SIZE, fObj.size);
          try {
            await uploadChunk({
              url: uploadUrl,
              file: fObj.file,
              start: nextByte,
              end: endByte,
              onProgress: (progress) => updateFileState(i, { progress }),
            });
            nextByte = endByte;
            retries = 3;
          } catch (chunkErr) {
            console.error(chunkErr);
            retries -= 1;
            if (retries === 0) {
              throw new Error(`Failed to upload ${fObj.name} after multiple retries.`);
            }
            await new Promise((res) => setTimeout(res, 2000));
            const statusCheck = await queryUploadStatus(uploadUrl);
            if (statusCheck.status === 'incomplete') nextByte = statusCheck.nextByte;
            if (statusCheck.status === 'completed') break;
          }
        }

        updateFileState(i, { status: 'completed', progress: 100 });
      }

      const manifestEntries = files.map((f) => ({
        uploadName: f.uploadName,
        relativePath: f.relativePath,
        size: f.size,
      }));

      if (manifestNeedsStructure(manifestEntries)) {
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

      const completedFiles = files.map((f) => ({
        name: f.relativePath,
        size: f.size,
        progress: 100,
        status: 'completed',
      }));
      await sendProgressHeartbeat('completed', completedFiles);

      const uploadedFilesInfo = files.map((f) => ({
        name: f.relativePath,
        size: f.size,
        status: 'completed',
      }));
      fetch('/api/notify', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          files: uploadedFilesInfo,
          uploaderName,
          uploaderEmail,
          folderId: currentFolderId,
        }),
      }).catch((err) => console.error('Notification failed:', err));

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
  }, [
    files,
    updateFileState,
    sessionData,
    saveSession,
    clearSession,
    apiHeaders,
    uploaderName,
    uploaderEmail,
    uploadSessionIdRef,
    uploadFolderIdRef,
    sendProgressHeartbeat,
    setStatus,
    setErrorMessage,
    setTokenStatus,
  ]);

  return { startUpload };
}
