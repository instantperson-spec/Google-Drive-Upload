import { Readable } from 'stream';
import { getActiveShare, assertFileInShareFolder, getDriveDownloadStream } from '@/lib/shareStore';
import { getAuthClient, isSessionFolder } from '@/lib/googleAuth';
import { rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request, { params }) {
  const limited = rateLimit(request, 'share-file', 120);
  if (limited) return limited;

  try {
    const { id } = await params;
    const share = await getActiveShare(id);
    if (!share) {
      return new Response(JSON.stringify({ error: 'Share not found or revoked.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return new Response(JSON.stringify({ error: 'fileId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const auth = await getAuthClient();
    if (!(await isSessionFolder(auth, share.folderId))) {
      return new Response(JSON.stringify({ error: 'Invalid share folder.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const ok = await assertFileInShareFolder(fileId, share.folderId);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'File not in this share.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { stream, name, mimeType, size } = await getDriveDownloadStream(fileId);
    const headers = new Headers({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    });
    if (size) headers.set('Content-Length', String(size));

    const webStream =
      typeof Readable.toWeb === 'function' ? Readable.toWeb(stream) : stream;
    return new Response(webStream, { status: 200, headers });
  } catch (err) {
    console.error('share file error:', err.message || err);
    return new Response(JSON.stringify({ error: err.message || 'Download failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
