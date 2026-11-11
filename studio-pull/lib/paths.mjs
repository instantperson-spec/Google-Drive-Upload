import path from 'path';

/** Safe folder name for local disk from a Drive session name. */
export function sessionSubfolderName(sessionName, folderId) {
  const base = String(sessionName || folderId || 'session')
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || folderId || 'session';
}

export function joinSessionDest(rootDest, sessionName, folderId) {
  return path.join(rootDest, sessionSubfolderName(sessionName, folderId));
}
