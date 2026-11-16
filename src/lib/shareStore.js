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
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0] || null;
}

async function readFileJson(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'text' }
  );
  return JSON.parse(res.data);
}

/** Active (non-revoked) share count for admin / studio KPI parity. */
export async function countActiveShares() {
  const registry = await readSharesRegistry();
  return (registry.shares || []).filter((s) => s && !s.revoked).length;
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

/**
 * path → { size, md5? } the client originally uploaded.
 * Legacy manifests store path → number (size only).
 */
function extractBaseline(manifest) {
  const baseline = {};
  if (manifest?.baseline && typeof manifest.baseline === 'object') {
    for (const [path, val] of Object.entries(manifest.baseline)) {
      if (val && typeof val === 'object') {
        baseline[path] = {
          size: Number(val.size) || 0,
          md5: typeof val.md5 === 'string' ? val.md5 : null,
        };
      } else {
        baseline[path] = { size: Number(val) || 0, md5: null };
      }
    }
  }
  if (Object.keys(baseline).length === 0 && manifest?.files) {
    for (const [path, meta] of Object.entries(manifest.files)) {
      if (!meta || typeof meta !== 'object') continue;
      if (typeof meta.baselineSize === 'number') {
        baseline[path] = {
          size: meta.baselineSize,
          md5: typeof meta.baselineMd5 === 'string' ? meta.baselineMd5 : null,
        };
      } else if (meta.status === 'original' && typeof meta.size === 'number') {
        baseline[path] = {
          size: meta.size,
          md5: typeof meta.md5Checksum === 'string' ? meta.md5Checksum : null,
        };
      }
    }
  }
  return baseline;
}

function statusForFile(relativePath, size, md5, modifiedTime, baseline, baselineAt) {
  if (!(relativePath in baseline)) return 'new';
  const entry = baseline[relativePath];
  const baseSize = Number(entry?.size);
  if (!Number.isFinite(baseSize)) return 'new';
  if (Number(size) !== baseSize) return 'modified';
  // Same size: prefer md5 when both sides have it (WAV same-size edits)
  if (entry.md5 && md5 && entry.md5 !== md5) return 'modified';
  if (entry.md5 && md5 && entry.md5 === md5) return 'original';
  // Fallback: Drive modified after baseline capture → treat as studio edit
  if (baselineAt && modifiedTime) {
    const baseMs = Date.parse(baselineAt);
    const modMs = Date.parse(modifiedTime);
    if (Number.isFinite(baseMs) && Number.isFinite(modMs) && modMs > baseMs + 2000) {
      return 'modified';
    }
  }
  return 'original';
}

function normalizeSnapshot(raw) {
  const snapshot = {};
  if (!raw || typeof raw !== 'object') return snapshot;
  for (const [path, val] of Object.entries(raw)) {
    if (val && typeof val === 'object') {
      snapshot[path] = {
        size: Number(val.size) || 0,
        md5: typeof val.md5 === 'string' ? val.md5 : null,
      };
    } else {
      snapshot[path] = { size: Number(val) || 0, md5: null };
    }
  }
  return snapshot;
}

function vsSnapshot(relativePath, size, md5, snapshot) {
  if (!(relativePath in snapshot)) return 'added';
  const entry = snapshot[relativePath];
  const baseSize = Number(entry?.size);
  if (!Number.isFinite(baseSize) || Number(size) !== baseSize) return 'changed';
  if (entry.md5 && md5 && entry.md5 !== md5) return 'changed';
  return 'unchanged';
}

export async function readTeamManifest(folderId) {
  const drive = await getDrive();
  const file = await findManifest(drive, folderId);
  if (!file) {
    return { files: {}, baseline: {}, baselineAt: null, rounds: [] };
  }
  const manifest = await readFileJson(drive, file.id);
  if (!manifest.files || typeof manifest.files !== 'object') manifest.files = {};
  manifest.baseline = extractBaseline(manifest);
  if (!Array.isArray(manifest.rounds)) manifest.rounds = [];
  return manifest;
}

const SKIP_NAMES = new Set([
  '_uploader_tokens.json',
  '_uploader_progress.json',
  '_uploader_shares.json',
  '_uploader_session.json',
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
      fields: 'nextPageToken, files(id, name, size, mimeType, modifiedTime, md5Checksum)',
      pageSize: 1000,
      pageToken,
    });
    if (res.data.files) files.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

/**
 * Walk session folder; merge statuses from team manifest + vs previous round.
 * @param {string} folderId
 * @param {{ roundId?: string|null }} [opts]
 */
export async function listShareFiles(folderId, opts = {}) {
  const drive = await getDrive();
  const manifest = await readTeamManifest(folderId);
  const baseline = extractBaseline(manifest);
  const baselineAt = manifest?.baselineAt || null;
  const rounds = Array.isArray(manifest.rounds) ? manifest.rounds : [];
  const roundId = opts.roundId || null;
  let currentRound = null;
  let prevSnapshot = null;

  if (rounds.length) {
    const idx = roundId
      ? rounds.findIndex((r) => r.id === roundId)
      : rounds.length - 1;
    const i = idx >= 0 ? idx : rounds.length - 1;
    currentRound = rounds[i]
      ? {
          id: rounds[i].id,
          label: rounds[i].label || `#${i + 1}`,
          publishedAt: rounds[i].publishedAt || null,
        }
      : null;
    if (i > 0) {
      prevSnapshot = normalizeSnapshot(rounds[i - 1].snapshot);
    } else {
      prevSnapshot = baseline;
    }
  }

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
      const md5 = item.md5Checksum || null;
      let status;
      if (isFromClientPath(rel)) {
        status = 'fromClient';
      } else if (Object.keys(baseline).length === 0) {
        status = 'original';
      } else {
        status = statusForFile(rel, size, md5, item.modifiedTime || null, baseline, baselineAt);
      }

      let vsPrevRound = null;
      if (prevSnapshot && status !== 'fromClient') {
        vsPrevRound = vsSnapshot(rel, size, md5, prevSnapshot);
      }

      out.push({
        id: item.id,
        name: item.name,
        relativePath: rel,
        size,
        modifiedTime: item.modifiedTime || null,
        status,
        vsPrevRound,
      });
    }
  }

  await walk(folderId, '');
  return {
    files: out,
    manifest,
    round: currentRound,
    rounds: rounds.map((r) => ({
      id: r.id,
      label: r.label || null,
      publishedAt: r.publishedAt || null,
    })),
  };
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
