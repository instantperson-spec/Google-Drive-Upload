/**
 * Live upload progress store.
 * Persisted in `_uploader_progress.json` on Google Drive (If-Match / ETag).
 */

import { google } from 'googleapis';
import { getAuthClient } from '@/lib/googleAuth';

const PROGRESS_FILE_NAME = '_uploader_progress.json';
const TTL_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_STALE_MS = 3 * 60 * 1000;
const RECENTLY_COMPLETED_MS = 2 * 60 * 1000;
const CACHE_TTL_MS = 30_000;

/** @type {{ registry: object|null, loadedAt: number, fileId: string|null, etag: string|null }} */
const cache = { registry: null, loadedAt: 0, fileId: null, etag: null };

function emptyRegistry() {
  return { version: 1, updatedAt: new Date().toISOString(), sessions: {} };
}

function pruneSessions(registry) {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, session] of Object.entries(registry.sessions)) {
    if (new Date(session.updatedAt).getTime() < cutoff) {
      delete registry.sessions[id];
    }
  }
}

async function getDrive() {
  const auth = await getAuthClient();
  return google.drive({ version: 'v3', auth });
}

async function findProgressFile(drive) {
  const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!mainFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured.');

  const res = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '${PROGRESS_FILE_NAME}' and trashed = false`,
    fields: 'files(id, modifiedTime)',
    pageSize: 1,
  });
  return res.data.files?.[0] || null;
}

function isPreconditionFailed(err) {
  const status = err?.code || err?.response?.status || err?.status;
  return Number(status) === 412;
}

/** Drive v3: etag is not a valid `fields` selector — read HTTP ETag header. */
function etagFromResponse(res) {
  const h = res?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get('etag') || h.get('ETag') || null;
  return h.etag || h.ETag || null;
}

async function readFileJson(drive, fileId) {
  const meta = await drive.files.get({ fileId, fields: 'id' });
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );
  return {
    registry: JSON.parse(res.data),
    etag: etagFromResponse(meta) || etagFromResponse(res),
  };
}

async function createProgressFile(drive, registry) {
  const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const body = JSON.stringify(registry, null, 2);
  const res = await drive.files.create({
    requestBody: {
      name: PROGRESS_FILE_NAME,
      mimeType: 'application/json',
      parents: [mainFolderId],
    },
    media: { mimeType: 'application/json', body },
    fields: 'id',
  });
  return { fileId: res.data.id, etag: etagFromResponse(res) };
}

async function writeFileJson(drive, fileId, registry, etag) {
  registry.updatedAt = new Date().toISOString();
  const body = JSON.stringify(registry, null, 2);
  const params = {
    fileId,
    media: { mimeType: 'application/json', body },
    fields: 'id',
  };
  if (etag) params.headers = { 'If-Match': etag };
  const res = await drive.files.update(params);
  return etagFromResponse(res);
}

async function readRegistry(force = false) {
  if (!force && cache.registry && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.registry;
  }

  try {
    const drive = await getDrive();
    let fileId = cache.fileId;

    if (!fileId) {
      const file = await findProgressFile(drive);
      fileId = file?.id ?? null;
    }

    if (!fileId) {
      const registry = emptyRegistry();
      const created = await createProgressFile(drive, registry);
      cache.registry = registry;
      cache.fileId = created.fileId;
      cache.etag = created.etag;
      cache.loadedAt = Date.now();
      return registry;
    }

    const { registry, etag } = await readFileJson(drive, fileId);
    if (!registry.sessions || typeof registry.sessions !== 'object') {
      registry.sessions = {};
    }
    pruneSessions(registry);
    cache.registry = registry;
    cache.fileId = fileId;
    cache.etag = etag;
    cache.loadedAt = Date.now();
    return registry;
  } catch (err) {
    if (cache.registry) {
      console.error('Progress registry read failed, using stale cache:', err.message || err);
      return cache.registry;
    }
    throw err;
  }
}

async function saveRegistry(registry) {
  pruneSessions(registry);

  try {
    const drive = await getDrive();
    let fileId = cache.fileId;
    if (!fileId) {
      const file = await findProgressFile(drive);
      fileId = file?.id ?? null;
      if (fileId) {
        const meta = await drive.files.get({ fileId, fields: 'id' });
        cache.etag = etagFromResponse(meta);
      }
    }
    if (!fileId) {
      const created = await createProgressFile(drive, registry);
      cache.fileId = created.fileId;
      cache.etag = created.etag;
    } else {
      try {
        cache.etag = await writeFileJson(drive, fileId, registry, cache.etag);
        cache.fileId = fileId;
      } catch (err) {
        if (isPreconditionFailed(err)) {
          const fresh = await readFileJson(drive, fileId);
          Object.assign(fresh.registry.sessions, registry.sessions);
          pruneSessions(fresh.registry);
          cache.etag = await writeFileJson(
            drive,
            fileId,
            fresh.registry,
            fresh.etag
          );
          cache.fileId = fileId;
          cache.registry = fresh.registry;
          cache.loadedAt = Date.now();
          return;
        }
        throw err;
      }
    }
    cache.registry = registry;
    cache.loadedAt = Date.now();
  } catch (err) {
    console.error('Progress registry write failed:', err.message || err);
  }
}

const LIVE_SESSION_STATUSES = new Set(['uploading', 'file-started', 'file-completed']);

function normalizeSessionStatus(status) {
  if (status === 'completed' || status === 'error') return status;
  return 'uploading';
}

/**
 * @param {object} data validated session payload
 */
export async function upsertProgressSession(data) {
  const registry = await readRegistry(true);
  const existing = registry.sessions[data.sessionId];
  if (existing && existing.token && existing.token !== data.token) {
    return { ok: false, status: 403, error: 'Session ID belongs to another token.' };
  }
  registry.sessions[data.sessionId] = {
    sessionId: data.sessionId,
    token: data.token,
    projectName: data.projectName || '',
    uploaderName: data.uploaderName,
    uploaderEmail: data.uploaderEmail,
    folderId: data.folderId,
    files: data.files,
    sessionStatus: normalizeSessionStatus(data.sessionStatus),
    logs: data.logs || [],
    updatedAt: new Date().toISOString(),
  };
  await saveRegistry(registry);
  return { ok: true };
}

export async function removeProgressSession(sessionId, token = null) {
  const registry = await readRegistry(true);
  const existing = registry.sessions[sessionId];
  if (existing) {
    if (existing.token && token && existing.token !== token) {
      return { ok: false, status: 403, error: 'Session belongs to another token.' };
    }
    delete registry.sessions[sessionId];
    await saveRegistry(registry);
  }
  return { ok: true };
}

export async function getSession(sessionId) {
  const registry = await readRegistry();
  return registry.sessions[sessionId] ?? null;
}

/**
 * Active uploads (heartbeat < staleMs) + recently completed (2 min).
 * @returns {Promise<object[]>}
 */
export async function getActiveSessions(staleMs = ACTIVE_STALE_MS) {
  const registry = await readRegistry();
  const now = Date.now();
  const activeCutoff = now - staleMs;
  const completedCutoff = now - RECENTLY_COMPLETED_MS;
  const result = [];

  for (const session of Object.values(registry.sessions)) {
    const updated = new Date(session.updatedAt).getTime();
    const isLive =
      updated >= activeCutoff &&
      (session.sessionStatus === 'uploading' ||
        LIVE_SESSION_STATUSES.has(session.sessionStatus));
    const isRecentlyDone =
      session.sessionStatus === 'completed' && updated >= completedCutoff;

    if (isLive || isRecentlyDone) {
      result.push(session);
    }
  }

  return result.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}
