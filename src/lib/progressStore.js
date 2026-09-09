/** In-memory store for live upload progress (Phase B). TTL 24h; active = heartbeat within 30s. */

const TTL_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_STALE_MS = 30 * 1000;
const RECENTLY_COMPLETED_MS = 2 * 60 * 1000;

/** @type {Map<string, object>} */
const sessions = new Map();

function pruneExpired() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, session] of sessions) {
    if (new Date(session.updatedAt).getTime() < cutoff) {
      sessions.delete(id);
    }
  }
}

/**
 * @param {object} data validated session payload
 */
export function upsertProgressSession(data) {
  sessions.set(data.sessionId, {
    sessionId: data.sessionId,
    token: data.token,
    uploaderName: data.uploaderName,
    uploaderEmail: data.uploaderEmail,
    folderId: data.folderId,
    files: data.files,
    sessionStatus: data.sessionStatus || 'uploading',
    logs: data.logs || [],
    updatedAt: new Date().toISOString(),
  });
  pruneExpired();
}

export function removeProgressSession(sessionId) {
  sessions.delete(sessionId);
}

export function getSession(sessionId) {
  return sessions.get(sessionId);
}

/**
 * Active uploads (heartbeat < staleMs) + recently completed (2 min).
 * @returns {object[]}
 */
export function getActiveSessions(staleMs = ACTIVE_STALE_MS) {
  pruneExpired();
  const now = Date.now();
  const activeCutoff = now - staleMs;
  const completedCutoff = now - RECENTLY_COMPLETED_MS;
  const result = [];

  for (const session of sessions.values()) {
    const updated = new Date(session.updatedAt).getTime();
    const isLive =
      updated >= activeCutoff && session.sessionStatus === 'uploading';
    const isRecentlyDone =
      session.sessionStatus === 'completed' && updated >= completedCutoff;

    if (isLive || isRecentlyDone) {
      result.push(session);
    }
  }

  return result.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}
