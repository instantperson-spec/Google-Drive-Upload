/**
 * Collect files with relative paths from folder pickers and drag-and-drop.
 * Plain dataTransfer.files only includes top-level files — nested folders need traversal.
 */

/** @typedef {{ file: File, relativePath: string }} FileEntry */

/**
 * Read all entries from a directory reader (readEntries returns max ~100 at a time).
 * @param {FileSystemDirectoryReader} dirReader
 * @returns {Promise<FileSystemEntry[]>}
 */
function readAllDirectoryEntries(dirReader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const readBatch = () => {
      dirReader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(all);
            return;
          }
          all.push(...batch);
          readBatch();
        },
        reject
      );
    };
    readBatch();
  });
}

/**
 * Recursively walk a FileSystemEntry (drag-and-drop API).
 * @param {FileSystemEntry} entry
 * @param {string} path prefix ending with / for directories
 * @returns {Promise<FileEntry[]>}
 */
async function traverseFileSystemEntry(entry, path = '') {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => {
      /** @type {FileSystemFileEntry} */ (entry).file(resolve, reject);
    });
    return [{ file, relativePath: path + file.name }];
  }

  if (entry.isDirectory) {
    const dirEntry = /** @type {FileSystemDirectoryEntry} */ (entry);
    const dirPath = path + dirEntry.name + '/';
    const children = await readAllDirectoryEntries(dirEntry.createReader());
    const nested = await Promise.all(
      children.map((child) => traverseFileSystemEntry(child, dirPath))
    );
    return nested.flat();
  }

  return [];
}

/**
 * Collect nested files from a DataTransfer (drag-and-drop).
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<FileEntry[]>}
 */
export async function collectEntriesFromDataTransfer(dataTransfer) {
  const items = dataTransfer.items;
  if (!items || items.length === 0) {
    return Array.from(dataTransfer.files || []).map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }));
  }

  const entries = /** @type {FileEntry[]} */ ([]);

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== 'file') continue;

    const fsEntry = item.webkitGetAsEntry?.() ?? item.getAsEntry?.() ?? null;
    if (fsEntry) {
      const nested = await traverseFileSystemEntry(fsEntry);
      entries.push(...nested);
    } else {
      const file = item.getAsFile();
      if (file) {
        entries.push({ file, relativePath: file.webkitRelativePath || file.name });
      }
    }
  }

  if (entries.length === 0 && dataTransfer.files?.length) {
    return Array.from(dataTransfer.files).map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }));
  }

  return entries;
}

/**
 * Recursively read a FileSystemDirectoryHandle (showDirectoryPicker).
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} pathPrefix
 * @returns {Promise<FileEntry[]>}
 */
async function walkDirectoryHandle(dirHandle, pathPrefix) {
  const results = /** @type {FileEntry[]} */ ([]);

  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      results.push({ file, relativePath: pathPrefix + name });
    } else if (handle.kind === 'directory') {
      const nested = await walkDirectoryHandle(handle, `${pathPrefix}${name}/`);
      results.push(...nested);
    }
  }

  return results;
}

/**
 * Open native folder picker with full nested read (Chrome, Edge, Safari 17+).
 * User selects any folder — all nested subfolders are included.
 * @returns {Promise<FileEntry[]>}
 */
export async function collectEntriesFromDirectoryPicker() {
  if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
    throw new Error('Directory picker not supported');
  }

  const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  return walkDirectoryHandle(dirHandle, `${dirHandle.name}/`);
}

/**
 * Normalize FileList from <input webkitdirectory> into FileEntry[].
 * @param {FileList|File[]} fileList
 * @returns {FileEntry[]}
 */
export function collectEntriesFromFileList(fileList) {
  return Array.from(fileList).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
}
