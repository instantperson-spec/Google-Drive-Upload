import { NextResponse } from 'next/server';
import {
  isAdminAuthenticated,
  unauthorizedAdminResponse,
} from '@/lib/adminAuth';
import {
  revokeInvite,
  rotateInviteToken,
  buildClientInviteUrl,
  ClientStoreConflictError,
} from '@/lib/clientStore';
import { sendClientInviteEmail } from '@/lib/clientInviteMail';
import { rateLimit } from '@/lib/rateLimit';

function appOrigin(request) {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (env) {
    const raw = String(env).trim();
    if (raw.startsWith('http')) return raw.replace(/\/$/, '');
    return `https://${raw.replace(/\/$/, '')}`;
  }
  try {
    return new URL(request.url).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

export async function PATCH(request, { params }) {
  if (!(await isAdminAuthenticated(request))) {
    return unauthorizedAdminResponse();
  }

  const limited = rateLimit(request, 'admin-client-invites-patch', 60);
  if (limited) return limited;

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim();

    if (action === 'revoke') {
      const invite = await revokeInvite(id);
      console.info('client invite revoked', { id: invite.id, email: invite.email });
      return NextResponse.json({ invite });
    }

    if (action === 'resend' || action === 'copy') {
      // Rotate so admin gets a fresh URL (raw cannot be recovered from hash)
      const { invite, rawToken } = await rotateInviteToken(id);
      const origin = appOrigin(request);
      const url = buildClientInviteUrl(origin, rawToken, invite.locale);

      let mail = { ok: false, skipped: 'not_requested' };
      if (action === 'resend' || body.sendEmail) {
        try {
          mail = await sendClientInviteEmail({
            to: invite.email,
            inviteUrl: url,
            locale: invite.locale,
            expiresAt: invite.expiresAt,
            name: body.name || body.displayName || '',
            project: body.note || invite.note || '',
          });
        } catch (err) {
          console.error('invite resend mail error:', err.message || err);
          mail = { ok: false, error: err.message || 'Mail failed' };
        }
      }

      return NextResponse.json({ invite, url, rawToken, mail });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    const status = err instanceof ClientStoreConflictError ? 409 : 400;
    return NextResponse.json(
      { error: err.message || 'Failed to update invite.' },
      { status }
    );
  }
}
