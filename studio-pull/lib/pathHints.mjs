/**
 * Detect accidental nested pull folders: Session/Session/...
 */
import fs from 'fs';
import path from 'path';

function normalizeLabel(label) {
  return String(label || '')
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} localPath
 * @param {string|null} sessionLabel
 * @returns {string|null} warning message or null
 */
export function detectNestedSessionPath(localPath, sessionLabel) {
  if (!localPath) return null;
  const root = path.resolve(localPath);
  let entries;
  try {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  const label = normalizeLabel(sessionLabel);
  const variants = new Set();
  if (label) {
    variants.add(label);
    variants.add(label.replace(/:/g, '-'));
  }
  // Also treat folder basename as a possible nested label
  const base = path.basename(root);
  if (base) variants.add(base);

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.')) continue;
    if (!variants.has(ent.name)) continue;

    // Nested copy of session folder inside the bound path
    const nested = path.join(root, ent.name);
    let nestedKids = [];
    try {
      nestedKids = fs.readdirSync(nested, { withFileTypes: true });
    } catch {
      continue;
    }
    const hasFiles = nestedKids.some((k) => k.isFile() || k.isDirectory());
    if (!hasFiles) continue;

    return (
      `Wygląda na zagnieżdżenie „${ent.name}/${ent.name}/…”. ` +
      `Wskaż folder sesji (wewnętrzny), nie katalog nadrzędny z powtórzoną nazwą.`
    );
  }

  return null;
}
