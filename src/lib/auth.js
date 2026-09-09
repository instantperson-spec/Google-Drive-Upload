import { NextResponse } from 'next/server';

/**
 * Server-side verification of the per-project upload token.
 *
 * Valid tokens are defined in the UPLOAD_TOKENS env variable as a
 * comma-separated list (e.g. UPLOAD_TOKENS="ProjectAlpha,ClientBeta2026").
 * The client obtains its token from the URL (?token=X) and sends it
 * with every API request in the "x-upload-token" header.
 *
 * Fail-closed: if UPLOAD_TOKENS is not configured, every request is rejected.
 *
 * @returns {string|null} the valid token, or null if unauthorized
 */
export function verifyUploadToken(request) {
  const configured = (process.env.UPLOAD_TOKENS || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  if (configured.length === 0) {
    console.error('UPLOAD_TOKENS is not configured — rejecting all API requests.');
    return null;
  }

  const provided = request.headers.get('x-upload-token');
  if (!provided || !configured.includes(provided)) {
    return null;
  }
  return provided;
}

/** Standard 401 response for unauthorized API requests. */
export function unauthorizedResponse() {
  return NextResponse.json(
    { error: 'Unauthorized: missing or invalid upload token.' },
    { status: 401 }
  );
}
