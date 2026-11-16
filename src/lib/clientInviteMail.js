/**
 * Optional SMTP for client hub invites.
 */
import nodemailer from 'nodemailer';

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export function isInviteSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
}

/**
 * @param {{ to: string, inviteUrl: string, locale?: string, expiresAt?: string }} opts
 */
export async function sendClientInviteEmail({
  to,
  inviteUrl,
  locale = 'en',
  expiresAt = null,
}) {
  if (!isInviteSmtpConfigured()) {
    return { ok: false, skipped: 'no_smtp' };
  }

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

  const from = `Drive Uploader <${process.env.SMTP_FROM || process.env.SMTP_USER}>`;
  const isPl = normalizeIsPl(locale);
  const subject = isPl
    ? 'Zaproszenie do konta klienta — portal studia'
    : 'Invitation to your client account — studio portal';
  const expiresLine = expiresAt
    ? isPl
      ? `<p>Link ważny do: <strong>${escapeHtml(formatWhen(expiresAt, locale))}</strong></p>`
      : `<p>Link valid until: <strong>${escapeHtml(formatWhen(expiresAt, locale))}</strong></p>`
    : '';

  const html = isPl
    ? `
      <div style="font-family:sans-serif;padding:20px;color:#333;max-width:560px;">
        <h2 style="color:#4f46e5;margin-top:0;">Zaproszenie do portalu klienta</h2>
        <p>Studio zaprosiło Cię do założenia konta — lista projektów, pobieranie plików i nowe uploady w jednym miejscu.</p>
        ${expiresLine}
        <p><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;margin-top:12px;padding:12px 20px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Załóż konto</a></p>
        <p style="margin-top:24px;font-size:12px;color:#666;word-break:break-all;">Lub otwórz link:<br>${escapeHtml(inviteUrl)}</p>
      </div>`
    : `
      <div style="font-family:sans-serif;padding:20px;color:#333;max-width:560px;">
        <h2 style="color:#4f46e5;margin-top:0;">You're invited to the client portal</h2>
        <p>The studio invited you to create an account — project list, downloads, and new uploads in one place.</p>
        ${expiresLine}
        <p><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;margin-top:12px;padding:12px 20px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Create account</a></p>
        <p style="margin-top:24px;font-size:12px;color:#666;word-break:break-all;">Or open this link:<br>${escapeHtml(inviteUrl)}</p>
      </div>`;

  await transporter.sendMail({
    from,
    to,
    subject,
    html,
    text: `${subject}\n\n${inviteUrl}\n`,
  });

  return { ok: true };
}

function normalizeIsPl(locale) {
  const l = String(locale || '').toLowerCase();
  return l === 'pl' || l.startsWith('pl-');
}

function formatWhen(iso, locale) {
  try {
    return new Intl.DateTimeFormat(normalizeIsPl(locale) ? 'pl-PL' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}
