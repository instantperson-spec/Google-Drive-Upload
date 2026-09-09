#!/usr/bin/env node
/**
 * CLI wrapper for OAuth scope diagnostic.
 * Usage: npm run check-oauth-scopes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runOAuthScopeCheck } from '../src/lib/checkOAuthScopes.js';

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

function printReport(report) {
  console.log('Drive Uploader — OAuth scope diagnostic\n');

  console.log('─'.repeat(60));
  console.log('Configuration');
  console.log('─'.repeat(60));
  console.log(`  · GOOGLE_CLIENT_ID: ${report.config.clientId}`);
  console.log(`  · GOOGLE_REFRESH_TOKEN: ${report.config.refreshToken}`);
  console.log(`  · GOOGLE_DRIVE_FOLDER_ID: ${report.config.mainFolderId || '(missing)'}`);

  console.log('\n' + '─'.repeat(60));
  console.log('Summary');
  console.log('─'.repeat(60));
  const icon = report.summary.level === 'ok' ? '✅' : report.summary.level === 'warn' ? '⚠️' : '❌';
  console.log(`  ${icon} ${report.summary.message}`);

  if (report.scopes.length) {
    console.log('\n  Granted scopes:');
    for (const s of report.scopes) {
      const prefix = s.status === 'error' ? '❌' : s.status === 'ok' ? '✅' : '·';
      console.log(`    ${prefix} ${s.scope}`);
    }
  }

  if (report.driveTests.length) {
    console.log('\n  Drive tests:');
    for (const t of report.driveTests) {
      console.log(`    ${t.passed ? '✅' : '❌'} ${t.name}${t.detail ? ` — ${t.detail}` : ''}${t.error ? ` — ${t.error}` : ''}`);
    }
  }

  console.log('');
}

async function main() {
  const fileEnv = loadEnvFile(ENV_PATH);
  const report = await runOAuthScopeCheck({
    clientId: fileEnv.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    clientSecret: fileEnv.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: fileEnv.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN,
    mainFolderId: fileEnv.GOOGLE_DRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID,
  });

  printReport(report);
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
