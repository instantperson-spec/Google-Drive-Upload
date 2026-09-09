// 32MB chunks — fewer round-trips and far fewer UI progress updates on multi-GB MOVs
export const CHUNK_SIZE = 32 * 1024 * 1024;

const STATUS_QUERY_TIMEOUT_MS = 30_000;
const CHUNK_TIMEOUT_MS = 10 * 60 * 1000; // 10 min per chunk (large MOVs on slow links)

export const UPLOAD_STATUS = {
  COMPLETED: 'completed',
  INCOMPLETE: 'incomplete',
  EXPIRED: 'expired',
  NETWORK_ERROR: 'network_error',
  ERROR: 'error',
};

/** @returns {Promise<{ status: string, nextByte?: number }>} */
export function queryUploadStatus(uploadUrl) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Range', 'bytes */*');

    let abortedByTimeout = false;

    const timer = setTimeout(() => {
      abortedByTimeout = true;
      xhr.abort();
    }, STATUS_QUERY_TIMEOUT_MS);

    const done = (result) => {
      clearTimeout(timer);
      resolve(result);
    };

    xhr.onload = () => {
      if (xhr.status === 308) {
        const range = xhr.getResponseHeader('Range');
        if (range) {
          const endByte = parseInt(range.split('-')[1], 10);
          done({ status: UPLOAD_STATUS.INCOMPLETE, nextByte: endByte + 1 });
        } else {
          done({ status: UPLOAD_STATUS.INCOMPLETE, nextByte: 0 });
        }
      } else if (xhr.status === 200 || xhr.status === 201) {
        done({ status: UPLOAD_STATUS.COMPLETED });
      } else if (xhr.status === 404 || xhr.status === 410) {
        done({ status: UPLOAD_STATUS.EXPIRED });
      } else {
        done({ status: UPLOAD_STATUS.ERROR });
      }
    };
    xhr.onerror = () => done({ status: UPLOAD_STATUS.NETWORK_ERROR });
    xhr.onabort = () => {
      done({
        status: abortedByTimeout ? UPLOAD_STATUS.NETWORK_ERROR : UPLOAD_STATUS.NETWORK_ERROR,
      });
    };
    xhr.send();
  });
}

/** Retry status query on transient network failures (keeps resumable URL). */
export async function queryUploadStatusWithRetry(uploadUrl, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await queryUploadStatus(uploadUrl);
    if (result.status !== UPLOAD_STATUS.NETWORK_ERROR) return result;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return { status: UPLOAD_STATUS.NETWORK_ERROR };
}

/**
 * Upload one chunk with optional progress callback (0–100 for whole file).
 * @param {{ url: string, file: File, start: number, end: number, onProgress?: (pct: number) => void }} opts
 */
export function uploadChunk({ url, file, start, end, onProgress }) {
  return new Promise((resolve, reject) => {
    const chunk = file.slice(start, end);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${file.size}`);

    const timer = setTimeout(() => {
      xhr.abort();
      reject(new Error('Chunk upload timed out — check your connection and retry.'));
    }, CHUNK_TIMEOUT_MS);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const totalLoaded = start + e.loaded;
        onProgress(Math.round((totalLoaded / file.size) * 100));
      }
    };

    xhr.onload = () => {
      clearTimeout(timer);
      if (xhr.status === 308 || (xhr.status >= 200 && xhr.status < 300)) {
        resolve();
      } else {
        reject(new Error(`Chunk upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Network error during chunk upload'));
    };
    xhr.onabort = () => clearTimeout(timer);
    xhr.send(chunk);
  });
}

/** True when the Google resumable session URL should be discarded and re-initiated. */
export function shouldDiscardUploadUrl(status) {
  return status === UPLOAD_STATUS.EXPIRED || status === UPLOAD_STATUS.ERROR;
}
