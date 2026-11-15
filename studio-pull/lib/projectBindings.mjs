/**
 * Local project bindings: Drive folderId + token ↔ editing folder on disk.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const CFG_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'StudioConsole');
const BINDINGS_PATH = path.join(CFG_DIR, 'project-bindings.json');

function emptyStore() {
  return { version: 1, updatedAt: null, bindings: [] };
}

export function bindingsPath() {
  return BINDINGS_PATH;
}

export function readBindings() {
  try {
    if (!fs.existsSync(BINDINGS_PATH)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(BINDINGS_PATH, 'utf8'));
    if (!Array.isArray(raw.bindings)) raw.bindings = [];
    return raw;
  } catch {
    return emptyStore();
  }
}

export function writeBindings(store) {
  fs.mkdirSync(CFG_DIR, { recursive: true });
  store.version = 1;
  store.updatedAt = new Date().toISOString();
  if (!Array.isArray(store.bindings)) store.bindings = [];
  fs.writeFileSync(BINDINGS_PATH, JSON.stringify(store, null, 2), 'utf8');
  return store;
}

export function getBinding(folderId) {
  if (!folderId) return null;
  return readBindings().bindings.find((b) => b.folderId === folderId) || null;
}

export function listBindings() {
  return readBindings().bindings;
}

/**
 * Upsert binding for a Drive session folder.
 */
export function upsertBinding({
  folderId,
  token = null,
  localPath,
  label = null,
  lastSyncedAt = undefined,
  lastClientPullAt = undefined,
}) {
  if (!folderId) throw new Error('folderId is required.');
  if (!localPath) throw new Error('localPath is required.');

  const store = readBindings();
  const idx = store.bindings.findIndex((b) => b.folderId === folderId);
  const prev = idx >= 0 ? store.bindings[idx] : {};
  const next = {
    folderId,
    token: token != null ? token : prev.token || null,
    localPath: path.resolve(localPath),
    label: label != null ? label : prev.label || null,
    lastSyncedAt:
      lastSyncedAt !== undefined ? lastSyncedAt : prev.lastSyncedAt || null,
    lastClientPullAt:
      lastClientPullAt !== undefined
        ? lastClientPullAt
        : prev.lastClientPullAt || null,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) store.bindings[idx] = next;
  else store.bindings.push(next);
  writeBindings(store);
  return next;
}

export function setLastSynced(folderId, iso = new Date().toISOString()) {
  const store = readBindings();
  const b = store.bindings.find((x) => x.folderId === folderId);
  if (!b) return null;
  b.lastSyncedAt = iso;
  b.updatedAt = iso;
  writeBindings(store);
  return b;
}

export function setLastClientPull(folderId, iso = new Date().toISOString()) {
  const store = readBindings();
  const b = store.bindings.find((x) => x.folderId === folderId);
  if (!b) return null;
  b.lastClientPullAt = iso;
  b.updatedAt = iso;
  writeBindings(store);
  return b;
}
