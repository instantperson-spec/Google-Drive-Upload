import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { isAdminAuthenticated, unauthorizedAdminResponse } from '@/lib/adminAuth';
import { getAuthClient } from '@/lib/googleAuth';
import { formatBytes } from '@/lib/formatBytes';
import { parseSessionFolderName } from '@/lib/sessionFolderName';
import { listSessionFilesRecursive } from '@/lib/listSessionFiles';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function GET(request) {
  if (!(await isAdminAuthenticated(request))) {
    return unauthorizedAdminResponse();
  }

  const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!mainFolderId) {
    return NextResponse.json({ error: 'GOOGLE_DRIVE_FOLDER_ID is not configured.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  try {
    const authClient = await getAuthClient();
    const drive = google.drive({ version: 'v3', auth: authClient });

    const foldersRes = await drive.files.list({
      q: `'${mainFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, modifiedTime, createdTime)',
      orderBy: 'modifiedTime desc',
      pageSize: limit,
    });

    const folders = foldersRes.data.files || [];

    // Recursive walk — after build-structure media lives in subfolders, not session root.
    const sessions = await Promise.all(
      folders.map(async (folder) => {
        const regularFiles = await listSessionFilesRecursive(authClient, folder.id);
        const totalSize = regularFiles.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
        const { projectName, uploaderName, uploaderEmail } = parseSessionFolderName(folder.name);

        return {
          folderId: folder.id,
          folderName: folder.name,
          projectName: projectName || '',
          uploaderName,
          uploaderEmail,
          fileCount: regularFiles.length,
          totalSize,
          totalSizeFormatted: formatBytes(totalSize),
          createdTime: folder.createdTime,
          modifiedTime: folder.modifiedTime,
          driveLink: `https://drive.google.com/drive/folders/${folder.id}`,
        };
      })
    );

    return NextResponse.json({
      sessions,
      total: sessions.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin sessions error:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch sessions from Google Drive.' },
      { status: 500 }
    );
  }
}
