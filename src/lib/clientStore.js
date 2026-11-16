/**
 * Client hub accounts + project memberships (_uploader_clients.json on Drive).
 */
import crypto from 'crypto';
import { google } from 'googleapis';
import { getAuthClient } from '@/lib/googleAuth';
import { normalizeLocale, DEFAULT_LOCALE } from '@/lib/locales';

export const CLIENTS_FILE_NAME = '_uploader_clients.json';
const CACHE_TTL_MS = 30_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @type {{ registry: object|null, loadedAt: number, fileId: string|null, etag: string|null }} */
const cache = { registry: null, loadedAt: 0, fileId: null, etag: null };

export class ClientStoreConflictError extends Error {
  constructor(message = 'Client registry was modified concurrently. Retry.') {
    super(message);
    this.name = 'ClientStoreConflictError';
    this.code = 409;
  }
}

function invalidateCache() {
  cache.registry = null;
  cache.loadedAt = 0;
  cache.etag = null;
}

function emptyRegistry() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    clients: [],
    memberships: [],
    invites: [],
  };
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ensureInvitesArray(registry) {
  if (!Array.isArray(registry.invites)) registry.invites = [];
}

function hashInviteToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function generateInviteRawToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function inviteStatus(inv) {
  if (!inv) return 'invalid';
  if (inv.revokedAt) return 'revoked';
  if (inv.usedAt) return 'used';
  if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) {
    return 'expired';
  }
  return 'pending';
}

function publicInvite(inv) {
  return {
    id: inv.id,
    email: inv.email,
    locale: normalizeLocale(inv.locale || DEFAULT_LOCALE),
    note: inv.note || null,
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
    usedAt: inv.usedAt || null,
    revokedAt: inv.revokedAt || null,
    createdBy: inv.createdBy || 'admin',
    status: inviteStatus(inv),
  };
}

export function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

export function isValidEmail(email) {
  return EMAIL_RE.test(normalizeEmail(email));
}

function timingSafeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/** scrypt:$salt:$hash */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return timingSafeEqualHex(hash, check);
}

async function getDrive() {
  const auth = await getAuthClient();
  return google.drive({ version: 'v3', auth });
}

async function findClientsFile(drive) {
  const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!mainFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured.');
  const res = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '${CLIENTS_FILE_NAME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0] || null;
}

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
    supportsAllDrives: true,
  });
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'text' }
  );
  return {
    registry: JSON.parse(res.data),
    etag: etagFromResponse(meta) || etagFromResponse(res),
  };
}

async function createClientsFile(drive, registry) {
  const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const body = JSON.stringify(registry, null, 2);
  const res = await drive.files.create({
    requestBody: {
      name: CLIENTS_FILE_NAME,
      mimeType: 'application/json',
      parents: [mainFolderId],
    },
    media: { mimeType: 'application/json', body },
    fields: 'id',
    supportsAllDrives: true,
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
    supportsAllDrives: true,
  };
  if (etag) params.headers = { 'If-Match': etag };
  try {
    const res = await drive.files.update(params);
    return etagFromResponse(res);
  } catch (err) {
    if (isPreconditionFailed(err)) throw new ClientStoreConflictError();
    throw err;
  }
}

export async function readClientsRegistry(force = false) {
  if (!force && cache.registry && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.registry;
  }
  try {
    const drive = await getDrive();
    let file = await findClientsFile(drive);
    if (!file) {
      const registry = emptyRegistry();
      const created = await createClientsFile(drive, registry);
      cache.registry = registry;
      cache.fileId = created.fileId;
      cache.etag = created.etag;
      cache.loadedAt = Date.now();
      return registry;
    }
    const { registry, etag } = await readFileJson(drive, file.id);
    if (!Array.isArray(registry.clients)) registry.clients = [];
    if (!Array.isArray(registry.memberships)) registry.memberships = [];
    ensureInvitesArray(registry);
    cache.registry = registry;
    cache.fileId = file.id;
    cache.etag = etag;
    cache.loadedAt = Date.now();
    return registry;
  } catch (err) {
    if (cache.registry) {
      console.error('Client registry read failed, using stale cache:', err.message || err);
      return cache.registry;
    }
    throw err;
  }
}

async function saveRegistry(registry) {
  const drive = await getDrive();
  if (!cache.fileId) {
    const file = await findClientsFile(drive);
    if (file) {
      cache.fileId = file.id;
      const meta = await drive.files.get({
        fileId: file.id,
        fields: 'id',
        supportsAllDrives: true,
      });
      cache.etag = etagFromResponse(meta);
    }
  }
  if (!cache.fileId) {
    const created = await createClientsFile(drive, registry);
    cache.fileId = created.fileId;
    cache.etag = created.etag;
  } else {
    cache.etag = await writeFileJson(drive, cache.fileId, registry, cache.etag);
  }
  cache.registry = registry;
  cache.loadedAt = Date.now();
}

async function withRegistryMutation(mutator) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    invalidateCache();
    const registry = await readClientsRegistry(true);
    const result = await mutator(registry);
    try {
      await saveRegistry(registry);
      return result;
    } catch (err) {
      lastErr = err;
      if (err instanceof ClientStoreConflictError && attempt === 0) continue;
      throw err;
    }
  }
  throw lastErr || new ClientStoreConflictError();
}

