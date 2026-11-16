import { NextResponse } from 'next/server';
import { findInviteByRawToken } from '@/lib/clientStore';
import { rateLimit } from '@/lib/rateLimit';

/**
 * Public probe: validate invite token without consuming.
 * GET /api/client/invite?token=...
 */
export async function GET(request) {
  const limited = rateLimit(request, 'client-invite-probe', 60);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token') || searchParams.get('invite') || '';
    const found = await findInviteByRawToken(token);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: 'Invalid invite.' },
        { status: 404 }
      );
    }
    if (found.status !== 'pending') {
      const status = found.status === 'expired' || found.status === 'used' ? 410 : 403;
      return NextResponse.json(
        {
          ok: false,
          status: found.status,
          error:
            found.status === 'expired'
              ? 'Invite has expired.'
              : found.status === 'used'
                ? 'Invite already used.'
                : 'Invite is not valid.',
        },
        { status }
      );
    }
    return NextResponse.json({
      ok: true,
      email: found.public.email,
      locale: found.public.locale,
      expiresAt: found.public.expiresAt,
    });
  } catch (err) {
    console.error('client invite probe:', err.message || err);
    return NextResponse.json(
      { error: err.message || 'Failed to validate invite.' },
      { status: 500 }
    );
  }
}
