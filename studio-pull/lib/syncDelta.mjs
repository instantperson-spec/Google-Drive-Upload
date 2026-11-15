/**
 * Compare local project tree vs Drive origin → upload plan.
 */

/**
 * @param {Array<{ relativePath: string, size: number, localPath: string, name: string }>} localFiles
 * @param {Array<{ relativePath: string, size: number, id: string }>} driveFiles
 * @returns {{ upload: object[], skip: object[], driveByPath: Map<string, object> }}
 */
export function planSync(localFiles, driveFiles) {
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
      skip.push({ ...local, driveId: remote.id, reason: 'same-size' });
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
