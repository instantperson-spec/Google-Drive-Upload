/**
 * Live upload progress store (Phase B).
 * Persisted in `_uploader_progress.json` on Google Drive so admin works on Vercel serverless.
 */

import { google } from 'googleapis';
import { getAuthClient } from '@/lib/googleAuth';

const PROGRESS_FILE_NAME = '_uploader_progress.json';
const TTL_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_STALE_MS = 30 * 1000;
const RECENTLY_COMPLETED_MS = 2 * 60 * 1000;
const CACHE_TTL_MS = 30_000;

/** @type {{ registry: object|null, loadedAt: number, fileId: string|null }} */
const cache = { registry: null, loadedAt: 0, fileId: null };

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

async function readFileJson(drive, fileId) {
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  return JSON.parse(res.data);
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
  return res.data.id;
}

async function writeFileJson(drive, fileId, registry) {
  registry.updatedAt = new Date().toISOString();
  const body = JSON.stringify(registry, null, 2);
  await drive.files.update({
    fileId,
    media: { mimeType: 'application/json', body },
  });
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
      fileId = await createProgressFile(drive, registry);
      cache.registry = registry;
      cache.fileId = fileId;
      cache.loadedAt = Date.now();
      return registry;
    }

    const registry = await readFileJson(drive, fileId);
    if (!registry.sessions || typeof registry.sessions !== 'object') {
      registry.sessions = {};
    }
    pruneSessions(registry);
    cache.registry = registry;
    cache.fileId = fileId;
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
  cache.registry = registry;
  cache.loadedAt = Date.now();

  try {
    const drive = await getDrive();
    let fileId = cache.fileId;
    if (!fileId) {
      const file = await findProgressFile(drive);
      fileId = file?.id ?? null;
    }
    if (!fileId) {
      fileId = await createProgressFile(drive, registry);
    } else {
      await writeFileJson(drive, fileId, registry);
    }
    cache.fileId = fileId;
  } catch (err) {
    console.error('Progress registry write failed:', err.message || err);
  }
}

/**
 * @param {object} data validated session payload
 */
export async function upsertProgressSession(data) {
  const registry = await readRegistry(true);
  registry.sessions[data.sessionId] = {
    sessionId: data.sessionId,
    token: data.token,
    uploaderName: data.uploaderName,
    uploaderEmail: data.uploaderEmail,
    folderId: data.folderId,
    files: data.files,
    sessionStatus: data.sessionStatus || 'uploading',
    logs: data.logs || [],
    updatedAt: new Date().toISOString(),
  };
  await saveRegistry(registry);
}

export async function removeProgressSession(sessionId) {
  const registry = await readRegistry(true);
  if (registry.sessions[sessionId]) {
    delete registry.sessions[sessionId];
    await saveRegistry(registry);
  }
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
    const isLive = updated >= activeCutoff && session.sessionStatus === 'uploading';
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
