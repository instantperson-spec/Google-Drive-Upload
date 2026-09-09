'use client';

import { useState, useRef, useCallback } from 'react';
import { deriveUploadName } from '@/lib/pathManifest';
import { isBlockedExtension } from '@/lib/blocklist';
import {
  collectEntriesFromDataTransfer,
  collectEntriesFromDirectoryPicker,
  collectEntriesFromFileList,
} from '@/lib/collectFolderFiles';

export function useFileQueue({ uploadStatus, setErrorMessage }) {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const addFileEntries = useCallback((entries) => {
    setFiles((prev) => {
      const accepted = [];
      const rejected = [];
      const usedUploadNames = new Set(prev.map((f) => f.uploadName).filter(Boolean));

      for (const { file, relativePath } of entries) {
        if (isBlockedExtension(relativePath)) {
          rejected.push(relativePath);
        } else {
          const uploadName = deriveUploadName(relativePath, usedUploadNames);
          accepted.push({
            id: crypto.randomUUID(),
            file,
            name: relativePath,
            relativePath,
            uploadName,
            size: file.size,
            type: file.type || 'application/octet-stream',
            status: 'pending',
            progress: 0,
            uploadUrl: null,
          });
        }
      }

      if (rejected.length > 0) {
        setErrorMessage(
          `Skipped ${rejected.length} file(s) with disallowed type: ${rejected.slice(0, 5).join(', ')}${rejected.length > 5 ? '…' : ''}`
        );
      }

      return accepted.length ? [...prev, ...accepted] : prev;
    });
  }, [setErrorMessage]);

  const removeFile = useCallback((idToRemove) => {
    setFiles((prev) => prev.filter((f) => f.id !== idToRemove));
  }, []);

  const updateFileState = useCallback((index, updates) => {
    setFiles((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, []);

  /** Mark many files completed in one React update (avoids UI freeze during bulk skip). */
  const markFilesComplete = useCallback((indices) => {
    if (!indices.length) return;
    const indexSet = new Set(indices);
    setFiles((prev) =>
      prev.map((f, i) =>
        indexSet.has(i) ? { ...f, status: 'completed', progress: 100 } : f
      )
    );
  }, []);

  const clearFiles = useCallback(() => setFiles([]), []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragging(false);
    setIsScanning(true);
    setErrorMessage('');
    try {
      const entries = await collectEntriesFromDataTransfer(e.dataTransfer);
      if (entries.length > 0) {
        addFileEntries(entries);
      } else {
        setErrorMessage('No files found. Drop a folder or select files to upload.');
      }
    } catch (err) {
      console.error('Drop scan failed:', err);
      setErrorMessage('Could not read dropped folder. Try “Select Folder” instead.');
    } finally {
      setIsScanning(false);
    }
  }, [addFileEntries, setErrorMessage]);

  const handleFileSelect = useCallback((e) => {
    if (e.target.files?.length) {
      addFileEntries(collectEntriesFromFileList(e.target.files));
    }
  }, [addFileEntries]);

  const handleFolderSelect = useCallback(async () => {
    if (uploadStatus === 'uploading' || isScanning) return;
    setErrorMessage('');

    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      setIsScanning(true);
      try {
        const entries = await collectEntriesFromDirectoryPicker();
        if (entries.length > 0) {
          addFileEntries(entries);
        } else {
          setErrorMessage('Selected folder is empty.');
        }
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('Folder picker failed:', err);
          setErrorMessage('Could not read folder. Try drag-and-drop instead.');
        }
      } finally {
        setIsScanning(false);
      }
      return;
    }

    if (folderInputRef.current) {
      folderInputRef.current.value = null;
      folderInputRef.current.click();
    }
  }, [uploadStatus, isScanning, addFileEntries, setErrorMessage]);

  const openFilePicker = useCallback(() => {
    if (uploadStatus === 'uploading' || isScanning || !fileInputRef.current) return;
    fileInputRef.current.value = null;
    fileInputRef.current.click();
  }, [uploadStatus, isScanning]);

  return {
    files,
    isDragging,
    isScanning,
    fileInputRef,
    folderInputRef,
    addFileEntries,
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
  };
}
