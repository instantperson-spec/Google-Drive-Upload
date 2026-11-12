import { formatBytes } from './download.mjs';
import { walkDriveFolder } from './driveWalk.mjs';

/** Unique upload folders end with " - YYYY-MM-DD HH:MM" (project - name - stamp). */
const STAMPED_FOLDER_RE = / - \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

export function isStampedSessionFolder(name) {
  return STAMPED_FOLDER_RE.test(String(name || ''));
}

function dayKey(iso) {
  const d = (iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function dayBoundsUtc(day) {
  const sinceMs = Date.parse(`${day}T00:00:00.000Z`);
  const untilMs = sinceMs + 24 * 60 * 60 * 1000;
  return {
    since: new Date(sinceMs).toISOString(),
    until: new Date(untilMs).toISOString(),
    sinceMs,
    untilMs,
  };
}

/**
 * Legacy client folders (no stamp) → one Console row per upload day.
 * Stamped folders → single row (already one upload).
 */
export async function expandFoldersToSessions(drive, folders, progressByFolder = new Map()) {
  const out = [];

  for (const f of folders) {
    const prog = progressByFolder.get(f.id);

    if (isStampedSessionFolder(f.name)) {
      out.push({
        id: f.id,
        folderId: f.id,
        name: f.name,
        createdTime: f.createdTime || null,
        modifiedTime: f.modifiedTime || null,
        lastActivity: prog?.updatedAt || f.modifiedTime || f.createdTime || null,
        progressStatus: prog?.sessionStatus || null,
        token: prog?.token || null,
        since: null,
        until: null,
        fileCount: null,
        totalLabel: null,
        batch: false,
      });
      continue;
    }

    const files = await walkDriveFolder(drive, f.id);
    const byDay = new Map();
    for (const file of files) {
      const day = dayKey(file.createdTime) || dayKey(file.modifiedTime);
      if (!day) continue;
      const entry = byDay.get(day) || { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += file.size || 0;
      byDay.set(day, entry);
    }

    const days = [...byDay.keys()].sort().reverse();
    if (!days.length) {
      out.push({
        id: f.id,
        folderId: f.id,
        name: f.name,
        createdTime: f.createdTime || null,
        modifiedTime: f.modifiedTime || null,
        lastActivity: prog?.updatedAt || f.createdTime || null,
        progressStatus: prog?.sessionStatus || null,
        token: prog?.token || null,
        since: null,
        until: null,
        fileCount: 0,
        totalLabel: '0 B',
        batch: false,
      });
      continue;
    }

    for (const day of days) {
      const stats = byDay.get(day);
      const bounds = dayBoundsUtc(day);
      out.push({
        id: `${f.id}__${day}`,
        folderId: f.id,
        name: `${f.name} · ${day}`,
        createdTime: bounds.since,
        modifiedTime: bounds.until,
        lastActivity: bounds.until,
        progressStatus: prog?.sessionStatus || null,
        token: prog?.token || null,
        since: bounds.since,
        until: bounds.until,
        fileCount: stats.count,
        totalLabel: formatBytes(stats.bytes),
        batch: true,
      });
    }
  }

  out.sort((a, b) => String(b.lastActivity || '').localeCompare(String(a.lastActivity || '')));
  return out;
}

export function filterFilesByWindow(files, sinceMs, untilMs) {
  return files.filter((f) => {
    const t = Date.parse(f.createdTime || f.modifiedTime || '');
    if (!Number.isFinite(t)) return false;
    if (Number.isFinite(sinceMs) && t < sinceMs) return false;
    if (Number.isFinite(untilMs) && t >= untilMs) return false;
    return true;
  });
}
