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

function defaultConsoleEvent(event) {
  const { type } = event;
  if (type === 'skip') {
    console.log(
      `[${event.index}/${event.total}] skip  ${event.relativePath} (${formatBytes(event.size)})`
    );
  } else if (type === 'progress') {
    if (event.phase === 'start') {
      process.stdout.write(
        `[${event.index}/${event.total}] get   ${event.relativePath} (${formatBytes(event.size)}) … `
      );
    } else if (event.phase === 'pct') {
      process.stdout.write(`${event.pct}% `);
    } else if (event.phase === 'done') {
      console.log('done');
    }
  } else if (type === 'error') {
    console.log(`FAIL: ${event.message}`);
  } else if (type === 'cancelled') {
    console.log('Cancelled.');
  }
}

/**
 * Download all listed Drive files into destRoot.
 * Skip when local file exists with the same size. Use .partial for in-progress.
 *
 * @param {object} [options]
 * @param {boolean} [options.failFast]
 * @param {(event: object) => void} [options.onEvent]
 * @param {() => boolean} [options.shouldCancel]
 */
export async function downloadFiles(drive, files, destRoot, options = {}) {
  const { failFast = false, shouldCancel } = options;
  const onEvent = options.onEvent || defaultConsoleEvent;

  const stats = {
    downloaded: 0,
    skipped: 0,
    failed: 0,
    bytesDownloaded: 0,
  };

  const total = files.length;

  for (let i = 0; i < files.length; i += 1) {
    if (shouldCancel?.()) {
      onEvent({ type: 'cancelled' });
      break;
    }

    const file = files[i];
    const index = i + 1;
    const localPath = path.join(destRoot, file.relativePath);
    const partialPath = `${localPath}.partial`;

    try {
      fs.mkdirSync(path.dirname(localPath), { recursive: true });

      if (fs.existsSync(localPath)) {
        const localSize = fs.statSync(localPath).size;
        if (file.size > 0 && localSize === file.size) {
          onEvent({
            type: 'skip',
            index,
            total,
            relativePath: file.relativePath,
            size: file.size,
          });
          stats.skipped += 1;
          continue;
        }
        fs.unlinkSync(localPath);
      }

      if (fs.existsSync(partialPath)) {
        fs.unlinkSync(partialPath);
      }

      onEvent({
        type: 'progress',
        phase: 'start',
        index,
        total,
        relativePath: file.relativePath,
        size: file.size,
      });

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
            onEvent({
              type: 'progress',
              phase: 'pct',
              index,
              total,
              relativePath: file.relativePath,
              size: file.size,
              received,
              pct,
            });
          }
        }
      });

      await pipeline(res.data, writeStream);

      if (shouldCancel?.()) {
        try {
          if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
        } catch {
          /* ignore */
        }
        onEvent({ type: 'cancelled' });
        break;
      }

      const finalSize = fs.statSync(partialPath).size;
      if (file.size > 0 && finalSize !== file.size) {
        throw new Error(`Size mismatch after download (got ${finalSize}, expected ${file.size})`);
      }

      fs.renameSync(partialPath, localPath);
      onEvent({
        type: 'progress',
        phase: 'done',
        index,
        total,
        relativePath: file.relativePath,
        size: finalSize,
      });
      stats.downloaded += 1;
      stats.bytesDownloaded += finalSize;
    } catch (err) {
      stats.failed += 1;
      onEvent({
        type: 'error',
        index,
        total,
        relativePath: file.relativePath,
        message: err.message || String(err),
      });
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
