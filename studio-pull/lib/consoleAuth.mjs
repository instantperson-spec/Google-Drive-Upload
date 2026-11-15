/**
 * Local auth for Studio Console (:8787).
 * Token lives only on disk under Application Support — required on every /api/* call.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const SUPPORT_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'StudioConsole'
);

export const AUTH_TOKEN_FILE = path.join(SUPPORT_DIR, 'console_auth.txt');
export const AUTH_FP_FILE = path.join(SUPPORT_DIR, 'console_auth.fp');

export function fingerprint(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

export function ensureConsoleAuthToken() {
  fs.mkdirSync(SUPPORT_DIR, { recursive: true });
  let token = '';
  try {
    if (fs.existsSync(AUTH_TOKEN_FILE)) {
      token = fs.readFileSync(AUTH_TOKEN_FILE, 'utf8').trim();
    }
  } catch {
    token = '';
  }
  if (token.length < 32) {
    token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(AUTH_TOKEN_FILE, token, { mode: 0o600 });
  }
  const fp = fingerprint(token);
  try {
    fs.writeFileSync(AUTH_FP_FILE, fp, { mode: 0o600 });
  } catch {
    /* ignore */
  }
  return { token, fingerprint: fp };
}

const ALLOWED_HOSTS = new Set(['127.0.0.1:8787', 'localhost:8787']);
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:8787',
  'http://localhost:8787',
  'tauri://localhost',
  'https://tauri.localhost',
  'http://tauri.localhost',
]);

/**
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function assertConsoleRequest(req, { token, allowUnauthedPath = false, allowQueryToken = false } = {}) {
  const host = String(req.headers.host || '')
    .trim()
    .toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    return { ok: false, status: 403, error: 'Invalid Host' };
  }

  const origin = req.headers.origin;
  if (origin != null && !ALLOWED_ORIGINS.has(String(origin))) {
    return { ok: false, status: 403, error: 'Invalid Origin' };
  }

  if (allowUnauthedPath) return { ok: true };

  const headerToken = req.headers['x-studio-console-token'];
  let queryToken = '';
  if (allowQueryToken) {
    const url = new URL(req.url, `http://${host}`);
    queryToken = url.searchParams.get('consoleToken') || '';
  }
  const provided = String(headerToken || queryToken || '').trim();
  if (!provided || provided !== token) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}
