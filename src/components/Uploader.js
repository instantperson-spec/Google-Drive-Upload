'use client';

import { useState, useCallback, useEffect } from 'react';
import { useUploadToken } from '@/hooks/useUploadToken';
import { useUploadSession } from '@/hooks/useUploadSession';
import { useUploadHeartbeat } from '@/hooks/useUploadHeartbeat';
import { useFileQueue } from '@/hooks/useFileQueue';
import { useUploadRunner } from '@/hooks/useUploadRunner';
import {
  UploadCheckingScreen,
  UploadInvalidScreen,
  UploadStructuringScreen,
  UploadSuccessScreen,
} from '@/components/upload/UploadStatusScreens';
import UserDetailsForm from '@/components/upload/UserDetailsForm';
import SessionResumeBanner from '@/components/upload/SessionResumeBanner';
import DeltaScanBanner from '@/components/upload/DeltaScanBanner';
import UploadDropZone from '@/components/upload/UploadDropZone';
import UploadFileList from '@/components/upload/UploadFileList';

export default function Uploader() {
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [deltaScan, setDeltaScan] = useState(null);

  const { accessToken, tokenStatus, setTokenStatus, tokenPrefill, apiHeaders } = useUploadToken();
  const {
    sessionData,
    uploaderName,
    setUploaderName,
    uploaderEmail,
    setUploaderEmail,
    saveSession,
    clearSession,
  } = useUploadSession();

  useEffect(() => {
    if (tokenStatus !== 'valid' || !tokenPrefill) return;
    if (sessionData?.uploaderName && sessionData?.uploaderEmail) return;
    if (!uploaderName.trim()) setUploaderName(tokenPrefill.name);
    if (!uploaderEmail.trim()) setUploaderEmail(tokenPrefill.email);
  }, [
    tokenStatus,
    tokenPrefill,
    sessionData,
    uploaderName,
    uploaderEmail,
    setUploaderName,
    setUploaderEmail,
  ]);

  const {
    files,
    isDragging,
    isScanning,
    fileInputRef,
    folderInputRef,
    removeFile,
    updateFileState,
    markFilesComplete,
    clearFiles,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileSelect,
    handleFolderSelect,
    openFilePicker,
  } = useFileQueue({ uploadStatus: status, setErrorMessage });

  const { uploadSessionIdRef, uploadFolderIdRef, sendProgressHeartbeat } = useUploadHeartbeat({
    accessToken,
    status,
    uploaderName,
    uploaderEmail,
    files,
    apiHeaders,
  });

  const { startUpload } = useUploadRunner({
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
    onDeltaScan: setDeltaScan,
  });

  const canUpload =
    tokenStatus === 'valid' &&
    files.length > 0 &&
    status !== 'uploading' &&
    !isScanning &&
    !!uploaderName.trim() &&
    !!uploaderEmail.trim();

  const uploadDisabled = status === 'uploading' || isScanning;

  const handleSuccessReset = useCallback(() => {
    clearFiles();
    setStatus('idle');
    setUploaderName('');
    setUploaderEmail('');
  }, [clearFiles, setUploaderName, setUploaderEmail]);

  const handleCancelSession = useCallback(() => {
    clearSession();
    setUploaderName('');
    setUploaderEmail('');
  }, [clearSession, setUploaderName, setUploaderEmail]);

  if (accessToken === undefined || tokenStatus === 'checking') {
    return <UploadCheckingScreen />;
  }

  if (accessToken === '' || tokenStatus === 'invalid') {
    return <UploadInvalidScreen isRevoked={accessToken !== ''} />;
  }

  if (status === 'structuring') {
    return <UploadStructuringScreen />;
  }

  if (status === 'success') {
    return <UploadSuccessScreen onReset={handleSuccessReset} />;
  }

  const pendingCount = files.filter((f) => f.status !== 'completed').length;

  return (
    <div className="uploader-container">
      <UserDetailsForm
        uploaderName={uploaderName}
        uploaderEmail={uploaderEmail}
        onNameChange={setUploaderName}
        onEmailChange={setUploaderEmail}
        disabled={status === 'uploading'}
      />

      {sessionData && status !== 'uploading' && files.length === 0 && (
        <SessionResumeBanner onCancel={handleCancelSession} />
      )}

      <UploadDropZone
        isDragging={isDragging}
        isScanning={isScanning}
        uploadDisabled={uploadDisabled}
        fileInputRef={fileInputRef}
        folderInputRef={folderInputRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onFileSelect={handleFileSelect}
        onOpenFilePicker={openFilePicker}
        onOpenFolderPicker={handleFolderSelect}
      />

      <UploadFileList
        files={files}
        uploadStatus={status}
        hasSession={!!sessionData}
        onRemoveFile={removeFile}
      />

      <DeltaScanBanner delta={deltaScan} />

      {errorMessage && (
        <div className="upload-error-banner" role="alert">
          {errorMessage}
        </div>
      )}

      <button
        type="button"
        className={`upload-start-btn ${canUpload ? 'upload-start-btn--ready' : 'upload-start-btn--disabled'}`}
        onClick={startUpload}
        disabled={!canUpload}
      >
        {status === 'uploading' ? 'Upload in progress...' : `Start Upload (${pendingCount} files)`}
      </button>
    </div>
  );
}
