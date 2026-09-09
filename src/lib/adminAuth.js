import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const ADMIN_COOKIE = 'admin_session';

/** Deterministic session token derived from ADMIN_SECRET — never sent to the client in env form. */
function expectedSessionToken() {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update('admin-session-v1').digest('hex');
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Verify raw password (login form) or x-admin-secret header. */
export function verifyAdminPassword(provided) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !provided) return false;
  return timingSafeEqual(provided, secret);
}

/** Verify signed session cookie value. */
export function verifyAdminSessionToken(token) {
  const expected = expectedSessionToken();
  if (!expected || !token) return false;
  return timingSafeEqual(token, expected);
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
    maxAge: 60 * 60 * 24, // 24 hours
  };
}

export function createAdminSessionToken() {
  return expectedSessionToken();
}
