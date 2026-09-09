import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';
import { getAuthClient, isSessionFolder } from '@/lib/googleAuth';

export async function POST(request) {
  if (!verifyUploadToken(request)) return unauthorizedResponse();

  try {
    const { folderId } = await request.json();

    if (!folderId) {
      return NextResponse.json({ error: 'Folder ID is required' }, { status: 400 });
    }

    const authClient = await getAuthClient();

    // Only session folders under the main folder may be listed
    if (!(await isSessionFolder(authClient, folderId))) {
      return NextResponse.json({ error: 'Invalid folder' }, { status: 403 });
    }

    const drive = google.drive({ version: 'v3', auth: authClient });
    
    let allFiles = [];
    let pageToken = null;
    
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, size)',
        pageSize: 1000,
        pageToken: pageToken
      });
      if (res.data.files) {
        allFiles = allFiles.concat(res.data.files);
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    return NextResponse.json({ files: allFiles });
  } catch (error) {
    console.error('Error checking folder:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Failed to check folder' }, 
      { status: 500 }
    );
  }
}
