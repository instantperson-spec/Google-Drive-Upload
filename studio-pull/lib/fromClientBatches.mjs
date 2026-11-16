/**
 * Group FromClient/ Drive files into time batches (subfolders) or ungrouped legacy flats.
 */

export const FROM_CLIENT_PREFIX = 'FromClient/';
export const FROM_CLIENT_UNGROUPED = '__ungrouped__';

/**
 * @param {string} relativePath
 * @returns {string|null}
 */
export function fromClientBatchKey(relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (!rel.startsWith(FROM_CLIENT_PREFIX) && rel !== 'FromClient') return null;
  if (rel === 'FromClient') return FROM_CLIENT_UNGROUPED;
  const rest = rel.slice(FROM_CLIENT_PREFIX.length);
  const parts = rest.split('/').filter(Boolean);
  if (parts.length >= 2) return parts[0];
  return FROM_CLIENT_UNGROUPED;
}

/**
 * @param {string} batchId
 * @returns {string}
 */
export function labelForFromClientBatch(batchId) {
  if (!batchId || batchId === FROM_CLIENT_UNGROUPED) {
    return 'Earlier (ungrouped)';
  }
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})__/.exec(batchId);
  if (m) return `${m[1]} ${m[2]}:${m[3]}`;
  return batchId;
}

/**
 * @param {Array<{ relativePath?: string, size?: number }>} files
 * @returns {Array<{ batchId: string, label: string, fileCount: number, totalBytes: number, files: typeof files }>}
 */
export function groupFromClientBatches(files) {
  const map = new Map();
  for (const f of files || []) {
    const key = fromClientBatchKey(f.relativePath);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        batchId: key,
        files: [],
        fileCount: 0,
        totalBytes: 0,
      });
    }
    const b = map.get(key);
    b.files.push(f);
    b.fileCount += 1;
    b.totalBytes += Number(f.size) || 0;
  }

  const list = [...map.values()].map((b) => ({
    ...b,
    label: labelForFromClientBatch(b.batchId),
  }));

  list.sort((a, b) => {
    if (a.batchId === FROM_CLIENT_UNGROUPED) return 1;
    if (b.batchId === FROM_CLIENT_UNGROUPED) return -1;
    return b.batchId.localeCompare(a.batchId);
  });

  return list;
}

/**
 * Metadata only (no file arrays) for session list payloads.
 */
export function summarizeFromClientBatches(files) {
  return groupFromClientBatches(files).map(
    ({ batchId, label, fileCount, totalBytes }) => ({
      batchId,
      label,
      fileCount,
      totalBytes,
    })
  );
}
