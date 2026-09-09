const MAX_RELATIVE_PATH_LENGTH = 500;
const MAX_PATH_DEPTH = 50;
const MAX_MANIFEST_ENTRIES = 5000;

/**
 * Escape a Drive query string literal (single-quoted value).
 */
export function escapeDriveQueryLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Derive a unique flat upload name for Drive (files live in session root during upload).
 * @param {string} relativePath webkitRelativePath or plain file name
 * @param {Set<string>} usedNames names already assigned in this batch
 */
export function deriveUploadName(relativePath, usedNames) {
  const basename = relativePath.split('/').pop() || relativePath;
  if (!usedNames.has(basename)) {
    usedNames.add(basename);
    return basename;
  }

  const parent = relativePath.includes('/')
    ? relativePath.slice(0, relativePath.lastIndexOf('/')).replace(/\//g, '_')
    : 'dup';

  let candidate = `${parent}__${basename}`;
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate);
    return candidate;
  }

  for (let n = 2; n < 10_000; n += 1) {
    candidate = `${parent}__${basename}__${n}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }

  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : String(Date.now());
  const fallback = `${parent}__${basename}__${suffix}`;
  usedNames.add(fallback);
  return fallback;
}

/**
 * @returns {string|null} error message or null if valid
 */
export function validateRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    return 'Invalid relative path.';
  }
  if (relativePath.length > MAX_RELATIVE_PATH_LENGTH) {
    return 'Relative path too long.';
  }
  if (relativePath.startsWith('/') || relativePath.includes('\\')) {
    return 'Relative path must use forward slashes and no leading slash.';
  }
  if (relativePath.includes('..')) {
    return 'Relative path must not contain "..".';
  }

  const parts = relativePath.split('/');
  if (parts.some((p) => p === '')) {
    return 'Relative path must not contain empty segments.';
  }
  if (parts.length > MAX_PATH_DEPTH) {
    return 'Folder nesting too deep.';
  }

  return null;
}

/**
 * Validate manifest payload from client before build-structure runs.
 * @param {unknown} body
 * @returns {{ folderId: string, entries: Array<{ uploadName: string, relativePath: string, size: number }> }|{ error: string }}
 */
export function parseManifestPayload(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid request body.' };
  }

  const { folderId, entries } = body;
  if (!folderId || typeof folderId !== 'string') {
    return { error: 'folderId is required.' };
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    return { error: 'Manifest entries are required.' };
  }
  if (entries.length > MAX_MANIFEST_ENTRIES) {
    return { error: `Too many files (max ${MAX_MANIFEST_ENTRIES}).` };
  }

  const parsed = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      return { error: 'Invalid manifest entry.' };
    }
    const { uploadName, relativePath, size } = entry;
    if (typeof uploadName !== 'string' || !uploadName.trim() || uploadName.length > 255) {
      return { error: 'Invalid uploadName in manifest.' };
    }
    const pathError = validateRelativePath(relativePath);
    if (pathError) return { error: pathError };

    const numericSize = Number(size);
    if (!Number.isFinite(numericSize) || numericSize <= 0) {
      return { error: 'Invalid size in manifest entry.' };
    }

    parsed.push({
      uploadName: uploadName.trim(),
      relativePath: relativePath.trim(),
      size: numericSize,
    });
  }

  return { folderId, entries: parsed };
}

/** True when at least one file sits in a subfolder (needs build-structure). */
export function manifestNeedsStructure(entries) {
  return entries.some((e) => e.relativePath.includes('/'));
}

/**
 * Unique folder paths required by manifest (excluding file basename).
 * @returns {string[]} sorted by depth ascending e.g. ["A", "A/B"]
 */
export function collectFolderPaths(entries) {
  const paths = new Set();
  for (const { relativePath } of entries) {
    const parts = relativePath.split('/');
    if (parts.length <= 1) continue;
    for (let i = 1; i < parts.length; i += 1) {
      paths.add(parts.slice(0, i).join('/'));
    }
  }
  return [...paths].sort((a, b) => a.split('/').length - b.split('/').length);
}
