import { NextResponse } from 'next/server';
import { getActiveShare, ensureFromClientFolder } from '@/lib/shareStore';
import { getAuthClient, isSessionFolder } from '@/lib/googleAuth';
import { validateFileMetadata } from '@/lib/validation';
import { rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Resumable upload init for client top-ups — files land only in FromClient/.
 * Auth: active share id in the URL (no upload token).
 */
export async function POST(request, { params }) {
  const limited = rateLimit(request, 'share-upload-session', 120);
  if (limited) return limited;

  try {
    const { id } = await params;
    const share = await getActiveShare(id);
    if (!share) {
      return NextResponse.json({ error: 'Share not found or revoked.' }, { status: 404 });
    }

    const authClient = await getAuthClient();
    if (!(await isSessionFolder(authClient, share.folderId))) {
      return NextResponse.json({ error: 'Invalid share folder.' }, { status: 403 });
    }

    const { name, mimeType, size } = await request.json();
    if (!name || !size) {
      return NextResponse.json({ error: 'Missing file metadata' }, { status: 400 });
    }

    // Flat name only — no path escape out of FromClient
    const baseName = String(name).split(/[/\\]/).pop();
    const validationError = validateFileMetadata(baseName, size);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const fromClientId = await ensureFromClientFolder(share.folderId);

    const response = await authClient.request({
      url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType || 'application/octet-stream',
        'X-Upload-Content-Length': String(size),
        Origin: request.headers.get('origin') || 'http://localhost:3000',
      },
      data: {
        name: baseName,
        parents: [fromClientId],
      },
    });

    let uploadUrl;
    if (response.headers && typeof response.headers.get === 'function') {
      uploadUrl = response.headers.get('location');
    } else {
      uploadUrl = response.headers.location || response.headers.Location;
    }

    if (!uploadUrl) {
      throw new Error('No upload URL returned from Google API');
    }

    return NextResponse.json({
      uploadUrl,
      parentFolderId: fromClientId,
      relativePath: `FromClient/${baseName}`,
    });
  } catch (error) {
    console.error('share upload-session error:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Failed to initiate upload' },
      { status: 500 }
    );
  }
}
