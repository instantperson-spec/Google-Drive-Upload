'use client';

import { createContext, useContext } from 'react';
import { useUploadToken } from '@/hooks/useUploadToken';

const UploadTokenContext = createContext(null);

export function UploadTokenProvider({ children }) {
  const value = useUploadToken();
  return <UploadTokenContext.Provider value={value}>{children}</UploadTokenContext.Provider>;
}

export function useUploadTokenContext() {
  const ctx = useContext(UploadTokenContext);
  if (!ctx) {
    throw new Error('useUploadTokenContext must be used within UploadTokenProvider');
  }
  return ctx;
}
