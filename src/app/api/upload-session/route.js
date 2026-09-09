import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';
import { getAuthClient, isSessionFolder } from '@/lib/googleAuth';
import { validateFileMetadata } from '@/lib/validation';
import { rateLimit } from '@/lib/rateLimit';

export async function POST(request) {
  // Generous limit: bulk folder uploads legitimately open one session per file
  const limited = rateLimit(request, 'upload-session', 300);
  if (limited) return limited;
  if (!(await verifyUploadToken(request))) return unauthorizedResponse();

  try {
    const { name, mimeType, size, folderId } = await request.json();

    if (!name || !size) {
      return NextResponse.json({ error: 'Missing file metadata' }, { status: 400 });
    }
    
    if (!folderId) {
      return NextResponse.json({ error: 'Target folder ID is required' }, { status: 400 });
    }

    const validationError = validateFileMetadata(name, size);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const authClient = await getAuthClient();

    // Only allow uploads into session folders created under the main folder
    if (!(await isSessionFolder(authClient, folderId))) {
      return NextResponse.json({ error: 'Invalid target folder' }, { status: 403 });
    }
    
    // Direct POST request to initiate the resumable upload session
    const response = await authClient.request({
      url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType || 'application/octet-stream',
        'X-Upload-Content-Length': size.toString(),
        'Origin': request.headers.get('origin') || 'http://localhost:3000',
      },
      data: {
        name: name,
        parents: [folderId],
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

    return NextResponse.json({ uploadUrl });
  } catch (error) {
    console.error('Error initiating upload session:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Failed to initiate upload session' }, 
      { status: 500 }
    );
  }
}
