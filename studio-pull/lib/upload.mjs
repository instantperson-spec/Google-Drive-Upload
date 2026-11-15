/**
 * Upload / replace files into a Drive session folder (studio OAuth).
 */
import fs from 'fs';
import path from 'path';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mxf': 'application/mxf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
};

function guessMime(fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/** Cache: `${parentId}::${name}` → folderId */
const folderCache = new Map();

async function findChildFolder(drive, parentId, name) {
  const key = `${parentId}::${name}`;
  if (folderCache.has(key)) return folderCache.get(key);

  const escaped = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const id = res.data.files?.[0]?.id || null;
  if (id) folderCache.set(key, id);
  return id;
}

async function ensureFolder(drive, parentId, name) {
  const existing = await findChildFolder(drive, parentId, name);
  if (existing) return existing;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  const id = created.data.id;
  folderCache.set(`${parentId}::${name}`, id);
  return id;
}

/**
 * Ensure nested folders for relativePath; return parent folder id for the file.
 */
export async function ensureParentFolders(drive, rootFolderId, relativePath) {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 1) return rootFolderId;

  let parent = rootFolderId;
  for (let i = 0; i < parts.length - 1; i += 1) {
    parent = await ensureFolder(drive, parent, parts[i]);
  }
  return parent;
}

/**
 * Upload one local file into Drive (create or replace by id).
 */
export async function uploadLocalFile(drive, item, rootFolderId, options = {}) {
  const { onProgress } = options;
  const mimeType = guessMime(item.name);
  const size = item.size;
  const body = fs.createReadStream(item.localPath);

  if (item.driveId && item.action === 'replace') {
    onProgress?.({ phase: 'start', mode: 'replace' });
    await drive.files.update({
      fileId: item.driveId,
      media: { mimeType, body },
      supportsAllDrives: true,
    });
    onProgress?.({ phase: 'done', mode: 'replace' });
    return { id: item.driveId, action: 'replace' };
  }

  const parentId = await ensureParentFolders(drive, rootFolderId, item.relativePath);
  onProgress?.({ phase: 'start', mode: 'create' });
  const created = await drive.files.create({
    requestBody: {
      name: item.name,
      parents: [parentId],
    },
    media: { mimeType, body },
    fields: 'id',
    supportsAllDrives: true,
  });
  onProgress?.({ phase: 'done', mode: 'create' });
  return { id: created.data.id, action: 'create' };
}

/**
 * Upload a list of planned files with cancel support.
 */
export async function uploadFiles(drive, items, rootFolderId, options = {}) {
  const { shouldCancel, onEvent } = options;
  const stats = { uploaded: 0, skipped: 0, failed: 0, bytesUploaded: 0 };
  const total = items.length;

  for (let i = 0; i < items.length; i += 1) {
    if (shouldCancel?.()) {
      onEvent?.({ type: 'cancelled' });
      break;
    }
    const item = items[i];
    const index = i + 1;
    try {
      onEvent?.({
        type: 'progress',
        phase: 'start',
        index,
        total,
        relativePath: item.relativePath,
        size: item.size,
        action: item.action,
      });
      await uploadLocalFile(drive, item, rootFolderId);
      stats.uploaded += 1;
      stats.bytesUploaded += item.size || 0;
      onEvent?.({
        type: 'progress',
        phase: 'done',
        index,
        total,
        relativePath: item.relativePath,
        size: item.size,
        action: item.action,
      });
    } catch (err) {
      stats.failed += 1;
      onEvent?.({
        type: 'error',
        index,
        total,
        relativePath: item.relativePath,
        message: err.message || String(err),
      });
    }
  }

  return stats;
}
