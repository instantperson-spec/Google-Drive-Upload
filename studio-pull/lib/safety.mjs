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
    throw new Error('Odrzucono katalog główny „/”. Wybierz folder na dysku zewnętrznym.');
  }

  // External volumes live under /Volumes/<Name>/...
  if (dest === '/Volumes' || dest.startsWith('/Volumes/')) {
    const parts = dest.split('/').filter(Boolean);
    // /Volumes alone or /Volumes/Macintosh HD → treat as system-ish
    if (parts.length < 2) {
      throw new Error(
        'Wskaż folder na dysku zewnętrznym, np. /Volumes/ENV/Projekty albo /Volumes/T7/Incoming'
      );
    }
    const volumeName = parts[1];
    if (volumeName === 'Macintosh HD' || volumeName === 'Macintosh HD - Data') {
      throw new Error(
        `Nie można użyć dysku systemowego „/Volumes/${volumeName}”.\nWybierz zewnętrzny dysk: /Volumes/<NazwaDysku>/TwójFolder`
      );
    }
    return;
  }

  for (const prefix of MAC_SYSTEM_PREFIXES) {
    if (dest === prefix || dest.startsWith(prefix + '/')) {
      throw new Error(
        `Folder na dysku systemowym jest zablokowany:\n${dest}\n\nWybierz lokalizację na dysku zewnętrznym, np.:\n/Volumes/ENV/Projekty\n(Documents, Desktop i /Users nie są dozwolone.)`
      );
    }
  }

  throw new Error(
    `Folder musi być na dysku zewnętrznym pod /Volumes/…\nOtrzymano: ${dest}`
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
