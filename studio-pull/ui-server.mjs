#!/usr/bin/env node
/**
 * Studio Pull UI — local HTTP server (127.0.0.1 only).
 * Manual start. Closing this process stops everything.
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
  const folders = await listSessionFolders(drive, mainFolderId, 40);
  sendJson(res, 200, {
    sessions: folders.map((f) => ({
      folderId: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime || null,
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

  const folderId = body.folderId;
  const destInput = body.dest;
  if (!folderId || !destInput) {
    sendJson(res, 400, { error: 'folderId and dest are required.' });
    return;
  }

  let dest;
  try {
    ({ dest } = assertSafeDest(destInput, { create: true }));
  } catch (err) {
    sendJson(res, 400, { error: err.message || String(err) });
    return;
  }

  jobRunning = true;
  cancelRequested = false;
  sendJson(res, 202, { ok: true, dest });

  // Run job after response
  setImmediate(async () => {
    try {
      const { drive } = createDriveClient();
      broadcast({ type: 'listing', folderId, dest });
      const files = await walkDriveFolder(drive, folderId);
      const totalBytes = files.reduce((s, f) => s + f.size, 0);
      broadcast({
        type: 'listing_done',
        fileCount: files.length,
        totalBytes,
        totalLabel: formatBytes(totalBytes),
      });

      if (!files.length) {
        broadcast({
          type: 'summary',
          downloaded: 0,
          skipped: 0,
          failed: 0,
          bytesDownloaded: 0,
          bytesLabel: '0 B',
          dest,
          empty: true,
        });
        return;
      }

      const stats = await downloadFiles(drive, files, dest, {
        failFast: false,
        shouldCancel: () => cancelRequested,
        onEvent: (event) => broadcast(event),
      });

      broadcast({
        type: 'summary',
        ...stats,
        bytesLabel: formatBytes(stats.bytesDownloaded),
        dest,
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const { pathname } = url;

    if (req.method === 'GET' && pathname === '/api/sessions') {
      await handleSessions(res);
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

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`Studio Pull UI → ${url}`);
  console.log('Close this terminal to stop. No background agent.');
  if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  }
});
