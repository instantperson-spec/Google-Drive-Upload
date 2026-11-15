import crypto from 'crypto';
import { google } from 'googleapis';
import { getAuthClient } from '@/lib/googleAuth';
import { normalizeLocale, DEFAULT_LOCALE } from '@/lib/locales';

export const TOKEN_FILE_NAME = '_uploader_tokens.json';
const CACHE_TTL_MS = 30_000;
const TOKEN_SLUG_RE = /^[a-zA-Z0-9_-]{2,64}$/;

/** @type {{ registry: object|null, loadedAt: number, fileId: string|null, etag: string|null }} */
const cache = { registry: null, loadedAt: 0, fileId: null, etag: null };

function invalidateCache() {
  cache.registry = null;
  cache.loadedAt = 0;
  cache.etag = null;
}

export class TokenStoreConflictError extends Error {
  constructor(message = 'Token registry was modified concurrently. Retry.') {
    super(message);
    this.name = 'TokenStoreConflictError';
    this.code = 409;
  }
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

/** Drive v3: etag is not a valid `fields` selector — read HTTP ETag header. */
function etagFromResponse(res) {
  const h = res?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get('etag') || h.get('ETag') || null;
  return h.etag || h.ETag || null;
}

async function readFileJson(drive, fileId) {
  const meta = await drive.files.get({
    fileId,
    fields: 'id',
  });
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );
  return {
    registry: JSON.parse(res.data),
    etag: etagFromResponse(meta) || etagFromResponse(res),
  };
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
  return { fileId: res.data.id, etag: etagFromResponse(res) };
}

function isPreconditionFailed(err) {
  const status = err?.code || err?.response?.status || err?.status;
  return Number(status) === 412;
}

async function writeFileJson(drive, fileId, registry, etag) {
  registry.updatedAt = new Date().toISOString();
  const body = JSON.stringify(registry, null, 2);
  const params = {
    fileId,
    media: { mimeType: 'application/json', body },
    fields: 'id',
  };
  if (etag) {
    params.headers = { 'If-Match': etag };
  }
  try {
    const res = await drive.files.update(params);
    return etagFromResponse(res);
  } catch (err) {
    if (isPreconditionFailed(err)) {
      throw new TokenStoreConflictError();
    }
    throw err;
  }
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
      const created = await createTokenFile(drive, registry);
      cache.registry = registry;
      cache.fileId = created.fileId;
      cache.etag = created.etag;
      cache.loadedAt = Date.now();
      return registry;
    }

    const { registry, etag } = await readFileJson(drive, file.id);
    cache.registry = registry;
    cache.fileId = file.id;
    cache.etag = etag;
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
    if (file) {
      cache.fileId = file.id;
      const meta = await drive.files.get({ fileId: file.id, fields: 'id' });
      cache.etag = etagFromResponse(meta);
    }
  }
  if (!cache.fileId) {
    const created = await createTokenFile(drive, registry);
    cache.fileId = created.fileId;
    cache.etag = created.etag;
  } else {
    cache.etag = await writeFileJson(drive, cache.fileId, registry, cache.etag);
  }
  cache.registry = registry;
  cache.loadedAt = Date.now();
}

/**
 * Read → mutate → write with one retry on If-Match conflict (412).
 * @param {(registry: object) => Promise<any>|any} mutator
 */
async function withRegistryMutation(mutator) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    invalidateCache();
    const registry = await readRegistry(true);
    const result = await mutator(registry);
    try {
      await saveRegistry(registry);
      return result;
    } catch (err) {
      lastErr = err;
      if (err instanceof TokenStoreConflictError && attempt === 0) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new TokenStoreConflictError();
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
  clientEmail,
  type = 'retainer',
  expiresAt = null,
  notes = '',
  prefillName = null,
  prefillEmail = null,
  locale = DEFAULT_LOCALE,
}) {
  if (!validateTokenSlug(token)) {
    throw new Error('Token must be 2–64 characters: letters, numbers, hyphen, underscore.');
  }
  if (!clientName?.trim()) {
    throw new Error('Client name is required.');
  }
  const email = String(prefillEmail || clientEmail || '')
    .trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw new Error('A valid client email is required (locked on the upload form).');
  }
  if (!['retainer', 'one-time'].includes(type)) {
    throw new Error('Type must be "retainer" or "one-time".');
  }

  return withRegistryMutation(async (registry) => {
    const duplicate = registry.tokens.find((t) => t.token === token && !t.revoked);
    if (duplicate) {
      throw new Error(`Token "${token}" already exists and is active.`);
    }

    const now = new Date().toISOString();
    const name = String(prefillName || clientName)
      .trim()
      .slice(0, 200);
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
      // Bound to token — upload form does not ask the client for these.
      prefillName: name,
      prefillEmail: email,
    };

    record.locale = normalizeLocale(locale);

    registry.tokens.push(record);
    return record;
  });
}

