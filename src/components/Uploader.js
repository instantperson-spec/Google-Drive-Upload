'use client';

import { useState, useCallback } from 'react';
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
import UploadDropZone from '@/components/upload/UploadDropZone';
import UploadFileList from '@/components/upload/UploadFileList';

export default function Uploader() {
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const { accessToken, tokenStatus, setTokenStatus, apiHeaders } = useUploadToken();
  const {
    sessionData,
    uploaderName,
    setUploaderName,
    uploaderEmail,
    setUploaderEmail,
    saveSession,
    clearSession,
  } = useUploadSession();

  const {
    files,
    isDragging,
    isScanning,
    fileInputRef,
    folderInputRef,
    removeFile,
    updateFileState,
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