function publicClient(record) {
  if (!record) return null;
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName || '',
    locale: normalizeLocale(record.locale || DEFAULT_LOCALE),
    linkedToken: record.linkedToken || null,
    createdAt: record.createdAt,
    revoked: Boolean(record.revoked),
    revokedAt: record.revokedAt || null,
    status: record.revoked ? 'revoked' : 'active',
  };
}

export async function listClients() {
  const registry = await readClientsRegistry();
  return registry.clients.map(publicClient);
}

/** Slugs currently linked to hub accounts (for hubBound soft-match). */
export async function listLinkedTokenSlugs() {
  const registry = await readClientsRegistry();
  const set = new Set();
  for (const c of registry.clients || []) {
    const slug = c.linkedToken ? String(c.linkedToken).trim() : '';
    if (slug) set.add(slug);
  }
  return set;
}

export async function getClientById(id) {
  const registry = await readClientsRegistry();
  return registry.clients.find((c) => c.id === id) || null;
}

export async function getClientByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const registry = await readClientsRegistry();
  return registry.clients.find((c) => c.email === normalized) || null;
}

export async function getActiveClientByEmail(email) {
  const client = await getClientByEmail(email);
  if (!client || client.revoked) return null;
  return client;
}

/**
 * Create client account. Requires password; linkedToken optional but needed for hub upload.
 */
export async function createClient({
  email,
  password,
  displayName = '',
  locale = DEFAULT_LOCALE,
  linkedToken = null,
}) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) throw new Error('Valid email is required.');
  if (!password || String(password).length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  return withRegistryMutation((registry) => {
    if (registry.clients.some((c) => c.email === normalized)) {
      throw new Error('A client with this email already exists.');
    }
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      email: normalized,
      passwordHash: hashPassword(password),
      displayName: String(displayName || '').trim().slice(0, 120),
      locale: normalizeLocale(locale),
      linkedToken: linkedToken ? String(linkedToken).trim() : null,
      createdAt: now,
      revoked: false,
      revokedAt: null,
    };
    registry.clients.push(record);
    return publicClient(record);
  });
}

