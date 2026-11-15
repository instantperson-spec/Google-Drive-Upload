/**
 * Client share registry (_uploader_shares.json) at Drive root.
 */
import { google } from 'googleapis';
import { getAuthClient } from '@/lib/googleAuth';

export const SHARES_FILE_NAME = '_uploader_shares.json';
export const MANIFEST_NAME = '_team_manifest.json';
export const FROM_CLIENT_FOLDER = 'FromClient';

export function isFromClientPath(relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  return rel === FROM_CLIENT_FOLDER || rel.startsWith(`${FROM_CLIENT_FOLDER}/`);
}

const CACHE_TTL_MS = 15_000;
/** @type {{ registry: object|null, loadedAt: number, fileId: string|null }} */
const cache = { registry: null, loadedAt: 0, fileId: null };

async function getDrive() {
  const auth = await getAuthClient();
  return google.drive({ version: 'v3', auth });
}

async function findSharesFile(drive) {
  const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!mainFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured.');
  const res = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '${SHARES_FILE_NAME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return res.data.files?.[0] || null;
}

async function readFileJson(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );
  return JSON.parse(res.data);
}

/** @returns {Promise<object>} */
export async function readSharesRegistry(force = false) {
  if (!force && cache.registry && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.registry;
  }
  const drive = await getDrive();
  const file = await findSharesFile(drive);
  if (!file) {
    const registry = { version: 1, updatedAt: null, shares: [] };
    cache.registry = registry;
    cache.fileId = null;
    cache.loadedAt = Date.now();
    return registry;
  }
  const registry = await readFileJson(drive, file.id);
  if (!Array.isArray(registry.shares)) registry.shares = [];
  cache.registry = registry;
  cache.fileId = file.id;
  cache.loadedAt = Date.now();
  return registry;
}

export async function getActiveShare(shareId) {
  if (!shareId || typeof shareId !== 'string') return null;
  const registry = await readSharesRegistry();
  const share = registry.shares.find((s) => s.id === shareId);
  if (!share || share.revoked) return null;
  return share;
}

async function findManifest(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name = '${MANIFEST_NAME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return res.data.files?.[0] || null;
}

/** path → size the client originally uploaded */
function extractBaseline(manifest) {
  const baseline = {};
  if (manifest?.baseline && typeof manifest.baseline === 'object') {
    for (const [path, size] of Object.entries(manifest.baseline)) {
      baseline[path] = Number(size) || 0;
    }
  }
  if (Object.keys(baseline).length === 0 && manifest?.files) {
    for (const [path, meta] of Object.entries(manifest.files)) {
      if (!meta || typeof meta !== 'object') continue;
      if (typeof meta.baselineSize === 'number') baseline[path] = meta.baselineSize;
      else if (meta.status === 'original' && typeof meta.size === 'number') {
        baseline[path] = meta.size;
      }
    }
  }
  return baseline;
}

function statusForFile(relativePath, size, baseline) {
  if (!(relativePath in baseline)) return 'new';
  const baseSize = Number(baseline[relativePath]);
  if (!Number.isFinite(baseSize)) return 'new';
  if (Number(size) === baseSize) return 'original';
  return 'modified';
}

export async function readTeamManifest(folderId) {
  const drive = await getDrive();
  const file = await findManifest(drive, folderId);
  if (!file) {
    return { files: {}, baseline: {}, baselineAt: null };
  }
  const manifest = await readFileJson(drive, file.id);
  if (!manifest.files || typeof manifest.files !== 'object') manifest.files = {};
  manifest.baseline = extractBaseline(manifest);
  return manifest;
}

const SKIP_NAMES = new Set([
  '_uploader_tokens.json',
  '_uploader_progress.json',
  '_uploader_shares.json',
  '_team_manifest.json',
  '_manifest.json',
  '_crash_log.txt',
]);

