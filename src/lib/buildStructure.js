import { google } from 'googleapis';
import {
  collectFolderPaths,
  escapeDriveQueryLiteral,
  manifestNeedsStructure,
} from '@/lib/pathManifest';

const MANIFEST_FILENAME = '_manifest.json';

async function listAllFilesInFolder(drive, folderId) {
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

/**
 * Ensure folder path exists under sessionFolderId. Returns map path -> folderId.
 */
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
    throw new Error(`Ambiguous match for "${uploadName}" (${size} bytes) — duplicate flat names on Drive.`);
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

/**
 * Rebuild nested folder structure inside a session folder after flat upload.
 * @param {import('google-auth-library').OAuth2Client} authClient
 * @param {string} sessionFolderId
 * @param {Array<{ uploadName: string, relativePath: string, size: number }>} entries
 */
export async function buildSessionStructure(authClient, sessionFolderId, entries) {
  const drive = google.drive({ version: 'v3', auth: authClient });
  const needsStructure = manifestNeedsStructure(entries);

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

  if (!needsStructure) {
    await writeManifestFile(drive, sessionFolderId, manifest);
    return {
      ok: true,
      skipped: true,
      message: 'All files are in session root — no subfolders to build.',
      stats: manifest.stats,
    };
  }

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
    manifest.stats.filesMoved += 1;
  }

  if (manifest.stats.unmatched.length) {
    await writeManifestFile(drive, sessionFolderId, manifest);
    return {
      ok: false,
      message: `${manifest.stats.unmatched.length} file(s) could not be matched on Drive.`,
      stats: manifest.stats,
    };
  }

  await writeManifestFile(drive, sessionFolderId, manifest);
  return {
    ok: true,
    skipped: false,
    message: `Moved ${manifest.stats.filesMoved} file(s) into ${folderPaths.length} folder path(s).`,
    stats: manifest.stats,
  };
}