export async function setClientPassword(id, password) {
  if (!password || String(password).length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  return withRegistryMutation((registry) => {
    const client = registry.clients.find((c) => c.id === id);
    if (!client) throw new Error('Client not found.');
    client.passwordHash = hashPassword(password);
    return publicClient(client);
  });
}

export async function updateClient(
  id,
  { displayName, locale, linkedToken, revoke, restore } = {}
) {
  return withRegistryMutation((registry) => {
    const client = registry.clients.find((c) => c.id === id);
    if (!client) throw new Error('Client not found.');
    if (displayName != null) {
      client.displayName = String(displayName).trim().slice(0, 120);
    }
    if (locale != null) client.locale = normalizeLocale(locale);
    if (linkedToken !== undefined) {
      client.linkedToken = linkedToken ? String(linkedToken).trim() : null;
    }
    if (revoke) {
      client.revoked = true;
      client.revokedAt = new Date().toISOString();
    }
    if (restore) {
      client.revoked = false;
      client.revokedAt = null;
    }
    return publicClient(client);
  });
}

export async function deleteClient(id) {
  return withRegistryMutation((registry) => {
    const idx = registry.clients.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error('Client not found.');
    const email = registry.clients[idx].email;
    registry.clients.splice(idx, 1);
    registry.memberships = registry.memberships.filter(
      (m) => m.clientEmail !== email
    );
    return { ok: true };
  });
}

export async function authenticateClient(email, password) {
  const client = await getClientByEmail(email);
  if (!client || client.revoked) return null;
  if (!verifyPassword(password, client.passwordHash)) return null;
  return client;
}

export async function listMembershipsForEmail(email) {
  const normalized = normalizeEmail(email);
  const registry = await readClientsRegistry();
  return registry.memberships.filter((m) => m.clientEmail === normalized);
}

export async function listAllMemberships() {
  const registry = await readClientsRegistry();
  return registry.memberships.slice();
}

/**
 * Assign a Drive session folder to a client hub account.
 */
export async function assignProject({
  folderId,
  clientEmail,
  shareId = null,
  label = null,
  assignedBy = 'admin',
}) {
  const folder = String(folderId || '').trim();
  const email = normalizeEmail(clientEmail);
  if (!folder) throw new Error('folderId is required.');
  if (!isValidEmail(email)) throw new Error('Valid clientEmail is required.');

  const client = await getActiveClientByEmail(email);
  if (!client) throw new Error('Active client account not found for this email.');

  return withRegistryMutation((registry) => {
    const existing = registry.memberships.find(
      (m) => m.clientEmail === email && m.folderId === folder
    );
    const now = new Date().toISOString();
    if (existing) {
      if (shareId) existing.shareId = shareId;
      if (label != null) existing.label = label;
      existing.assignedAt = now;
      existing.assignedBy = assignedBy;
      return existing;
    }
    const row = {
      id: crypto.randomUUID(),
      folderId: folder,
      shareId: shareId || null,
      clientEmail: email,
      label: label || null,
      role: 'member',
      assignedAt: now,
      assignedBy,
    };
    registry.memberships.push(row);
    return row;
  });
}

export async function unassignProject(membershipId) {
  return withRegistryMutation((registry) => {
    const idx = registry.memberships.findIndex((m) => m.id === membershipId);
    if (idx < 0) throw new Error('Membership not found.');
    registry.memberships.splice(idx, 1);
    return { ok: true };
  });
}

/**
 * Build public invite URL (raw token only appears here / in email).
 */
export function buildClientInviteUrl(origin, rawToken, locale = 'en') {
  const base = String(origin || '').replace(/\/$/, '');
  const lang = normalizeLocale(locale);
  const q = new URLSearchParams({
    invite: String(rawToken),
    signup: '1',
    lang,
  });
  return `${base}/client?${q.toString()}`;
}

export async function listInvites() {
  const registry = await readClientsRegistry();
  ensureInvitesArray(registry);
  return registry.invites.map(publicInvite).sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
}

/**
 * Create invite. Returns { invite, rawToken } — rawToken only once.
 */
export async function createInvite({
  email,
  locale = DEFAULT_LOCALE,
  note = '',
  createdBy = 'admin',
}) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) throw new Error('Valid email is required.');

  const existing = await getActiveClientByEmail(normalized);
  if (existing) {
    throw new Error('An active client account already exists for this email.');
  }

  const rawToken = generateInviteRawToken();
  const tokenHash = hashInviteToken(rawToken);
  const now = Date.now();

  const invite = await withRegistryMutation((registry) => {
    ensureInvitesArray(registry);
    // Revoke other pending invites for same email
    for (const inv of registry.invites) {
      if (
        inv.email === normalized &&
        !inv.usedAt &&
        !inv.revokedAt &&
        !(inv.expiresAt && new Date(inv.expiresAt).getTime() < now)
      ) {
        inv.revokedAt = new Date().toISOString();
      }
    }
    const row = {
      id: crypto.randomUUID(),
      email: normalized,
      locale: normalizeLocale(locale),
      tokenHash,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
      usedAt: null,
      revokedAt: null,
      createdBy,
      note: String(note || '').trim().slice(0, 200) || null,
    };
    registry.invites.push(row);
    return row;
  });

  return { invite: publicInvite(invite), rawToken };
}

