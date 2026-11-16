import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { getActiveShare } from '@/lib/shareStore';
import { getTokenRecord } from '@/lib/tokenStore';
import { rateLimit } from '@/lib/rateLimit';
import { DEFAULT_LOCALE, normalizeLocale } from '@/lib/locales';
import en from '@/i18n/en.json';
import pl from '@/i18n/pl.json';

const MESSAGES = { en, pl };
const MAX_FILES = 200;
const MAX_NAME = 200;

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function resolvePath(obj, path) {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

function t(locale, key, vars = {}) {
  const primary = MESSAGES[normalizeLocale(locale)] ?? MESSAGES.en;
  let out = resolvePath(primary, key) ?? resolvePath(MESSAGES.en, key) ?? key;
  if (typeof out !== 'string') return key;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

function formatMb(size) {
  return `${(Number(size) / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * After client top-up via /share portal (FromClient/).
 * Always notify studio (NOTIFICATION_EMAIL). Client summary only if token has prefillEmail.
 */
export async function POST(request, { params }) {
  const limited = rateLimit(request, 'share-notify-topup', 10);
  if (limited) return limited;

  try {
    const { id } = await params;
    const share = await getActiveShare(id);
    if (!share) {
      return NextResponse.json({ error: 'Share not found or revoked.' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.files) || body.files.length === 0 || body.files.length > MAX_FILES) {
      return NextResponse.json({ error: 'Invalid files payload' }, { status: 400 });
    }

    const files = body.files.map((f) => ({
      name: String(f?.name || 'unnamed').slice(0, MAX_NAME),
      size: Number(f?.size) || 0,
      status: f?.status === 'completed' ? 'completed' : 'incomplete',
    }));

    const batchId = String(body.batchId || '').trim().slice(0, 64);
    const batchLabel = (() => {
      if (!batchId) return '';
      const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})__/.exec(batchId);
      if (m) return `${m[1]} ${m[2]}:${m[3]} (${batchId})`;
      return batchId;
    })();

    const projectLabel = String(
      body.label || share.label || 'Project'
    ).slice(0, 120);

    let tokenRecord = null;
    if (share.token) {
      try {
        tokenRecord = await getTokenRecord(share.token);
      } catch {
        tokenRecord = null;
      }
    }

    const clientName =
      String(
        tokenRecord?.clientName ||
          tokenRecord?.prefillName ||
          share.token ||
          'Client'
      ).slice(0, 200);
    const clientEmail = String(tokenRecord?.prefillEmail || '').trim();
    const locale = normalizeLocale(tokenRecord?.locale || DEFAULT_LOCALE);
    const folderId = share.folderId || '';
    const folderLink = folderId
      ? `https://drive.google.com/drive/folders/${folderId}`
      : '';

    const filesListText = files
      .map((f) => `- \`${f.name}\` (${formatMb(f.size)})`)
      .join('\n');
    const filesListHtml = files
      .map(
        (f) =>
          `<li><strong>${escapeHtml(f.name)}</strong> (${formatMb(f.size)})</li>`
      )
      .join('');

    const webhookUrl = process.env.WEBHOOK_URL;
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `📎 **Portal top-up (FromClient)**\nProject: \`${projectLabel}\`\nClient: \`${clientName}\`${clientEmail ? ` (${clientEmail})` : ''}${batchLabel ? `\nBatch: \`${batchLabel}\`` : ''}\nFiles:\n${filesListText}`,
        }),
      }).catch((err) => console.error('Webhook top-up error:', err));
    }

    const result = {
      ok: true,
      studio: false,
      client: false,
      skippedClient: clientEmail ? null : 'no_prefillEmail',
    };

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return NextResponse.json({
        ...result,
        skipped: 'no_smtp',
      });
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

    // 1) Always notify studio — you want to know client sent new versions
    if (process.env.NOTIFICATION_EMAIL) {
      await transporter
        .sendMail({
          from,
          to: process.env.NOTIFICATION_EMAIL,
          subject: batchLabel
            ? `📎 ${projectLabel} — portal batch ${batchLabel}`
            : `📎 ${projectLabel} — new files from client (portal)`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333;">
              <h2 style="color: #0056b3;">Client added files via project portal</h2>
              <p><strong>Project:</strong> ${escapeHtml(projectLabel)}</p>
              <p><strong>Client:</strong> ${escapeHtml(clientName)}${
                clientEmail
                  ? ` (<a href="mailto:${escapeHtml(clientEmail)}">${escapeHtml(clientEmail)}</a>)`
                  : ' — <em>no email on token</em>'
              }</p>
              ${
                batchLabel
                  ? `<p><strong>Batch:</strong> <code>${escapeHtml(batchLabel)}</code> → <code>FromClient/${escapeHtml(batchId)}/</code></p>`
                  : '<p>Files landed in <code>FromClient/</code> on Drive.</p>'
              }
              <p>Pull them in Studio Console (per batch or all).</p>
              <h3 style="margin-top: 20px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Files (${files.length}):</h3>
              <ul style="padding-left: 20px;">${filesListHtml}</ul>
              ${
                folderLink
                  ? `<a href="${folderLink}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0056b3;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Open folder in Google Drive</a>`
                  : ''
              }
            </div>
          `,
          text: `${projectLabel} — portal top-up from ${clientName}${batchLabel ? `\nBatch: ${batchLabel}\nPath: FromClient/${batchId}/` : ''}\n\n${filesListText}\n${folderLink ? `\n${folderLink}\n` : ''}`,
        })
        .then(() => {
          result.studio = true;
        })
        .catch((err) => console.error('Studio top-up email error:', err));
    } else {
      result.skippedStudio = 'no_NOTIFICATION_EMAIL';
    }

    // 2) Optional client confirmation — same idea as upload summary, only if email on token
    if (clientEmail) {
      const successFiles = files.filter((f) => f.status === 'completed');
      const successListHtml =
        successFiles.length > 0
          ? `<ul style="padding-left: 20px;">${successFiles
              .map(
                (f) =>
                  `<li><strong>${escapeHtml(f.name)}</strong> (${formatMb(f.size)})</li>`
              )
              .join('')}</ul>`
          : `<p>${escapeHtml(t(locale, 'share.mailTopupNone'))}</p>`;

      await transporter
        .sendMail({
          from,
          to: clientEmail,
          subject: t(locale, 'share.mailTopupSubject', {
            count: successFiles.length,
            project: projectLabel,
          }),
          html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; border: 1px solid #eee; border-radius: 8px;">
              <h2 style="color: #4ade80; margin-top: 0;">${escapeHtml(t(locale, 'share.mailTopupHeading'))}</h2>
              <p>${escapeHtml(t(locale, 'share.mailTopupHello', { name: clientName }))}</p>
              <p>${escapeHtml(t(locale, 'share.mailTopupBody'))}</p>
              <h3 style="margin-top: 20px; color: #0056b3; border-bottom: 1px solid #ddd; padding-bottom: 5px;">
                ${escapeHtml(t(locale, 'share.mailTopupListTitle', { count: successFiles.length }))}
              </h3>
              ${successListHtml}
              <p style="margin-top: 40px; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 10px;">
                ${escapeHtml(t(locale, 'share.mailTopupFooter'))}
              </p>
            </div>
          `,
        })
        .then(() => {
          result.client = true;
          result.skippedClient = null;
        })
        .catch((err) => console.error('Client top-up email error:', err));
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('share notify-topup error:', err.message || err);
    return NextResponse.json(
      { error: err.message || 'Failed to send notification' },
      { status: 500 }
    );
  }
}
