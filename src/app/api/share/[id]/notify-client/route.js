import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { getActiveShare } from '@/lib/shareStore';
import { getTokenRecord } from '@/lib/tokenStore';
import { verifyAdminPassword } from '@/lib/adminAuth';
import { rateLimit } from '@/lib/rateLimit';

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/**
 * Studio Console → mail client after Opublikuj.
 * Auth: x-admin-secret === ADMIN_SECRET
 */
export async function POST(request, { params }) {
  const limited = rateLimit(request, 'share-notify-client', 10);
  if (limited) return limited;

  const secret =
    request.headers.get('x-admin-secret') ||
    request.headers.get('x-admin-password') ||
    '';
  if (!verifyAdminPassword(secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const share = await getActiveShare(id);
    if (!share) {
      return NextResponse.json({ error: 'Share not found or revoked.' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const roundLabel =
      String(body.roundLabel || share.roundLabel || '').trim() || 'Draft';
    const projectLabel =
      String(body.label || share.label || 'Projekt').slice(0, 120);

    if (!share.token) {
      return NextResponse.json(
        { error: 'Share has no token — cannot resolve client email.', skipped: 'no_token' },
        { status: 400 }
      );
    }

    const tokenRecord = await getTokenRecord(share.token);
    const to = String(tokenRecord?.prefillEmail || '').trim();
    if (!to) {
      return NextResponse.json(
        {
          error: 'Token has no prefillEmail — add client email on the token.',
          skipped: 'no_prefillEmail',
        },
        { status: 400 }
      );
    }

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return NextResponse.json(
        { error: 'SMTP is not configured on Vercel.', skipped: 'no_smtp' },
        { status: 503 }
      );
    }

    const origin = (
      process.env.PUBLIC_UPLOAD_URL ||
      process.env.NEXT_PUBLIC_UPLOAD_URL ||
      'https://drive-uploader-three.vercel.app'
    ).replace(/\/$/, '');
    const shareUrl = `${origin}/share/${encodeURIComponent(share.id)}`;

    const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const safeProject = escapeHtml(projectLabel);
    const safeRound = escapeHtml(roundLabel);
    const safeUrl = escapeHtml(shareUrl);

    await transporter.sendMail({
      from: `Drive Uploader <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject: `${projectLabel} — ${roundLabel} gotowy do pobrania`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #4f46e5;">Nowa publikacja od studia</h2>
          <p>Projekt: <strong>${safeProject}</strong></p>
          <p>Runda: <strong>${safeRound}</strong></p>
          <p>Możesz pobrać pliki w portalu projektu (bez logowania):</p>
          <p style="margin: 24px 0;">
            <a href="${safeUrl}"
               style="display:inline-block;padding:12px 20px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">
              Otwórz portal projektu
            </a>
          </p>
          <p style="font-size:13px;color:#666;">Link: ${safeUrl}</p>
        </div>
      `,
      text: `${projectLabel} — ${roundLabel}\n\nOtwórz portal: ${shareUrl}\n`,
    });

    return NextResponse.json({
      ok: true,
      to,
      shareId: share.id,
      roundLabel,
      url: shareUrl,
    });
  } catch (err) {
    console.error('share notify-client error:', err.message || err);
    return NextResponse.json(
      { error: err.message || 'Failed to send mail' },
      { status: 500 }
    );
  }
}
