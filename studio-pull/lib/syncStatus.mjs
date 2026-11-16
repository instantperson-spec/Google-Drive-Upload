/**
 * Lightweight out-of-sync detection for Studio Console sessions.
 */
import fs from 'fs';
import path from 'path';
import { walkDriveFolder } from './driveWalk.mjs';
import { detectNestedSessionPath } from './pathHints.mjs';
import {
  FROM_CLIENT_PREFIX,
  summarizeFromClientBatches,
} from './fromClientBatches.mjs';

/**
 * @param {object} drive
 * @param {string} folderId
 * @param {{ localPath?: string|null, lastSyncedAt?: string|null, lastClientPullAt?: string|null, label?: string|null }|null} binding
 */
export async function computeSyncStatus(drive, folderId, binding) {
  const files = await walkDriveFolder(drive, folderId);
  const fromClientFiles = files.filter((f) =>
    String(f.relativePath || '').startsWith(FROM_CLIENT_PREFIX)
  );
  const studioFiles = files.filter(
    (f) => !String(f.relativePath || '').startsWith(FROM_CLIENT_PREFIX)
  );

  let remoteChangedAt = null;
  let studioRemoteChangedAt = null;
  for (const f of files) {
    const t = f.modifiedTime || f.createdTime || null;
    if (t && (!remoteChangedAt || t > remoteChangedAt)) remoteChangedAt = t;
  }
  for (const f of studioFiles) {
    const t = f.modifiedTime || f.createdTime || null;
    if (t && (!studioRemoteChangedAt || t > studioRemoteChangedAt)) {
      studioRemoteChangedAt = t;
    }
  }

  let missingLocalFromClient = 0;
  const localRoot = binding?.localPath || null;
  if (localRoot) {
    for (const f of fromClientFiles) {
      const localFile = path.join(localRoot, f.relativePath);
      try {
        if (!fs.existsSync(localFile) || fs.statSync(localFile).size !== f.size) {
          missingLocalFromClient += 1;
        }
      } catch {
        missingLocalFromClient += 1;
      }
    }
  } else if (fromClientFiles.length) {
    missingLocalFromClient = fromClientFiles.length;
  }

  const lastSyncedAt = binding?.lastSyncedAt || null;
  const studioRemoteNewer = Boolean(
    lastSyncedAt &&
      studioRemoteChangedAt &&
      new Date(studioRemoteChangedAt) > new Date(lastSyncedAt)
  );
  const fromClientPending = missingLocalFromClient > 0;

  const syncStatus =
    fromClientPending || studioRemoteNewer ? 'out_of_sync' : 'ok';

  const nestedWarning = localRoot
    ? detectNestedSessionPath(localRoot, binding?.label || null)
    : null;

  return {
    syncStatus,
    reasons: {
      fromClientPending,
      studioRemoteNewer,
    },
    lastSyncedAt,
    lastClientPullAt: binding?.lastClientPullAt || null,
    remoteChangedAt,
    fromClientCount: fromClientFiles.length,
    fromClientBatches: summarizeFromClientBatches(fromClientFiles),
    missingLocalFromClient,
    nestedWarning,
  };
}
