import { NextResponse } from 'next/server';
import { authenticateClient, normalizeEmail } from '@/lib/clientStore';
import {
  CLIENT_COOKIE,
  clientSessionCookieOptions,
  createClientSessionToken,
  clearLoginFails,
  isClientAuthConfigured,
  isLoginLocked,
  publicClientSession,
  recordLoginFail,
} from '@/lib/clientAuth';
import { rateLimit } from '@/lib/rateLimit';

export async function POST(request) {
  const limited = rateLimit(request, 'client-login', 10);
  if (limited) return limited;

  if (!isClientAuthConfigured()) {
    return NextResponse.json(
      { error: 'Client hub is not configured (ADMIN_SECRET missing).' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 }
      );
    }

    if (isLoginLocked(email)) {
      return NextResponse.json(
        { error: 'Too many failed attempts. Try again later.' },
        { status: 429 }
      );
    }

    const client = await authenticateClient(email, password);
    if (!client) {
      recordLoginFail(email);
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    clearLoginFails(email);
    const response = NextResponse.json({
      ok: true,
      client: publicClientSession(client),
    });
    response.cookies.set(
      CLIENT_COOKIE,
      createClientSessionToken(client.id),
      clientSessionCookieOptions()
    );
    return response;
  } catch (err) {
    console.error('client login error:', err.message || err);
    return NextResponse.json({ error: 'Login failed.' }, { status: 500 });
  }
}
