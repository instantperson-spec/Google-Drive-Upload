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
    const { name, mimeType, size, folderId } = await request.json();

    if (!name || !size) {
      return NextResponse.json({ error: 'Missing file metadata' }, { status: 400 });
    }
    
    if (!folderId) {
      return NextResponse.json({ error: 'Target folder ID is required' }, { status: 400 });
    }

    const authClient = await getAuthClient();
    
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
