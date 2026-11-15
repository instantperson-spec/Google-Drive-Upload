import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Native folder picker (macOS). Returns absolute path or null if cancelled.
 * @param {{ defaultPath?: string, prompt?: string }} [opts]
 * Starts at defaultPath when it exists, otherwise /Volumes. Brings dialog to front.
 */
export async function pickFolderMac(opts = {}) {
  if (process.platform !== 'darwin') {
    throw new Error(
      'Folder picker is currently supported on macOS only. Pass a path via CLI --dest.'
    );
  }

  const defaultPath = String(opts.defaultPath || '/Volumes').trim() || '/Volumes';
  const prompt =
    String(opts.prompt || '').trim() ||
    'Studio Console — wskaż folder na dysku zewnętrznym (np. /Volumes/ENV/…)';

  // Escape for AppleScript string literal
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const script = `
    tell application "Finder"
      activate
    end tell
    delay 0.15
    try
      set candidate to "${esc(defaultPath)}"
      set defaultLoc to POSIX file "/Volumes"
      try
        set defaultLoc to POSIX file candidate
      end try
      set chosen to choose folder with prompt "${esc(prompt)}" default location defaultLoc
      return POSIX path of chosen
    on error errMsg number errNum
      if errNum is -128 then
        return ""
      end if
      return "ERROR:" & errMsg
    end try
  `;

  const { stdout, stderr } = await execFileAsync('osascript', ['-e', script], {
    maxBuffer: 1024 * 1024,
  });
  const raw = String(stdout || '').trim();
  if (!raw) {
    if (stderr && String(stderr).trim()) {
      throw new Error(`Nie udało się otworzyć wyboru folderu: ${String(stderr).trim()}`);
    }
    return null;
  }
  if (raw.startsWith('ERROR:')) {
    throw new Error(raw.slice(6).trim() || 'Błąd wyboru folderu.');
  }
  return raw.replace(/\/$/, '') || null;
}
