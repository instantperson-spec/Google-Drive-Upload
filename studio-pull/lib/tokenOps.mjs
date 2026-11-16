/**
 * Local Drive token registry ops (same _uploader_tokens.json as web admin).
 * Writes use If-Match + one retry on 412.
 */
import crypto from 'crypto';
import { createDriveClient } from './auth.mjs';

const TOKEN_FILE_NAME = '_uploader_tokens.json';
const CLIENTS_FILE_NAME = '_uploader_clients.json';
const TOKEN_SLUG_RE = /^[a-zA-Z0-9_-]{2,64}$/;

function normalizeLocale(value) {
  return value === 'pl' ? 'pl' : 'en';
}

function statusOf(t) {
  if (t.revoked) return 'revoked';
  if (t.expiresAt && new Date(t.expiresAt) < new Date()) return 'expired';
  return 'active';
}

function isPreconditionFailed(err) {
  const status = err?.code || err?.response?.status || err?.status;
  return Number(status) === 412;
}

async function findTokenFile(drive, mainFolderId) {
  const res = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '${TOKEN_FILE_NAME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return res.data.files?.[0] || null;
}

async function readRegistry(drive, mainFolderId) {
  const file = await findTokenFile(drive, mainFolderId);
  if (!file) {
    return {
      fileId: null,
      etag: null,
      registry: { version: 1, updatedAt: new Date().toISOString(), tokens: [] },
    };
  }
  // Drive v3: etag is not a valid `fields` selector — use HTTP ETag header.
  const meta = await drive.files.get({ fileId: file.id, fields: 'id' });
  const res = await drive.files.get(
    { fileId: file.id, alt: 'media' },
    { responseType: 'text' }
  );
  const registry = JSON.parse(res.data);
  if (!Array.isArray(registry.tokens)) registry.tokens = [];
  const headers = meta.headers || {};
  const etag =
    (typeof headers.get === 'function'
      ? headers.get('etag') || headers.get('ETag')
      : headers.etag || headers.ETag) || null;
  return { fileId: file.id, etag, registry };
}

function etagFromResponse(res) {
  const h = res?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get('etag') || h.get('ETag') || null;
  return h.etag || h.ETag || null;
}

async function writeRegistry(drive, mainFolderId, fileId, etag, registry) {
  registry.updatedAt = new Date().toISOString();
  const body = JSON.stringify(registry, null, 2);
  if (!fileId) {
    const created = await drive.files.create({
      requestBody: {
        name: TOKEN_FILE_NAME,
        mimeType: 'application/json',
        parents: [mainFolderId],
      },
      media: { mimeType: 'application/json', body },
      fields: 'id',
    });
    return { fileId: created.data.id, etag: etagFromResponse(created) };
  }
  const params = {
    fileId,
    media: { mimeType: 'application/json', body },
    fields: 'id',
  };
  if (etag) params.headers = { 'If-Match': etag };
  try {
    const updated = await drive.files.update(params);
    return { fileId, etag: etagFromResponse(updated) };
  } catch (err) {
    if (isPreconditionFailed(err)) {
      const conflict = new Error(
        'Token registry was modified concurrently. Retry.'
      );
      conflict.code = 409;
      throw conflict;
    }
    throw err;
  }
}

async function withMutation(mutator) {
  const { drive, mainFolderId, env } = createDriveClient();
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { fileId, etag, registry } = await readRegistry(drive, mainFolderId);
    const result = await mutator(registry, env);
    try {
      await writeRegistry(drive, mainFolderId, fileId, etag, registry);
      return result;
    } catch (err) {
      lastErr = err;
      if (Number(err.code) === 409 && attempt === 0) continue;
      throw err;
    }
  }
  throw lastErr;
}

function publicOrigin(env = {}) {
  return (env.PUBLIC_UPLOAD_URL || 'https://drive-uploader-three.vercel.app').replace(
    /\/$/,
    ''
  );
}

export function buildUploadUrl(token, env = {}) {
  return `${publicOrigin(env)}/?token=${encodeURIComponent(token)}`;
}

function isHubBoundToken(t, linkedSlugs) {
  if (t?.hubBound) return true;
  if (
    typeof t?.notes === 'string' &&
    /auto-created on invited client hub signup/i.test(t.notes)
  ) {
    return true;
  }
  if (linkedSlugs?.has(String(t?.token || ''))) return true;
  return false;
}

