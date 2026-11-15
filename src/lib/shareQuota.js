/**
 * Per-share upload quotas (in-memory per warm instance).
 * Hard caps via env; defaults are conservative abuse brakes.
 */

const hits = new Map(); // shareId -> { files: number, bytes: number, day: string }

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function limits() {
  return {
    maxFiles: Number(process.env.SHARE_UPLOAD_MAX_FILES_PER_DAY) || 200,
    maxBytes: Number(process.env.SHARE_UPLOAD_MAX_BYTES_PER_DAY) || 5 * 1024 * 1024 * 1024,
  };
}

/**
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertShareUploadAllowed(shareId, fileSize) {
  const size = Math.max(0, Number(fileSize) || 0);
  const { maxFiles, maxBytes } = limits();
  const today = dayKey();
  let entry = hits.get(shareId);
  if (!entry || entry.day !== today) {
    entry = { files: 0, bytes: 0, day: today };
  }

  if (entry.files + 1 > maxFiles) {
    return {
      ok: false,
      error: `Share upload limit reached (${maxFiles} files/day).`,
    };
  }
  if (entry.bytes + size > maxBytes) {
    return {
      ok: false,
      error: `Share upload size limit reached for today.`,
    };
  }

  entry.files += 1;
  entry.bytes += size;
  hits.set(shareId, entry);

  if (hits.size > 5000) {
    const first = hits.keys().next().value;
    hits.delete(first);
  }

  return { ok: true };
}
