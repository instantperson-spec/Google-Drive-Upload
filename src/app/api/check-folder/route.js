import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';
import { getAuthClient, isSessionFolder } from '@/lib/googleAuth';
import { listSessionFilesRecursive } from '@/lib/listSessionFiles';
import { partitionUploadQueue } from '@/lib/deltaMatch';
import { rateLimit } from '@/lib/rateLimit';

export async function POST(request) {
  const limited = rateLimit(request, 'check-folder', 30);
  if (limited) return limited;
  if (!(await verifyUploadToken(request))) return unauthorizedResponse();

  try {
    const body = await request.json();
    const { folderId, pending } = body;

    if (!folderId) {
      return NextResponse.json({ error: 'Folder ID is required' }, { status: 400 });
    }

    const authClient = await getAuthClient();

    // Only session folders under the main folder may be listed
    if (!(await isSessionFolder(authClient, folderId))) {
      return NextResponse.json({ error: 'Invalid folder' }, { status: 403 });
    }

    const allFiles = await listSessionFilesRecursive(authClient, folderId);

    if (Array.isArray(pending) && pending.length) {
      const { onDrive, toUpload } = partitionUploadQueue(pending, allFiles);
      return NextResponse.json({
        files: allFiles,
        delta: {
          onDriveCount: onDrive.length,
          toUploadCount: toUpload.length,
          onDrivePaths: onDrive.map((e) => e.relativePath),
          toUploadPaths: toUpload.map((e) => e.relativePath),
        },
      });
    }

    return NextResponse.json({ files: allFiles });
  } catch (error) {
    console.error('Error checking folder:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Failed to check folder' }, 
      { status: 500 }
    );
  }
}
