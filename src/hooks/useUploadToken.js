'use client';

import { useState, useEffect, useCallback } from 'react';

export function useUploadToken() {
  const [accessToken, setAccessToken] = useState(undefined);
  const [tokenStatus, setTokenStatus] = useState('checking');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setAccessToken(params.get('token') || '');
  }, []);

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

  const apiHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      'x-upload-token': accessToken || '',
    }),
    [accessToken]
  );

  return { accessToken, tokenStatus, setTokenStatus, apiHeaders };
}
