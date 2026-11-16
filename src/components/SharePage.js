'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { CHUNK_SIZE, uploadChunk } from '@/lib/chunkUpload';
import { LocaleProvider, useT } from '@/context/LocaleContext';
import { normalizeLocale } from '@/lib/locales';
import LocaleSwitch from '@/components/LocaleSwitch';

/** Legacy global key — used to permanently override token locale (bug). */
const LEGACY_SHARE_LOCALE_KEY = 'sharePortal.locale';

function sessionLocaleKey(shareId) {
  return `sharePortal.sessionLocale:${shareId || 'unknown'}`;
}

function clearLegacyShareLocale() {
  try {
    localStorage.removeItem(LEGACY_SHARE_LOCALE_KEY);
  } catch {
    /* ignore */
  }
}

function readSessionShareLocale(shareId) {
  try {
    const saved = sessionStorage.getItem(sessionLocaleKey(shareId));
    if (saved === 'pl' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return null;
}

function storeSessionShareLocale(shareId, locale) {
  try {
    sessionStorage.setItem(sessionLocaleKey(shareId), normalizeLocale(locale));
  } catch {
    /* ignore */
  }
}

function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n || 0} B`;
}

function statusLabel(status, t) {
  if (status === 'fromClient') return t('share.statusFromClient');
  if (status === 'modified') return t('share.statusModified');
  if (status === 'new') return t('share.statusNew');
  return t('share.statusOriginal');
}

function fileExt(nameOrPath) {
  const base = String(nameOrPath || '').split('/').pop() || '';
  const parts = base.split('.');
  if (parts.length < 2) return 'FILE';
  return parts.pop().slice(0, 4).toUpperCase();
}

function folderOf(relativePath) {
  const parts = String(relativePath || '').split('/');
  if (parts.length < 2) return '';
  return parts.slice(0, -1).join('/');
}

const FROM_CLIENT_PREFIX = 'FromClient/';
const FROM_CLIENT_UNGROUPED = '__ungrouped__';

/** One portal drop → one batch folder id: `YYYY-MM-DD_HH-mm__xxxxxxxx` */
function makeFromClientBatchId(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${stamp}__${rand}`;
}

function fromClientBatchKey(relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (!rel.startsWith(FROM_CLIENT_PREFIX) && rel !== 'FromClient') return null;
  if (rel === 'FromClient') return FROM_CLIENT_UNGROUPED;
  const rest = rel.slice(FROM_CLIENT_PREFIX.length);
  const parts = rest.split('/').filter(Boolean);
  if (parts.length >= 2) return parts[0];
  return FROM_CLIENT_UNGROUPED;
}

function formatBatchLabel(batchId, t) {
  if (!batchId || batchId === FROM_CLIENT_UNGROUPED) {
    return t('share.batchUngrouped');
  }
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})__/.exec(batchId);
  if (m) {
    try {
      const d = new Date(`${m[1]}T${m[2]}:${m[3]}:00`);
      if (!Number.isNaN(d.getTime())) {
        return new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(d);
      }
    } catch {
      /* fall through */
    }
  }
  return batchId;
}

function pathInsideBatch(relativePath, batchId) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (!batchId || batchId === FROM_CLIENT_UNGROUPED) {
    const folder = folderOf(rel);
    return folder === 'FromClient' ? '' : folder.replace(/^FromClient\/?/, '');
  }
  const prefix = `${FROM_CLIENT_PREFIX}${batchId}/`;
  if (rel.startsWith(prefix)) {
    const rest = rel.slice(prefix.length);
    const parts = rest.split('/');
    if (parts.length < 2) return '';
    return parts.slice(0, -1).join('/');
  }
  return folderOf(rel);
}

/** Let React paint before the next heavy step. */
function yieldToUi() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

