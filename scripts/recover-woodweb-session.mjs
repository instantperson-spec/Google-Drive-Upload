#!/usr/bin/env node
/**
 * Recover Woodweb upload: flatten path-in-name → nested folders + missing-files report.
 *
 * Usage:
 *   node scripts/recover-woodweb-session.mjs [--dry-run|--apply] [--session-id=...]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { escapeDriveQueryLiteral } from '../src/lib/pathManifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env.local');
const INVENTORY_PATH = path.join(__dirname, 'data', 'woodweb-expected.json');
const REPORT_DIR = path.join(__dirname, '..', 'dokumentacja');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;
const SESSION_ID =
  args.find((a) => a.startsWith('--session-id='))?.split('=')[1] ||
  '1zDyGWHbw8Fh-7Zz1LBh56G82Rf72CJDr';

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
  if (num >= 1024 ** 4) return `${(num / 1024 ** 4).toFixed(2)} TB`;
  if (num >= 1024 ** 3) return `${(num / 1024 ** 3).toFixed(2)} GB`;
  if (num >= 1024 ** 2) return `${(num / 1024 ** 2).toFixed(1)} MB`;
  if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${num} B`;
}

async function listAllFiles(drive, folderId) {
  const files = [];
  let pageToken = null;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, size, mimeType, parents)',
      pageSize: 1000,
      pageToken,
    });
    if (res.data.files) files.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
}

async function findChildFolder(drive, parentId, name) {
  const escaped = escapeDriveQueryLiteral(name);
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    pageSize: 1,
    fields: 'files(id)',
  });
  return res.data.files?.[0]?.id ?? null;
}

async function createChildFolder(drive, parentId, name) {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });
  return res.data.id;
}

async function ensureFolderTree(drive, sessionFolderId, folderPaths) {
  const cache = { '': sessionFolderId };
  const sorted = [...folderPaths].sort((a, b) => a.split('/').length - b.split('/').length);

  for (const folderPath of sorted) {
    if (cache[folderPath]) continue;
    const parts = folderPath.split('/');
    let parentPath = '';
    let parentId = sessionFolderId;

    for (const part of parts) {
      const currentPath = parentPath ? `${parentPath}/${part}` : part;
      if (cache[currentPath]) {
        parentId = cache[currentPath];
        parentPath = currentPath;
        continue;
      }
      let folderId = DRY_RUN ? null : await findChildFolder(drive, parentId, part);
      if (!folderId && !DRY_RUN) {
        folderId = await createChildFolder(drive, parentId, part);
      }
      if (DRY_RUN) {
        folderId = `dry-${currentPath}`;
      }
      cache[currentPath] = folderId;
      parentId = folderId;
      parentPath = currentPath;
    }
  }
  return cache;
}

function sizeClose(a, b, tolerancePct = 0.02) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const diff = Math.abs(x - y);
  const tol = Math.max(64 * 1024, Math.max(x, y) * tolerancePct);
  return diff <= tol;
}

function baseSizeKey(basename) {
  return basename.toLowerCase();
}

function buildComparison(expected, driveFiles) {
  const expectedList = [...expected.entries, ...(expected.rootFiles || [])];
  const expectedMap = new Map(expectedList.map((e) => [e.relativePath, e]));

  const driveByPath = new Map(driveFiles.map((f) => [f.name, f]));
  const driveByBasename = new Map();
  for (const f of driveFiles) {
    const basename = f.name.split('/').pop();
    const key = baseSizeKey(basename);
    if (!driveByBasename.has(key)) driveByBasename.set(key, []);
    driveByBasename.get(key).push(f);
  }

  const matched = [];
  const missing = [];
  const sizeMismatch = [];
  const extraOnDrive = [];
  const usedDriveIds = new Set();

  for (const exp of expectedList) {
    const basename = exp.basename || exp.relativePath.split('/').pop();
    let onDrive = driveByPath.get(exp.relativePath);

    if (!onDrive) {
      const candidates = (driveByBasename.get(baseSizeKey(basename)) || [])
        .filter((f) => !usedDriveIds.has(f.id) && sizeClose(f.size, exp.size));
      if (candidates.length === 1) onDrive = candidates[0];
      else if (candidates.length > 1) {
        onDrive =
          candidates.find((f) => f.name === exp.relativePath) ||
          candidates.find((f) => f.name.endsWith(`/${basename}`)) ||
          candidates[0];
      }
    }

    if (!onDrive) {
      missing.push(exp);
      continue;
    }

    usedDriveIds.add(onDrive.id);
    const driveSize = Number(onDrive.size);
    const diff = Math.abs(driveSize - exp.size);
    const tolerance = Math.max(1024, exp.size * 0.001);
    if (diff > tolerance) {
      sizeMismatch.push({
        relativePath: exp.relativePath,
        drivePath: onDrive.name,
        expectedSize: exp.size,
        driveSize,
        sizeLabel: exp.sizeLabel,
      });
    }
    matched.push({
      expectedPath: exp.relativePath,
      drivePath: onDrive.name,
      size: driveSize,
      fileId: onDrive.id,
    });
  }

  for (const f of driveFiles) {
    if (usedDriveIds.has(f.id)) continue;
    if (f.name.endsWith('.DS_Store')) continue;
    extraOnDrive.push({ relativePath: f.name, size: Number(f.size), fileId: f.id });
  }

  const missingBytes = missing.reduce((s, m) => s + m.size, 0);
  const matchedBytes = matched.reduce((s, m) => s + m.size, 0);
  const expectedBytes = expectedList.reduce((s, e) => s + e.size, 0);

  return {
    matched,
    missing,
    sizeMismatch,
    extraOnDrive,
    stats: {
      expectedFiles: expectedList.length,
      onDriveFiles: driveFiles.length,
      matchedFiles: matched.length,
      missingFiles: missing.length,
      extraFiles: extraOnDrive.length,
      expectedBytes,
      matchedBytes,
      missingBytes,
      uploadedPct: ((matchedBytes / expectedBytes) * 100).toFixed(1),
    },
  };
}

function groupMissingByFolder(missing) {
  const groups = new Map();
  for (const item of missing) {
    const parts = item.relativePath.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '(root)';
    if (!groups.has(folder)) {
      groups.set(folder, { files: [], bytes: 0 });
    }
    const g = groups.get(folder);
    g.files.push(item);
    g.bytes += item.size;
  }
  return [...groups.entries()]
    .map(([folder, data]) => ({ folder, ...data, fileCount: data.files.length }))
    .sort((a, b) => b.bytes - a.bytes);
}

function writeReport(comparison, sessionName) {
  const date = new Date().toISOString().slice(0, 10);
  const mdPath = path.join(REPORT_DIR, `raport_brakow_woodweb_${date}.md`);
  const jsonPath = path.join(REPORT_DIR, `raport_brakow_woodweb_${date}.json`);

  const { stats, missing, sizeMismatch, extraOnDrive } = comparison;
  const byFolder = groupMissingByFolder(missing);

  let md = `# Raport braków — Woodweb (T7 Drive 02)\n\n`;
  md += `**Sesja Drive:** ${sessionName}\n`;
  md += `**Data raportu:** ${new Date().toISOString()}\n\n`;
  md += `## Podsumowanie\n\n`;
  md += `| Metryka | Wartość |\n|---------|--------|\n`;
  md += `| Oczekiwane pliki (z PDF) | ${stats.expectedFiles} (${formatBytes(stats.expectedBytes)}) |\n`;
  md += `| Wgrane na Drive (płasko) | ${stats.onDriveFiles} |\n`;
  md += `| Dopasowane (nazwa + ścieżka) | ${stats.matchedFiles} (${formatBytes(stats.matchedBytes)}) |\n`;
  md += `| **Brakuje do dosłania** | **${stats.missingFiles} (${formatBytes(stats.missingBytes)})** |\n`;
  md += `| Ukończenie (po wielkości) | ${stats.uploadedPct}% |\n`;
  md += `| Pliki tylko na Drive (extra) | ${stats.extraFiles} |\n`;
  md += `| Rozbieżności rozmiaru | ${sizeMismatch.length} |\n\n`;

  md += `## Braki wg folderu (do dosłania przez klienta)\n\n`;
  md += `| Folder | Plików | Brakujący rozmiar |\n|--------|--------|------------------|\n`;
  for (const g of byFolder.slice(0, 40)) {
    md += `| \`${g.folder}\` | ${g.fileCount} | ${formatBytes(g.bytes)} |\n`;
  }
  if (byFolder.length > 40) {
    md += `\n_… i ${byFolder.length - 40} kolejnych folderów (szczegóły w JSON)._\n`;
  }

  md += `\n## Pliki spoza inwentarza PDF (wgrane, ale nie na liście)\n\n`;
  if (extraOnDrive.length === 0) {
    md += `_Brak._\n`;
  } else {
    for (const e of extraOnDrive.slice(0, 30)) {
      md += `- \`${e.relativePath}\` (${formatBytes(e.size)})\n`;
    }
    if (extraOnDrive.length > 30) {
      md += `\n_… +${extraOnDrive.length - 30} plików._\n`;
    }
  }

  md += `\n## Lista brakujących plików (pełna)\n\n`;
  md += `<details><summary>Rozwiń ${missing.length} pozycji</summary>\n\n`;
  for (const m of missing) {
    md += `- \`${m.relativePath}\` — ${m.sizeLabel || formatBytes(m.size)}\n`;
  }
  md += `\n</details>\n`;

  md += `\n## Pliki spoza dysku źródłowego (root T7, nie w Woodweb Master)\n\n`;
  md += `Te 3 pliki były w korzeniu dysku T7 i **nie zostały** wgrane:\n\n`;
  for (const r of comparison.rootFilesNote || []) {
    md += `- \`${r.relativePath}\` — ${r.sizeLabel}\n`;
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ sessionName, generatedAt: new Date().toISOString(), ...comparison }, null, 2)
  );

  console.log(`\nReport: ${mdPath}`);
  console.log(`JSON:   ${jsonPath}`);
  return mdPath;
}

async function reorganizeFiles(drive, sessionFolderId, driveFiles) {
  const pathFiles = driveFiles.filter((f) => f.name.includes('/'));
  const folderPaths = new Set();

  for (const f of pathFiles) {
    const parts = f.name.split('/');
    if (parts.length > 1) {
      folderPaths.add(parts.slice(0, -1).join('/'));
    }
  }

  console.log(`\nReorganize: ${pathFiles.length} files → ${folderPaths.size} folder paths`);
  const folderCache = await ensureFolderTree(drive, sessionFolderId, folderPaths);

  let moved = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of pathFiles) {
    const parts = file.name.split('/');
    const basename = parts.pop();
    const parentPath = parts.join('/');
    const targetFolderId = folderCache[parentPath];

    if (!targetFolderId || targetFolderId.startsWith('dry-run-')) {
      if (DRY_RUN) {
        moved += 1;
        continue;
      }
      console.error(`No target folder for ${file.name}`);
      errors += 1;
      continue;
    }

    if (DRY_RUN) {
      moved += 1;
      continue;
    }

    try {
      await drive.files.update({
        fileId: file.id,
        addParents: targetFolderId,
        removeParents: sessionFolderId,
        requestBody: { name: basename },
        fields: 'id, name, parents',
      });
      moved += 1;
      if (moved % 25 === 0) {
        console.log(`  … moved ${moved}/${pathFiles.length}`);
      }
    } catch (err) {
      console.error(`Failed ${file.name}: ${err.message}`);
      errors += 1;
    }
  }

  const noPath = driveFiles.filter((f) => !f.name.includes('/'));
  skipped = noPath.length;

  return { moved, skipped, errors, folders: folderPaths.size };
}

async function main() {
  const env = loadEnvFile(ENV_PATH);
  const expected = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));

  const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const sessionMeta = await drive.files.get({
    fileId: SESSION_ID,
    fields: 'id, name',
  });
  const sessionName = sessionMeta.data.name;

  console.log(`Session: ${sessionName} (${SESSION_ID})`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);

  const driveFiles = await listAllFiles(drive, SESSION_ID);
  const comparison = buildComparison(expected, driveFiles);
  comparison.rootFilesNote = expected.rootFiles;

  console.log('\nComparison:');
  console.log(`  Expected: ${comparison.stats.expectedFiles} files (${formatBytes(comparison.stats.expectedBytes)})`);
  console.log(`  On Drive: ${comparison.stats.onDriveFiles} files`);
  console.log(`  Matched:  ${comparison.stats.matchedFiles} (${comparison.stats.uploadedPct}%)`);
  console.log(`  Missing:  ${comparison.stats.missingFiles} (${formatBytes(comparison.stats.missingBytes)})`);

  writeReport(comparison, sessionName);

  const reorg = await reorganizeFiles(drive, SESSION_ID, driveFiles);
  console.log(`\nReorganize result: moved=${reorg.moved}, skipped=${reorg.skipped}, errors=${reorg.errors}, folders=${reorg.folders}`);

  if (DRY_RUN) {
    console.log('\nRun with --apply to execute moves on Google Drive.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
