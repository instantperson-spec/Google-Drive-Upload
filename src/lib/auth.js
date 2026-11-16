import { NextResponse } from 'next/server';
import { isTokenActive, isTokenActiveInEnv } from '@/lib/tokenStore';
import { getClientFromRequest } from '@/lib/clientAuth';

/**
 * Server-side verification of the per-project upload token.
 *
 * Primary: header `x-upload-token` against `_uploader_tokens.json`.
 * Fallback: active client hub session → linkedToken (hub upload; token slug never sent to browser).
 * Env fallback: UPLOAD_TOKENS only when Drive store is unreachable for header tokens.
 *
 * @returns {Promise<string|null>} the valid token, or null if unauthorized
 */
export async function verifyUploadToken(request) {
  const provided = request.headers.get('x-upload-token');
  if (provided) {
    try {
      if (await isTokenActive(provided)) return provided;
      return null;
    } catch (err) {
      console.error(
        'Token store unavailable, falling back to UPLOAD_TOKENS env:',
        err.message
      );
      if (isTokenActiveInEnv(provided)) return provided;
      return null;
    }
  }

  try {
    const client = await getClientFromRequest(request);
    const linked = client?.linkedToken ? String(client.linkedToken).trim() : '';
    if (linked && (await isTokenActive(linked))) return linked;
  } catch (err) {
    console.error('Client hub token resolve failed:', err.message || err);
  }

  return null;
}

/** Standard 401 response for unauthorized API requests. */
export function unauthorizedResponse() {
  return NextResponse.json(
    { error: 'Unauthorized: missing or invalid upload token.' },
    { status: 401 }
  );
}
