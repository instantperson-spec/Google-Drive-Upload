#!/usr/bin/env node
/** Patch prefillName/prefillEmail on an existing token in _uploader_tokens.json */
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tokenSlug = args.token;
  const prefillName = args.name;
  const prefillEmail = args.email;

  if (!tokenSlug || !prefillName || !prefillEmail) {
    throw new Error('Usage: --token=... --name="..." --email="..."');
  }

  const env = loadEnvFile(ENV_PATH);
  const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth2 });
  const mainFolderId = env.GOOGLE_DRIVE_FOLDER_ID;

  const list = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '${TOKEN_FILE_NAME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  const fileId = list.data.files?.[0]?.id;
  if (!fileId) throw new Error('Token registry not found.');

  const content = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  const registry = JSON.parse(content.data);
  const record = registry.tokens.find((t) => t.token === tokenSlug);
  if (!record) throw new Error(`Token "${tokenSlug}" not found.`);

  record.prefillName = prefillName.trim();
  record.prefillEmail = prefillEmail.trim();
  registry.updatedAt = new Date().toISOString();

  await drive.files.update({
    fileId,
    media: { mimeType: 'application/json', body: JSON.stringify(registry, null, 2) },
  });

  console.log(`✅ Prefill set on token "${tokenSlug}"`);
  console.log(`   Name:  ${record.prefillName}`);
  console.log(`   Email: ${record.prefillEmail}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
