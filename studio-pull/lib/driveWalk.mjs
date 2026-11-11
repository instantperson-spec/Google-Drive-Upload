const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SKIP_NAMES = new Set([
  '_uploader_tokens.json',
  '_uploader_progress.json',
  '_manifest.json',
  '_crash_log.txt',
]);

async function listChildren(drive, folderId) {
  const files = [];
  let pageToken = null;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, size, mimeType)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    if (res.data.files) files.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

/**
 * One-shot recursive listing of a single session folder tree.
 * @returns {Promise<Array<{ id: string, name: string, relativePath: string, size: number }>>}
 */
export async function walkDriveFolder(drive, rootFolderId) {
  const out = [];

  async function walk(folderId, prefix) {
    const children = await listChildren(drive, folderId);
    for (const item of children) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.mimeType === FOLDER_MIME) {
        await walk(item.id, rel);
        continue;
      }
      if (SKIP_NAMES.has(item.name)) continue;
      // Skip Google Docs/Sheets etc. (no binary size for local archive)
      if (item.mimeType?.startsWith('application/vnd.google-apps.')) continue;

      out.push({
        id: item.id,
        name: item.name,
        relativePath: rel,
        size: Number(item.size) || 0,
      });
    }
  }

  await walk(rootFolderId, '');
  return out;
}

/**
 * List recent session folders under the main upload root (one API page).
 */
export async function listSessionFolders(drive, mainFolderId, limit = 30) {
  const res = await drive.files.list({
    q: `'${mainFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id, name, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: Math.min(Math.max(limit, 1), 100),
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files || [];
}