const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function listChildren(drive, folderId) {
  const files = [];
  let pageToken = null;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, size, mimeType, modifiedTime)',
      pageSize: 1000,
      pageToken,
    });
    if (res.data.files) files.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

/**
 * Walk session folder; merge statuses from team manifest.
 */
export async function listShareFiles(folderId) {
  const drive = await getDrive();
  const manifest = await readTeamManifest(folderId);
  const baseline = extractBaseline(manifest);
  const out = [];

  async function walk(id, prefix) {
    const children = await listChildren(drive, id);
    for (const item of children) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.mimeType === FOLDER_MIME) {
        await walk(item.id, rel);
        continue;
      }
      if (SKIP_NAMES.has(item.name)) continue;
      if (item.mimeType?.startsWith('application/vnd.google-apps.')) continue;

      const size = Number(item.size) || 0;
      let status;
      if (isFromClientPath(rel)) {
        status = 'fromClient';
      } else if (Object.keys(baseline).length === 0) {
        status = 'original';
      } else {
        status = statusForFile(rel, size, baseline);
      }

      out.push({
        id: item.id,
        name: item.name,
        relativePath: rel,
        size,
        modifiedTime: item.modifiedTime || null,
        status,
      });
    }
  }

  await walk(folderId, '');
  return { files: out, manifest };
}

async function findFromClientFolder(drive, sessionFolderId) {
  const escaped = FROM_CLIENT_FOLDER.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const listed = await drive.files.list({
    q: `'${sessionFolderId}' in parents and name = '${escaped}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return listed.data.files?.[0]?.id || null;
}

/**
 * Find or create FromClient/ under session folder. Returns folder id.
 */
export async function ensureFromClientFolder(sessionFolderId) {
  const drive = await getDrive();
  const existing = await findFromClientFolder(drive, sessionFolderId);
  if (existing) return existing;

  const created = await drive.files.create({
    requestBody: {
      name: FROM_CLIENT_FOLDER,
      mimeType: FOLDER_MIME,
      parents: [sessionFolderId],
    },
    fields: 'id',
  });
  return created.data.id;
}

/** True if fileId is under sessionFolderId/FromClient/. */
export async function assertFileInFromClient(fileId, sessionFolderId) {
  const drive = await getDrive();
  const fromClientId = await findFromClientFolder(drive, sessionFolderId);
  if (!fromClientId) return false;
  let current = fileId;
  const seen = new Set();
  for (let depth = 0; depth < 32; depth += 1) {
    if (seen.has(current)) return false;
    seen.add(current);
    const res = await drive.files.get({
      fileId: current,
      fields: 'id, parents, trashed',
    });
    const f = res.data;
    if (f.trashed) return false;
    if (f.id === fromClientId) return true;
    const parents = f.parents || [];
    if (parents.includes(fromClientId)) return true;
    if (!parents.length) return false;
    current = parents[0];
  }
  return false;
}

/**
 * Ensure fileId belongs under share folderId (path walk check via parents chain to session).
 */
export async function assertFileInShareFolder(fileId, folderId) {
  const drive = await getDrive();
  let current = fileId;
  const seen = new Set();
  for (let depth = 0; depth < 32; depth += 1) {
    if (seen.has(current)) return false;
    seen.add(current);
    const res = await drive.files.get({
      fileId: current,
      fields: 'id, parents, trashed, mimeType',
    });
    const f = res.data;
    if (f.trashed) return false;
    if (f.id === folderId) return true;
    const parents = f.parents || [];
    if (parents.includes(folderId)) return true;
    if (!parents.length) return false;
    current = parents[0];
  }
  return false;
}

export async function getDriveDownloadStream(fileId) {
  const auth = await getAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const meta = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size',
  });
  const streamRes = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  return {
    stream: streamRes.data,
    name: meta.data.name,
    mimeType: meta.data.mimeType || 'application/octet-stream',
    size: Number(meta.data.size) || undefined,
  };
}
