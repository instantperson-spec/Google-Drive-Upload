/**
 * Per-session _team_manifest.json on Drive.
 * baseline = immutable map of what the client originally uploaded (path → size).
 * Statuses are always derived: original | modified | new.
 */

export const MANIFEST_NAME = '_team_manifest.json';

async function findManifest(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name = '${MANIFEST_NAME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0] || null;
}

async function readJson(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'text' }
  );
  return JSON.parse(res.data);
}

/** Normalize legacy manifests into { baseline: { path: size } }. */
export function normalizeManifest(raw, folderId) {
  const manifest = raw && typeof raw === 'object' ? { ...raw } : {};
  manifest.version = 2;
  manifest.folderId = folderId || manifest.folderId || null;
  if (!manifest.baseline || typeof manifest.baseline !== 'object') {
    manifest.baseline = {};
  }

  // Migrate old files{ path: { baselineSize|size, status } } → baseline
  if (Object.keys(manifest.baseline).length === 0 && manifest.files) {
    for (const [path, meta] of Object.entries(manifest.files)) {
      if (!meta || typeof meta !== 'object') continue;
      if (typeof meta.baselineSize === 'number') {
        manifest.baseline[path] = meta.baselineMd5
          ? { size: meta.baselineSize, md5: meta.baselineMd5 }
          : meta.baselineSize;
      } else if (meta.status === 'original' && typeof meta.size === 'number') {
        manifest.baseline[path] = meta.md5Checksum
          ? { size: meta.size, md5: meta.md5Checksum }
          : meta.size;
      }
    }
  }

  if (!manifest.files || typeof manifest.files !== 'object') manifest.files = {};
  return manifest;
}

/**
 * @returns {Promise<{ fileId: string|null, manifest: object }>}
 */
export async function readManifest(drive, folderId) {
  const file = await findManifest(drive, folderId);
  if (!file) {
    return {
      fileId: null,
      manifest: normalizeManifest(
        {
          version: 2,
          folderId,
          token: null,
          baselineAt: null,
          baseline: {},
          files: {},
          updatedAt: null,
        },
        folderId
      ),
    };
  }
  const raw = await readJson(drive, file.id);
  return { fileId: file.id, manifest: normalizeManifest(raw, folderId) };
}

export async function writeManifest(drive, folderId, fileId, manifest) {
  const next = normalizeManifest(manifest, folderId);
  next.updatedAt = new Date().toISOString();
  const body = JSON.stringify(next, null, 2);

  if (!fileId) {
    const created = await drive.files.create({
      requestBody: {
        name: MANIFEST_NAME,
        mimeType: 'application/json',
        parents: [folderId],
      },
      media: { mimeType: 'application/json', body },
      fields: 'id',
      supportsAllDrives: true,
    });
    return created.data.id;
  }

  await drive.files.update({
    fileId,
    media: { mimeType: 'application/json', body },
    supportsAllDrives: true,
  });
  return fileId;
}

export function hasBaseline(manifest) {
  return Boolean(manifest?.baselineAt && manifest.baseline && Object.keys(manifest.baseline).length);
}

/**
 * Classify one file vs immutable client baseline.
 */
export function statusForFile(relativePath, size, baseline = {}, opts = {}) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (!(rel in baseline)) return 'new';
  const entry = baseline[rel];
  const baseSize = typeof entry === 'object' && entry != null ? Number(entry.size) : Number(entry);
  const baseMd5 = typeof entry === 'object' && entry != null ? entry.md5 || null : null;
  if (!Number.isFinite(baseSize)) return 'new';
  if (Number(size) !== baseSize) return 'modified';
  const md5 = opts.md5 || null;
  if (baseMd5 && md5 && baseMd5 !== md5) return 'modified';
  if (baseMd5 && md5 && baseMd5 === md5) return 'original';
  const baselineAt = opts.baselineAt || null;
  const modifiedTime = opts.modifiedTime || null;
  if (baselineAt && modifiedTime) {
    const baseMs = Date.parse(baselineAt);
    const modMs = Date.parse(modifiedTime);
    if (Number.isFinite(baseMs) && Number.isFinite(modMs) && modMs > baseMs + 2000) {
      return 'modified';
    }
  }
  return 'original';
}

