import { NextResponse } from 'next/server';
import { isTokenActive, isTokenActiveInEnv } from '@/lib/tokenStore';

/**
 * Server-side verification of the per-project upload token.
 *
 * Primary source: `_uploader_tokens.json` on Google Drive (managed via /admin).
 * Fallback: UPLOAD_TOKENS env (comma-separated) if Drive store is unreachable.
 *
 * Fail-closed when neither source accepts the token.
 *
 * @returns {Promise<string|null>} the valid token, or null if unauthorized
 */
export async function verifyUploadToken(request) {
  const provided = request.headers.get('x-upload-token');
  if (!provided) return null;

  try {
    // Drive store is authoritative — revoke in /admin takes effect immediately
    if (await isTokenActive(provided)) return provided;
    return null;
  } catch (err) {
    // Fallback only when Drive is unreachable (e.g. misconfigured credentials)
    console.error('Token store unavailable, falling back to UPLOAD_TOKENS env:', err.message);
    if (isTokenActiveInEnv(provided)) return provided;
    return null;
  }
}

/** Standard 401 response for unauthorized API requests. */
export function unauthorizedResponse() {
  return NextResponse.json(
    { error: 'Unauthorized: missing or invalid upload token.' },
    { status: 401 }
  );
}
