import crypto from 'crypto';
import { NextResponse } from 'next/server';
import {
  createClient,
  normalizeEmail,
  isValidEmail,
  findInviteByRawToken,
  consumeInviteByRawToken,
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
 * Invite-only registration. Requires valid one-time invite token.
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
    const inviteRaw = String(body.invite || body.inviteToken || '').trim();
    if (!inviteRaw) {
      return NextResponse.json(
        { error: 'An invitation from the studio is required to create an account.' },
        { status: 403 }
      );
    }

    const found = await findInviteByRawToken(inviteRaw);
    if (!found || found.status !== 'pending') {
      const code =
        found?.status === 'expired' || found?.status === 'used' ? 410 : 403;
      return NextResponse.json(
        {
          error:
            found?.status === 'expired'
              ? 'Invite has expired.'
              : found?.status === 'used'
                ? 'Invite already used.'
                : 'Invalid or revoked invite.',
        },
        { status: code }
      );
    }

    const inviteEmail = normalizeEmail(found.invite.email);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const displayName = String(body.displayName || body.name || '').trim();
    const locale = normalizeLocale(
      body.locale || found.invite.locale || 'en'
    );

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Valid email is required.' }, { status: 400 });
    }
    if (email !== inviteEmail) {
      return NextResponse.json(
        { error: 'Email must match the invitation.' },
        { status: 403 }
      );
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
      notes: 'Auto-created on invited client hub signup',
      prefillName: displayName,
      prefillEmail: email,
      locale,
    });

    const client = await createClient({
      email,
      password,
      displayName,
      locale,
      linkedToken,
    });

    await consumeInviteByRawToken(inviteRaw);
    console.info('client invite consumed', {
      inviteId: found.invite.id,
      email,
    });

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
    let status = 400;
    if (/already exists/i.test(msg)) status = 409;
    if (err.code === 403) status = 403;
    if (err.code === 410) status = 410;
    console.error('client register error:', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
