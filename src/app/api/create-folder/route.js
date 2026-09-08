import { google } from 'googleapis';
import { NextResponse } from 'next/server';

const getAuthClient = async () => {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    return oauth2Client;
  }
  
  const credentials = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
  
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
  });
  
  return await auth.getClient();
};

export async function POST(request) {
  try {
    const { uploaderName, uploaderEmail } = await request.json();
    const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!mainFolderId) {
      return NextResponse.json({ error: 'Main folder ID is not configured.' }, { status: 500 });
    }

    if (!uploaderName || !uploaderEmail) {
      return NextResponse.json({ error: 'Uploader name and email are required to create a folder.' }, { status: 400 });
    }

    const authClient = await getAuthClient();
    const folderName = `${uploaderName} - ${uploaderEmail}`;

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