export async function revokeInvite(id) {
  return withRegistryMutation((registry) => {
    ensureInvitesArray(registry);
    const inv = registry.invites.find((i) => i.id === id);
    if (!inv) throw new Error('Invite not found.');
    if (inv.usedAt) throw new Error('Invite already used.');
    if (inv.revokedAt) return publicInvite(inv);
    inv.revokedAt = new Date().toISOString();
    return publicInvite(inv);
  });
}

/**
 * Look up invite by raw token (does not consume).
 * @returns {{ invite: object, status: string } | null}
 */
export async function findInviteByRawToken(rawToken) {
  const raw = String(rawToken || '').trim();
  if (!raw || raw.length < 16) return null;
  const tokenHash = hashInviteToken(raw);
  const registry = await readClientsRegistry();
  ensureInvitesArray(registry);
  const inv = registry.invites.find((i) => i.tokenHash === tokenHash);
  if (!inv) return null;
  return { invite: inv, status: inviteStatus(inv), public: publicInvite(inv) };
}

/**
 * Consume invite after successful registration (must still be pending).
 */
export async function consumeInviteByRawToken(rawToken) {
  const raw = String(rawToken || '').trim();
  const tokenHash = hashInviteToken(raw);
  return withRegistryMutation((registry) => {
    ensureInvitesArray(registry);
    const inv = registry.invites.find((i) => i.tokenHash === tokenHash);
    if (!inv) {
      const err = new Error('Invalid or unknown invite.');
      err.code = 403;
      throw err;
    }
    const status = inviteStatus(inv);
    if (status === 'revoked') {
      const err = new Error('Invite was revoked.');
      err.code = 403;
      throw err;
    }
    if (status === 'expired') {
      const err = new Error('Invite has expired.');
      err.code = 410;
      throw err;
    }
    if (status === 'used') {
      const err = new Error('Invite already used.');
      err.code = 410;
      throw err;
    }
    inv.usedAt = new Date().toISOString();
    return publicInvite(inv);
  });
}

/** Re-resolve raw token for resend (pending only). */
export async function getInviteRawLookupMaterial(id) {
  const registry = await readClientsRegistry();
  ensureInvitesArray(registry);
  const inv = registry.invites.find((i) => i.id === id);
  if (!inv) throw new Error('Invite not found.');
  const status = inviteStatus(inv);
  if (status !== 'pending') {
    throw new Error(`Invite is ${status}; cannot resend.`);
  }
  return publicInvite(inv);
}

/**
 * Rotate token on resend so old copied links still work until expiry —
 * plan v1: keep same hash; admin must keep original URL.
 * For resend mail we need the raw token — store cannot recover it.
 * So on create we return raw once; for resend mail we rotate to a new token.
 */
export async function rotateInviteToken(id) {
  const rawToken = generateInviteRawToken();
  const tokenHash = hashInviteToken(rawToken);
  const invite = await withRegistryMutation((registry) => {
    ensureInvitesArray(registry);
    const inv = registry.invites.find((i) => i.id === id);
    if (!inv) throw new Error('Invite not found.');
    const status = inviteStatus(inv);
    if (status !== 'pending') {
      throw new Error(`Invite is ${status}; cannot rotate.`);
    }
    inv.tokenHash = tokenHash;
    // Extend expiry from now on rotate/resend
    inv.expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    return inv;
  });
  return { invite: publicInvite(invite), rawToken };
}
