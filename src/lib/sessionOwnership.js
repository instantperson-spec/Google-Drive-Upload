import crypto from 'crypto';
import { google } from 'googleapis';

export const SESSION_META_NAME = '_uploader_session.json';

const ownershipCache = new Map(); // folderId -> { tokenFp: string, verifiedAt: number }
const OWNERSHIP_TTL_MS = 30 * 60 * 1000;
const MAX_OWNERSHIP_CACHE = 500;

function setOwnershipCache(folderId, tokenFp) {
  ownershipCache.set(folderId, { tokenFp, verifiedAt: Date.now() });
  if (ownershipCache.size > MAX_OWNERSHIP_CACHE) {
    const oldest = ownershipCache.keys().next().value;
    ownershipCache.delete(oldest);
  }
}

function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function getDrive(authClient) {
  return google.drive({ version: 'v3', auth: authClient });
}

async function findSessionMeta(drive, folderId) {
  const escaped = SESSION_META_NAME.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name = '${escaped}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0] || null;
}

/**
 * Stamp a new session folder with the owning upload-token fingerprint.
 * Call once from create-folder.
 */
export async function writeSessionOwnership(authClient, folderId, token) {
  const drive = getDrive(authClient);
  const fp = tokenFingerprint(token);
  const body = JSON.stringify(
    {
      version: 1,
      tokenFp: fp,
      createdAt: new Date().toISOString(),
    },
    null,
    2
  );

  const existing = await findSessionMeta(drive, folderId);
  if (existing) {
    await drive.files.update({
      fileId: existing.id,
      media: { mimeType: 'application/json', body },
      supportsAllDrives: true,
    });
    setOwnershipCache(folderId, fp);
    return existing.id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: SESSION_META_NAME,
      mimeType: 'application/json',
      parents: [folderId],
    },
    media: { mimeType: 'application/json', body },
    fields: 'id',
    supportsAllDrives: true,
  });
  setOwnershipCache(folderId, fp);
  return created.data.id;
}

/**
 * Fail-closed ownership check: folder must have _uploader_session.json
 * whose tokenFp matches the caller's upload token.
 * Legacy folders without the file are rejected (client must start a new session).
 *
 * @returns {Promise<{ ok: true } | { ok: false, status: number, error: string }>}
 */
export async function assertFolderOwnedByToken(authClient, folderId, token) {
  if (!folderId || !token) {
    return { ok: false, status: 403, error: 'Missing folder or token.' };
  }

  const expected = tokenFingerprint(token);
  const cached = ownershipCache.get(folderId);
  if (cached && Date.now() - cached.verifiedAt < OWNERSHIP_TTL_MS) {
    if (cached.tokenFp === expected) {
      return { ok: true };
    }
    return { ok: false, status: 403, error: 'Folder is not owned by this upload token.' };
  }

  try {
    const drive = getDrive(authClient);
    const meta = await findSessionMeta(drive, folderId);
    if (!meta) {
      return {
        ok: false,
        status: 403,
        error: 'Session ownership missing. Start a new upload session.',
      };
    }

    const res = await drive.files.get(
      { fileId: meta.id, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' }
    );
    const data = JSON.parse(res.data);
    const actual = typeof data?.tokenFp === 'string' ? data.tokenFp : '';
    if (actual) {
      setOwnershipCache(folderId, actual);
    }
    if (!actual || actual !== expected) {
      return { ok: false, status: 403, error: 'Folder is not owned by this upload token.' };
    }
    return { ok: true };
  } catch (err) {
    console.error('assertFolderOwnedByToken:', err.message || err);
    return { ok: false, status: 403, error: 'Could not verify session ownership.' };
  }
}
