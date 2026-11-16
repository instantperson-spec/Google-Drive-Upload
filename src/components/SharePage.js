'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { CHUNK_SIZE, uploadChunk } from '@/lib/chunkUpload';
import { LocaleProvider, useT } from '@/context/LocaleContext';
import { normalizeLocale } from '@/lib/locales';
import LocaleSwitch from '@/components/LocaleSwitch';

const SHARE_LOCALE_KEY = 'sharePortal.locale';

function readStoredShareLocale() {
  try {
    const saved = localStorage.getItem(SHARE_LOCALE_KEY);
    if (saved === 'pl' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return null;
}

function storeShareLocale(locale) {
  try {
    localStorage.setItem(SHARE_LOCALE_KEY, normalizeLocale(locale));
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

/** Let React paint before the next heavy step. */
function yieldToUi() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

async function uploadFileViaShare(shareId, file, onPct) {
  const initRes = await fetch(
    `/api/share/${encodeURIComponent(shareId)}/upload-session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
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
      <ul className="share-file-list">
        {items.map((f) => {
          const name = f.name || String(f.relativePath || '').split('/').pop();
          const folder = folderOf(f.relativePath);
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
                <span className="share-file-size">{formatBytes(f.size)}</span>
              </span>
            </li>
          );
        })}
      </ul>
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
    storeShareLocale(normalized);
    if (typeof onLocale === 'function') onLocale(normalized);
  }

  useEffect(() => {
    load();
  }, [load]);

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
  const sincePublishFiles = useMemo(
    () =>
      files.filter(
        (f) => f.vsPrevRound === 'added' || f.vsPrevRound === 'changed'
      ),
    [files]
  );
  const hasStudioUpdates = Boolean(share?.roundId || share?.publishedAt);
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

        await uploadFileViaShare(shareId, file, (pct) => {
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
  const showSince = filter === 'since' && hasStudioUpdates;
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
        {hasStudioUpdates && (
          <button
            type="button"
            className={`share-stat${filter === 'since' ? ' is-active' : ''}`}
            onClick={() => setFilter('since')}
          >
            <strong>{sincePublishFiles.length}</strong>
            <span>{t('share.filterSince')}</span>
          </button>
        )}
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
          className={`share-stat${filter === 'studio' ? ' is-active' : ''}`}
          onClick={() => setFilter('studio')}
        >
          <strong>{studioFiles.length}</strong>
          <span>{t('share.filterStudio')}</span>
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

      {showSince ? (
        <FileSection
          t={t}
          title={t('share.sinceTitle')}
          hint={
            lastSentLabel
              ? t('share.sinceHint', { when: lastSentLabel })
              : t('share.sinceHintDefault')
          }
          items={sincePublishFiles}
          busy={busy}
          downloadLabel={t('share.downloadSince')}
          onDownload={() =>
            downloadSet(
              sincePublishFiles,
              `${zipBase}-studio-updates.zip`,
              t('share.downloadSince')
            )
          }
        />
      ) : null}

      {!showSince && showStudio ? (
        <FileSection
          t={t}
          title={t('share.studioTitle')}
          hint={t('share.studioHint')}
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
      {!showSince && showOriginal ? (
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
      {!showSince && showClient ? (
        <FileSection
          t={t}
          title={t('share.clientTitle')}
          hint={t('share.clientHint')}
          items={fromClientFiles}
          busy={busy}
          downloadLabel={t('share.downloadClient')}
          onDownload={() =>
            downloadSet(
              fromClientFiles,
              `${zipBase}-uploads.zip`,
              t('share.downloadClient')
            )
          }
        />
      ) : null}

      {!files.length ? (
        <p className="share-muted share-empty">{t('share.empty')}</p>
      ) : null}
    </div>
  );
}

export default function SharePage({ shareId }) {
  const [locale, setLocale] = useState(() => readStoredShareLocale() || 'en');

  const onTokenLocale = useCallback((tokenLocale) => {
    if (readStoredShareLocale()) return;
    setLocale(normalizeLocale(tokenLocale));
  }, []);

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