/** Revoke by token slug; used after one-time project upload completes. */
export async function revokeTokenByValue(tokenString) {
  return withRegistryMutation(async (registry) => {
    const record = registry.tokens.find((t) => t.token === tokenString);
    if (!record || record.revoked) return record ?? null;
    record.revoked = true;
    record.revokedAt = new Date().toISOString();
    return record;
  });
}

export async function getTokenRecord(tokenString) {
  const registry = await readRegistry();
  return registry.tokens.find((t) => t.token === tokenString) ?? null;
}

/**
 * Identity locked to the token for the upload form.
 * Name falls back to clientName; email must be stored on the token.
 */
export async function getTokenPrefill(tokenString) {
  const record = await getTokenRecord(tokenString);
  if (!record || !isRecordActive(record)) return null;

  const name = (
    (typeof record.prefillName === 'string' && record.prefillName.trim()) ||
    (typeof record.clientName === 'string' && record.clientName.trim()) ||
    ''
  ).slice(0, 200);
  const email = (
    (typeof record.prefillEmail === 'string' && record.prefillEmail.trim()) ||
    ''
  )
    .toLowerCase()
    .slice(0, 200);

  if (!name) return null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { name, email: '', incomplete: true };
  }

  return { name, email, incomplete: false };
}

/** UI language for upload screen (`en` default if unset). */
export async function getTokenLocale(tokenString) {
  const record = await getTokenRecord(tokenString);
  if (!record || !isRecordActive(record)) return DEFAULT_LOCALE;
  return normalizeLocale(record.locale);
}

/** Set / repair client identity used by the locked upload form. */
export async function setTokenIdentity(id, { clientName, clientEmail } = {}) {
  return withRegistryMutation(async (registry) => {
    const record = registry.tokens.find((t) => t.id === id);
    if (!record) throw new Error('Token not found.');

    const name = String(clientName || record.clientName || record.prefillName || '')
      .trim()
      .slice(0, 200);
    const email = String(clientEmail || record.prefillEmail || '')
      .trim()
      .toLowerCase()
      .slice(0, 200);

    if (!name) throw new Error('Client name is required.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('A valid client email is required.');
    }

    record.clientName = name;
    record.prefillName = name;
    record.prefillEmail = email;
    return record;
  });
}

export async function revokeToken(id) {
  return withRegistryMutation(async (registry) => {
    const record = registry.tokens.find((t) => t.id === id);
    if (!record) throw new Error('Token not found.');
    if (record.revoked) return record;

    record.revoked = true;
    record.revokedAt = new Date().toISOString();
    return record;
  });
}

export async function deleteToken(id) {
  return withRegistryMutation(async (registry) => {
    const initialLength = registry.tokens.length;
    registry.tokens = registry.tokens.filter((t) => t.id !== id);
    if (registry.tokens.length === initialLength) {
      throw new Error('Token not found.');
    }
    return { success: true };
  });
}

export async function restoreToken(id) {
  return withRegistryMutation(async (registry) => {
    const record = registry.tokens.find((t) => t.id === id);
    if (!record) throw new Error('Token not found.');

    const conflict = registry.tokens.find(
      (t) => t.token === record.token && !t.revoked && t.id !== id
    );
    if (conflict) {
      throw new Error(`Cannot restore — token "${record.token}" is already active.`);
    }

    record.revoked = false;
    record.revokedAt = null;
    return record;
  });
}

export function buildUploadUrl(origin, token) {
  const base = (origin || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/?token=${encodeURIComponent(token)}`;
}
