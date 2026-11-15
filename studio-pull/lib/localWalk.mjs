/**
 * Recursive local file listing with relative POSIX paths.
 */
import fs from 'fs';
import path from 'path';

const SKIP_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  '_team_manifest.json',
  '_uploader_tokens.json',
  '_uploader_progress.json',
  '_uploader_shares.json',
  '_uploader_session.json',
  '_manifest.json',
  '_crash_log.txt',
]);

/**
 * @returns {Array<{ relativePath: string, name: string, size: number, localPath: string, mtimeMs: number }>}
 */
export function walkLocalFolder(rootDir) {
  const root = path.resolve(rootDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Local folder not found: ${root}`);
  }

  const out = [];

  function walk(dir, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') && ent.name !== '.') continue;
      if (SKIP_NAMES.has(ent.name)) continue;
      if (ent.name.endsWith('.partial')) continue;

      const abs = path.join(dir, ent.name);
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;

      if (ent.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!ent.isFile()) continue;

      let size = 0;
      let mtimeMs = 0;
      try {
        const st = fs.statSync(abs);
        size = st.size;
        mtimeMs = st.mtimeMs;
      } catch {
        continue;
      }
      out.push({
        relativePath: rel.replace(/\\/g, '/'),
        name: ent.name,
        size,
        mtimeMs,
        localPath: abs,
      });
    }
  }

  walk(root, '');
  return out;
}
