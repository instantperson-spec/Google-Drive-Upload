'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'drive_uploader_session';

export function useUploadSession() {
  const [sessionData, setSessionData] = useState(null);
  const [uploaderName, setUploaderName] = useState('');
  const [uploaderEmail, setUploaderEmail] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, []);

  const clearSession = useCallback(() => {
    setSessionData(null);
    localStorage.removeItem(STORAGE_KEY);
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
