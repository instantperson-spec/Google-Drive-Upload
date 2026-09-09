import { google } from 'googleapis';

/**
 * Shared Google auth client factory (previously duplicated in 3 route handlers).
 *
 * Primary path: OAuth2 with a refresh token (bypasses Service Account upload limits).
 * Fallback: Service Account. Note: the scope list below only applies to the
 * Service Account path — for OAuth2 the effective scopes are baked into the
 * refresh token at the time it was generated.
 */
export async function getAuthClient() {
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
    // Least privilege: drive.file only (access limited to files created by this app)
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  return await auth.getClient();
}

/**
 * Verifies that the given folder is a direct child of the configured main
 * upload folder (GOOGLE_DRIVE_FOLDER_ID). Prevents clients from pointing
 * API operations at arbitrary Drive folders.
 */
export async function isSessionFolder(authClient, folderId) {
  const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!mainFolderId || !folderId || typeof folderId !== 'string') return false;

  try {
    const drive = google.drive({ version: 'v3', auth: authClient });
    const res = await drive.files.get({
      fileId: folderId,
      fields: 'id, mimeType, parents, trashed',
    });
    const f = res.data;
    return (
      f.mimeType === 'application/vnd.google-apps.folder' &&
      !f.trashed &&
      Array.isArray(f.parents) &&
      f.parents.includes(mainFolderId)
    );
  } catch {
    return false;
  }
}
