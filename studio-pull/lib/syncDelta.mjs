/**
 * Compare local project tree vs Drive origin → upload plan.
 * Same size alone is not enough (WAV edits often keep byte length) —
 * use Drive md5Checksum vs local md5, or local mtime vs remote modifiedTime.
 */
import crypto from 'crypto';
import fs from 'fs';

/**
 * @param {string} localPath
 * @returns {Promise<string|null>}
 */
export function md5File(localPath) {
  return new Promise((resolve) => {
    try {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(localPath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * @param {Array<{ relativePath: string, size: number, localPath: string, name: string, mtimeMs?: number }>} localFiles
 * @param {Array<{ relativePath: string, size: number, id: string, md5Checksum?: string|null, modifiedTime?: string|null }>} driveFiles
 * @returns {Promise<{ upload: object[], skip: object[], driveByPath: Map<string, object> }>}
 */
export async function planSync(localFiles, driveFiles) {
  const driveByPath = new Map();
  for (const f of driveFiles) {
    driveByPath.set(f.relativePath.replace(/\\/g, '/'), f);
  }

  const upload = [];
  const skip = [];

  for (const local of localFiles) {
    const rel = local.relativePath.replace(/\\/g, '/');
    const remote = driveByPath.get(rel);

    if (remote && remote.size > 0 && remote.size === local.size) {
      let sameContent = false;

      if (remote.md5Checksum) {
        const localMd5 = await md5File(local.localPath);
        if (localMd5) local.md5 = localMd5;
        if (localMd5 && localMd5 === remote.md5Checksum) {
          sameContent = true;
        } else if (localMd5 && localMd5 !== remote.md5Checksum) {
          upload.push({
            ...local,
            driveId: remote.id,
            action: 'replace',
            reason: 'md5-mismatch',
          });
          continue;
        }
      }

      if (!sameContent && local.mtimeMs && remote.modifiedTime) {
        const remoteMs = Date.parse(remote.modifiedTime);
        // Local newer than Drive by >2s → treat as changed (same-size edit)
        if (Number.isFinite(remoteMs) && local.mtimeMs > remoteMs + 2000) {
          upload.push({
            ...local,
            driveId: remote.id,
            action: 'replace',
            reason: 'mtime-newer',
          });
          continue;
        }
        if (Number.isFinite(remoteMs) && local.mtimeMs <= remoteMs + 2000) {
          sameContent = true;
        }
      }

      if (sameContent || (!remote.md5Checksum && !(local.mtimeMs && remote.modifiedTime))) {
        // No md5/mtime signal: keep legacy same-size skip only when neither side has hints
        skip.push({
          ...local,
          driveId: remote.id,
          reason: sameContent ? 'unchanged' : 'same-size',
        });
        continue;
      }

      // Same size but inconclusive → upload to be safe for studio WAV workflows
      upload.push({
        ...local,
        driveId: remote.id,
        action: 'replace',
        reason: 'same-size-unverified',
      });
      continue;
    }

    upload.push({
      ...local,
      driveId: remote?.id || null,
      action: remote ? 'replace' : 'create',
    });
  }

  return { upload, skip, driveByPath };
}
