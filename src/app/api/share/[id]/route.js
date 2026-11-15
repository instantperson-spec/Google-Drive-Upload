import { NextResponse } from 'next/server';
import { getActiveShare, listShareFiles } from '@/lib/shareStore';
import { getAuthClient, isSessionFolder } from '@/lib/googleAuth';
import { rateLimit } from '@/lib/rateLimit';

export async function GET(request, { params }) {
  const limited = rateLimit(request, 'share-list', 60);
  if (limited) return limited;

  try {
    const { id } = await params;
    const share = await getActiveShare(id);
    if (!share) {
      return NextResponse.json({ error: 'Share not found or revoked.' }, { status: 404 });
    }

    const auth = await getAuthClient();
    if (!(await isSessionFolder(auth, share.folderId))) {
      return NextResponse.json({ error: 'Invalid share folder.' }, { status: 403 });
    }

    const { files } = await listShareFiles(share.folderId);
    const counts = { original: 0, modified: 0, new: 0, fromClient: 0 };
    for (const f of files) {
      if (counts[f.status] != null) counts[f.status] += 1;
      else if (f.status === 'fromClient') counts.fromClient += 1;
      else counts.new += 1;
    }

    return NextResponse.json({
      share: {
        id: share.id,
        label: share.label || null,
        token: share.token || null,
        createdAt: share.createdAt || null,
      },
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        relativePath: f.relativePath,
        size: f.size,
        status: f.status,
        modifiedTime: f.modifiedTime,
      })),
      counts,
      total: files.length,
    });
  } catch (err) {
    console.error('share list error:', err.message || err);
    return NextResponse.json(
      { error: err.message || 'Failed to load share' },
      { status: 500 }
    );
  }
}
