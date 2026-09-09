'use client';

import { useRef, useEffect, useCallback } from 'react';

// Heartbeat is OFF by default to protect Vercel free-tier invocation limits.
// Set NEXT_PUBLIC_ENABLE_HEARTBEAT=true in Vercel env vars to enable debug mode
// (pulses every 30s). Error events are always sent regardless of this flag.
const HEARTBEAT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_HEARTBEAT === 'true';
const HEARTBEAT_INTERVAL_MS = 30_000; // 30s in debug mode (was 10s)

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

      // In normal mode (heartbeat OFF), skip routine 'uploading' pings.
      // Always send terminal states: 'completed', 'error' — these are critical.
      const isTerminal = sessionStatus === 'completed' || sessionStatus === 'error';
      if (!HEARTBEAT_ENABLED && !isTerminal) return;

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

  // Periodic heartbeat — only fires in debug mode (NEXT_PUBLIC_ENABLE_HEARTBEAT=true)
  useEffect(() => {
    if (!HEARTBEAT_ENABLED) return;
    if (status !== 'uploading' || !accessToken) return;
    const tick = () => sendProgressHeartbeat('uploading', filesRef.current);
    tick();
    const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, accessToken, sendProgressHeartbeat]);

  return { uploadSessionIdRef, uploadFolderIdRef, sendProgressHeartbeat, pushLog };
}
