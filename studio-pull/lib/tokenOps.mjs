/**
 * Local Drive token registry ops (same _uploader_tokens.json as web admin).
 */
import crypto from 'crypto';
import { google } from 'googleapis';
import { createDriveClient } from './auth.mjs';

const TOKEN_FILE_NAME = '_uploader_tokens.json';
const TOKEN_SLUG_RE = /^[a-zA-Z0-9_-]{2,64}$/;

function normalizeLocale(value) {
  return value === 'pl' ? 'pl' : 'en';
}

function statusOf(t) {
  if (t.revoked) return 'revoked';
  if (t.expiresAt && new Date(t.expiresAt) < new Date()) return 'expired';
  return 'active';
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
      registry: { version: 1, updatedAt: new Date().toISOString(), tokens: [] },
    };
  }
  const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'text' });
  const registry = JSON.parse(res.data);
  if (!Array.isArray(registry.tokens)) registry.tokens = [];
  return { fileId: file.id, registry };
}

async function writeRegistry(drive, mainFolderId, fileId, registry) {
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
    return created.data.id;
  }
  await drive.files.update({
    fileId,
    media: { mimeType: 'application/json', body },
  });
  return fileId;
}

function publicOrigin(env = {}) {
  return (env.PUBLIC_UPLOAD_URL || 'https://drive-uploader-three.vercel.app').replace(/\/$/, '');
}

export function buildUploadUrl(token, env = {}) {
  return `${publicOrigin(env)}/?token=${encodeURIComponent(token)}`;
}

export async function listTokensLocal() {
  const { drive, mainFolderId, env } = createDriveClient();
  const { registry } = await readRegistry(drive, mainFolderId);
  return registry.tokens.map((t) => ({
    ...t,
    status: statusOf(t),
    locale: normalizeLocale(t.locale),
    uploadUrl: buildUploadUrl(t.token, env),
  }));
}

export async function createTokenLocal(input) {
  const { drive, mainFolderId, env } = createDriveClient();

  const token = String(input.token || '').trim();
  const clientName = String(input.clientName || '').trim();
  const clientEmail = String(input.clientEmail || input.prefillEmail || '')
    .trim()
    .toLowerCase();
  const type = input.type === 'one-time' ? 'one-time' : 'retainer';
  const locale = normalizeLocale(input.locale);

  if (!TOKEN_SLUG_RE.test(token)) {
    throw new Error('Token must be 2–64 characters: letters, numbers, hyphen, underscore.');
  }
  if (!clientName) throw new Error('Client name is required.');
  if (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
    throw new Error('A valid client email is required (locked on the upload form).');
  }

  const { fileId, registry } = await readRegistry(drive, mainFolderId);
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
  await writeRegistry(drive, mainFolderId, fileId, registry);
  return {
    ...record,
    status: 'active',
    uploadUrl: buildUploadUrl(record.token, env),
  };
}

export async function patchTokenLocal(id, action) {
  const { drive, mainFolderId, env } = createDriveClient();
  const { fileId, registry } = await readRegistry(drive, mainFolderId);
  const record = registry.tokens.find((t) => t.id === id);
  if (!record) throw new Error('Token not found.');

  if (action === 'revoke') {
    record.revoked = true;
    record.revokedAt = new Date().toISOString();
  } else if (action === 'restore') {
    const conflict = registry.tokens.find(
      (t) => t.token === record.token && !t.revoked && t.id !== id
    );
    if (conflict) throw new Error(`Cannot restore — token "${record.token}" is already active.`);
    record.revoked = false;
    record.revokedAt = null;
  } else {
    throw new Error('Unsupported action. Use revoke or restore.');
  }

  await writeRegistry(drive, mainFolderId, fileId, registry);
  return { ...record, status: statusOf(record), uploadUrl: buildUploadUrl(record.token, env) };
}

export async function setTokenLocaleLocal(id, locale) {
  const { drive, mainFolderId, env } = createDriveClient();
  const { fileId, registry } = await readRegistry(drive, mainFolderId);
  const record = registry.tokens.find((t) => t.id === id);
  if (!record) throw new Error('Token not found.');
  record.locale = normalizeLocale(locale);
  await writeRegistry(drive, mainFolderId, fileId, registry);
  return { ...record, status: statusOf(record), uploadUrl: buildUploadUrl(record.token, env) };
}

export async function deleteTokenLocal(id) {
  const { drive, mainFolderId } = createDriveClient();
  const { fileId, registry } = await readRegistry(drive, mainFolderId);
  const initialLength = registry.tokens.length;
  registry.tokens = registry.tokens.filter((t) => t.id !== id);
  if (registry.tokens.length === initialLength) {
    throw new Error('Token not found.');
  }
  await writeRegistry(drive, mainFolderId, fileId, registry);
  return { success: true };
}
