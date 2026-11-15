#!/usr/bin/env node
/**
 * Studio Console — local HTTP server (127.0.0.1 only).
 * Pull + Sync (local→Drive origin) + Shares + Tokens. No Live Progress.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { createDriveClient } from './lib/auth.mjs';
import { assertSafeDest } from './lib/safety.mjs';
import { listSessionFolders, walkDriveFolder } from './lib/driveWalk.mjs';
import { loadProgressByFolderId } from './lib/progressOps.mjs';
import { expandFoldersToSessions, filterFilesByWindow } from './lib/sessionBatches.mjs';
import { downloadFiles, formatBytes } from './lib/download.mjs';
import { pickFolderMac } from './lib/pickFolder.mjs';
import { joinSessionDest } from './lib/paths.mjs';
import {
  listTokensLocal,
  createTokenLocal,
  patchTokenLocal,
  setTokenLocaleLocal,
  setTokenIdentityLocal,
  deleteTokenLocal,
} from './lib/tokenOps.mjs';
import {
  listBindings,
  getBinding,
  upsertBinding,
  setLastSynced,
  setLastClientPull,
} from './lib/projectBindings.mjs';
import { computeSyncStatus } from './lib/syncStatus.mjs';
import { detectNestedSessionPath } from './lib/pathHints.mjs';
import { walkLocalFolder } from './lib/localWalk.mjs';
import { planSync } from './lib/syncDelta.mjs';
import { uploadFiles } from './lib/upload.mjs';
import {
  readManifest,
  writeManifest,
  buildBaselineFromLocal,
  setBaselineFromFiles,
  recomputeStatuses,
  hasBaseline,
  stripSessionPrefix,
} from './lib/manifestOps.mjs';
import {
  listSharesLocal,
  createShareLocal,
  revokeShareLocal,
} from './lib/shareOps.mjs';
import {
  ensureConsoleAuthToken,
  assertConsoleRequest,
} from './lib/consoleAuth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');
const HOST = '127.0.0.1';
const PORT = 8787;

const { token: CONSOLE_TOKEN, fingerprint: CONSOLE_FP } = ensureConsoleAuthToken();

/** @type {Set<import('http').ServerResponse>} */
const sseClients = new Set();

