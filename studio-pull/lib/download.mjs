import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

function formatBytes(n) {
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * Download all listed Drive files into destRoot.
 * Skip when local file exists with the same size. Use .partial for in-progress.
 */
export async function downloadFiles(drive, files, destRoot, { failFast = false } = {}) {
  const stats = {
    downloaded: 0,
    skipped: 0,
    failed: 0,
    bytesDownloaded: 0,
  };

  const total = files.length;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const indexLabel = `[${i + 1}/${total}]`;
    const localPath = path.join(destRoot, file.relativePath);
    const partialPath = `${localPath}.partial`;

    try {
      fs.mkdirSync(path.dirname(localPath), { recursive: true });

      if (fs.existsSync(localPath)) {
        const localSize = fs.statSync(localPath).size;
        if (file.size > 0 && localSize === file.size) {
          console.log(`${indexLabel} skip  ${file.relativePath} (${formatBytes(file.size)})`);
          stats.skipped += 1;
          continue;
        }
        // Size mismatch — re-download
        fs.unlinkSync(localPath);
      }

      if (fs.existsSync(partialPath)) {
        fs.unlinkSync(partialPath);
      }

      process.stdout.write(
        `${indexLabel} get   ${file.relativePath} (${formatBytes(file.size)}) … `
      );

      const res = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'stream' }
      );

      const writeStream = fs.createWriteStream(partialPath);
      let received = 0;
      let lastPct = -1;

      res.data.on('data', (chunk) => {
        received += chunk.length;
        if (file.size > 0) {
          const pct = Math.floor((received / file.size) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            process.stdout.write(`${pct}% `);
          }
        }
      });

      await pipeline(res.data, writeStream);

      const finalSize = fs.statSync(partialPath).size;
      if (file.size > 0 && finalSize !== file.size) {
        throw new Error(`Size mismatch after download (got ${finalSize}, expected ${file.size})`);
      }

      fs.renameSync(partialPath, localPath);
      console.log('done');
      stats.downloaded += 1;
      stats.bytesDownloaded += finalSize;
    } catch (err) {
      stats.failed += 1;
      console.log(`FAIL: ${err.message || err}`);
      try {
        if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
      } catch {
        /* ignore */
      }
      if (failFast) throw err;
    }
  }

  return stats;
}

export { formatBytes };
