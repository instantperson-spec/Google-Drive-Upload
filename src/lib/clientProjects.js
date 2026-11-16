/**
 * Build hub project list: owned (linked token / progress) ∪ assigned memberships.
 */
import {
  listMembershipsForEmail,
  normalizeEmail,
} from '@/lib/clientStore';
import {
  listActiveSharesByToken,
  getActiveShareByFolderId,
  readSharesRegistry,
} from '@/lib/shareStore';
import { listProgressSessions } from '@/lib/progressStore';

/**
 * @param {object} client full client record with email + linkedToken
 * @returns {Promise<Array<object>>}
 */
export async function listProjectsForClient(client) {
  if (!client?.email) return [];
  const email = normalizeEmail(client.email);
  const linkedToken = client.linkedToken ? String(client.linkedToken).trim() : '';

  /** @type {Map<string, object>} */
  const byFolder = new Map();

  const upsert = (folderId, patch) => {
    const id = String(folderId || '').trim();
    if (!id) return;
    const prev = byFolder.get(id);
    if (!prev) {
      byFolder.set(id, {
        folderId: id,
        label: patch.label || null,
        shareId: patch.shareId || null,
        source: patch.source || 'owned',
        updatedAt: patch.updatedAt || null,
        projectName: patch.projectName || null,
        membershipId: patch.membershipId || null,
      });
      return;
    }
    let source = prev.source;
    if (patch.source && patch.source !== prev.source) {
      if (
        (prev.source === 'owned' && patch.source === 'assigned') ||
        (prev.source === 'assigned' && patch.source === 'owned') ||
        prev.source === 'both' ||
        patch.source === 'both'
      ) {
        source = 'both';
      } else {
        source = patch.source;
      }
    }
    byFolder.set(id, {
      ...prev,
      source,
      label: patch.label || prev.label,
      shareId: patch.shareId || prev.shareId,
      updatedAt: pickNewer(prev.updatedAt, patch.updatedAt),
      projectName: patch.projectName || prev.projectName,
      membershipId: patch.membershipId || prev.membershipId,
    });
  };

  // 1) Shares tied to linked upload token
  if (linkedToken) {
    const shares = await listActiveSharesByToken(linkedToken);
    for (const s of shares) {
      upsert(s.folderId, {
        source: 'owned',
        shareId: s.id,
        label: s.label || s.roundLabel || null,
        updatedAt: s.updatedAt || s.createdAt || null,
        projectName: s.label || null,
      });
    }
  }

  // 2) Recent progress sessions (token or email match)
  try {
    const sessions = await listProgressSessions();
    for (const s of sessions) {
      const tokenMatch = linkedToken && String(s.token || '') === linkedToken;
      const emailMatch =
        email && normalizeEmail(s.uploaderEmail || '') === email;
      if (!tokenMatch && !emailMatch) continue;
      const share = await getActiveShareByFolderId(s.folderId);
      upsert(s.folderId, {
        source: 'owned',
        shareId: share?.id || null,
        label: s.projectName || share?.label || null,
        projectName: s.projectName || null,
        updatedAt: s.updatedAt || null,
      });
    }
  } catch (err) {
    console.error('clientProjects progress scan:', err.message || err);
  }

  // 3) Explicit admin assignments
  const memberships = await listMembershipsForEmail(email);
  for (const m of memberships) {
    let shareId = m.shareId || null;
    if (!shareId) {
      const share = await getActiveShareByFolderId(m.folderId);
      shareId = share?.id || null;
    }
    upsert(m.folderId, {
      source: 'assigned',
      shareId,
      label: m.label || null,
      projectName: m.label || null,
      updatedAt: m.assignedAt || null,
      membershipId: m.id,
    });
  }

  // Enrich labels from share registry when missing
  try {
    const registry = await readSharesRegistry();
    for (const [folderId, row] of byFolder) {
      if (row.label && row.shareId) continue;
      const share =
        registry.shares.find(
          (s) => s && !s.revoked && s.folderId === folderId
        ) || null;
      if (share) {
        upsert(folderId, {
          shareId: row.shareId || share.id,
          label: row.label || share.label || share.roundLabel || null,
          updatedAt: pickNewer(row.updatedAt, share.createdAt),
        });
      }
    }
  } catch {
    /* ignore */
  }

  const list = [...byFolder.values()].map((p) => ({
    folderId: p.folderId,
    shareId: p.shareId || null,
    label: p.label || p.projectName || p.folderId,
    projectName: p.projectName || p.label || null,
    source: p.source,
    hasShare: Boolean(p.shareId),
    updatedAt: p.updatedAt,
    membershipId: p.membershipId || null,
    openUrl: p.shareId ? `/share/${encodeURIComponent(p.shareId)}` : null,
  }));

  list.sort((a, b) => {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });

  return list;
}

function pickNewer(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
