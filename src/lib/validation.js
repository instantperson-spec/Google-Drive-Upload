import { BLOCKED_EXTENSIONS } from '@/lib/blocklist';

// Per-file size cap, configurable via env (in GB)
const MAX_FILE_SIZE_GB = parseInt(process.env.MAX_FILE_SIZE_GB || '250', 10);
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_GB * 1024 * 1024 * 1024;

/**
 * @param {string} name file name, may include a relative path (webkitRelativePath)
 * @returns {string|null} error message or null if the file is acceptable
 */
export function validateFileMetadata(name, size) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 500) {
    return 'Invalid file name.';
  }

  const baseName = name.split('/').pop();
  const extension = baseName.includes('.') ? baseName.split('.').pop().toLowerCase() : '';
  if (BLOCKED_EXTENSIONS.has(extension)) {
    return `File type ".${extension}" is not allowed for security reasons.`;
  }

  const numericSize = Number(size);
  if (!Number.isFinite(numericSize) || numericSize <= 0) {
    return 'Invalid file size.';
  }
  if (numericSize > MAX_FILE_SIZE_BYTES) {
    return `File exceeds the maximum allowed size of ${MAX_FILE_SIZE_GB} GB.`;
  }

  return null;
}