/**
 * Build / keep immutable baseline from a file list (client originals).
 * Never overwrites an existing baseline unless force=true.
 */
export function setBaselineFromFiles(fileList, { token = null, force = false, prev = null } = {}) {
  const prevNorm = prev ? normalizeManifest(prev, prev.folderId) : null;
  if (!force && prevNorm && hasBaseline(prevNorm)) {
    return prevNorm;
  }

  const baseline = {};
  const files = {};
  for (const f of fileList || []) {
    const rel = String(f.relativePath || '').replace(/\\/g, '/');
    if (!rel) continue;
    const size = Number(f.size) || 0;
    const md5 = f.md5Checksum || f.md5 || null;
    baseline[rel] = md5 ? { size, md5 } : size;
    files[rel] = {
      size,
      status: 'original',
      baselineSize: size,
      baselineMd5: md5,
      md5Checksum: md5,
    };
  }

  return {
    version: 2,
    folderId: prevNorm?.folderId || null,
    token: token || prevNorm?.token || null,
    baselineAt: new Date().toISOString(),
    baseline,
    files,
  };
}

/** @deprecated alias — pull/sync call sites */
export function buildBaselineFromLocal(localFiles, opts = {}) {
  return setBaselineFromFiles(localFiles, opts);
}

/**
 * Recompute cached status map from current files vs immutable baseline.
 * Does NOT change baseline.
 */
export function recomputeStatuses(manifest, currentFiles) {
  const norm = normalizeManifest(manifest, manifest.folderId);
  const baseline = norm.baseline || {};
  const files = {};
  for (const f of currentFiles || []) {
    const rel = String(f.relativePath || '').replace(/\\/g, '/');
    const size = Number(f.size) || 0;
    const md5 = f.md5Checksum || f.md5 || null;
    const modifiedTime =
      f.modifiedTime ||
      (Number.isFinite(f.mtimeMs) && f.mtimeMs > 0
        ? new Date(f.mtimeMs).toISOString()
        : null);
    const status = statusForFile(rel, size, baseline, {
      md5,
      modifiedTime,
      baselineAt: norm.baselineAt,
    });
    const baseEntry = baseline[rel];
    const baselineSize =
      typeof baseEntry === 'object' && baseEntry != null
        ? baseEntry.size
        : rel in baseline
          ? baseEntry
          : null;
    const baselineMd5 =
      typeof baseEntry === 'object' && baseEntry != null ? baseEntry.md5 || null : null;
    files[rel] = {
      size,
      status,
      baselineSize,
      baselineMd5,
      md5Checksum: md5,
    };
  }
  return {
    ...norm,
    files,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * If local tree is nested under a single folder matching sessionLabel, strip that prefix
 * so sync paths match Drive origin (avoids uploading "Session Name/Clips/..." into origin).
 */
export function stripSessionPrefix(localFiles, sessionLabel) {
  const label = String(sessionLabel || '')
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label || !localFiles?.length) return localFiles;

  // Also try colon→hyphen variant Finder/Drive sometimes use in names
  const variants = new Set([
    label,
    label.replace(/:/g, '-'),
    label.replace(/:/g, '-').replace(/\s+/g, ' '),
  ]);

  const prefixed = localFiles.every((f) => {
    const rel = f.relativePath.replace(/\\/g, '/');
    const top = rel.split('/')[0];
    return variants.has(top) && rel.includes('/');
  });
  if (!prefixed) return localFiles;

  const top = localFiles[0].relativePath.replace(/\\/g, '/').split('/')[0];
  const prefix = `${top}/`;
  return localFiles.map((f) => {
    const rel = f.relativePath.replace(/\\/g, '/');
    return {
      ...f,
      relativePath: rel.startsWith(prefix) ? rel.slice(prefix.length) : rel,
    };
  });
}
