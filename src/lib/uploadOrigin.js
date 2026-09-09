/**
 * Resolve the public base URL for client upload links (?token=...).
 * Priority: PUBLIC_UPLOAD_URL → VERCEL_URL → request Origin → forwarded Host → localhost.
 * @param {Request} [request]
 * @returns {string}
 */
export function getUploadOrigin(request) {
  if (process.env.PUBLIC_UPLOAD_URL) {
    return process.env.PUBLIC_UPLOAD_URL.replace(/\/$/, '');
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  }

  if (request) {
    const origin = request.headers.get('origin');
    if (origin) return origin.replace(/\/$/, '');

    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
      const proto = request.headers.get('x-forwarded-proto') || 'https';
      return `${proto}://${host.split(',')[0].trim()}`.replace(/\/$/, '');
    }
  }

  return 'http://localhost:3000';
}
