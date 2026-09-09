'use client';

import { useCallback } from 'react';
import { getApiErrorMessage } from '@/lib/apiErrors';
import {
  CHUNK_SIZE,
  queryUploadStatusWithRetry,
  shouldDiscardUploadUrl,
  uploadChunk,
  UPLOAD_STATUS,
} from '@/lib/chunkUpload';
import { isFileOnDrive } from '@/lib/deltaMatch';
import { manifestNeedsStructure } from '@/lib/pathManifest';
import { createProgressThrottle } from '@/lib/progressThrottle';
import { readStoredUploadSession } from '@/hooks/useUploadSession';

const API_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(url, options, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out — check your connection and retry.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function useUploadRunner({
  files,
  updateFileState,
  markFilesComplete,
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
  onDeltaScan,
}) {
  const startUpload = useCallback(async () => {
    setStatus('uploading');
    setErrorMessage('');

    uploadSessionIdRef.current = crypto.randomUUID();
    uploadFolderIdRef.current = null;

    try {
      const storedSession = readStoredUploadSession();
      let currentFolderId = storedSession?.folderId || sessionData?.folderId;
      let sessionFiles = storedSession?.files || sessionData?.files || {};

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
        body: JSON.stringify({
          folderId: currentFolderId,
          pending: files.map((f) => ({
            relativePath: f.relativePath,
            uploadName: f.uploadName,
            size: f.size,
          })),
        }),
      });
      if (!checkRes.ok) {
        throw new Error(await getApiErrorMessage(checkRes, 'Failed to verify upload folder.'));
      }
      const { files: existingDriveFiles = [], delta } = await checkRes.json();

      if (delta && onDeltaScan) {
        onDeltaScan(delta);
      }

      const fileSnapshot = files;
      const skipIndices = [];
      const uploadIndices = [];

      for (let i = 0; i < fileSnapshot.length; i++) {
        const fObj = fileSnapshot[i];
        if (fObj.status === 'completed') continue;
        if (isFileOnDrive(fObj, existingDriveFiles)) {
          skipIndices.push(i);
        } else {
          uploadIndices.push(i);
        }
      }

      markFilesComplete(skipIndices);
      // Let React paint skipped state before heavy uploads begin
      await new Promise((r) => setTimeout(r, 0));

      const totalToUpload = uploadIndices.length;
      let uploadedCount = 0;

      for (const i of uploadIndices) {
        const fObj = fileSnapshot[i];
        uploadedCount += 1;

        updateFileState(i, { status: 'uploading', progress: 0 });
        await new Promise((r) => setTimeout(r, 0));
        await sendProgressHeartbeat('uploading');

        let uploadUrl = sessionFiles[fObj.uploadName];
        let nextByte = 0;

        if (uploadUrl) {
          const statusCheck = await queryUploadStatusWithRetry(uploadUrl);
          if (statusCheck.status === UPLOAD_STATUS.COMPLETED) {
            delete sessionFiles[fObj.uploadName];
            saveSession({ uploaderName, uploaderEmail, folderId: currentFolderId, files: sessionFiles });
            updateFileState(i, { status: 'completed', progress: 100 });
            continue;
          }
          if (statusCheck.status === UPLOAD_STATUS.INCOMPLETE) {
            nextByte = statusCheck.nextByte;
            updateFileState(i, { progress: Math.round((nextByte / fObj.size) * 100) });
          } else if (shouldDiscardUploadUrl(statusCheck.status)) {
            uploadUrl = null;
            delete sessionFiles[fObj.uploadName];
          }
          // network_error: keep uploadUrl — chunk upload will 308 to correct offset
        }

        if (!uploadUrl) {
          const initRes = await fetchWithTimeout('/api/upload-session', {
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
            throw new Error(
              await getApiErrorMessage(
                initRes,
                `Failed to init upload for ${fObj.name} (${uploadedCount}/${totalToUpload})`
              )
            );
          }
          const data = await initRes.json();
          uploadUrl = data.uploadUrl;
          sessionFiles[fObj.uploadName] = uploadUrl;
          saveSession({ uploaderName, uploaderEmail, folderId: currentFolderId, files: sessionFiles });
        }

        updateFileState(i, { uploadUrl });

        const reportProgress = createProgressThrottle(
          (progress) => updateFileState(i, { progress }),
          1000
        );

        let retries = 3;
        while (nextByte < fObj.size) {
          const endByte = Math.min(nextByte + CHUNK_SIZE, fObj.size);
          try {
            await uploadChunk({
              url: uploadUrl,
              file: fObj.file,
              start: nextByte,
              end: endByte,
              onProgress: reportProgress,
            });
            nextByte = endByte;
            reportProgress(Math.round((nextByte / fObj.size) * 100));
            retries = 3;
          } catch (chunkErr) {
            console.error(chunkErr);
            retries -= 1;
            if (retries === 0) {
              throw new Error(`Failed to upload ${fObj.name} after multiple retries.`);
            }
            await new Promise((res) => setTimeout(res, 2000));
            const statusCheck = await queryUploadStatusWithRetry(uploadUrl);
            if (statusCheck.status === UPLOAD_STATUS.INCOMPLETE) {
              nextByte = statusCheck.nextByte;
            }
            if (statusCheck.status === UPLOAD_STATUS.COMPLETED) break;
            if (shouldDiscardUploadUrl(statusCheck.status)) {
              throw new Error(`Upload session expired for ${fObj.name}. Retry to start a new session.`);
            }
          }
        }

        delete sessionFiles[fObj.uploadName];
        saveSession({ uploaderName, uploaderEmail, folderId: currentFolderId, files: sessionFiles });
        updateFileState(i, { status: 'completed', progress: 100 });
        await sendProgressHeartbeat('uploading');
        await new Promise((r) => setTimeout(r, 50));
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

      // Only auto-revoke one-time tokens when this run actually uploaded files
      // (skip-only runs must not revoke — delta resume would break)
      if (uploadIndices.length > 0) {
        fetch('/api/revoke-upload-token', {
          method: 'POST',
          headers: apiHeaders(),
        }).catch((err) => console.error('Token revoke failed:', err));
      }

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
    markFilesComplete,
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
    onDeltaScan,
  ]);

  return { startUpload };
}
