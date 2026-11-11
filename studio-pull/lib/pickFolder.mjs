import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Native folder picker (macOS). Returns absolute path or null if cancelled.
 */
export async function pickFolderMac() {
  if (process.platform !== 'darwin') {
    throw new Error('Folder picker is currently supported on macOS only. Pass a path via CLI --dest.');
  }

  const script = `
    try
      set chosen to choose folder with prompt "Studio Pull — wybierz folder docelowy na dysku zewnętrznym"
      return POSIX path of chosen
    on error
      return ""
    end try
  `;

  const { stdout } = await execFileAsync('osascript', ['-e', script], {
    maxBuffer: 1024 * 1024,
  });
  const path = String(stdout || '').trim().replace(/\/$/, '');
  return path || null;
}
