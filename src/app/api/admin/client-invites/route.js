import { NextResponse } from 'next/server';
import {
  isAdminAuthenticated,
  unauthorizedAdminResponse,
} from '@/lib/adminAuth';
import {
  createInvite,
  listInvites,
  buildClientInviteUrl,
  ClientStoreConflictError,
} from '@/lib/clientStore';
import {
  sendClientInviteEmail,
  isInviteSmtpConfigured,
} from '@/lib/clientInviteMail';
import { rateLimit } from '@/lib/rateLimit';
import { normalizeLocale } from '@/lib/locales';

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

export async function GET(request) {
  if (!(await isAdminAuthenticated(request))) {
    return unauthorizedAdminResponse();
  }
  try {
    const invites = await listInvites();
    return NextResponse.json({
      invites,
      smtpConfigured: isInviteSmtpConfigured(),
    });
  } catch (err) {
    console.error('admin client-invites GET:', err.message || err);
    return NextResponse.json(
      { error: err.message || 'Failed to list invites.' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  if (!(await isAdminAuthenticated(request))) {
    return unauthorizedAdminResponse();
  }

  const limited = rateLimit(request, 'admin-client-invites', 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => ({}));
    const locale = normalizeLocale(body.locale || 'en');
    const { invite, rawToken } = await createInvite({
      email: body.email,
      locale,
      note: body.note || '',
    });

    const origin = appOrigin(request);
    const url = buildClientInviteUrl(origin, rawToken, locale);

    let mail = { ok: false, skipped: 'not_requested' };
    if (body.sendEmail) {
      try {
        mail = await sendClientInviteEmail({
          to: invite.email,
          inviteUrl: url,
          locale,
          expiresAt: invite.expiresAt,
          name: body.name || body.displayName || '',
          project: body.note || invite.note || '',
        });
      } catch (err) {
        console.error('invite mail error:', err.message || err);
        mail = { ok: false, error: err.message || 'Mail failed' };
      }
    }

    console.info('client invite created', {
      id: invite.id,
      email: invite.email,
      locale,
      mailOk: mail.ok,
    });

    return NextResponse.json(
      { invite, url, rawToken, mail },
      { status: 201 }
    );
  } catch (err) {
    const status = err instanceof ClientStoreConflictError ? 409 : 400;
    return NextResponse.json(
      { error: err.message || 'Failed to create invite.' },
      { status }
    );
  }
}
