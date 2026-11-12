import { createDriveClient } from './auth.mjs';

const PROGRESS_FILE_NAME = '_uploader_progress.json';

/**
 * Map session folderId -> latest progress activity (from Drive registry).
 * @returns {Promise<Map<string, { updatedAt: string, sessionStatus: string, uploaderName: string, token: string }>>}
 */
export async function loadProgressByFolderId() {
  const { drive, mainFolderId } = createDriveClient();
  const found = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '${PROGRESS_FILE_NAME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const fileId = found.data.files?.[0]?.id;
  const map = new Map();
  if (!fileId) return map;

  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  let registry;
  try {
    registry = JSON.parse(raw);
  } catch {
    return map;
  }

  for (const session of Object.values(registry.sessions || {})) {
    if (!session?.folderId) continue;
    const prev = map.get(session.folderId);
    if (!prev || String(session.updatedAt || '') > String(prev.updatedAt || '')) {
      map.set(session.folderId, {
        updatedAt: session.updatedAt || '',
        sessionStatus: session.sessionStatus || '',
        uploaderName: session.uploaderName || '',
        token: session.token || '',
      });
    }
  }
  return map;
}
