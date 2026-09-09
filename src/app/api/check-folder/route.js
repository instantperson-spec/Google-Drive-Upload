import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';

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
  
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google credentials are not set in .env');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
  });
  
  return await auth.getClient();
};

export async function POST(request) {
  if (!verifyUploadToken(request)) return unauthorizedResponse();

  try {
    const { folderId } = await request.json();

    if (!folderId) {
      return NextResponse.json({ error: 'Folder ID is required' }, { status: 400 });
    }

    const authClient = await getAuthClient();
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
