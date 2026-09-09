#!/usr/bin/env node
/** List upload tokens from _uploader_tokens.json on Drive (names/status only). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env.local');
const TOKEN_FILE_NAME = '_uploader_tokens.json';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

async function main() {
  const env = loadEnvFile(ENV_PATH);
  const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth2 });
  const mainFolderId = env.GOOGLE_DRIVE_FOLDER_ID;

  const res = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '${TOKEN_FILE_NAME}' and trashed = false`,
    fields: 'files(id, modifiedTime, webViewLink)',
    pageSize: 1,
  });
  const file = res.data.files?.[0];
  if (!file) {
    console.log('Brak pliku _uploader_tokens.json na Drive.');
    return;
  }

  const content = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'text' });
  const registry = JSON.parse(content.data);
  const origin = env.PUBLIC_UPLOAD_URL || 'https://drive-uploader-three.vercel.app';
  const now = Date.now();

  console.log(`Plik: ${TOKEN_FILE_NAME}`);
  console.log(`Drive file ID: ${file.id}`);
  console.log(`Folder uploadów ID: ${mainFolderId}`);
  console.log(`Ostatnia modyfikacja: ${file.modifiedTime}`);
  console.log(`Registry updatedAt: ${registry.updatedAt}`);
  console.log(`Liczba tokenów: ${registry.tokens.length}\n`);

  for (const t of registry.tokens) {
    let status = 'active';
    if (t.revoked) status = 'revoked';
    else if (t.expiresAt && new Date(t.expiresAt).getTime() < now) status = 'expired';

    console.log(`---`);
    console.log(`Token:      ${t.token}`);
    console.log(`Klient:     ${t.clientName}`);
    console.log(`Typ:        ${t.type}`);
    console.log(`Status:     ${status}`);
    console.log(`Utworzony:  ${t.createdAt}`);
    if (t.prefillName) console.log(`Prefill:    ${t.prefillName} <${t.prefillEmail}>`);
    if (t.notes) console.log(`Notatki:    ${t.notes}`);
    console.log(`Link:       ${origin.replace(/\/$/, '')}/?token=${encodeURIComponent(t.token)}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
