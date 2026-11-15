import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const ADMIN_COOKIE = 'admin_session';
const SESSION_TTL_MS = 60 * 60 * 24 * 1000; // 24h

/** In-memory denylist — works per warm instance; SECRET rotate invalidates all. */
const revokedSessionIds = new Set();
const MAX_REVOKED = 5000;

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function signPayload(payload) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Verify raw password (login form) or x-admin-secret header. */
export function verifyAdminPassword(provided) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !provided) return false;
  return timingSafeEqual(provided, secret);
}

/**
 * Parse `sessionId.exp.sig` cookie value.
 * @returns {{ sessionId: string, exp: number } | null}
 */
export function parseAdminSessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [sessionId, expStr, sig] = parts;
  if (!/^[a-f0-9]{32}$/i.test(sessionId)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return null;
  const payload = `${sessionId}.${expStr}`;
  const expected = signPayload(payload);
  if (!expected || !timingSafeEqual(sig, expected)) return null;
  if (Date.now() > exp) return null;
  if (revokedSessionIds.has(sessionId)) return null;
  return { sessionId, exp };
}

/** Verify signed session cookie value (random id + TTL + HMAC). */
export function verifyAdminSessionToken(token) {
  return Boolean(parseAdminSessionToken(token));
}

/**
 * Check admin auth from cookie (browser) or x-admin-secret header (scripts).
 * @returns {boolean}
 */
export async function isAdminAuthenticated(request) {
  if (!process.env.ADMIN_SECRET) {
    console.error('ADMIN_SECRET is not configured — admin routes are locked.');
    return false;
  }

  const headerSecret = request.headers.get('x-admin-secret');
  if (verifyAdminPassword(headerSecret)) return true;

  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_COOKIE);
  return verifyAdminSessionToken(session?.value);
}

export function unauthorizedAdminResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/** Cookie options for a successful admin login. */
export function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** Fresh random session id + expiry + HMAC (logout can revoke by id). */
export function createAdminSessionToken() {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${sessionId}.${exp}`;
  const sig = signPayload(payload);
  if (!sig) throw new Error('ADMIN_SECRET missing');
  return `${payload}.${sig}`;
}

/** Invalidate a session id (best-effort on this instance). */
export function revokeAdminSessionToken(token) {
  const parsed = (() => {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [sessionId, expStr, sig] = parts;
    const payload = `${sessionId}.${expStr}`;
    const expected = signPayload(payload);
    if (!expected || !timingSafeEqual(sig, expected)) return null;
    return sessionId;
  })();
  if (!parsed) return;
  if (revokedSessionIds.size >= MAX_REVOKED) {
    const first = revokedSessionIds.values().next().value;
    revokedSessionIds.delete(first);
  }
  revokedSessionIds.add(parsed);
}
