/**
 * Optional SMTP for client hub invites (Instant Project Studio copy).
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

function normalizeIsPl(locale) {
  const l = String(locale || '').toLowerCase();
  return l === 'pl' || l.startsWith('pl-');
}

/** Greeting suffix: ", Anna" or "" */
function nameSuffix(name) {
  const n = String(name || '').trim();
  return n ? `, ${n}` : '';
}

function inviteFromAddress() {
  const addr = process.env.SMTP_FROM || process.env.SMTP_USER;
  return `Instant Project Studio <${addr}>`;
}

/**
 * @param {{
 *   to: string,
 *   inviteUrl: string,
 *   locale?: string,
 *   name?: string,
 *   project?: string,
 *   expiresAt?: string,
 * }} opts
 */
export async function sendClientInviteEmail({
  to,
  inviteUrl,
  locale = 'en',
  name = '',
  project = '',
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

  const isPl = normalizeIsPl(locale);
  const greet = nameSuffix(name);
  const safeUrl = escapeHtml(inviteUrl);
  const projectLine = String(project || '').trim()
    ? isPl
      ? `<p>Projekt: <strong>${escapeHtml(project)}</strong></p>`
      : `<p>Project: <strong>${escapeHtml(project)}</strong></p>`
    : '';
  const expiresLine = expiresAt
    ? isPl
      ? `<p style="font-size:13px;color:#666;">Link ważny do: <strong>${escapeHtml(formatWhen(expiresAt, locale))}</strong></p>`
      : `<p style="font-size:13px;color:#666;">Link valid until: <strong>${escapeHtml(formatWhen(expiresAt, locale))}</strong></p>`
    : '';

  const ctaStyle =
    'display:inline-block;margin:8px 0 4px;padding:12px 22px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;';

  const subject = isPl
    ? 'Zaproszenie do Instant Project Studio'
    : 'You’re invited to Instant Project Studio';

  const html = isPl
    ? `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;color:#1f2937;max-width:560px;line-height:1.55;">
        <p style="margin:0 0 1rem;">Cześć${escapeHtml(greet)},</p>
        <p>zapraszamy Cię do <strong>Instant Project Studio</strong> — miejsca, w którym bezpiecznie przekażesz surowkę i materiały do projektu oraz będziesz na bieżąco z paczkami od studia.</p>
        ${projectLine}
        <p style="margin-bottom:0.35rem;"><strong>Co zyskujesz:</strong></p>
        <ul style="margin:0 0 1rem;padding-left:1.2rem;">
          <li>bezpieczny upload materiałów źródłowych,</li>
          <li>dostęp do dostarczonych paczek plików,</li>
          <li>możliwość dogrania brakujących materiałów w jednym miejscu.</li>
        </ul>
        <p style="margin-bottom:0.5rem;">Utwórz konto:</p>
        <p><a href="${safeUrl}" style="${ctaStyle}">Utwórz konto</a></p>
        <p style="font-size:12px;color:#6b7280;word-break:break-all;">${safeUrl}</p>
        ${expiresLine}
        <p>Link jest przeznaczony dla Ciebie — nie udostępniaj go osobom trzecim.</p>
        <p>Jeśli nie spodziewasz się tej wiadomości, zignoruj ją lub napisz do nas.</p>
        <p style="margin-top:1.5rem;">Pozdrawiamy,<br/>Zespół Instant Project Studio</p>
      </div>`
    : `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;color:#1f2937;max-width:560px;line-height:1.55;">
        <p style="margin:0 0 1rem;">Hi${escapeHtml(greet)},</p>
        <p>you’re invited to <strong>Instant Project Studio</strong> — a secure place to hand off raw footage and project assets, and to stay in sync with packages from the studio.</p>
        ${projectLine}
        <p style="margin-bottom:0.35rem;"><strong>What you get:</strong></p>
        <ul style="margin:0 0 1rem;padding-left:1.2rem;">
          <li>secure upload of source materials,</li>
          <li>access to delivered file packages,</li>
          <li>a single place to send any missing assets.</li>
        </ul>
        <p style="margin-bottom:0.5rem;">Create your account:</p>
        <p><a href="${safeUrl}" style="${ctaStyle}">Create account</a></p>
        <p style="font-size:12px;color:#6b7280;word-break:break-all;">${safeUrl}</p>
        ${expiresLine}
        <p>This link is for you — please don’t share it with others.</p>
        <p>If you didn’t expect this email, you can ignore it or reply to let us know.</p>
        <p style="margin-top:1.5rem;">Best regards,<br/>The Instant Project Studio team</p>
      </div>`;

  const text = isPl
    ? [
        `Cześć${greet},`,
        '',
        'zapraszamy Cię do Instant Project Studio — miejsca, w którym bezpiecznie przekażesz surowkę i materiały do projektu oraz będziesz na bieżąco z paczkami od studia.',
        project ? `Projekt: ${project}` : '',
        '',
        'Co zyskujesz:',
        '- bezpieczny upload materiałów źródłowych,',
        '- dostęp do dostarczonych paczek plików,',
        '- możliwość dogrania brakujących materiałów w jednym miejscu.',
        '',
        'Utwórz konto:',
        inviteUrl,
        '',
        'Link jest przeznaczony dla Ciebie — nie udostępniaj go osobom trzecim.',
        '',
        'Jeśli nie spodziewasz się tej wiadomości, zignoruj ją lub napisz do nas.',
        '',
        'Pozdrawiamy,',
        'Zespół Instant Project Studio',
      ]
        .filter((line) => line !== '')
        .join('\n')
    : [
        `Hi${greet},`,
        '',
        'you’re invited to Instant Project Studio — a secure place to hand off raw footage and project assets, and to stay in sync with packages from the studio.',
        project ? `Project: ${project}` : '',
        '',
        'What you get:',
        '- secure upload of source materials,',
        '- access to delivered file packages,',
        '- a single place to send any missing assets.',
        '',
        'Create your account:',
        inviteUrl,
        '',
        'This link is for you — please don’t share it with others.',
        '',
        'If you didn’t expect this email, you can ignore it or reply to let us know.',
        '',
        'Best regards,',
        'The Instant Project Studio team',
      ]
        .filter((line) => line !== '')
        .join('\n');

  await transporter.sendMail({
    from: inviteFromAddress(),
    to,
    subject,
    html,
    text,
  });

  return { ok: true };
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
