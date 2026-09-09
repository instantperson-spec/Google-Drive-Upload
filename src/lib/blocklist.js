/** Shared extension blacklist — used by server validation and client UI preview. */
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'com', 'scr', 'pif', 'msi', 'msp',
  'vbs', 'vbe', 'ws', 'wsf', 'wsh', 'ps1', 'psm1',
  'sh', 'bash', 'zsh', 'jar', 'hta', 'cpl', 'lnk', 'reg',
]);

/**
 * @param {string} path file name or relative path
 */
export function isBlockedExtension(path) {
  const baseName = path.split('/').pop() || path;
  const ext = baseName.includes('.') ? baseName.split('.').pop().toLowerCase() : '';
  return BLOCKED_EXTENSIONS.has(ext);
}