let jobRunning = false;
let cancelRequested = false;

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function serveStatic(req, res) {
  let urlPath = new URL(req.url, `http://${HOST}`).pathname;
  if (urlPath === '/') urlPath = '/index.html';

  // Same backdrop as Vercel uploader/admin
  if (urlPath === '/bg.jpg') {
    const bgPath = path.join(__dirname, '..', 'public', 'bg.jpg');
    if (fs.existsSync(bgPath)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(bgPath).pipe(res);
      return;
    }
  }

  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(UI_DIR, safe);
  if (!filePath.startsWith(UI_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const headers = {
    'Content-Type': contentType(filePath),
    'Cache-Control': filePath.endsWith('.jpg') ? 'public, max-age=86400' : 'no-store',
  };

  // Inject local auth token into HTML so same-origin UI can call /api/*
  if (filePath.endsWith('.html')) {
    let html = fs.readFileSync(filePath, 'utf8');
    const meta = `<meta name="studio-console-token" content="${CONSOLE_TOKEN}">`;
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${meta}\n</head>`);
    } else {
      html = meta + html;
    }
    res.writeHead(200, headers);
    res.end(html);
    return;
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

async function handleSessions(res) {
  const { drive, mainFolderId } = createDriveClient();
  const [folders, progressByFolder] = await Promise.all([
    listSessionFolders(drive, mainFolderId, 200),
    loadProgressByFolderId().catch(() => new Map()),
  ]);

  // Legacy fat folders → one row per upload day; stamped folders stay 1:1.
  const sessions = await expandFoldersToSessions(drive, folders, progressByFolder);
  const bindingsByFolder = new Map(listBindings().map((b) => [b.folderId, b]));
  for (const s of sessions) {
    const b = bindingsByFolder.get(s.folderId);
    if (b) {
      s.localPath = b.localPath;
      s.lastSyncedAt = b.lastSyncedAt || null;
      s.lastClientPullAt = b.lastClientPullAt || null;
      s.bindingLabel = b.label || null;
      if (!s.token && b.token) s.token = b.token;
    }
  }

  // Sync status only for bound projects (avoid N Drive walks for unbound rows)
  const boundIds = [
    ...new Set(sessions.filter((s) => s.localPath).map((s) => s.folderId)),
  ];
  const statusByFolder = new Map();
  const CONCURRENCY = 4;
  for (let i = 0; i < boundIds.length; i += CONCURRENCY) {
    const slice = boundIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (folderId) => {
        try {
          const st = await computeSyncStatus(
            drive,
            folderId,
            bindingsByFolder.get(folderId) || null
          );
          return [folderId, st];
        } catch {
          return [
            folderId,
            {
              syncStatus: 'unknown',
              reasons: { fromClientPending: false, studioRemoteNewer: false },
              fromClientCount: 0,
              missingLocalFromClient: 0,
              remoteChangedAt: null,
              nestedWarning: null,
            },
          ];
        }
      })
    );
    for (const [folderId, st] of results) statusByFolder.set(folderId, st);
  }

  for (const s of sessions) {
    const st = statusByFolder.get(s.folderId);
    if (st) {
      s.syncStatus = st.syncStatus;
      s.syncReasons = st.reasons || {
        fromClientPending: false,
        studioRemoteNewer: false,
      };
      s.fromClientCount = st.fromClientCount;
      s.missingLocalFromClient = st.missingLocalFromClient;
      s.remoteChangedAt = st.remoteChangedAt;
      s.nestedWarning = st.nestedWarning || null;
      if (st.lastClientPullAt) s.lastClientPullAt = st.lastClientPullAt;
    } else {
      s.syncStatus = s.localPath ? 'ok' : 'unknown';
      s.syncReasons = { fromClientPending: false, studioRemoteNewer: false };
      s.fromClientCount = 0;
      s.missingLocalFromClient = 0;
      s.nestedWarning = s.localPath
        ? detectNestedSessionPath(s.localPath, s.bindingLabel || s.name || null)
        : null;
    }
  }

  sendJson(res, 200, {
    sessions,
    total: sessions.length,
    mainFolderId,
    fetchedAt: new Date().toISOString(),
  });
}

async function handleSessionFiles(folderId, reqUrl, res) {
  const { drive } = createDriveClient();
  let files = await walkDriveFolder(drive, folderId);
  const sinceMs = reqUrl.searchParams.get('since')
    ? Date.parse(reqUrl.searchParams.get('since'))
    : NaN;
  const untilMs = reqUrl.searchParams.get('until')
    ? Date.parse(reqUrl.searchParams.get('until'))
    : NaN;
  if (Number.isFinite(sinceMs) || Number.isFinite(untilMs)) {
    files = filterFilesByWindow(files, sinceMs, untilMs);
  }
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  sendJson(res, 200, {
    folderId,
    fileCount: files.length,
    totalBytes,
    totalLabel: formatBytes(totalBytes),
    files: files.map((f) => ({
      relativePath: f.relativePath,
      size: f.size,
      sizeLabel: formatBytes(f.size),
    })),
  });
}

async function handlePickDest(req, res) {
  let body = {};
  if (req.method === 'POST') {
    try {
      body = await readBody(req);
    } catch {
      body = {};
    }
  }
  let picked;
  try {
    picked = await pickFolderMac({
      defaultPath: body.defaultPath || '/Volumes',
      prompt: body.prompt || undefined,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err), path: null });
    return;
  }
  if (!picked) {
    sendJson(res, 200, { cancelled: true, path: null });
    return;
  }
  try {
    const { dest } = assertSafeDest(picked, { create: false });
    sendJson(res, 200, { cancelled: false, path: dest });
  } catch (err) {
    sendJson(res, 400, { error: err.message || String(err), path: picked });
  }
}

/**
 * Body: { dest, sessions: [{ folderId, name }], since?: ISO date string|null }
 * dest = root on external disk; each session downloads into dest/<sessionName>/
 * since = only files with createdTime >= since (for old reused client folders)
 */
async function handlePull(req, res) {
  if (jobRunning) {
    sendJson(res, 409, { error: 'A pull is already running.' });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const destInput = body.dest;
  let sessions = Array.isArray(body.sessions) ? body.sessions : [];
  if ((!sessions.length) && body.folderId) {
    sessions = [{ folderId: body.folderId, name: body.name || body.folderId }];
  }
  sessions = sessions.filter((s) => s && s.folderId);
  if (!destInput || !sessions.length) {
    sendJson(res, 400, { error: 'dest and sessions[] (or folderId) are required.' });
    return;
  }

  const globalSinceRaw = body.since ? String(body.since).trim() : '';
  const globalSinceMs = globalSinceRaw ? Date.parse(globalSinceRaw) : NaN;
  const globalSinceIso = Number.isFinite(globalSinceMs)
    ? new Date(globalSinceMs).toISOString()
    : null;

  let destRoot;
  try {
    ({ dest: destRoot } = assertSafeDest(destInput, { create: true }));
  } catch (err) {
    sendJson(res, 400, { error: err.message || String(err) });
    return;
  }

  jobRunning = true;
  cancelRequested = false;
  sendJson(res, 202, {
    ok: true,
    dest: destRoot,
    sessionCount: sessions.length,
    since: globalSinceIso,
  });

  setImmediate(async () => {
    const totals = {
      downloaded: 0,
      skipped: 0,
      failed: 0,
      bytesDownloaded: 0,
    };

    try {
      const { drive } = createDriveClient();
      broadcast({
        type: 'queue_start',
        sessionCount: sessions.length,
        dest: destRoot,
        since: globalSinceIso,
      });

      for (let si = 0; si < sessions.length; si += 1) {
        if (cancelRequested) break;
        const session = sessions[si];
        const sessionDest = joinSessionDest(destRoot, session.name, session.folderId);
        fs.mkdirSync(sessionDest, { recursive: true });

        const sessionSinceMs = session.since ? Date.parse(session.since) : NaN;
        const sessionUntilMs = session.until ? Date.parse(session.until) : NaN;
        const sinceMs = Number.isFinite(sessionSinceMs)
          ? sessionSinceMs
          : Number.isFinite(globalSinceMs)
            ? globalSinceMs
            : NaN;
        const untilMs = Number.isFinite(sessionUntilMs) ? sessionUntilMs : NaN;
        const sinceIso = Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : null;
        const untilIso = Number.isFinite(untilMs) ? new Date(untilMs).toISOString() : null;

        broadcast({
          type: 'session_start',
          index: si + 1,
          total: sessions.length,
          folderId: session.folderId,
          name: session.name,
          dest: sessionDest,
          since: sinceIso,
          until: untilIso,
        });

        broadcast({ type: 'listing', folderId: session.folderId, dest: sessionDest });
        let files = await walkDriveFolder(drive, session.folderId);
        const listedTotal = files.length;
        if (Number.isFinite(sinceMs) || Number.isFinite(untilMs)) {
          files = filterFilesByWindow(files, sinceMs, untilMs);
        }
        const totalBytes = files.reduce((s, f) => s + f.size, 0);
        broadcast({
          type: 'listing_done',
          folderId: session.folderId,
          fileCount: files.length,
          listedTotal,
          filtered: Boolean(sinceIso || untilIso),
          since: sinceIso,
          until: untilIso,
          totalBytes,
          totalLabel: formatBytes(totalBytes),
        });

        if (!files.length) {
          try {
            upsertBinding({
              folderId: session.folderId,
              token: session.token || null,
              localPath: sessionDest,
              label: session.name,
            });
          } catch {
            /* ignore */
          }
          broadcast({
            type: 'session_done',
            folderId: session.folderId,
            name: session.name,
            localPath: sessionDest,
            empty: true,
          });
          continue;
        }

        const stats = await downloadFiles(drive, files, sessionDest, {
          failFast: false,
          shouldCancel: () => cancelRequested,
          onEvent: (event) =>
            broadcast({
              ...event,
              sessionIndex: si + 1,
              sessionTotal: sessions.length,
              sessionName: session.name,
            }),
        });

        totals.downloaded += stats.downloaded;
        totals.skipped += stats.skipped;
        totals.failed += stats.failed;
        totals.bytesDownloaded += stats.bytesDownloaded;

        // Bind project folder + snapshot baseline for team statuses
        try {
          let token = session.token || null;
          if (!token) {
            const progressMap = await loadProgressByFolderId().catch(() => null);
            token = progressMap?.get?.(session.folderId)?.token || null;
          }
          upsertBinding({
            folderId: session.folderId,
            token,
            localPath: sessionDest,
            label: session.name,
          });
          const driveByRel = new Map(
            files.map((df) => [String(df.relativePath || '').replace(/\\/g, '/'), df])
          );
          const localFiles = walkLocalFolder(sessionDest).map((lf) => {
            const rel = String(lf.relativePath || '').replace(/\\/g, '/');
            const df = driveByRel.get(rel);
            if (df?.md5Checksum && Number(lf.size) === Number(df.size)) {
              return { ...lf, md5Checksum: df.md5Checksum };
            }
            return lf;
          });
          const { fileId: manId, manifest: prevMan } = await readManifest(
            drive,
            session.folderId
          );
          const baseline = buildBaselineFromLocal(localFiles, {
            token,
            force: false,
            prev: prevMan,
          });
          baseline.folderId = session.folderId;
          await writeManifest(drive, session.folderId, manId, baseline);
        } catch (bindErr) {
          broadcast({
            type: 'error',
            relativePath: '(binding)',
            message: bindErr.message || String(bindErr),
          });
        }

        broadcast({
          type: 'session_done',
          folderId: session.folderId,
          name: session.name,
          localPath: sessionDest,
          ...stats,
          bytesLabel: formatBytes(stats.bytesDownloaded),
        });
      }

      broadcast({
        type: 'summary',
        ...totals,
        bytesLabel: formatBytes(totals.bytesDownloaded),
        dest: destRoot,
        cancelled: cancelRequested,
        sessionCount: sessions.length,
      });
    } catch (err) {
      broadcast({ type: 'fatal', message: err.message || String(err) });
    } finally {
      jobRunning = false;
      cancelRequested = false;
    }
  });
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
}

function handleCancel(res) {
  if (!jobRunning) {
    sendJson(res, 200, { ok: true, running: false });
    return;
  }
  cancelRequested = true;
  sendJson(res, 200, { ok: true, running: true, cancelRequested: true });
}

async function handleSync(req, res) {
  if (jobRunning) {
    sendJson(res, 409, { error: 'A job is already running (pull or sync).' });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const folderId = String(body.folderId || '').trim();
  if (!folderId) {
    sendJson(res, 400, { error: 'folderId is required.' });
    return;
  }

  let binding = getBinding(folderId);
  // Hard binding: Sync only uses the path recorded at Pobierz / Zmień folder.
  if (!binding?.localPath) {
    sendJson(res, 400, {
      error:
        'Brak folderu projektu — najpierw Pobierz sesję albo „Zmień folder” (Sync nie ustawia ścieżki).',
    });
    return;
  }

  const bound = path.resolve(binding.localPath);
  if (body.localPath) {
    const requested = path.resolve(String(body.localPath).trim());
    if (requested !== bound) {
      sendJson(res, 400, {
        error: `Sync tylko z folderu po Pobierz:\n${bound}\n(nie ${requested})`,
      });
      return;
    }
  }

  let dest;
  try {
    ({ dest } = assertSafeDest(bound, { create: false }));
  } catch (err) {
    sendJson(res, 400, { error: err.message || String(err) });
    return;
  }

  const nestedWarning = detectNestedSessionPath(
    dest,
    body.label || binding.label || null
  );

  jobRunning = true;
  cancelRequested = false;
  sendJson(res, 202, {
    ok: true,
    folderId,
    localPath: dest,
    nestedWarning: nestedWarning || null,
  });

  setImmediate(async () => {
    try {
      const { drive } = createDriveClient();
      if (nestedWarning) {
        broadcast({ type: 'log', message: `⚠ ${nestedWarning}` });
      }
      broadcast({
        type: 'sync_start',
        folderId,
        dest,
        label: binding.label || folderId,
        nestedWarning: nestedWarning || null,
      });

      broadcast({ type: 'listing', folderId, dest });
      let localFiles = walkLocalFolder(dest);
      localFiles = stripSessionPrefix(localFiles, binding.label);
      // Don't push FromClient/ back during studio sync — those are client top-ups.
      localFiles = localFiles.filter(
        (f) => !String(f.relativePath || '').startsWith('FromClient/')
      );
      const driveFiles = await walkDriveFolder(drive, folderId);

      // Baseline = what the client uploaded. Capture from Drive BEFORE this sync if missing.
      let { fileId: manId, manifest: prevMan } = await readManifest(drive, folderId);
      let manifest = {
        ...prevMan,
        token: binding.token || prevMan.token || null,
        folderId,
      };
      if (!hasBaseline(manifest)) {
        const baselineSource = driveFiles.filter(
          (f) => !String(f.relativePath || '').startsWith('FromClient/')
        );
        manifest = setBaselineFromFiles(baselineSource, {
          token: binding.token,
          force: true,
          prev: manifest,
        });
        manifest.folderId = folderId;
        broadcast({
          type: 'log',
          message: `Baseline z Drive (pliki klienta): ${Object.keys(manifest.baseline).length} plików`,
        });
      }

      const { upload, skip } = await planSync(localFiles, driveFiles);

      broadcast({
        type: 'listing_done',
        folderId,
        fileCount: upload.length,
        listedTotal: localFiles.length,
        skipCount: skip.length,
        totalBytes: upload.reduce((s, f) => s + f.size, 0),
        totalLabel: formatBytes(upload.reduce((s, f) => s + f.size, 0)),
        mode: 'sync',
      });

      for (const s of skip) {
        broadcast({
          type: 'skip',
          relativePath: s.relativePath,
          size: s.size,
          index: 0,
          total: upload.length,
        });
      }

      const stats = await uploadFiles(drive, upload, folderId, {
        shouldCancel: () => cancelRequested,
        onEvent: (event) => broadcast({ ...event, mode: 'sync' }),
      });

      // Statuses vs immutable client baseline (local after edits = current delivery set)
      const nextMan = recomputeStatuses(manifest, localFiles);
      await writeManifest(drive, folderId, manId, nextMan);
      setLastSynced(folderId);

      broadcast({
        type: 'summary',
        mode: 'sync',
        uploaded: stats.uploaded,
        skipped: skip.length + stats.skipped,
        failed: stats.failed,
        bytesUploaded: stats.bytesUploaded,
        bytesLabel: formatBytes(stats.bytesUploaded),
        dest,
        folderId,
        cancelled: cancelRequested,
      });
    } catch (err) {
      broadcast({ type: 'fatal', message: err.message || String(err) });
    } finally {
      jobRunning = false;
      cancelRequested = false;
    }
  });
}

async function handleBindingsGet(res) {
  sendJson(res, 200, { bindings: listBindings() });
}

async function handleBindingPut(req, res) {
  const body = await readBody(req);
  const folderId = String(body.folderId || '').trim();
  const localPath = String(body.localPath || '').trim();
  if (!folderId || !localPath) {
    sendJson(res, 400, { error: 'folderId and localPath are required.' });
    return;
  }
  const { dest } = assertSafeDest(localPath, { create: false });
  const binding = upsertBinding({
    folderId,
    token: body.token || null,
    localPath: dest,
    label: body.label || null,
  });
  sendJson(res, 200, { binding });
}

/**
 * Pull only FromClient/ into local project folder.
 * Body: { folderId }
 */
async function handlePullFromClient(req, res) {
  if (jobRunning) {
    sendJson(res, 409, { error: 'A job is already running (pull or sync).' });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const folderId = String(body.folderId || '').trim();
  if (!folderId) {
    sendJson(res, 400, { error: 'folderId is required.' });
    return;
  }

  const binding = getBinding(folderId);
  if (!binding?.localPath) {
    sendJson(res, 400, {
      error: 'Brak folderu projektu — najpierw Pobierz sesję.',
    });
    return;
  }

  let dest;
  try {
    ({ dest } = assertSafeDest(binding.localPath, { create: false }));
  } catch (err) {
    sendJson(res, 400, { error: err.message || String(err) });
    return;
  }

  jobRunning = true;
  cancelRequested = false;
  sendJson(res, 202, { ok: true, folderId, localPath: dest, mode: 'fromClient' });

  setImmediate(async () => {
    try {
      const { drive } = createDriveClient();
      broadcast({
        type: 'sync_start',
        folderId,
        dest,
        label: binding.label || 'FromClient',
        mode: 'fromClient',
      });

      broadcast({ type: 'listing', folderId, dest });
      const all = await walkDriveFolder(drive, folderId);
      const files = all.filter((f) =>
        String(f.relativePath || '').startsWith('FromClient/')
      );
      const totalBytes = files.reduce((s, f) => s + f.size, 0);
      broadcast({
        type: 'listing_done',
        folderId,
        fileCount: files.length,
        listedTotal: files.length,
        totalBytes,
        totalLabel: formatBytes(totalBytes),
        mode: 'fromClient',
      });

      if (!files.length) {
        setLastClientPull(folderId);
        broadcast({
          type: 'summary',
          mode: 'fromClient',
          downloaded: 0,
          skipped: 0,
          failed: 0,
          bytesDownloaded: 0,
          bytesLabel: formatBytes(0),
          dest,
          folderId,
          cancelled: false,
        });
        return;
      }

      const stats = await downloadFiles(drive, files, dest, {
        failFast: false,
        shouldCancel: () => cancelRequested,
        onEvent: (event) => broadcast({ ...event, mode: 'fromClient' }),
      });

      setLastClientPull(folderId);
      broadcast({
        type: 'summary',
        mode: 'fromClient',
        downloaded: stats.downloaded,
        skipped: stats.skipped,
        failed: stats.failed,
        bytesDownloaded: stats.bytesDownloaded,
        bytesLabel: formatBytes(stats.bytesDownloaded),
        dest,
        folderId,
        cancelled: cancelRequested,
      });
    } catch (err) {
      broadcast({ type: 'fatal', message: err.message || String(err) });
    } finally {
      jobRunning = false;
      cancelRequested = false;
    }
  });
}

/**
 * Snapshot current Drive tree as client baseline (repair / after pull before edits).
 * Body: { folderId, force?: true }
 */
async function handleCaptureBaseline(req, res) {
  const body = await readBody(req);
  const folderId = String(body.folderId || '').trim();
  if (!folderId) {
    sendJson(res, 400, { error: 'folderId is required.' });
    return;
  }
  const force = body.force !== false;
  const { drive } = createDriveClient();
  const driveFiles = await walkDriveFolder(drive, folderId);
  const binding = getBinding(folderId);
  // Prefer non-nested client paths: drop copies under "Session Name/..."
  const label = binding?.label || body.label || '';
  const labelTop = String(label)
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/:/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const clientFiles = labelTop
    ? driveFiles.filter((f) => {
        const top = f.relativePath.split('/')[0];
        return top !== labelTop && top !== label.replace(/:/g, '-');
      })
    : driveFiles;
  const source = clientFiles.length ? clientFiles : driveFiles;

  const { fileId, manifest: prev } = await readManifest(drive, folderId);
  const next = setBaselineFromFiles(source, {
    token: binding?.token || body.token || prev.token,
    force,
    prev,
  });
  next.folderId = folderId;
  await writeManifest(drive, folderId, fileId, next);
  sendJson(res, 200, {
    ok: true,
    baselineCount: Object.keys(next.baseline).length,
    baselineAt: next.baselineAt,
  });
}

async function handleSharesGet(res) {
  const shares = await listSharesLocal();
  sendJson(res, 200, { shares });
}

async function handleSharesPost(req, res) {
  const body = await readBody(req);
  const folderId = String(body.folderId || '').trim();
  if (!folderId) {
    sendJson(res, 400, { error: 'folderId is required.' });
    return;
  }
  const binding = getBinding(folderId);
  const share = await createShareLocal({
    folderId,
    token: body.token || binding?.token || null,
    label: body.label || binding?.label || null,
  });
  sendJson(res, 201, { share });
}

async function handleShareRevoke(id, res) {
  const share = await revokeShareLocal(id);
  sendJson(res, 200, { share });
}

async function handleTokensGet(res) {
  const tokens = await listTokensLocal();
  sendJson(res, 200, { tokens });
}

async function handleTokensPost(req, res) {
  const body = await readBody(req);
  const token = await createTokenLocal(body);
  sendJson(res, 201, { token });
}

async function handleTokenPatch(id, req, res) {
  const body = await readBody(req);
  if (body.locale && body.action === 'locale') {
    const token = await setTokenLocaleLocal(id, body.locale);
    sendJson(res, 200, { token });
    return;
  }
  if (body.action === 'identity') {
    const token = await setTokenIdentityLocal(id, {
      clientName: body.clientName,
      clientEmail: body.clientEmail || body.prefillEmail,
    });
    sendJson(res, 200, { token });
    return;
  }
  const token = await patchTokenLocal(id, body.action);
  sendJson(res, 200, { token });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const { pathname } = url;

    // Public health for Tauri fingerprint check (Host still validated)
    if (req.method === 'GET' && pathname === '/api/health') {
      const gate = assertConsoleRequest(req, {
        token: CONSOLE_TOKEN,
        allowUnauthedPath: true,
      });
      if (!gate.ok) {
        sendJson(res, gate.status, { error: gate.error });
        return;
      }
      sendJson(res, 200, { ok: true, app: 'studio-console', fp: CONSOLE_FP });
      return;
    }

    if (pathname.startsWith('/api/')) {
      const allowQueryToken =
        req.method === 'GET' &&
        (pathname === '/api/pull/events' || pathname === '/api/sync/events');
      const gate = assertConsoleRequest(req, {
        token: CONSOLE_TOKEN,
        allowQueryToken,
      });
      if (!gate.ok) {
        sendJson(res, gate.status, { error: gate.error });
        return;
      }
    }

    if (req.method === 'GET' && pathname === '/api/sessions') {
      await handleSessions(res);
      return;
    }

    const filesMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/files$/);
    if (req.method === 'GET' && filesMatch) {
      await handleSessionFiles(decodeURIComponent(filesMatch[1]), url, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/pick-dest') {
      await handlePickDest(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/pull') {
      await handlePull(req, res);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/pull/events') {
      handleEvents(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/pull/cancel') {
      handleCancel(res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/sync') {
      await handleSync(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/pull-from-client') {
      await handlePullFromClient(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/baseline') {
      await handleCaptureBaseline(req, res);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/sync/events') {
      handleEvents(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/sync/cancel') {
      handleCancel(res);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/bindings') {
      await handleBindingsGet(res);
      return;
    }
    if (req.method === 'PUT' && pathname === '/api/bindings') {
      await handleBindingPut(req, res);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/shares') {
      await handleSharesGet(res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/shares') {
      await handleSharesPost(req, res);
      return;
    }
    const shareMatch = pathname.match(/^\/api\/shares\/([^/]+)$/);
    if (req.method === 'DELETE' && shareMatch) {
      await handleShareRevoke(decodeURIComponent(shareMatch[1]), res);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/tokens') {
      await handleTokensGet(res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/tokens') {
      await handleTokensPost(req, res);
      return;
    }
    const tokenMatch = pathname.match(/^\/api\/tokens\/([^/]+)$/);
    if (req.method === 'PATCH' && tokenMatch) {
      await handleTokenPatch(decodeURIComponent(tokenMatch[1]), req, res);
      return;
    }
    if (req.method === 'DELETE' && tokenMatch) {
      await deleteTokenLocal(decodeURIComponent(tokenMatch[1]));
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: err.message || 'Server error' });
    }
  }
});

export function startStudioConsole({ openBrowser = true } = {}) {
  const wantBrowser =
    openBrowser &&
    process.env.STUDIO_CONSOLE_NO_BROWSER !== '1' &&
    process.env.STUDIO_CONSOLE_EMBEDDED !== '1';

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      const url = `http://${HOST}:${PORT}`;
      console.log(`Studio Console → ${url}`);
      console.log('Close this process to stop. No background agent. No Live Progress.');
      if (wantBrowser && process.platform === 'darwin') {
        exec(`open "${url}"`);
      }
      resolve({ url, server, host: HOST, port: PORT });
    });
  });
}

const autoStart = process.env.STUDIO_CONSOLE_NO_AUTO !== '1';
if (autoStart) {
  startStudioConsole().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
