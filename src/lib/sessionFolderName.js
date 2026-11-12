/**
 * Build / parse Drive session folder names.
 *
 * New uploads:
 *   "{projectName} - {uploaderName} - YYYY-MM-DD HH:MM"
 * Legacy:
 *   "{uploaderName} - {email}"
 *   "{uploaderName} - {email} - YYYY-MM-DD HH:MM"
 */

const STAMP_RE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/** Strip characters Drive / macOS dislike in folder names. */
export function sanitizeFolderPart(value, maxLen = 80) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
    .trim();
}

export function buildSessionFolderName({ projectName, uploaderName, stamp }) {
  const project = sanitizeFolderPart(projectName, 80);
  const name = sanitizeFolderPart(uploaderName, 80);
  const when = stamp || new Date().toISOString().slice(0, 16).replace('T', ' ');
  if (!project || !name) {
    throw new Error('projectName and uploaderName are required.');
  }
  return `${project} - ${name} - ${when}`;
}

export function isStampedSessionFolderName(name) {
  return STAMP_RE.test(String(name || ''));
}

export function parseSessionFolderName(name) {
  const raw = String(name || '');
  const stampMatch = raw.match(/^(.*) - (.*) - (\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/);
  if (stampMatch) {
    const left = stampMatch[1];
    const mid = stampMatch[2];
    // New: project - name - stamp  (mid is not an email)
    // Old: name - email - stamp
    if (/^[^\s@]+@[^\s@]+$/.test(mid)) {
      return {
        projectName: '',
        uploaderName: left,
        uploaderEmail: mid,
        stamp: stampMatch[3],
      };
    }
    return {
      projectName: left,
      uploaderName: mid,
      uploaderEmail: '',
      stamp: stampMatch[3],
    };
  }

  const dashIdx = raw.lastIndexOf(' - ');
  if (dashIdx <= 0) {
    return { projectName: '', uploaderName: raw, uploaderEmail: '', stamp: '' };
  }
  return {
    projectName: '',
    uploaderName: raw.slice(0, dashIdx),
    uploaderEmail: raw.slice(dashIdx + 3),
    stamp: '',
  };
}
