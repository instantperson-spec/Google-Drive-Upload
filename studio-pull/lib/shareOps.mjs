/**
 * Client share links (_uploader_shares.json at Drive root).
 * Separate from upload tokens — access only via explicit share id.
 */
import crypto from 'crypto';
import { createDriveClient } from './auth.mjs';
import { publishRound, roundsMeta } from './manifestOps.mjs';

export const SHARES_FILE_NAME = '_uploader_shares.json';

function publicOrigin(env = {}) {
  return (env.PUBLIC_UPLOAD_URL || 'https://drive-uploader-three.vercel.app').replace(/\/$/, '');
}

export function buildShareUrl(shareId, env = {}) {
  return `${publicOrigin(env)}/share/${encodeURIComponent(shareId)}`;
}

async function findSharesFile(drive, mainFolderId) {
  const res = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '${SHARES_FILE_NAME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0] || null;
}

async function readSharesRegistry(drive, mainFolderId) {
  const file = await findSharesFile(drive, mainFolderId);
  if (!file) {
    return {
      fileId: null,
      registry: { version: 1, updatedAt: new Date().toISOString(), shares: [] },
    };
  }
  const res = await drive.files.get(
    { fileId: file.id, alt: 'media', supportsAllDrives: true },
    { responseType: 'text' }
  );
  const registry = JSON.parse(res.data);
  if (!Array.isArray(registry.shares)) registry.shares = [];
  return { fileId: file.id, registry };
}

async function writeSharesRegistry(drive, mainFolderId, fileId, registry) {
  registry.updatedAt = new Date().toISOString();
  const body = JSON.stringify(registry, null, 2);
  if (!fileId) {
    const created = await drive.files.create({
      requestBody: {
        name: SHARES_FILE_NAME,
        mimeType: 'application/json',
        parents: [mainFolderId],
      },
      media: { mimeType: 'application/json', body },
      fields: 'id',
      supportsAllDrives: true,
    });
    return created.data.id;
  }
  await drive.files.update({
    fileId,
    media: { mimeType: 'application/json', body },
    supportsAllDrives: true,
  });
  return fileId;
}

export async function listSharesLocal() {
  const { drive, mainFolderId, env } = createDriveClient();
  const { registry } = await readSharesRegistry(drive, mainFolderId);
  return registry.shares.map((s) => ({
    ...s,
    url: buildShareUrl(s.id, env),
    status: s.revoked ? 'revoked' : 'active',
  }));
}

function withShareUrl(record, env) {
  return {
    ...record,
    url: buildShareUrl(record.id, env),
    status: record.revoked ? 'revoked' : 'active',
  };
}

/**
 * Create or reuse active share for folder. Optionally set roundId / rounds meta.
 */
export async function createShareLocal({
  folderId,
  token = null,
  label = null,
  roundId = null,
  roundLabel = null,
  rounds = null,
} = {}) {
  if (!folderId) throw new Error('folderId is required.');
  const { drive, mainFolderId, env } = createDriveClient();
  const { fileId, registry } = await readSharesRegistry(drive, mainFolderId);

  const existing = registry.shares.find(
    (s) => s.folderId === folderId && !s.revoked
  );
  if (existing) {
    let dirty = false;
    if (token && !existing.token) {
      existing.token = token;
      dirty = true;
    }
    if (label && existing.label !== label) {
      existing.label = label;
      dirty = true;
    }
    if (roundId) {
      existing.roundId = roundId;
      existing.roundLabel = roundLabel || existing.roundLabel || null;
      dirty = true;
    }
    if (Array.isArray(rounds)) {
      existing.rounds = rounds;
      dirty = true;
    }
    if (dirty) {
      await writeSharesRegistry(drive, mainFolderId, fileId, registry);
    }
    return { ...withShareUrl(existing, env), reused: true };
  }

  const now = new Date().toISOString();
  const record = {
    id: `shr_${crypto.randomBytes(12).toString('hex')}`,
    folderId,
    token: token || null,
    label: label || null,
    createdAt: now,
    revoked: false,
    revokedAt: null,
    roundId: roundId || null,
    roundLabel: roundLabel || null,
    rounds: Array.isArray(rounds) ? rounds : [],
  };
  registry.shares.push(record);
  await writeSharesRegistry(drive, mainFolderId, fileId, registry);
  return { ...withShareUrl(record, env), reused: false };
}

/**
 * Publish next Draft N, upsert share with roundId, return share + round.
 */
export async function publishAndShare({
  folderId,
  token = null,
  label = null,
  roundLabel = null,
} = {}) {
  if (!folderId) throw new Error('folderId is required.');
  const { drive, env } = createDriveClient();
  const { round, manifest } = await publishRound(drive, folderId, {
    label: roundLabel,
  });
  const meta = roundsMeta(manifest);
  const share = await createShareLocal({
    folderId,
    token,
    label,
    roundId: round.id,
    roundLabel: round.label,
    rounds: meta,
  });
  return {
    share: withShareUrl(share, env),
    round: { id: round.id, label: round.label, publishedAt: round.publishedAt },
    rounds: meta,
  };
}

export async function revokeShareLocal(id) {
  const { drive, mainFolderId, env } = createDriveClient();
  const { fileId, registry } = await readSharesRegistry(drive, mainFolderId);
  const record = registry.shares.find((s) => s.id === id);
  if (!record) throw new Error('Share not found.');
  record.revoked = true;
  record.revokedAt = new Date().toISOString();
  await writeSharesRegistry(drive, mainFolderId, fileId, registry);
  return {
    ...record,
    url: buildShareUrl(record.id, env),
    status: 'revoked',
  };
}

export async function getShareByIdLocal(id) {
  const { drive, mainFolderId, env } = createDriveClient();
  const { registry } = await readSharesRegistry(drive, mainFolderId);
  const record = registry.shares.find((s) => s.id === id);
  if (!record) return null;
  return {
    ...record,
    url: buildShareUrl(record.id, env),
    status: record.revoked ? 'revoked' : 'active',
  };
}
