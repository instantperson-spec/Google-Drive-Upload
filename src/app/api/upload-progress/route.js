import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';
import { getAuthClient, isSessionFolder } from '@/lib/googleAuth';
import { upsertProgressSession, removeProgressSession } from '@/lib/progressStore';
import { rateLimit } from '@/lib/rateLimit';

const MAX_FILES = 2000;
const MAX_NAME_LENGTH = 500;
const VALID_STATUSES = new Set(['pending', 'uploading', 'completed', 'error']);
const VALID_SESSION_STATUSES = new Set(['uploading', 'completed', 'error', 'file-started', 'file-completed']);

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const isValidFolderId = (v) =>
  typeof v === 'string' && /^[a-zA-Z0-9_-]{10,100}$/.test(v);

function sanitizeFiles(rawFiles) {
  if (!Array.isArray(rawFiles)) return null;
  if (rawFiles.length > MAX_FILES) return null;

  return rawFiles.map((f) => ({
    name: String(f?.name || 'unnamed').slice(0, MAX_NAME_LENGTH),
    size: Math.max(0, Number(f?.size) || 0),
    progress: Math.min(100, Math.max(0, Math.round(Number(f?.progress) || 0))),
    status: VALID_STATUSES.has(f?.status) ? f.status : 'pending',
  }));
}

export async function POST(request) {
  const token = await verifyUploadToken(request);
  if (!token) return unauthorizedResponse();

  try {
    const raw = await request.json();

    if (!isUuid(raw.sessionId)) {
      return NextResponse.json({ error: 'Invalid sessionId.' }, { status: 400 });
    }

    // Per-file events (file-started, file-completed) can burst quickly for sessions
    // with many small files. 500/min allows up to 250 files completing per minute
    // while still blocking obvious abuse (bot spam would need >500 req/min).
    const limited = rateLimit(request, `upload-progress:${raw.sessionId}`, 500);
    if (limited) return limited;

    if (!isValidFolderId(raw.folderId)) {
      return NextResponse.json({ error: 'Invalid folderId.' }, { status: 400 });
    }

    const files = sanitizeFiles(raw.files);
    if (!files) {
      return NextResponse.json({ error: 'Invalid files payload.' }, { status: 400 });
    }

    const sessionStatus = VALID_SESSION_STATUSES.has(raw.sessionStatus)
      ? raw.sessionStatus
      : 'uploading';

    // Verify folder belongs to our upload tree (skip on completed final ping if folder was valid)
    const authClient = await getAuthClient();
    if (!(await isSessionFolder(authClient, raw.folderId))) {
      return NextResponse.json({ error: 'Invalid target folder.' }, { status: 403 });
    }

    const payload = {
      sessionId: raw.sessionId,
      token,
      uploaderName: String(raw.uploaderName || 'Unknown').slice(0, 200),
      uploaderEmail: String(raw.uploaderEmail || '').slice(0, 254),
      folderId: raw.folderId,
      files,
      sessionStatus,
      logs: Array.isArray(raw.logs) ? raw.logs.slice(-200).map(String) : [],
    };

    await upsertProgressSession(payload);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Upload progress error:', error.message || error);
    return NextResponse.json({ error: 'Failed to record progress.' }, { status: 500 });
  }
}

/** Optional: client may DELETE session after successful upload cleanup. */
export async function DELETE(request) {
  if (!(await verifyUploadToken(request))) return unauthorizedResponse();

  try {
    const { sessionId } = await request.json();
    if (!isUuid(sessionId)) {
      return NextResponse.json({ error: 'Invalid sessionId.' }, { status: 400 });
    }
    await removeProgressSession(sessionId);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to remove session.' }, { status: 500 });
  }
}
