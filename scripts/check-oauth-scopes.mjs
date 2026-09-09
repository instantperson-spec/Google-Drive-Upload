#!/usr/bin/env node
/**
 * Diagnose OAuth refresh-token scopes and basic Drive API access.
 *
 * Usage:
 *   npm run check-oauth-scopes
 *
 * Reads .env.local from project root (GOOGLE_* vars).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.local');

const RECOMMENDED = 'https://www.googleapis.com/auth/drive.file';
const BROAD_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.readonly',
];

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

function mask(value, visible = 6) {
  if (!value) return '(missing)';
  if (value.length <= visible * 2) return '***';
  return `${value.slice(0, visible)}…${value.slice(-4)}`;
}

function printHeader(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(title);
  console.log('─'.repeat(60));
}

function ok(msg) {
  console.log(`  ✅ ${msg}`);
}

function warn(msg) {
  console.log(`  ⚠️  ${msg}`);
}

function fail(msg) {
  console.log(`  ❌ ${msg}`);
}

function info(msg) {
  console.log(`  · ${msg}`);
}

async function fetchTokenInfo(accessToken) {
  const url = `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `tokeninfo HTTP ${res.status}`);
  }
  return data;
}

async function runDriveTests(authClient, mainFolderId) {
  const drive = google.drive({ version: 'v3', auth: authClient });
  const results = [];

  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, passed: true });
    } catch (err) {
      results.push({ name, passed: false, error: err.message || String(err) });
    }
  }

  await test('Read main upload folder metadata', async () => {
    const res = await drive.files.get({
      fileId: mainFolderId,
      fields: 'id, name, mimeType, ownedByMe',
    });
    if (res.data.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error('GOOGLE_DRIVE_FOLDER_ID is not a folder');
    }
    info(`Folder: "${res.data.name}" (ownedByMe: ${res.data.ownedByMe ?? 'unknown'})`);
  });

  await test('List session folders in main folder', async () => {
    const res = await drive.files.list({
      q: `'${mainFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      pageSize: 3,
      fields: 'files(id, name)',
    });
    info(`Found ${res.data.files?.length ?? 0} subfolder(s) (sample, max 3)`);
  });

  await test('List files inside main folder', async () => {
    const res = await drive.files.list({
      q: `'${mainFolderId}' in parents and trashed = false`,
      pageSize: 3,
      fields: 'files(id, name, mimeType)',
    });
    info(`Found ${res.data.files?.length ?? 0} item(s) in root (sample, max 3)`);
  });

  await test('Read _uploader_tokens.json (token registry)', async () => {
    const res = await drive.files.list({
      q: `'${mainFolderId}' in parents and name = '_uploader_tokens.json' and trashed = false`,
      pageSize: 1,
      fields: 'files(id, name)',
    });
    if (!res.data.files?.length) {
      info('Registry file not created yet (normal before first /admin token load)');
      return;
    }
    info('Registry file accessible');
  });

  return results;
}

async function main() {
  console.log('Drive Uploader — OAuth scope diagnostic\n');

  const env = { ...process.env, ...loadEnvFile(ENV_PATH) };

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;
  const mainFolderId = env.GOOGLE_DRIVE_FOLDER_ID;

  printHeader('Configuration');
  info(`Env file: ${fs.existsSync(ENV_PATH) ? '.env.local ✓' : '.env.local missing — using process.env only'}`);
  info(`GOOGLE_CLIENT_ID: ${mask(clientId)}`);
  info(`GOOGLE_CLIENT_SECRET: ${mask(clientSecret)}`);
  info(`GOOGLE_REFRESH_TOKEN: ${mask(refreshToken, 8)}`);
  info(`GOOGLE_DRIVE_FOLDER_ID: ${mainFolderId || '(missing)'}`);

  if (!clientId || !clientSecret || !refreshToken) {
    fail('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN');
    process.exit(1);
  }

  if (!mainFolderId) {
    warn('GOOGLE_DRIVE_FOLDER_ID not set — Drive tests will be skipped');
  }

  printHeader('Refresh token → access token');
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  let accessToken;
  try {
    const { token } = await oauth2.getAccessToken();
    if (!token) throw new Error('No access token returned');
    accessToken = token;
    ok('Access token obtained from refresh token');
  } catch (err) {
    fail(`Failed to refresh access token: ${err.message}`);
    info('Check credentials or regenerate refresh token in OAuth Playground');
    process.exit(1);
  }

  printHeader('Token scopes (tokeninfo)');
  let tokenInfo;
  try {
    tokenInfo = await fetchTokenInfo(accessToken);
  } catch (err) {
    fail(`tokeninfo failed: ${err.message}`);
    process.exit(1);
  }

  const scopes = (tokenInfo.scope || '').split(' ').filter(Boolean);
  info(`Expires in: ${tokenInfo.expires_in}s`);
  info(`Audience: ${tokenInfo.audience || tokenInfo.issued_to || 'n/a'}`);

  if (scopes.length === 0) {
    warn('No scopes returned by tokeninfo');
  } else {
    console.log('\n  Granted scopes:');
    for (const s of scopes) {
      const isBroad = BROAD_SCOPES.includes(s);
      const isRecommended = s === RECOMMENDED;
      const prefix = isBroad ? '❌' : isRecommended ? '✅' : '·';
      console.log(`    ${prefix} ${s}`);
    }
  }

  printHeader('Assessment (VULN-05)');
  const hasDriveFull = scopes.includes('https://www.googleapis.com/auth/drive');
  const hasDriveFile = scopes.includes(RECOMMENDED);

  if (hasDriveFull) {
    fail('FULL Drive scope detected — access to entire Google Drive account');
    info('Regenerate refresh token with ONLY drive.file in OAuth Playground');
  } else {
    ok('No full https://www.googleapis.com/auth/drive scope');
  }

  if (hasDriveFile) {
    ok('Recommended drive.file scope is present');
  } else if (!hasDriveFull) {
    warn('drive.file scope not found — verify scopes match app requirements');
  }

  const otherBroad = scopes.filter((s) => BROAD_SCOPES.includes(s) && s !== 'https://www.googleapis.com/auth/drive');
  if (otherBroad.length) {
    warn(`Other broad scopes: ${otherBroad.join(', ')}`);
  }

  if (mainFolderId) {
    printHeader('Drive API smoke tests');
    const authClient = oauth2;
    const results = await runDriveTests(authClient, mainFolderId);

    for (const r of results) {
      if (r.passed) ok(r.name);
      else fail(`${r.name}: ${r.error}`);
    }

    const allPassed = results.every((r) => r.passed);
    printHeader('Summary');
    if (hasDriveFull) {
      fail('Action required: regenerate refresh token with drive.file only');
    } else if (hasDriveFile && allPassed) {
      ok('Scopes look good and Drive operations pass — safe to use drive.file-only token');
    } else if (hasDriveFile && !allPassed) {
      warn('drive.file is present but some Drive tests failed');
      info('Folder may not be owned by OAuth account, or token lacks required access');
    } else {
      warn('Review scopes and test results before maintenance window deploy');
    }
  } else {
    printHeader('Summary');
    if (hasDriveFull) {
      fail('Action required: regenerate refresh token with drive.file only');
    } else if (hasDriveFile) {
      ok('drive.file scope present (set GOOGLE_DRIVE_FOLDER_ID to run Drive tests)');
    }
  }

  console.log('');
  process.exit(hasDriveFull ? 1 : 0);
}

main().catch((err) => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
