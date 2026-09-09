export const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

/** Query resumable upload status (bytes already received). */
export function queryUploadStatus(uploadUrl) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Range', 'bytes */*');
    xhr.onload = () => {
      if (xhr.status === 308) {
        const range = xhr.getResponseHeader('Range');
        if (range) {
          const endByte = parseInt(range.split('-')[1], 10);
          resolve({ status: 'incomplete', nextByte: endByte + 1 });
        } else {
          resolve({ status: 'incomplete', nextByte: 0 });
        }
      } else if (xhr.status === 200 || xhr.status === 201) {
        resolve({ status: 'completed' });
      } else {
        resolve({ status: 'error' });
      }
    };
    xhr.onerror = () => resolve({ status: 'error' });
    xhr.send();
  });
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

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const totalLoaded = start + e.loaded;
        onProgress(Math.round((totalLoaded / file.size) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 308 || (xhr.status >= 200 && xhr.status < 300)) {
        resolve();
      } else {
        reject(new Error(`Chunk upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during chunk upload'));
    xhr.send(chunk);
  });
}
