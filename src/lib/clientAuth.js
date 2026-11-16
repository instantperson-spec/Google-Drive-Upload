/**
 * Client hub session cookies (separate from admin_session).
 * Signing secret: CLIENT_SESSION_SECRET || ADMIN_SECRET.
 */
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getClientById } from '@/lib/clientStore';

export const CLIENT_COOKIE = 'client_hub_session';
const SESSION_TTL_MS = 60 * 60 * 24 * 14 * 1000; // 14 days

const revokedSessionIds = new Set();
const MAX_REVOKED = 5000;

/** In-memory login fail tracking (per warm instance). */
const loginFails = new Map();
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;

function sessionSecret() {
  return process.env.CLIENT_SESSION_SECRET || process.env.ADMIN_SECRET || '';
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function signPayload(payload) {
  const secret = sessionSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Token: clientId.sessionId.exp.sig
 * @returns {{ clientId: string, sessionId: string, exp: number } | null}
 */
export function parseClientSessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [clientId, sessionId, expStr, sig] = parts;
  if (!clientId || clientId.length < 8) return null;
  if (!sessionId || !/^[a-f0-9]{32}$/i.test(sessionId)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return null;
  const payload = `${clientId}.${sessionId}.${expStr}`;
  const expected = signPayload(payload);
  if (!expected || !timingSafeEqual(sig, expected)) return null;
  if (Date.now() > exp) return null;
  if (revokedSessionIds.has(sessionId)) return null;
  return { clientId, sessionId, exp };
}

export function verifyClientSessionToken(token) {
  return Boolean(parseClientSessionToken(token));
}

export function createClientSessionToken(clientId) {
  const secret = sessionSecret();
  if (!secret) throw new Error('CLIENT_SESSION_SECRET or ADMIN_SECRET missing');
  const sessionId = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${clientId}.${sessionId}.${exp}`;
  const sig = signPayload(payload);
  return `${payload}.${sig}`;
}

export function clientSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export function revokeClientSessionToken(token) {
  const parsed = parseClientSessionToken(token);
  if (!parsed) {
    const parts = String(token || '').split('.');
    if (parts.length === 4 && /^[a-f0-9]{32}$/i.test(parts[1])) {
      revokedSessionIds.add(parts[1]);
    }
    return;
  }
  if (revokedSessionIds.size >= MAX_REVOKED) {
    const first = revokedSessionIds.values().next().value;
    revokedSessionIds.delete(first);
  }
  revokedSessionIds.add(parsed.sessionId);
}

export function unauthorizedClientResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function isClientAuthConfigured() {
  return Boolean(sessionSecret());
}

/** Login lockout helpers */
export function isLoginLocked(email) {
  const key = String(email || '').toLowerCase();
  const row = loginFails.get(key);
  if (!row) return false;
  if (Date.now() - row.firstAt > FAIL_WINDOW_MS) {
    loginFails.delete(key);
    return false;
  }
  return row.count >= MAX_FAILS;
}

export function recordLoginFail(email) {
  const key = String(email || '').toLowerCase();
  const now = Date.now();
  const row = loginFails.get(key);
  if (!row || now - row.firstAt > FAIL_WINDOW_MS) {
    loginFails.set(key, { count: 1, firstAt: now });
    return;
  }
  row.count += 1;
}

export function clearLoginFails(email) {
  loginFails.delete(String(email || '').toLowerCase());
}

/**
 * Resolve active client account from cookie.
 * @returns {Promise<object|null>} full client record (includes passwordHash — strip before JSON)
 */
export async function getClientFromRequest(request) {
  if (!isClientAuthConfigured()) return null;
  const cookieStore = await cookies();
  const raw = cookieStore.get(CLIENT_COOKIE)?.value;
  const parsed = parseClientSessionToken(raw);
  if (!parsed) return null;
  const client = await getClientById(parsed.clientId);
  if (!client || client.revoked) return null;
  return client;
}

export function publicClientSession(client) {
  if (!client) return null;
  return {
    id: client.id,
    email: client.email,
    displayName: client.displayName || '',
    locale: client.locale || 'en',
    linkedToken: Boolean(client.linkedToken),
    hasLinkedToken: Boolean(client.linkedToken),
  };
}
