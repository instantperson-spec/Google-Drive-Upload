#!/usr/bin/env node
/**
 * Create an upload token in Drive registry (_uploader_tokens.json).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env.local');
const TOKEN_FILE_NAME = '_uploader_tokens.json';
const TOKEN_SLUG_RE = /^[a-zA-Z0-9_-]{2,64}$/;

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

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      out[k] = v ?? true;
    }
  }
  return out;
}

function buildUploadUrl(origin, token) {
  return `${origin.replace(/\/$/, '')}/?token=${encodeURIComponent(token)}`;
}

async function readRegistry(drive, mainFolderId) {
  const res = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '${TOKEN_FILE_NAME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  const file = res.data.files?.[0];
  if (!file) {
    const envTokens = (process.env.UPLOAD_TOKENS || '').split(',').map((t) => t.trim()).filter(Boolean);
    const now = new Date().toISOString();
    return {
      registry: {
        version: 1,
        updatedAt: now,
        tokens: envTokens.map((token) => ({
          id: crypto.randomUUID(),
          token,
          clientName: token,
          type: 'retainer',
          notes: '',
          createdAt: now,
          expiresAt: null,
          revoked: false,
          revokedAt: null,
        })),
      },
      fileId: null,
    };
  }
  const content = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'text' });
  return { registry: JSON.parse(content.data), fileId: file.id };
}

async function saveRegistry(drive, mainFolderId, registry, fileId) {
  registry.updatedAt = new Date().toISOString();
  const body = JSON.stringify(registry, null, 2);
  if (fileId) {
    await drive.files.update({
      fileId,
      media: { mimeType: 'application/json', body },
    });
    return fileId;
  }
  const created = await drive.files.create({
    requestBody: {
      name: TOKEN_FILE_NAME,
      mimeType: 'application/json',
      parents: [mainFolderId],
    },
    media: { mimeType: 'application/json', body },
    fields: 'id',
  });
  return created.data.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnvFile(ENV_PATH);

  const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth2 });
  const mainFolderId = env.GOOGLE_DRIVE_FOLDER_ID;

  const token = args.token || `proj-${crypto.randomBytes(4).toString('hex')}`;
  const clientName = args.client || 'Client';
  const type = args.type === 'retainer' ? 'retainer' : 'one-time';
  const notes = args.notes || '';

  if (!TOKEN_SLUG_RE.test(token)) {
    throw new Error('Token must be 2–64 chars: letters, numbers, hyphen, underscore.');
  }

  const { registry, fileId } = await readRegistry(drive, mainFolderId);
  if (registry.tokens.some((t) => t.token === token && !t.revoked)) {
    throw new Error(`Token "${token}" already exists.`);
  }

  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    token,
    clientName,
    type,
    notes: String(notes).slice(0, 500),
    createdAt: now,
    expiresAt: null,
    revoked: false,
    revokedAt: null,
  };
  registry.tokens.push(record);
  await saveRegistry(drive, mainFolderId, registry, fileId);

  const origin = env.PUBLIC_UPLOAD_URL || 'https://drive-uploader-three.vercel.app';
  console.log('\n✅ Token created\n');
  console.log(`  Token:      ${record.token}`);
  console.log(`  Client:     ${record.clientName}`);
  console.log(`  Type:       ${record.type}`);
  console.log(`  Upload URL: ${buildUploadUrl(origin, record.token)}\n`);
  if (record.notes) console.log(`  Notes:      ${record.notes}\n`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
