'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * @param {{ mode?: 'query' | 'clientHub' }} opts
 * - query: classic `/?token=` clip-only flow
 * - clientHub: session cookie → linked token resolved server-side
 */
export function useUploadToken({ mode = 'query' } = {}) {
  const [accessToken, setAccessToken] = useState(
    mode === 'clientHub' ? '__client_hub__' : undefined
  );
  const [tokenStatus, setTokenStatus] = useState('checking');
  const [tokenPrefill, setTokenPrefill] = useState(null);
  const [locale, setLocale] = useState('en');

  useEffect(() => {
    if (mode === 'clientHub') {
      setAccessToken('__client_hub__');
      return;
    }
    const params = new URLSearchParams(window.location.search);
    setAccessToken(params.get('token') || '');
  }, [mode]);

  useEffect(() => {
    if (mode === 'clientHub') {
      let cancelled = false;
      setTokenStatus('checking');
      (async () => {
        try {
          const res = await fetch('/api/client/upload-context', {
            credentials: 'include',
          });
          if (cancelled) return;
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.canUpload) {
            setTokenStatus('valid');
            setTokenPrefill(data.prefill ?? null);
            setLocale(data.locale ?? 'en');
          } else if (res.status === 401) {
            setTokenStatus('invalid');
            setTokenPrefill(null);
          } else {
            setTokenStatus('invalid');
            setTokenPrefill(null);
            setLocale('en');
          }
        } catch {
          if (!cancelled) setTokenStatus('invalid');
        }
      })();
      return () => {
        cancelled = true;
      };
    }

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
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-upload-token': accessToken,
          },
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setTokenStatus('valid');
          setTokenPrefill(data.prefill ?? null);
          setLocale(data.locale ?? 'en');
        } else {
          setTokenStatus('invalid');
          setTokenPrefill(null);
          setLocale('en');
        }
      } catch {
        if (!cancelled) setTokenStatus('invalid');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, mode]);

  const apiHeaders = useCallback(() => {
    const headers = { 'Content-Type': 'application/json' };
    if (mode !== 'clientHub' && accessToken && accessToken !== '__client_hub__') {
      headers['x-upload-token'] = accessToken;
    }
    return headers;
  }, [accessToken, mode]);

  return {
    accessToken,
    tokenStatus,
    setTokenStatus,
    tokenPrefill,
    locale,
    apiHeaders,
    mode,
  };
}