async function loadLinkedTokenSlugs(drive, mainFolderId) {
  try {
    const res = await drive.files.list({
      q: `'${mainFolderId}' in parents and name = '${CLIENTS_FILE_NAME}' and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
    });
    const file = res.data.files?.[0];
    if (!file) return new Set();
    const media = await drive.files.get(
      { fileId: file.id, alt: 'media' },
      { responseType: 'text' }
    );
    const registry = JSON.parse(media.data);
    const set = new Set();
    for (const c of registry.clients || []) {
      const slug = c.linkedToken ? String(c.linkedToken).trim() : '';
      if (slug) set.add(slug);
    }
    return set;
  } catch {
    return new Set();
  }
}

export async function listTokensLocal() {
  const { drive, mainFolderId, env } = createDriveClient();
  const [{ registry }, linkedSlugs] = await Promise.all([
    readRegistry(drive, mainFolderId),
    loadLinkedTokenSlugs(drive, mainFolderId),
  ]);
  // Hub-bound bindings belong under Client hub Accounts on Vercel — not here.
  return registry.tokens
    .filter((t) => !isHubBoundToken(t, linkedSlugs))
    .map((t) => ({
      ...t,
      hubBound: false,
      status: statusOf(t),
      locale: normalizeLocale(t.locale),
      uploadUrl: buildUploadUrl(t.token, env),
    }));
}

export async function createTokenLocal(input) {
  return withMutation((registry, env) => {
    const token = String(input.token || '').trim();
    const clientName = String(input.clientName || '').trim();
    const clientEmail = String(input.clientEmail || input.prefillEmail || '')
      .trim()
      .toLowerCase();
    const type = input.type === 'one-time' ? 'one-time' : 'retainer';
    const locale = normalizeLocale(input.locale);

    if (!TOKEN_SLUG_RE.test(token)) {
      throw new Error(
        'Token must be 2–64 characters: letters, numbers, hyphen, underscore.'
      );
    }
    if (!clientName) throw new Error('Client name is required.');
    if (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      throw new Error('A valid client email is required (locked on the upload form).');
    }

    const duplicate = registry.tokens.find((t) => t.token === token && !t.revoked);
    if (duplicate) throw new Error(`Token "${token}" already exists and is active.`);

    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      token,
      clientName,
      type,
      notes: String(input.notes || '').slice(0, 500),
      createdAt: now,
      expiresAt: String(input.expiresAt || '').trim() || null,
      revoked: false,
      revokedAt: null,
      locale,
      prefillName: clientName.slice(0, 200),
      prefillEmail: clientEmail.slice(0, 200),
    };

    registry.tokens.push(record);
    return {
      ...record,
      status: 'active',
      uploadUrl: buildUploadUrl(record.token, env),
    };
  });
}

export async function patchTokenLocal(id, action) {
  return withMutation((registry, env) => {
    const record = registry.tokens.find((t) => t.id === id);
    if (!record) throw new Error('Token not found.');

    if (action === 'revoke') {
      record.revoked = true;
      record.revokedAt = new Date().toISOString();
    } else if (action === 'restore') {
      const conflict = registry.tokens.find(
        (t) => t.token === record.token && !t.revoked && t.id !== id
      );
      if (conflict) {
        throw new Error(`Cannot restore — token "${record.token}" is already active.`);
      }
      record.revoked = false;
      record.revokedAt = null;
    } else {
      throw new Error('Unsupported action. Use revoke or restore.');
    }

    return {
      ...record,
      status: statusOf(record),
      uploadUrl: buildUploadUrl(record.token, env),
    };
  });
}

export async function setTokenIdentityLocal(id, { clientName, clientEmail } = {}) {
  return withMutation((registry, env) => {
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
    return {
      ...record,
      status: statusOf(record),
      locale: normalizeLocale(record.locale),
      uploadUrl: buildUploadUrl(record.token, env),
    };
  });
}

export async function setTokenLocaleLocal(id, locale) {
  return withMutation((registry, env) => {
    const record = registry.tokens.find((t) => t.id === id);
    if (!record) throw new Error('Token not found.');
    record.locale = normalizeLocale(locale);
    return {
      ...record,
      status: statusOf(record),
      uploadUrl: buildUploadUrl(record.token, env),
    };
  });
}

export async function deleteTokenLocal(id) {
  return withMutation((registry) => {
    const initialLength = registry.tokens.length;
    registry.tokens = registry.tokens.filter((t) => t.id !== id);
    if (registry.tokens.length === initialLength) {
      throw new Error('Token not found.');
    }
    return { success: true };
  });
}
