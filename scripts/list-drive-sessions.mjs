#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env.local');

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

function formatBytes(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '?';
  if (num >= 1e12) return `${(num / 1e12).toFixed(2)} TB`;
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)} GB`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)} MB`;
  return `${num} B`;
}

async function listFolderContents(drive, folderId, depth = 0) {
  const files = [];
  let pageToken = null;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, size, mimeType, modifiedTime)',
      pageSize: 1000,
      pageToken,
      orderBy: 'name',
    });
    if (res.data.files) files.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

async function main() {
  const env = loadEnvFile(ENV_PATH);
  const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth2 });
  const mainId = env.GOOGLE_DRIVE_FOLDER_ID;

  console.log('Main folder:', mainId);
  const sessions = await listFolderContents(drive, mainId);
  const folders = sessions.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');

  console.log(`\nSession folders (${folders.length}):\n`);
  for (const folder of folders) {
    const children = await listFolderContents(drive, folder.id);
    const fileChildren = children.filter((c) => c.mimeType !== 'application/vnd.google-apps.folder');
    const subfolders = children.filter((c) => c.mimeType === 'application/vnd.google-apps.folder');
    const totalSize = fileChildren.reduce((s, f) => s + Number(f.size || 0), 0);
    console.log(`  ${folder.name}`);
    console.log(`    id: ${folder.id}`);
    console.log(`    modified: ${folder.modifiedTime}`);
    console.log(`    flat files: ${fileChildren.length}, subfolders: ${subfolders.length}, size: ${formatBytes(totalSize)}`);
    if (fileChildren.length <= 5) {
      for (const f of fileChildren.slice(0, 5)) {
        console.log(`      · ${f.name} (${formatBytes(f.size)})`);
      }
    } else {
      for (const f of fileChildren.slice(0, 3)) {
        console.log(`      · ${f.name} (${formatBytes(f.size)})`);
      }
      console.log(`      … +${fileChildren.length - 3} more files`);
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
