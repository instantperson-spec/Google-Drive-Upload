import crypto from 'crypto';
import { NextResponse } from 'next/server';
import {
  createClient,
  normalizeEmail,
  isValidEmail,
} from '@/lib/clientStore';
import {
  CLIENT_COOKIE,
  clientSessionCookieOptions,
  createClientSessionToken,
  isClientAuthConfigured,
  publicClientSession,
} from '@/lib/clientAuth';
import { createToken, validateTokenSlug } from '@/lib/tokenStore';
import { rateLimit } from '@/lib/rateLimit';
import { normalizeLocale } from '@/lib/locales';

function makeLinkedTokenSlug(displayName, email) {
  const base = String(displayName || email.split('@')[0] || 'client')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 20);
  const suffix = crypto.randomBytes(3).toString('hex');
  const slug = `${base || 'client'}_${suffix}`;
  return validateTokenSlug(slug) ? slug : `client_${suffix}`;
}

/**
 * Public self-signup for project clients (no invite token).
 * Creates hub account + linked retainer upload token for /client/upload.
 */
export async function POST(request) {
  const limited = rateLimit(request, 'client-register', 8);
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
    const displayName = String(body.displayName || body.name || '').trim();
    const locale = normalizeLocale(body.locale || 'en');

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Valid email is required.' }, { status: 400 });
    }
    if (displayName.length < 2) {
      return NextResponse.json(
        { error: 'Name must be at least 2 characters.' },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters.' },
        { status: 400 }
      );
    }

    const linkedToken = makeLinkedTokenSlug(displayName, email);
    await createToken({
      token: linkedToken,
      clientName: displayName,
      clientEmail: email,
      type: 'retainer',
      notes: 'Auto-created on client hub self-signup',
      prefillName: displayName,
      prefillEmail: email,
      locale,
    });

    let client;
    try {
      client = await createClient({
        email,
        password,
        displayName,
        locale,
        linkedToken,
      });
    } catch (err) {
      // Best-effort: leave orphan token for admin cleanup if account create fails
      throw err;
    }

    const response = NextResponse.json(
      { ok: true, client: publicClientSession({ ...client, linkedToken }) },
      { status: 201 }
    );
    response.cookies.set(
      CLIENT_COOKIE,
      createClientSessionToken(client.id),
      clientSessionCookieOptions()
    );
    return response;
  } catch (err) {
    const msg = err.message || 'Registration failed.';
    const status = /already exists/i.test(msg) ? 409 : 400;
    console.error('client register error:', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
