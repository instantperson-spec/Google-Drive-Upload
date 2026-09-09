import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';
import { getAuthClient } from '@/lib/googleAuth';
import { rateLimit } from '@/lib/rateLimit';

export async function POST(request) {
  const limited = rateLimit(request, 'create-folder', 10);
  if (limited) return limited;
  if (!verifyUploadToken(request)) return unauthorizedResponse();

  try {
    const { uploaderName, uploaderEmail } = await request.json();
    const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!mainFolderId) {
      return NextResponse.json({ error: 'Main folder ID is not configured.' }, { status: 500 });
    }

    if (!uploaderName || !uploaderEmail) {
      return NextResponse.json({ error: 'Uploader name and email are required to create a folder.' }, { status: 400 });
    }

    if (typeof uploaderName !== 'string' || uploaderName.length > 200 ||
        typeof uploaderEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(uploaderEmail)) {
      return NextResponse.json({ error: 'Invalid uploader name or email.' }, { status: 400 });
    }

    const authClient = await getAuthClient();
    const folderName = `${uploaderName.trim()} - ${uploaderEmail.trim()}`;

    // Reuse an existing session folder instead of creating duplicates
    // (e.g. when the same client returns after clearing localStorage)
    const drive = google.drive({ version: 'v3', auth: authClient });
    const escapedName = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const existing = await drive.files.list({
      q: `'${mainFolderId}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
    });
    if (existing.data.files && existing.data.files.length > 0) {
      return NextResponse.json({ folderId: existing.data.files[0].id });
    }

    const folderRes = await authClient.request({
      url: 'https://www.googleapis.com/drive/v3/files',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [mainFolderId],
      },
    });

    return NextResponse.json({ folderId: folderRes.data.id });
  } catch (error) {
    console.error('Error creating user folder:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Failed to create user folder' }, 
      { status: 500 }
    );
  }
}
