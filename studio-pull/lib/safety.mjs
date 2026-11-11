import fs from 'fs';
import os from 'os';
import path from 'path';

const MAC_SYSTEM_PREFIXES = [
  '/System',
  '/Users',
  '/Applications',
  '/Library',
  '/private',
  '/opt',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
];

/**
 * Resolve and validate a download destination on an external volume.
 * Refuses system disks; never silently remaps.
 * @param {string} destInput
 * @param {{ create?: boolean }} [opts]
 * @returns {{ dest: string }}
 */
export function assertSafeDest(destInput, opts = {}) {
  const create = opts.create !== false;
  if (!destInput || typeof destInput !== 'string') {
    throw new Error('Destination path is required (--dest=/Volumes/YourDisk/Folder).');
  }

  const dest = path.resolve(destInput);

  if (process.platform === 'darwin') {
    assertSafeMacDest(dest);
  } else if (process.platform === 'win32') {
    assertSafeWinDest(dest);
  } else {
    // Linux / other: refuse home and obvious system roots
    const home = os.homedir();
    if (dest === '/' || dest.startsWith('/home/') || (home && dest.startsWith(home + path.sep))) {
      throw new Error(
        `Refusing system/home destination: ${dest}\nUse an external mount (e.g. /mnt/... or /media/...).`
      );
    }
  }

  if (fs.existsSync(dest)) {
    const st = fs.statSync(dest);
    if (!st.isDirectory()) {
      throw new Error(`Destination exists but is not a directory: ${dest}`);
    }
  } else if (create) {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) {
      throw new Error(
        `Parent folder does not exist: ${parent}\nCreate it on the external disk first, or pass an existing path.`
      );
    }
    fs.mkdirSync(dest, { recursive: false });
  } else {
    throw new Error(`Destination does not exist: ${dest}`);
  }

  // Re-check after create (still on same volume path)
  if (process.platform === 'darwin') assertSafeMacDest(dest);
  if (process.platform === 'win32') assertSafeWinDest(dest);

  return { dest };
}

function assertSafeMacDest(dest) {
  if (dest === '/') {
    throw new Error('Refusing destination on system root "/".');
  }

  // External volumes live under /Volumes/<Name>/...
  if (dest === '/Volumes' || dest.startsWith('/Volumes/')) {
    const parts = dest.split('/').filter(Boolean);
    // /Volumes alone or /Volumes/Macintosh HD → treat as system-ish
    if (parts.length < 2) {
      throw new Error('Point --dest at a folder on an external volume, e.g. /Volumes/T7/MyFolder');
    }
    const volumeName = parts[1];
    if (volumeName === 'Macintosh HD' || volumeName === 'Macintosh HD - Data') {
      throw new Error(
        `Refusing destination on system volume "/Volumes/${volumeName}".\nUse an external disk under /Volumes/<DiskName>/...`
      );
    }
    return;
  }

  for (const prefix of MAC_SYSTEM_PREFIXES) {
    if (dest === prefix || dest.startsWith(prefix + '/')) {
      throw new Error(
        `Refusing destination on system path "${dest}".\nUse an external disk: /Volumes/<DiskName>/YourFolder`
      );
    }
  }

  throw new Error(
    `Destination must be on an external volume under /Volumes/...\nGot: ${dest}`
  );
}

function assertSafeWinDest(dest) {
  const normalized = dest.replace(/\//g, '\\');
  const drive = normalized.slice(0, 2).toUpperCase();
  if (drive === 'C:') {
    throw new Error(
      `Refusing destination on system drive C: (${dest}).\nUse an external drive letter, e.g. E:\\Woodweb`
    );
  }
  const home = os.homedir();
  if (home && normalized.toLowerCase().startsWith(home.toLowerCase())) {
    throw new Error(`Refusing destination under user profile: ${dest}`);
  }
}
