import { google } from 'googleapis';

export const RECOMMENDED_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const BROAD_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.readonly',
];

export function maskSecret(value, visible = 6) {
  if (!value) return '(missing)';
  if (value.length <= visible * 2) return '***';
  return `${value.slice(0, visible)}…${value.slice(-4)}`;
}

async function fetchTokenInfo(accessToken) {
  const url = `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `tokeninfo HTTP ${res.status}`);
  }
  return data;
}

async function runDriveTests(authClient, mainFolderId) {
  const drive = google.drive({ version: 'v3', auth: authClient });
  const results = [];

  async function test(name, fn, { critical = true } = {}) {
    try {
      const detail = await fn();
      results.push({ name, passed: true, detail: detail || null, critical });
    } catch (err) {
      results.push({
        name,
        passed: false,
        error: err.message || String(err),
        critical,
      });
    }
  }

  // With drive.file, files.get on a pre-existing root folder often returns 404 even when
  // list/create inside that folder works (app only "sees" files it opened or created).
  await test('Verify main upload folder access', async () => {
    const res = await drive.files.list({
      q: `'${mainFolderId}' in parents and trashed = false`,
      pageSize: 1,
      fields: 'files(id, name)',
    });
    return `Upload folder reachable (${res.data.files?.length ?? 0}+ item(s) in root)`;
  });

  await test('Main folder metadata via files.get (informational)', async () => {
    const res = await drive.files.get({
      fileId: mainFolderId,
      fields: 'id, name, mimeType, ownedByMe',
    });
    if (res.data.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error('GOOGLE_DRIVE_FOLDER_ID is not a folder');
    }
    return `Folder: "${res.data.name}" (ownedByMe: ${res.data.ownedByMe ?? 'unknown'})`;
  }, { critical: false });

  await test('List session folders in main folder', async () => {
    const res = await drive.files.list({
      q: `'${mainFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      pageSize: 3,
      fields: 'files(id, name)',
    });
    return `Found ${res.data.files?.length ?? 0} subfolder(s) (sample, max 3)`;
  });

  await test('List files inside main folder', async () => {
    const res = await drive.files.list({
      q: `'${mainFolderId}' in parents and trashed = false`,
      pageSize: 3,
      fields: 'files(id, name, mimeType)',
    });
    return `Found ${res.data.files?.length ?? 0} item(s) in root (sample, max 3)`;
  });

  await test('Read _uploader_tokens.json (token registry)', async () => {
    const res = await drive.files.list({
      q: `'${mainFolderId}' in parents and name = '_uploader_tokens.json' and trashed = false`,
      pageSize: 1,
      fields: 'files(id, name)',
    });
    if (!res.data.files?.length) {
      return 'Registry file not created yet (normal before first /admin token load)';
    }
    return 'Registry file accessible';
  });

  return results;
}

function classifyScope(scope) {
  if (scope === RECOMMENDED_SCOPE) return 'ok';
  if (BROAD_SCOPES.includes(scope)) return 'error';
  return 'neutral';
}

function criticalTestsPassed(driveTests) {
  const critical = driveTests?.filter((t) => t.critical !== false) ?? [];
  return !critical.length || critical.every((t) => t.passed);
}

function buildSummary(hasDriveFull, hasDriveFile, driveTests, mainFolderId) {
  const criticalOk = criticalTestsPassed(driveTests);
  const optionalFailed = driveTests?.some((t) => t.critical === false && !t.passed);

  if (hasDriveFull) {
    return {
      level: 'error',
      message: 'Action required: regenerate refresh token with drive.file only (see dokumentacja/regeneracja_oauth_scope.md).',
    };
  }
  if (hasDriveFile && criticalOk && !optionalFailed) {
    return {
      level: 'ok',
      message: 'Scopes look good and Drive operations pass — safe to use drive.file-only token.',
    };
  }
  if (hasDriveFile && criticalOk && optionalFailed) {
    return {
      level: 'ok',
      message:
        'Scopes and upload folder access look good. files.get on the root folder may fail with drive.file — that is normal when the folder existed before the app.',
    };
  }
  if (hasDriveFile && !criticalOk) {
    return {
      level: 'warn',
      message: 'drive.file is present but upload folder operations failed. Check GOOGLE_DRIVE_FOLDER_ID and folder sharing with the OAuth account.',
    };
  }
  if (!mainFolderId) {
    return {
      level: 'warn',
      message: 'Set GOOGLE_DRIVE_FOLDER_ID to run Drive smoke tests.',
    };
  }
  return {
    level: 'warn',
    message: 'Review scopes and test results before maintenance window deploy.',
  };
}

/**
 * Run OAuth scope diagnostic (VULN-05). Returns structured report for CLI and admin UI.
 * @param {object} [options] optional credential overrides (CLI may pass .env.local values)
 */
export async function runOAuthScopeCheck(options = {}) {
  const clientId = options.clientId ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = options.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = options.refreshToken ?? process.env.GOOGLE_REFRESH_TOKEN;
  const mainFolderId = options.mainFolderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID ?? null;

  const report = {
    ok: false,
    checkedAt: new Date().toISOString(),
    config: {
      clientId: maskSecret(clientId),
      clientSecret: maskSecret(clientSecret),
      refreshToken: maskSecret(refreshToken, 8),
      mainFolderId: mainFolderId || null,
    },
    refresh: { ok: false, error: null },
    tokenInfo: null,
    scopes: [],
    assessment: {
      hasDriveFull: false,
      hasDriveFile: false,
      otherBroadScopes: [],
    },
    driveTests: [],
    summary: { level: 'error', message: '' },
  };

  if (!clientId || !clientSecret || !refreshToken) {
    report.summary = {
      level: 'error',
      message: 'Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN.',
    };
    return report;
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  let accessToken;
  try {
    const { token } = await oauth2.getAccessToken();
    if (!token) throw new Error('No access token returned');
    accessToken = token;
    report.refresh.ok = true;
  } catch (err) {
    report.refresh.error = err.message || String(err);
    report.summary = {
      level: 'error',
      message: `Failed to refresh access token: ${report.refresh.error}`,
    };
    return report;
  }

  try {
    const tokenInfo = await fetchTokenInfo(accessToken);
    report.tokenInfo = {
      expiresIn: tokenInfo.expires_in,
      audience: tokenInfo.audience || tokenInfo.issued_to || null,
    };

    const scopeList = (tokenInfo.scope || '').split(' ').filter(Boolean);
    report.scopes = scopeList.map((scope) => ({
      scope,
      status: classifyScope(scope),
    }));

    report.assessment.hasDriveFull = scopeList.includes('https://www.googleapis.com/auth/drive');
    report.assessment.hasDriveFile = scopeList.includes(RECOMMENDED_SCOPE);
    report.assessment.otherBroadScopes = scopeList.filter(
      (s) => BROAD_SCOPES.includes(s) && s !== 'https://www.googleapis.com/auth/drive'
    );
  } catch (err) {
    report.summary = {
      level: 'error',
      message: `tokeninfo failed: ${err.message || String(err)}`,
    };
    return report;
  }

  if (mainFolderId) {
    report.driveTests = await runDriveTests(oauth2, mainFolderId);
  }

  report.summary = buildSummary(
    report.assessment.hasDriveFull,
    report.assessment.hasDriveFile,
    report.driveTests,
    mainFolderId
  );
  report.ok = report.summary.level === 'ok';

  return report;
}