async function uploadFileViaShare(shareId, file, batchId, onPct) {
  const initRes = await fetch(
    `/api/share/${encodeURIComponent(shareId)}/upload-session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        batchId,
      }),
    }
  );
  const initData = await initRes.json();
  if (!initRes.ok) throw new Error(initData.error || 'uploadStartFailed');

  const uploadUrl = initData.uploadUrl;
  let start = 0;
  while (start < file.size) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    await uploadChunk({
      url: uploadUrl,
      file,
      start,
      end,
      onProgress: onPct,
    });
    start = end;
  }
}

function ProgressPanel({ job }) {
  if (!job) return null;
  const pct = Math.max(0, Math.min(100, Math.round(job.pct || 0)));
  const isError = job.phase === 'error';
  const isDone = job.phase === 'done';

  return (
    <div
      className={`share-job${isError ? ' is-error' : ''}${isDone ? ' is-done' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="share-job-top">
        <span className="share-job-spinner" aria-hidden="true" />
        <div className="share-job-copy">
          <strong className="share-job-title">{job.title}</strong>
          <span className="share-job-detail">{job.detail}</span>
        </div>
        <span className="share-job-pct">{isDone || isError ? '' : `${pct}%`}</span>
      </div>
      {!isDone && !isError ? (
        <div className="share-job-track">
          <div className="share-job-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function FileListItems({ items, batchId, t }) {
  return (
    <ul className="share-file-list">
      {items.map((f) => {
        const name = f.name || String(f.relativePath || '').split('/').pop();
        const folder = batchId
          ? pathInsideBatch(f.relativePath, batchId)
          : folderOf(f.relativePath);
        return (
          <li key={f.id} className={`share-file status-${f.status}`}>
            <div className="share-file-main">
              <span className="share-file-ext" aria-hidden="true">
                {fileExt(name)}
              </span>
              <div className="share-file-text">
                <span className="share-file-name" title={f.relativePath}>
                  {name}
                </span>
                {folder ? (
                  <span className="share-file-folder">📁 {folder}/</span>
                ) : null}
              </div>
            </div>
            <span className="share-file-meta">
              <span className={`share-badge share-badge-${f.status}`}>
                {statusLabel(f.status, t)}
              </span>
              <span className="share-file-size">{formatBytes(Number(f.size) || 0)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function FileSection({ title, hint, items, downloadLabel, onDownload, busy, t }) {
  if (!items.length) return null;
  return (
    <section className="share-section">
      <div className="share-section-head">
        <div className="share-section-title-row">
          <h2>{title}</h2>
          <span className="share-section-count">{items.length}</span>
        </div>
        {onDownload ? (
          <button
            type="button"
            className="btn btn-secondary share-section-download"
            disabled={busy}
            onClick={onDownload}
          >
            {busy ? t('share.busyShort') : downloadLabel || t('share.download')}
          </button>
        ) : null}
      </div>
      {hint ? <p className="share-section-hint">{hint}</p> : null}
      <FileListItems items={items} t={t} />
    </section>
  );
}

function ClientBatchesSection({
  title,
  hint,
  batches,
  zipBase,
  busy,
  t,
  onDownload,
}) {
  if (!batches.length) return null;
  return (
    <section className="share-section">
      <div className="share-section-head">
        <div className="share-section-title-row">
          <h2>{title}</h2>
          <span className="share-section-count">
            {batches.reduce((n, b) => n + b.items.length, 0)}
          </span>
        </div>
        {batches.length > 1 ? (
          <button
            type="button"
            className="btn btn-secondary share-section-download"
            disabled={busy}
            onClick={() =>
              onDownload(
                batches.flatMap((b) => b.items),
                `${zipBase}-uploads.zip`,
                t('share.downloadClient')
              )
            }
          >
            {busy ? t('share.busyShort') : t('share.downloadClientAll')}
          </button>
        ) : null}
      </div>
      {hint ? <p className="share-section-hint">{hint}</p> : null}
      {batches.map((batch) => (
        <div key={batch.batchId} className="share-batch">
          <div className="share-batch-head">
            <div className="share-batch-title-row">
              <h3 className="share-batch-title">{batch.label}</h3>
              <span className="share-section-count">{batch.items.length}</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary share-section-download"
              disabled={busy}
              onClick={() =>
                onDownload(
                  batch.items,
                  `${zipBase}-${batch.batchId === FROM_CLIENT_UNGROUPED ? 'ungrouped' : batch.batchId}.zip`,
                  t('share.downloadBatch')
                )
              }
            >
              {busy ? t('share.busyShort') : t('share.downloadBatch')}
            </button>
          </div>
          <FileListItems items={batch.items} batchId={batch.batchId} t={t} />
        </div>
      ))}
    </section>
  );
}

function SharePageInner({ shareId, locale, onLocale, onTokenLocale }) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [share, setShare] = useState(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [filter, setFilter] = useState('all');
  // Legacy "since" filter removed — map to single studio bucket.
  useEffect(() => {
    if (filter === 'since') setFilter('studio');
  }, [filter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('share.openFailed'));
      setShare({
        ...(data.share || {}),
        roundLabel: data.share?.roundLabel || data.round?.label || null,
        roundId: data.share?.roundId || data.round?.id || null,
        publishedAt: data.round?.publishedAt || null,
      });
      setFiles(data.files || []);
      if (data.locale && typeof onTokenLocale === 'function') {
        onTokenLocale(normalizeLocale(data.locale));
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [shareId, onTokenLocale, t]);

  function handleLocaleChange(next) {
    const normalized = normalizeLocale(next);
    storeSessionShareLocale(shareId, normalized);
    if (typeof onLocale === 'function') onLocale(normalized);
  }

  useEffect(() => {
    load();
  }, [load]);

  // One client-facing studio bucket: new OR updated by studio (vs original upload).
  const studioFiles = useMemo(
    () => files.filter((f) => f.status === 'new' || f.status === 'modified'),
    [files]
  );
  const yourFiles = useMemo(
    () => files.filter((f) => f.status === 'original'),
    [files]
  );
  const fromClientFiles = useMemo(
    () => files.filter((f) => f.status === 'fromClient'),
    [files]
  );
  const fromClientBatches = useMemo(() => {
    const map = new Map();
    for (const f of fromClientFiles) {
      const key = fromClientBatchKey(f.relativePath) || FROM_CLIENT_UNGROUPED;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(f);
    }
    const list = [...map.entries()].map(([batchId, items]) => ({
      batchId,
      label: formatBatchLabel(batchId, t),
      items,
    }));
    list.sort((a, b) => {
      if (a.batchId === FROM_CLIENT_UNGROUPED) return 1;
      if (b.batchId === FROM_CLIENT_UNGROUPED) return -1;
      return b.batchId.localeCompare(a.batchId);
    });
    return list;
  }, [fromClientFiles, t]);
  const lastSentLabel = share?.publishedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(share.publishedAt))
    : null;

  async function downloadSet(list, zipName, actionLabel) {
    if (!list.length) {
      setJob({
        phase: 'error',
        title: t('share.noFilesTitle'),
        detail: t('share.noFilesDetail'),
        pct: 0,
      });
      return;
    }

    const total = list.length;
    const totalBytes = list.reduce((s, f) => s + (Number(f.size) || 0), 0);
    const ZIP_MAX_FILES = 40;
    const ZIP_MAX_BYTES = 500 * 1024 * 1024;
    const canUseDirPicker = typeof window.showDirectoryPicker === 'function';
    const zipOk = total <= ZIP_MAX_FILES && totalBytes <= ZIP_MAX_BYTES;

    setBusy(true);
    setJob({
      phase: 'start',
      title: actionLabel || t('share.downloading'),
      detail: t('share.startFiles', { total }),
      pct: 2,
    });
    await yieldToUi();

    try {
      // Default: file-by-file into a chosen folder (avoids ZIP OOM)
      if (canUseDirPicker) {
        const rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

        async function ensureDir(parts) {
          let dir = rootHandle;
          for (const part of parts) {
            if (!part) continue;
            dir = await dir.getDirectoryHandle(part, { create: true });
          }
          return dir;
        }

        for (let i = 0; i < total; i += 1) {
          const f = list[i];
          setJob({
            phase: 'fetch',
            title: t('share.downloading'),
            detail: t('share.downloadProgress', {
              current: i + 1,
              total,
              name: f.name || f.relativePath,
            }),
            pct: Math.max(3, Math.round(((i + 0.2) / total) * 97)),
          });
          await yieldToUi();

          const res = await fetch(
            `/api/share/${encodeURIComponent(shareId)}/file?fileId=${encodeURIComponent(f.id)}`
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(
              err.error || t('share.fileError', { path: f.relativePath })
            );
          }
          const blob = await res.blob();
          const rel = String(f.relativePath || f.name || `file-${i}`).replace(/\\/g, '/');
          const parts = rel.split('/').filter(Boolean);
          const fileName = parts.pop() || `file-${i}`;
          const dir = await ensureDir(parts);
          const fileHandle = await dir.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        }

        setJob({
          phase: 'done',
          title: t('share.done'),
          detail: t('share.savedToFolder', { total }),
          pct: 100,
        });
        return;
      }

      if (!zipOk) {
        throw new Error(t('share.zipTooBig'));
      }

      const zip = new JSZip();
      for (let i = 0; i < total; i += 1) {
        const f = list[i];
        setJob({
          phase: 'fetch',
          title: t('share.downloading'),
          detail: t('share.downloadProgress', {
            current: i + 1,
            total,
            name: f.name || f.relativePath,
          }),
          pct: Math.max(3, Math.round(((i + 0.15) / total) * 85)),
        });
        await yieldToUi();

        const res = await fetch(
          `/api/share/${encodeURIComponent(shareId)}/file?fileId=${encodeURIComponent(f.id)}`
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            err.error || t('share.fileError', { path: f.relativePath })
          );
        }
        const blob = await res.blob();
        zip.file(f.relativePath, blob);
      }

      setJob({
        phase: 'zip',
        title: t('share.preparingZip'),
        detail: t('share.assembling'),
        pct: 86,
      });
      await yieldToUi();

      const out = await zip.generateAsync(
        { type: 'blob', streamFiles: true },
        (meta) => {
          const zipPct = 86 + Math.round((meta.percent || 0) * 0.13);
          setJob({
            phase: 'zip',
            title: t('share.preparingZip'),
            detail: t('share.zipProgress', {
              pct: Math.round(meta.percent || 0),
            }),
            pct: Math.min(99, zipPct),
          });
        }
      );

      const a = document.createElement('a');
      a.href = URL.createObjectURL(out);
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      setJob({
        phase: 'done',
        title: t('share.done'),
        detail: t('share.savedZip', { zipName, total }),
        pct: 100,
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        setJob({
          phase: 'error',
          title: t('share.cancelled'),
          detail: t('share.noFolder'),
          pct: 0,
        });
      } else {
        setJob({
          phase: 'error',
          title: t('share.downloadError'),
          detail: err.message || String(err),
          pct: 0,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleIncomingFiles(fileList) {
    const list = [...fileList].filter((f) => f && f.size > 0);
    if (!list.length) return;

    const batchId = makeFromClientBatchId();

    setBusy(true);
    setJob({
      phase: 'start',
      title: t('share.uploadingTitle'),
      detail: t('share.startFiles', { total: list.length }),
      pct: 2,
    });
    await yieldToUi();

    try {
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        setJob({
          phase: 'upload',
          title: t('share.sendingStudio'),
          detail: t('share.downloadProgress', {
            current: i + 1,
            total: list.length,
            name: file.name,
          }),
          pct: Math.round((i / list.length) * 100),
        });
        await yieldToUi();

        await uploadFileViaShare(shareId, file, batchId, (pct) => {
          const overall = Math.round(((i + pct / 100) / list.length) * 100);
          setJob({
            phase: 'upload',
            title: t('share.sendingStudio'),
            detail: t('share.downloadProgressPct', {
              current: i + 1,
              total: list.length,
              name: file.name,
              pct,
            }),
            pct: overall,
          });
        });
      }

      // Notify studio (always) + client summary if token has email — same idea as /api/notify
      try {
        await fetch(
          `/api/share/${encodeURIComponent(shareId)}/notify-topup`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              label: share?.label || null,
              batchId,
              files: list.map((f) => ({
                name: f.name,
                size: f.size,
                status: 'completed',
              })),
            }),
          }
        );
      } catch {
        /* non-blocking — files are already on Drive */
      }

      setJob({
        phase: 'done',
        title: t('share.uploadDoneTitle'),
        detail: t('share.uploadDoneDetail'),
        pct: 100,
      });
      setFilter('client');
      await load();
    } catch (err) {
      const msg =
        err.message === 'uploadStartFailed'
          ? t('share.uploadStartFailed')
          : err.message || String(err);
      setJob({
        phase: 'error',
        title: t('share.uploadError'),
        detail: msg,
        pct: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="glass-panel share-panel">
        <p className="share-muted">{t('share.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel share-panel">
        <div className="share-portal-header">
          <div className="share-portal-header-top">
            <div>
              <p className="share-access-label">{t('share.accessLabel')}</p>
              <h1 className="share-portal-title">{t('share.portalTitle')}</h1>
            </div>
            <LocaleSwitch locale={locale} onChange={handleLocaleChange} />
          </div>
        </div>
        <h2 className="share-title">{t('share.unavailableTitle')}</h2>
        <p className="share-error">{error}</p>
      </div>
    );
  }

  const projectName = share?.label || t('share.fallbackProject');
  const zipBase =
    String(projectName)
      .replace(/[\/\\?%*:|"<>]/g, '-')
      .slice(0, 80) || 'project';

  const showAllHero = filter === 'all';
  const showStudio = filter === 'all' || filter === 'studio';
  const showOriginal = filter === 'all' || filter === 'original';
  const showClient = filter === 'all' || filter === 'client';

  return (
    <div className="glass-panel share-panel">
      <header className="share-portal-header">
        <div className="share-portal-header-top">
          <div className="share-portal-brand">
            <span className="share-portal-icon" aria-hidden="true">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.2"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </span>
            <div>
              <div className="share-portal-meta">
                <span className="share-access-label">{t('share.accessLabel')}</span>
                <span className="share-active-pill">
                  <span className="share-active-dot" aria-hidden="true" />
                  {t('share.active')}
                </span>
                {lastSentLabel ? (
                  <span className="share-round-pill">
                    {t('share.lastSent', { when: lastSentLabel })}
                  </span>
                ) : null}
              </div>
              <h1 className="share-portal-title">{t('share.portalTitle')}</h1>
            </div>
          </div>
          <LocaleSwitch locale={locale} onChange={handleLocaleChange} />
        </div>

        <div className="share-project-bar">
          <span className="share-project-label">{t('share.projectLabel')}</span>
          <span className="share-project-name">{projectName}</span>
        </div>

        <p className="share-muted share-intro">{t('share.intro')}</p>
      </header>

      <div className="share-stats" aria-label={t('share.statsAria')}>
        <button
          type="button"
          className={`share-stat${filter === 'all' ? ' is-active' : ''}`}
          onClick={() => setFilter('all')}
        >
          <strong>{files.length}</strong>
          <span>{t('share.filterAll')}</span>
        </button>
        <button
          type="button"
          className={`share-stat${filter === 'studio' ? ' is-active' : ''}`}
          onClick={() => setFilter('studio')}
        >
          <strong>{studioFiles.length}</strong>
          <span>{t('share.filterStudio')}</span>
        </button>
        <button
          type="button"
          className={`share-stat${filter === 'original' ? ' is-active' : ''}`}
          onClick={() => setFilter('original')}
        >
          <strong>{yourFiles.length}</strong>
          <span>{t('share.filterYours')}</span>
        </button>
        <button
          type="button"
          className={`share-stat${filter === 'client' ? ' is-active' : ''}`}
          onClick={() => setFilter('client')}
        >
          <strong>{fromClientFiles.length}</strong>
          <span>{t('share.filterClient')}</span>
        </button>
      </div>

      <ProgressPanel job={job} />

      <div
        className={`share-dropzone${dragOver ? ' drag-over' : ''}${busy ? ' is-busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy) handleIncomingFiles(e.dataTransfer.files);
        }}
      >
        <p className="share-dropzone-title">{t('share.dropTitle')}</p>
        <p className="share-muted">{t('share.dropHint')}</p>
        <label className={`share-file-input-label${busy ? ' disabled' : ''}`}>
          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(e) => {
              handleIncomingFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {busy ? t('share.waitBusy') : t('share.chooseFiles')}
        </label>
      </div>

      {showAllHero && files.length ? (
        <section className="share-section">
          <div className="share-section-head">
            <div className="share-section-title-row">
              <h2>{t('share.allTitle')}</h2>
              <span className="share-section-count">{files.length}</span>
            </div>
            <button
              type="button"
              className="btn share-section-download"
              disabled={busy}
              onClick={() =>
                downloadSet(
                  files,
                  `${zipBase}-all.zip`,
                  t('share.downloadAll')
                )
              }
            >
              {busy ? t('share.busyShort') : t('share.downloadAll')}
            </button>
          </div>
          <p className="share-section-hint">{t('share.allHint')}</p>
        </section>
      ) : null}

      {showStudio ? (
        <FileSection
          t={t}
          title={t('share.studioTitle')}
          hint={
            lastSentLabel
              ? t('share.studioHintWithDate', { when: lastSentLabel })
              : t('share.studioHint')
          }
          items={studioFiles}
          busy={busy}
          downloadLabel={t('share.downloadStudio')}
          onDownload={() =>
            downloadSet(
              studioFiles,
              `${zipBase}-from-studio.zip`,
              t('share.downloadStudio')
            )
          }
        />
      ) : null}
      {showOriginal ? (
        <FileSection
          t={t}
          title={t('share.originalTitle')}
          hint={t('share.originalHint')}
          items={yourFiles}
          busy={busy}
          downloadLabel={t('share.downloadOriginal')}
          onDownload={() =>
            downloadSet(
              yourFiles,
              `${zipBase}-original.zip`,
              t('share.downloadOriginal')
            )
          }
        />
      ) : null}
      {showClient ? (
        <ClientBatchesSection
          t={t}
          title={t('share.clientTitle')}
          hint={t('share.clientHint')}
          batches={fromClientBatches}
          zipBase={zipBase}
          busy={busy}
          onDownload={downloadSet}
        />
      ) : null}

      {!files.length ? (
        <p className="share-muted share-empty">{t('share.empty')}</p>
      ) : null}
    </div>
  );
}

export default function SharePage({ shareId }) {
  // Token locale wins. Manual switch is session-only (does not permanently block EN tokens).
  const [locale, setLocale] = useState(
    () => readSessionShareLocale(shareId) || 'en'
  );

  useEffect(() => {
    clearLegacyShareLocale();
  }, []);

  const onTokenLocale = useCallback(
    (tokenLocale) => {
      const fromToken = normalizeLocale(tokenLocale);
      const sessionOverride = readSessionShareLocale(shareId);
      setLocale(sessionOverride || fromToken);
    },
    [shareId]
  );

  return (
    <LocaleProvider locale={locale}>
      <SharePageInner
        shareId={shareId}
        locale={locale}
        onLocale={setLocale}
        onTokenLocale={onTokenLocale}
      />
    </LocaleProvider>
  );
}
