import crypto from 'crypto';
import { google } from 'googleapis';
import { getAuthClient } from '@/lib/googleAuth';

export const TOKEN_FILE_NAME = '_uploader_tokens.json';
const CACHE_TTL_MS = 30_000;
const TOKEN_SLUG_RE = /^[a-zA-Z0-9_-]{2,64}$/;

/** @type {{ registry: object|null, loadedAt: number, fileId: string|null }} */
const cache = { registry: null, loadedAt: 0, fileId: null };

function invalidateCache() {
  cache.registry = null;
  cache.loadedAt = 0;
}

function bootstrapFromEnv() {
  const envTokens = (process.env.UPLOAD_TOKENS || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const now = new Date().toISOString();
  return {
    version: 1,
    updatedAt: now,
    tokens: envTokens.map((token) => ({
      id: crypto.randomUUID(),
      token,
      clientName: token,
      type: 'retainer',
      notes: '',
      createdAt: now,
      expiresAt: null,
      revoked: false,
      revokedAt: null,
    })),
  };
}

async function getDrive() {
  const auth = await getAuthClient();
  return google.drive({ version: 'v3', auth });
}

async function findTokenFile(drive) {
  const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!mainFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured.');

  const res = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '${TOKEN_FILE_NAME}' and trashed = false`,
    fields: 'files(id, modifiedTime)',
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

async function createTokenFile(drive, registry) {
  const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const body = JSON.stringify(registry, null, 2);
  const res = await drive.files.create({
    requestBody: {
      name: TOKEN_FILE_NAME,
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

/** @returns {Promise<object>} token registry */
export async function readRegistry(force = false) {
  if (!force && cache.registry && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.registry;
  }

  try {
    const drive = await getDrive();
    let file = await findTokenFile(drive);

    if (!file) {
      const registry = bootstrapFromEnv();
      const fileId = await createTokenFile(drive, registry);
      cache.registry = registry;
      cache.fileId = fileId;
      cache.loadedAt = Date.now();
      return registry;
    }

    const registry = await readFileJson(drive, file.id);
    cache.registry = registry;
    cache.fileId = file.id;
    cache.loadedAt = Date.now();
    return registry;
  } catch (err) {
    // Drive hiccup / rate limit: serve last known registry instead of failing
    // auth (a stale-but-real registry beats a spurious 401 for active clients).
    if (cache.registry) {
      console.error('Token registry read failed, using stale cache:', err.message || err);
      return cache.registry;
    }
    throw err;
  }
}

async function saveRegistry(registry) {
  const drive = await getDrive();
  if (!cache.fileId) {
    const file = await findTokenFile(drive);
    if (file) cache.fileId = file.id;
  }
  if (!cache.fileId) {
    cache.fileId = await createTokenFile(drive, registry);
  } else {
    await writeFileJson(drive, cache.fileId, registry);
  }
  cache.registry = registry;
  cache.loadedAt = Date.now();
}

function isRecordActive(record) {
  if (!record || record.revoked) return false;
  if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) return false;
  return true;
}

/** Check if a token string is currently valid (Drive store). */
export async function isTokenActive(tokenString) {
  const registry = await readRegistry();
  const record = registry.tokens.find((t) => t.token === tokenString);
  return isRecordActive(record);
}

/** Env-only fallback when Drive store is unavailable. */
export function isTokenActiveInEnv(tokenString) {
  const configured = (process.env.UPLOAD_TOKENS || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return configured.includes(tokenString);
}

export function validateTokenSlug(token) {
  return typeof token === 'string' && TOKEN_SLUG_RE.test(token);
}

export async function listTokens() {
  const registry = await readRegistry();
  return registry.tokens.map((t) => ({
    ...t,
    status: t.revoked ? 'revoked' : (t.expiresAt && new Date(t.expiresAt) < new Date() ? 'expired' : 'active'),
  }));
}

export async function createToken({
  token,
  clientName,
  type = 'retainer',
  expiresAt = null,
  notes = '',
  prefillName = null,
  prefillEmail = null,
}) {
  if (!validateTokenSlug(token)) {
    throw new Error('Token must be 2–64 characters: letters, numbers, hyphen, underscore.');
  }
  if (!clientName?.trim()) {
    throw new Error('Client name is required.');
  }
  if (!['retainer', 'one-time'].includes(type)) {
    throw new Error('Type must be "retainer" or "one-time".');
  }

  const registry = await readRegistry(true);
  const duplicate = registry.tokens.find((t) => t.token === token && !t.revoked);
  if (duplicate) {
    throw new Error(`Token "${token}" already exists and is active.`);
  }

  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    token,
    clientName: clientName.trim(),
    type,
    notes: String(notes || '').slice(0, 500),
    createdAt: now,
    expiresAt: expiresAt || null,
    revoked: false,
    revokedAt: null,
  };

  if (prefillName?.trim() && prefillEmail?.trim()) {
    record.prefillName = prefillName.trim().slice(0, 200);
    record.prefillEmail = prefillEmail.trim().slice(0, 200);
  }

  registry.tokens.push(record);
  await saveRegistry(registry);
  return record;
}

/** Revoke by token slug; used after one-time project upload completes. */
export async function revokeTokenByValue(tokenString) {
  const registry = await readRegistry(true);
  const record = registry.tokens.find((t) => t.token === tokenString);
  if (!record || record.revoked) return record ?? null;
  record.revoked = true;
  record.revokedAt = new Date().toISOString();
  await saveRegistry(registry);
  invalidateCache();
  return record;
}

export async function getTokenRecord(tokenString) {
  const registry = await readRegistry();
  return registry.tokens.find((t) => t.token === tokenString) ?? null;
}

/** Optional form prefill for a token (e.g. resume upload to existing session folder). */
export async function getTokenPrefill(tokenString) {
  const record = await getTokenRecord(tokenString);
  if (!record || !isRecordActive(record)) return null;

  const name = typeof record.prefillName === 'string' ? record.prefillName.trim() : '';
  const email = typeof record.prefillEmail === 'string' ? record.prefillEmail.trim() : '';
  if (!name || !email) return null;
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (name.length > 200) return null;

  return { name, email };
}

export async function revokeToken(id) {
  const registry = await readRegistry(true);
  const record = registry.tokens.find((t) => t.id === id);
  if (!record) throw new Error('Token not found.');
  if (record.revoked) return record;

  record.revoked = true;
  record.revokedAt = new Date().toISOString();
  await saveRegistry(registry);
  invalidateCache(); // force immediate effect on auth checks
  return record;
}

export async function deleteToken(id) {
  const registry = await readRegistry(true);
  const initialLength = registry.tokens.length;
  registry.tokens = registry.tokens.filter((t) => t.id !== id);
  if (registry.tokens.length === initialLength) {
    throw new Error('Token not found.');
  }
  await saveRegistry(registry);
  invalidateCache();
  return { success: true };
}

export async function restoreToken(id) {
  const registry = await readRegistry(true);
  const record = registry.tokens.find((t) => t.id === id);
  if (!record) throw new Error('Token not found.');

  const conflict = registry.tokens.find((t) => t.token === record.token && !t.revoked && t.id !== id);
  if (conflict) {
    throw new Error(`Cannot restore — token "${record.token}" is already active.`);
  }

  record.revoked = false;
  record.revokedAt = null;
  await saveRegistry(registry);
  invalidateCache();
  return record;
}

export function buildUploadUrl(origin, token) {
  const base = (origin || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/?token=${encodeURIComponent(token)}`;
}
