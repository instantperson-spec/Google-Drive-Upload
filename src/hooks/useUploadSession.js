'use client';

import { useState, useEffect, useCallback } from 'react';

export const UPLOAD_SESSION_STORAGE_KEY = 'drive_uploader_session';

/** Read persisted upload session synchronously (authoritative for resume URLs). */
export function readStoredUploadSession() {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(UPLOAD_SESSION_STORAGE_KEY);
    if (!saved) return null;
    const session = JSON.parse(saved);
    if (session?.uploaderName && session?.uploaderEmail && session?.folderId) {
      return session;
    }
  } catch (e) {
    console.error('Failed to parse session data', e);
  }
  return null;
}

export function useUploadSession() {
  const [sessionData, setSessionData] = useState(null);
  const [uploaderName, setUploaderName] = useState('');
  const [uploaderEmail, setUploaderEmail] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(UPLOAD_SESSION_STORAGE_KEY);
      if (!saved) return;
      const session = JSON.parse(saved);
      if (session.uploaderName && session.uploaderEmail && session.folderId) {
        setUploaderName(session.uploaderName);
        setUploaderEmail(session.uploaderEmail);
        setSessionData(session);
      }
    } catch (e) {
      console.error('Failed to parse session data', e);
    }
  }, []);

  const saveSession = useCallback((data) => {
    setSessionData(data);
    localStorage.setItem(UPLOAD_SESSION_STORAGE_KEY, JSON.stringify(data));
  }, []);

  const clearSession = useCallback(() => {
    setSessionData(null);
    localStorage.removeItem(UPLOAD_SESSION_STORAGE_KEY);
  }, []);

  return {
    sessionData,
    uploaderName,
    setUploaderName,
    uploaderEmail,
    setUploaderEmail,
    saveSession,
    clearSession,
  };
}
