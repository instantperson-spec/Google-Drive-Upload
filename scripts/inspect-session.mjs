#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env.local');
const SESSION_ID = process.argv[2];

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

async function listAllFiles(drive, folderId) {
  const files = [];
  let pageToken = null;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, size, mimeType)',
      pageSize: 1000,
      pageToken,
    });
    if (res.data.files) files.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

async function main() {
  if (!SESSION_ID) {
    throw new Error('Usage: node scripts/inspect-session.mjs DRIVE_FOLDER_ID');
  }
  const env = loadEnvFile(ENV_PATH);
  const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const files = await listAllFiles(drive, SESSION_ID);
  const withSlash = files.filter((f) => f.name.includes('/'));
  const withoutSlash = files.filter((f) => !f.name.includes('/'));

  console.log(`Total: ${files.length}, with / in name: ${withSlash.length}, without: ${withoutSlash.length}`);
  console.log('\nSample with slash:');
  for (const f of withSlash.slice(0, 15)) {
    console.log(`  ${f.name} (${f.size})`);
  }
  console.log('\nSample without slash:');
  for (const f of withoutSlash.slice(0, 10)) {
    console.log(`  ${f.name} (${f.size})`);
  }

  const prefixes = new Set();
  for (const f of withSlash) {
    const parts = f.name.split('/');
    if (parts.length >= 2) prefixes.add(parts.slice(0, 2).join('/'));
  }
  console.log('\nTop-level prefixes (first 2 segments):');
  for (const p of [...prefixes].sort().slice(0, 20)) {
    console.log(`  ${p}`);
  }
}

main().catch(console.error);
