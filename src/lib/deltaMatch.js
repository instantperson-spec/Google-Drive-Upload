/**
 * Normalize client-side relative paths for comparison with Drive inventory.
 */
export function normalizeClientPath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') return '';
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** First segment looks like an external volume / disk label (not project content). */
const VOLUME_ROOT_RE = /drive|volume|disk|\(\d+\s*(TB|GB|MB)\)/i;

/**
 * Path variants for matching when the client selected an entire drive root.
 * e.g. "T7 Drive 02 (2TB)/Project/Media/file.mov" → also "Project/Media/file.mov"
 */
export function clientPathVariants(relativePath) {
  const p = normalizeClientPath(relativePath);
  const variants = new Set([p]);
  const parts = p.split('/').filter(Boolean);
  if (parts.length < 2) return [...variants];

  if (VOLUME_ROOT_RE.test(parts[0])) {
    variants.add(parts.slice(1).join('/'));
  }
  if (parts.length >= 3 && VOLUME_ROOT_RE.test(parts[0]) && VOLUME_ROOT_RE.test(parts[1])) {
    variants.add(parts.slice(2).join('/'));
  }

  return [...variants];
}

function pathsEquivalent(clientVariants, drivePath) {
  const normDrive = normalizeClientPath(drivePath);
  if (!normDrive) return false;

  for (const clientPath of clientVariants) {
    if (!clientPath) continue;
    if (normDrive === clientPath) return true;
    if (normDrive.endsWith(`/${clientPath}`)) return true;
    if (clientPath.endsWith(`/${normDrive}`)) return true;
    if (clientPath.endsWith(normDrive)) return true;
  }
  return false;
}

/**
 * @returns {boolean} true if the file already exists on Drive (size must match).
 */
export function isFileOnDrive(entry, driveFiles, tolerancePct = 0.02) {
  const clientVariants = clientPathVariants(entry.relativePath);
  const uploadName = entry.uploadName || normalizeClientPath(entry.relativePath).split('/').pop();
  const size = Number(entry.size);

  return driveFiles.some((df) => {
    if (!sizeClose(df.size, size, tolerancePct)) return false;

    const drivePath = df.relativePath || df.name;
    if (pathsEquivalent(clientVariants, drivePath)) return true;

    return df.name === uploadName;
  });
}

function sizeClose(a, b, tolerancePct) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const diff = Math.abs(x - y);
  const tol = Math.max(64 * 1024, Math.max(x, y) * tolerancePct);
  return diff <= tol;
}

/**
 * Partition upload queue into already on Drive vs needs upload.
 */
export function partitionUploadQueue(entries, driveFiles) {
  const onDrive = [];
  const toUpload = [];

  for (const entry of entries) {
    if (isFileOnDrive(entry, driveFiles)) {
      onDrive.push(entry);
    } else {
      toUpload.push(entry);
    }
  }

  return { onDrive, toUpload };
}
