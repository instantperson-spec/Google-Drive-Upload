#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const SESSION_ID = '1zDyGWHbw8Fh-7Zz1LBh56G82Rf72CJDr';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    let v = t.slice(eq + 1).trim();
    if (v.startsWith('"')) v = v.slice(1, -1);
    env[t.slice(0, eq).trim()] = v;
  }
  return env;
}

function fmt(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${n} B`;
}

async function listChildren(drive, folderId) {
  const items = [];
  let pt = null;
  do {
    const r = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id,name,size,mimeType,modifiedTime,createdTime)',
      pageSize: 1000,
      pageToken: pt,
      orderBy: 'modifiedTime desc',
    });
    items.push(...(r.data.files || []));
    pt = r.data.nextPageToken;
  } while (pt);
  return items;
}

async function main() {
  const env = loadEnv();
  const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const root = await listChildren(drive, SESSION_ID);
  const folders = root.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
  const flatFiles = root.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');

  console.log(`Session: Ciaran Carty (${SESSION_ID})\n`);
  console.log(`Subfolders: ${folders.map((f) => f.name).join(', ') || '(none)'}`);
  console.log(`Flat files in session ROOT (new uploads land here): ${flatFiles.length}\n`);

  if (flatFiles.length === 0) {
    console.log('No flat files in root — either still uploading first file, or nothing new yet.');
  } else {
    console.log('Most recently modified flat files:');
    for (const f of flatFiles.slice(0, 20)) {
      console.log(`  ${f.modifiedTime}  ${f.name}  (${fmt(Number(f.size || 0))})`);
    }
  }

  // Count stills in nested folder
  const master = folders.find((f) => f.name === 'Woodweb (Master)');
  if (master) {
    const stillsFolder = (await listChildren(drive, master.id)).find((f) => f.name === 'Stills');
    if (stillsFolder) {
      const stills = await listChildren(drive, stillsFolder.id);
      const files = stills.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
      console.log(`\nWoodweb (Master)/Stills: ${files.length} files`);
      const recent = files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)).slice(0, 8);
      for (const f of recent) {
        console.log(`  ${f.modifiedTime}  ${f.name}`);
      }
    }
  }
}

main().catch(console.error);
