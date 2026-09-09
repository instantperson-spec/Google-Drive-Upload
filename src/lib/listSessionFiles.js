import { google } from 'googleapis';

/**
 * List all non-folder files under a session folder (recursive).
 * @returns {Promise<Array<{ id: string, name: string, size: number, relativePath: string }>>}
 */
export async function listSessionFilesRecursive(authClient, sessionFolderId) {
  const drive = google.drive({ version: 'v3', auth: authClient });
  const results = [];

  async function walk(folderId, prefix) {
    let pageToken = null;
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, size, mimeType)',
        pageSize: 1000,
        pageToken,
      });

      for (const item of res.data.files || []) {
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          const childPrefix = prefix ? `${prefix}/${item.name}` : item.name;
          await walk(item.id, childPrefix);
        } else {
          const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
          results.push({
            id: item.id,
            name: item.name,
            size: Number(item.size || 0),
            relativePath,
          });
        }
      }

      pageToken = res.data.nextPageToken;
    } while (pageToken);
  }

  await walk(sessionFolderId, '');
  return results;
}
