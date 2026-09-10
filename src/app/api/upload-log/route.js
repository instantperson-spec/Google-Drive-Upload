import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';
import { getAuthClient, isSessionFolder } from '@/lib/googleAuth';
import { getSession } from '@/lib/progressStore';
import { rateLimit } from '@/lib/rateLimit';

export async function POST(request) {
  const limited = rateLimit(request, 'upload-log', 5);
  if (limited) return limited;
  
  if (!(await verifyUploadToken(request))) return unauthorizedResponse();

  try {
    const { sessionId, folderId, errorMessage } = await request.json();

    if (!sessionId || !folderId) {
      return NextResponse.json({ error: 'Missing sessionId or folderId' }, { status: 400 });
    }

    const authClient = await getAuthClient();
    if (!(await isSessionFolder(authClient, folderId))) {
      return NextResponse.json({ error: 'Invalid target folder.' }, { status: 403 });
    }

    const session = await getSession(sessionId);
    const logs = session?.logs || [];
    
    let logContent = `CRASH LOG: ${new Date().toISOString()}\n`;
    logContent += `ERROR: ${errorMessage}\n`;
    logContent += `----------------------------------------\n`;
    logContent += logs.join('\n');

    const drive = google.drive({ version: 'v3', auth: authClient });

    await drive.files.create({
      requestBody: {
        name: '_crash_log.txt',
        mimeType: 'text/plain',
        parents: [folderId],
      },
      media: {
        mimeType: 'text/plain',
        body: logContent,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error uploading crash log:', error.message || error);
    return NextResponse.json({ error: 'Failed to upload crash log' }, { status: 500 });
  }
}
