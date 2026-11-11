#!/usr/bin/env node
/**
 * Studio Console — local HTTP server (127.0.0.1 only).
 * Pull (multi-session) + Tokens. No Live Progress. No background agent.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { createDriveClient } from './lib/auth.mjs';
import { assertSafeDest } from './lib/safety.mjs';
import { listSessionFolders, walkDriveFolder } from './lib/driveWalk.mjs';
import { downloadFiles, formatBytes } from './lib/download.mjs';
import { pickFolderMac } from './lib/pickFolder.mjs';
import { joinSessionDest } from './lib/paths.mjs';
import {
  listTokensLocal,
  createTokenLocal,
  patchTokenLocal,
  setTokenLocaleLocal,
  deleteTokenLocal,
} from './lib/tokenOps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');
const HOST = '127.0.0.1';
const PORT = 8787;

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
  return 'application/octet-stream';
}

function serveStatic(req, res) {
  let urlPath = new URL(req.url, `http://${HOST}`).pathname;
  if (urlPath === '/') urlPath = '/index.html';
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
  res.writeHead(200, { 'Content-Type': contentType(filePath) });
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
  const folders = await listSessionFolders(drive, mainFolderId, 50);
  sendJson(res, 200, {
    sessions: folders.map((f) => ({
      folderId: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime || null,
    })),
  });
}

async function handleSessionFiles(folderId, res) {
  const { drive } = createDriveClient();
  const files = await walkDriveFolder(drive, folderId);
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

async function handlePickDest(res) {
  const picked = await pickFolderMac();
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
 * Body: { dest, sessions: [{ folderId, name }] }
 * dest = root on external disk; each session downloads into dest/<sessionName>/
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

  let destRoot;
  try {
    ({ dest: destRoot } = assertSafeDest(destInput, { create: true }));
  } catch (err) {
    sendJson(res, 400, { error: err.message || String(err) });
    return;
  }

  jobRunning = true;
  cancelRequested = false;
  sendJson(res, 202, { ok: true, dest: destRoot, sessionCount: sessions.length });

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
      });

      for (let si = 0; si < sessions.length; si += 1) {
        if (cancelRequested) break;
        const session = sessions[si];
        const sessionDest = joinSessionDest(destRoot, session.name, session.folderId);
        fs.mkdirSync(sessionDest, { recursive: true });

        broadcast({
          type: 'session_start',
          index: si + 1,
          total: sessions.length,
          folderId: session.folderId,
          name: session.name,
          dest: sessionDest,
        });

        broadcast({ type: 'listing', folderId: session.folderId, dest: sessionDest });
        const files = await walkDriveFolder(drive, session.folderId);
        const totalBytes = files.reduce((s, f) => s + f.size, 0);
        broadcast({
          type: 'listing_done',
          folderId: session.folderId,
          fileCount: files.length,
          totalBytes,
          totalLabel: formatBytes(totalBytes),
        });

        if (!files.length) {
          broadcast({
            type: 'session_done',
            folderId: session.folderId,
            name: session.name,
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

        broadcast({
          type: 'session_done',
          folderId: session.folderId,
          name: session.name,
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
  const token = await patchTokenLocal(id, body.action);
  sendJson(res, 200, { token });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const { pathname } = url;

    if (req.method === 'GET' && pathname === '/api/sessions') {
      await handleSessions(res);
      return;
    }

    const filesMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/files$/);
    if (req.method === 'GET' && filesMatch) {
      await handleSessionFiles(decodeURIComponent(filesMatch[1]), res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/pick-dest') {
      await handlePickDest(res);
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
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      const url = `http://${HOST}:${PORT}`;
      console.log(`Studio Console → ${url}`);
      console.log('Close this process to stop. No background agent. No Live Progress.');
      if (openBrowser && process.platform === 'darwin') {
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
