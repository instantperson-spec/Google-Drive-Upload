'use client';

import { useRef, useEffect, useCallback } from 'react';

// Production: light 90s pulse during upload so admin Live Monitor stays in sync on
// long files (MOVs). Per-file events still fire on start/complete. Debug: 30s.
const DEBUG_HEARTBEAT = process.env.NEXT_PUBLIC_ENABLE_HEARTBEAT === 'true';
const HEARTBEAT_INTERVAL_MS = DEBUG_HEARTBEAT ? 30_000 : 90_000;

export function useUploadHeartbeat({
  accessToken,
  status,
  uploaderName,
  uploaderEmail,
  files,
  apiHeaders,
}) {
  const uploadSessionIdRef = useRef(null);
  const uploadFolderIdRef = useRef(null);
  const filesRef = useRef(files);
  const logsRef = useRef([]);

  const pushLog = useCallback((message) => {
    const timestamp = new Date().toISOString();
    logsRef.current.push(`[${timestamp}] ${message}`);
    // Keep max 200 logs to prevent memory/payload bloat
    if (logsRef.current.length > 200) {
      logsRef.current = logsRef.current.slice(-200);
    }
  }, []);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const sendProgressHeartbeat = useCallback(
    async (sessionStatus = 'uploading', filesSnapshot = null) => {
      const sessionId = uploadSessionIdRef.current;
      const folderId = uploadFolderIdRef.current;
      if (!sessionId || !folderId || !accessToken) return;

      const fileList = (filesSnapshot ?? filesRef.current).map((f) => ({
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
          logs: logsRef.current,
        }),
      }).catch(() => {});
    },
    [accessToken, uploaderName, uploaderEmail, apiHeaders]
  );

  // Periodic heartbeat while uploading (90s prod / 30s debug) for admin Live Monitor.
  useEffect(() => {
    if (status !== 'uploading' || !accessToken) return;
    const tick = () => sendProgressHeartbeat('uploading', filesRef.current);
    const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, accessToken, sendProgressHeartbeat]);

  return { uploadSessionIdRef, uploadFolderIdRef, sendProgressHeartbeat, pushLog };
}
