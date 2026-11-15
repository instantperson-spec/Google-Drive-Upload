'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { CHUNK_SIZE, uploadChunk } from '@/lib/chunkUpload';
import { LocaleProvider, useT } from '@/context/LocaleContext';
import { normalizeLocale } from '@/lib/locales';

function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n || 0} B`;
}

function statusLabel(status) {
  if (status === 'fromClient') return 'Dograne przez Ciebie';
  if (status === 'modified') return 'Zmienione przez studio';
  if (status === 'new') return 'Nowe od studia';
  return 'Twoje (oryginał)';
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
  if (!initRes.ok) throw new Error(initData.error || 'Nie udało się zacząć uploadu');

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

function FileSection({ title, hint, items, downloadLabel, onDownload, busy }) {
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
            {busy ? 'Trwa…' : downloadLabel || 'Pobierz'}
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
                  {statusLabel(f.status)}
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

function SharePageInner({ shareId }) {
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
      if (!res.ok) throw new Error(data.error || 'Nie udało się otworzyć linku');
      setShare(data.share);
      setFiles(data.files || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [shareId]);

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

  async function downloadSet(list, zipName, actionLabel) {
    if (!list.length) {
      setJob({
        phase: 'error',
        title: 'Brak plików',
        detail: 'Nie ma nic do pobrania w tej kategorii.',
        pct: 0,
      });
      return;
    }

    setBusy(true);
    setJob({
      phase: 'start',
      title: actionLabel || 'Pobieranie',
      detail: `Start — ${list.length} plików…`,
      pct: 2,
    });
    await yieldToUi();

    try {
      const zip = new JSZip();
      const total = list.length;

      for (let i = 0; i < total; i += 1) {
        const f = list[i];
        const fetchPct = Math.round(((i + 0.15) / total) * 85);
        setJob({
          phase: 'fetch',
          title: 'Pobieranie',
          detail: `${i + 1} / ${total}: ${f.name || f.relativePath}`,
          pct: Math.max(3, fetchPct),
        });
        await yieldToUi();

        const res = await fetch(
          `/api/share/${encodeURIComponent(shareId)}/file?fileId=${encodeURIComponent(f.id)}`
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Błąd: ${f.relativePath}`);
        }
        const blob = await res.blob();
        zip.file(f.relativePath, blob);

        setJob({
          phase: 'fetch',
          title: 'Pobieranie',
          detail: `OK ${i + 1} / ${total}: ${f.name || f.relativePath}`,
          pct: Math.round(((i + 1) / total) * 85),
        });
        await yieldToUi();
      }

      setJob({
        phase: 'zip',
        title: 'Przygotowanie paczki',
        detail: 'Składanie plików…',
        pct: 86,
      });
      await yieldToUi();

      const out = await zip.generateAsync(
        { type: 'blob', streamFiles: true },
        (meta) => {
          const zipPct = 86 + Math.round((meta.percent || 0) * 0.13);
          setJob({
            phase: 'zip',
            title: 'Przygotowanie paczki',
            detail: `${Math.round(meta.percent || 0)}% — nie zamykaj karty`,
            pct: Math.min(99, zipPct),
          });
        }
      );

      setJob({
        phase: 'save',
        title: 'Zapisywanie',
        detail: `Pobieranie „${zipName}”…`,
        pct: 99,
      });
      await yieldToUi();

      const a = document.createElement('a');
      a.href = URL.createObjectURL(out);
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      setJob({
        phase: 'done',
        title: 'Gotowe',
        detail: `Zapisano ${zipName} (${total} plików).`,
        pct: 100,
      });
    } catch (err) {
      setJob({
        phase: 'error',
        title: 'Błąd pobierania',
        detail: err.message || String(err),
        pct: 0,
      });
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
      title: 'Dogrywanie plików',
      detail: `Start — ${list.length} plików…`,
      pct: 2,
    });
    await yieldToUi();

    try {
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        setJob({
          phase: 'upload',
          title: 'Wysyłanie do studia',
          detail: `${i + 1} / ${list.length}: ${file.name}`,
          pct: Math.round((i / list.length) * 100),
        });
        await yieldToUi();

        await uploadFileViaShare(shareId, file, (pct) => {
          const overall = Math.round(((i + pct / 100) / list.length) * 100);
          setJob({
            phase: 'upload',
            title: 'Wysyłanie do studia',
            detail: `${i + 1} / ${list.length}: ${file.name} — ${pct}%`,
            pct: overall,
          });
        });
      }

      setJob({
        phase: 'done',
        title: 'Dogrywanie zakończone',
        detail: 'Studio zobaczy pliki w Console (FromClient).',
        pct: 100,
      });
      setFilter('client');
      await load();
    } catch (err) {
      setJob({
        phase: 'error',
        title: 'Błąd dogrywania',
        detail: err.message || String(err),
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
          <p className="share-access-label">{t('share.accessLabel')}</p>
          <h1 className="share-portal-title">{t('share.portalTitle')}</h1>
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
              </div>
              <h1 className="share-portal-title">{t('share.portalTitle')}</h1>
            </div>
          </div>
        </div>

        <div className="share-project-bar">
          <span className="share-project-label">{t('share.projectLabel')}</span>
          <span className="share-project-name">{projectName}</span>
        </div>

        <p className="share-muted share-intro">{t('share.intro')}</p>
      </header>

      <div className="share-stats" aria-label="Podsumowanie i filtry">
        <button
          type="button"
          className={`share-stat${filter === 'all' ? ' is-active' : ''}`}
          onClick={() => setFilter('all')}
        >
          <strong>{files.length}</strong>
          <span>wszystkie</span>
        </button>
        <button
          type="button"
          className={`share-stat${filter === 'original' ? ' is-active' : ''}`}
          onClick={() => setFilter('original')}
        >
          <strong>{yourFiles.length}</strong>
          <span>Twoje</span>
        </button>
        <button
          type="button"
          className={`share-stat${filter === 'studio' ? ' is-active' : ''}`}
          onClick={() => setFilter('studio')}
        >
          <strong>{studioFiles.length}</strong>
          <span>od studia</span>
        </button>
        <button
          type="button"
          className={`share-stat${filter === 'client' ? ' is-active' : ''}`}
          onClick={() => setFilter('client')}
        >
          <strong>{fromClientFiles.length}</strong>
          <span>dogrywki</span>
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
        <p className="share-dropzone-title">Dograj nowe pliki</p>
        <p className="share-muted">
          Upuść tu pliki albo wybierz z dysku. Trafią do studia (FromClient).
        </p>
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
          {busy ? 'Poczekaj na koniec…' : 'Wybierz pliki…'}
        </label>
      </div>

      {showAllHero && files.length ? (
        <section className="share-section">
          <div className="share-section-head">
            <div className="share-section-title-row">
              <h2>Wszystkie pliki</h2>
              <span className="share-section-count">{files.length}</span>
            </div>
            <button
              type="button"
              className="btn share-section-download"
              disabled={busy}
              onClick={() =>
                downloadSet(files, `${zipBase}-wszystko.zip`, 'Pobierz wszystko')
              }
            >
              {busy ? 'Trwa…' : 'Pobierz wszystko'}
            </button>
          </div>
          <p className="share-section-hint">
            Cały projekt — oryginały, studio i dogrywki.
          </p>
        </section>
      ) : null}

      {showStudio ? (
        <FileSection
          title="Od studia"
          hint="Nowe i zmienione przez studio."
          items={studioFiles}
          busy={busy}
          downloadLabel="Pobierz od studia"
          onDownload={() =>
            downloadSet(studioFiles, `${zipBase}-od-studia.zip`, 'Pobierz od studia')
          }
        />
      ) : null}
      {showOriginal ? (
        <FileSection
          title="Twoje pliki (oryginał)"
          hint="To, co wysłałeś na początku."
          items={yourFiles}
          busy={busy}
          downloadLabel="Pobierz oryginały"
          onDownload={() =>
            downloadSet(yourFiles, `${zipBase}-oryginal.zip`, 'Pobierz oryginały')
          }
        />
      ) : null}
      {showClient ? (
        <FileSection
          title="Twoje dogrywki"
          hint="Pliki dodane później przez ten portal."
          items={fromClientFiles}
          busy={busy}
          downloadLabel="Pobierz dogrywki"
          onDownload={() =>
            downloadSet(
              fromClientFiles,
              `${zipBase}-dogrywki.zip`,
              'Pobierz dogrywki'
            )
          }
        />
      ) : null}

      {!files.length ? (
        <p className="share-muted share-empty">Brak plików w tym projekcie.</p>
      ) : null}
    </div>
  );
}

export default function SharePage({ shareId }) {
  const [locale, setLocale] = useState('en');

  useEffect(() => {
    const browser = typeof navigator !== 'undefined' ? navigator.language : 'en';
    setLocale(normalizeLocale(browser?.toLowerCase().startsWith('pl') ? 'pl' : 'en'));
  }, []);

  return (
    <LocaleProvider locale={locale}>
      <SharePageInner shareId={shareId} />
    </LocaleProvider>
  );
}
