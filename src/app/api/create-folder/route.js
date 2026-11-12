import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';
import { getAuthClient } from '@/lib/googleAuth';
import { rateLimit } from '@/lib/rateLimit';
import { buildSessionFolderName } from '@/lib/sessionFolderName';

export async function POST(request) {
  const limited = rateLimit(request, 'create-folder', 10);
  if (limited) return limited;
  if (!(await verifyUploadToken(request))) return unauthorizedResponse();

  try {
    const { uploaderName, uploaderEmail, projectName } = await request.json();
    const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!mainFolderId) {
      return NextResponse.json({ error: 'Main folder ID is not configured.' }, { status: 500 });
    }

    if (!uploaderName || !uploaderEmail || !projectName) {
      return NextResponse.json(
        { error: 'Project name, uploader name and email are required.' },
        { status: 400 }
      );
    }

    if (
      typeof uploaderName !== 'string' ||
      uploaderName.length > 200 ||
      typeof projectName !== 'string' ||
      projectName.trim().length < 2 ||
      projectName.length > 120 ||
      typeof uploaderEmail !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(uploaderEmail)
    ) {
      return NextResponse.json({ error: 'Invalid project name, uploader name or email.' }, { status: 400 });
    }

    const authClient = await getAuthClient();

    // One Drive folder per upload run — Studio Pull downloads that session only.
    // Resume in the same browser keeps folderId from localStorage.
    const folderName = buildSessionFolderName({
      projectName,
      uploaderName,
    });

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

    return NextResponse.json({
      folderId: folderRes.data.id,
      folderName,
      projectName: projectName.trim(),
    });
  } catch (error) {
    console.error('Error creating user folder:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Failed to create user folder' },
      { status: 500 }
    );
  }
}
