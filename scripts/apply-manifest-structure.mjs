#!/usr/bin/env node
/**
 * Move flat files in a session folder into nested paths per PDF inventory.
 * Uses Drive file sizes (not PDF SI sizes) for matching.
 *
 * Usage:
 *   node scripts/apply-manifest-structure.mjs SESSION_FOLDER_ID [inventory.json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env.local');
const DEFAULT_INVENTORY = path.join(__dirname, '..', '.tmp-inventory.json');
const MANIFEST_FILENAME = '_manifest.json';

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

function escapeDriveQueryLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function collectFolderPaths(entries) {
  const paths = new Set();
  for (const { relativePath } of entries) {
    const parts = relativePath.split('/');
    if (parts.length <= 1) continue;
    for (let i = 1; i < parts.length; i += 1) {
      paths.add(parts.slice(0, i).join('/'));
    }
  }
  return [...paths].sort((a, b) => a.split('/').length - b.split('/').length);
}

async function listAllFilesInFolder(drive, folderId) {
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
  return files;
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

  for (const folderPath of folderPaths) {
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

      let folderId = await findChildFolder(drive, parentId, part);
      if (!folderId) {
        folderId = await createChildFolder(drive, parentId, part);
        console.log(`  Created folder: ${currentPath}`);
      }

      cache[currentPath] = folderId;
      parentId = folderId;
      parentPath = currentPath;
    }
  }

  return cache;
}

function matchDriveFile(flatFiles, uploadName, size) {
  const matches = flatFiles.filter(
    (f) =>
      f.mimeType !== 'application/vnd.google-apps.folder' &&
      f.name === uploadName &&
      Number(f.size) === size
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Ambiguous match for "${uploadName}" (${size} bytes).`);
  }
  return null;
}

async function writeManifestFile(drive, sessionFolderId, manifest) {
  const content = JSON.stringify(manifest, null, 2);
  const existing = await drive.files.list({
    q: `'${sessionFolderId}' in parents and name = '${MANIFEST_FILENAME}' and trashed = false`,
    pageSize: 1,
    fields: 'files(id)',
  });

  if (existing.data.files?.length) {
    await drive.files.update({
      fileId: existing.data.files[0].id,
      media: { mimeType: 'application/json', body: content },
    });
    return existing.data.files[0].id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: MANIFEST_FILENAME,
      mimeType: 'application/json',
      parents: [sessionFolderId],
    },
    media: { mimeType: 'application/json', body: content },
    fields: 'id',
  });
  return created.data.id;
}

function buildInventoryIndex(inventory) {
  const byName = new Map();
  const all = [
    ...inventory.entries,
    ...inventory.rootFiles.map((r) => ({ ...r, basename: r.relativePath })),
  ];
  for (const entry of all) {
    const basename = entry.basename || entry.relativePath.split('/').pop();
    if (!byName.has(basename)) byName.set(basename, entry);
  }
  return byName;
}

function buildEntriesForFlatFiles(flatFiles, inventoryIndex) {
  const entries = [];
  const missing = [];

  for (const file of flatFiles) {
    if (file.mimeType === 'application/vnd.google-apps.folder') continue;
    const inv = inventoryIndex.get(file.name);
    if (!inv) {
      missing.push(file.name);
      continue;
    }
    entries.push({
      uploadName: file.name,
      relativePath: inv.relativePath,
      size: Number(file.size),
    });
  }

  return { entries, missing };
}

async function buildSessionStructure(drive, sessionFolderId, entries) {
  const manifest = {
    version: 1,
    builtAt: new Date().toISOString(),
    sessionFolderId,
    entries,
    stats: {
      foldersCreated: 0,
      filesMoved: 0,
      filesSkipped: 0,
      unmatched: [],
    },
  };

  const flatFiles = await listAllFilesInFolder(drive, sessionFolderId);
  const folderPaths = collectFolderPaths(entries);
  const folderCache = await ensureFolderTree(drive, sessionFolderId, folderPaths);

  for (const entry of entries) {
    const parts = entry.relativePath.split('/');
    if (parts.length <= 1) {
      manifest.stats.filesSkipped += 1;
      continue;
    }

    const driveFile = matchDriveFile(flatFiles, entry.uploadName, entry.size);
    if (!driveFile) {
      manifest.stats.unmatched.push(entry.uploadName);
      continue;
    }

    const parentPath = parts.slice(0, -1).join('/');
    const targetFolderId = folderCache[parentPath];
    if (!targetFolderId) {
      manifest.stats.unmatched.push(entry.uploadName);
      continue;
    }

    if (driveFile.parents?.includes(targetFolderId)) {
      manifest.stats.filesSkipped += 1;
      continue;
    }

    await drive.files.update({
      fileId: driveFile.id,
      addParents: targetFolderId,
      removeParents: sessionFolderId,
      fields: 'id, parents',
    });
    console.log(`  Moved: ${entry.uploadName} → ${entry.relativePath}`);
    manifest.stats.filesMoved += 1;
  }

  await writeManifestFile(drive, sessionFolderId, manifest);

  return {
    ok: manifest.stats.unmatched.length === 0,
    message:
      manifest.stats.unmatched.length === 0
        ? `Moved ${manifest.stats.filesMoved} file(s) into ${folderPaths.length} folder path(s).`
        : `${manifest.stats.unmatched.length} file(s) could not be matched.`,
    stats: manifest.stats,
  };
}

async function main() {
  const sessionFolderId = process.argv[2];
  const inventoryPath = process.argv[3] || DEFAULT_INVENTORY;

  if (!sessionFolderId) {
    throw new Error('Usage: node scripts/apply-manifest-structure.mjs SESSION_FOLDER_ID [inventory.json]');
  }
  if (!fs.existsSync(inventoryPath)) {
    throw new Error(`Inventory not found: ${inventoryPath}`);
  }

  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const inventoryIndex = buildInventoryIndex(inventory);

  const env = loadEnvFile(ENV_PATH);
  const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const flatFiles = await listAllFilesInFolder(drive, sessionFolderId);
  const flatOnly = flatFiles.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
  console.log(`Session ${sessionFolderId}: ${flatOnly.length} flat file(s) in root`);

  const { entries, missing } = buildEntriesForFlatFiles(flatOnly, inventoryIndex);
  if (missing.length) {
    console.warn('Not in PDF inventory:', missing.join(', '));
  }
  console.log(`Building structure for ${entries.length} file(s)...`);

  const result = await buildSessionStructure(drive, sessionFolderId, entries);
  console.log(result.message);
  console.log(JSON.stringify(result.stats, null, 2));

  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
