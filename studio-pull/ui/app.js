(async () => {
  const t = (...args) => window.StudioI18n.t(...args);

  const $ = (id) => document.getElementById(id);

  const CONSOLE_TOKEN =
    document.querySelector('meta[name="studio-console-token"]')?.content || '';

  function apiFetch(url, opts = {}) {
    const headers = new Headers(opts.headers || {});
    if (CONSOLE_TOKEN) headers.set('X-Studio-Console-Token', CONSOLE_TOKEN);
    return fetch(url, { ...opts, headers });
  }

  function apiEvents(path) {
    const sep = path.includes('?') ? '&' : '?';
    return new EventSource(
      `${path}${sep}consoleToken=${encodeURIComponent(CONSOLE_TOKEN)}`
    );
  }

  function localeTag() {
    return window.StudioI18n.getLocale() === 'pl' ? 'pl-PL' : 'en-US';
  }

  function formatDateTime(value) {
    if (!value) return t('common.emDash');
    try {
      return new Date(value).toLocaleString(localeTag());
    } catch {
      return String(value);
    }
  }

  function formatExpires(iso) {
    if (!iso) return t('common.emDash');
    try {
      return new Intl.DateTimeFormat(localeTag(), { dateStyle: 'medium' }).format(
        new Date(iso)
      );
    } catch {
      return String(iso);
    }
  }

  function tokenStatusLabel(status) {
    if (status === 'active') return t('tokensPanel.statusActive');
    if (status === 'expired') return t('tokensPanel.statusExpired');
    if (status === 'revoked') return t('tokensPanel.statusRevoked');
    return String(status || '');
  }

  const sessionsEl = $('sessions');
  const previewEl = $('preview');
  const previewMeta = $('preview-meta');
  const destEl = $('dest');
  const destErrorEl = $('dest-error');
  const statusEl = $('status');
  const statusTitleEl = $('status-title');
  const statusSubEl = $('status-sub');
  const barEl = $('bar');
  const logEl = $('log');
  const btnRefresh = $('btn-refresh');
  const btnPreview = $('btn-preview');
  const btnPick = $('btn-pick');
  const btnStart = $('btn-start');
  const btnCancel = $('btn-cancel');
  const tokensEl = $('tokens');
  const tokenForm = $('token-form');
  const tokenFormError = $('token-form-error');

  /** @type {Map<string, object>} */
  const sessionMap = new Map();
  /** @type {Set<string>} */
  const selected = new Set();
  let previewSessionId = null;
  let destPath = '';
  let running = false;
  let currentFileIndex = 0;
  let currentFileTotal = 1;

  try {
    const saved = localStorage.getItem('studioConsole.destPath');
    if (saved) destPath = saved;
  } catch {
    /* ignore */
  }

  function sessionSubfolderName(sessionName, folderId) {
    const base = String(sessionName || folderId || 'session')
      .replace(/[\/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return base || folderId || 'session';
  }

  /** Path after pull (binding) — only this is allowed for Sync. */
  function projectFolderPath(session) {
    return session?.localPath || null;
  }

  /** Hint before pull: where files will land. */
  function expectedPullPath(session) {
    if (session?.localPath) return session.localPath;
    if (!destPath || !session) return null;
    const sub = sessionSubfolderName(session.name, session.folderId);
    return `${destPath.replace(/\/$/, '')}/${sub}`;
  }

  const flashEl = $('flash');
  let flashTimer = null;

  function offerShareAfterSync(folderId, label, token) {
    if (!flashEl || !folderId) return;
    let actions = flashEl.querySelector('.flash-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'flash-actions';
      flashEl.appendChild(actions);
    }
    actions.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ok tiny';
    btn.textContent = t('notify.offerShare');
    btn.addEventListener('click', async () => {
      try {
        await shareSession(folderId, label, token);
      } catch (err) {
        notify(err.message || String(err), 'error');
      }
    });
    actions.appendChild(btn);
  }

  /** In-app banner — Tauri often hides window.alert/confirm behind the window. */
  function notify(message, kind = 'ok') {
    const text = String(message || '');
    if (flashEl) {
      flashEl.textContent = text;
      flashEl.className = `flash ${kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'ok'}`;
      flashEl.classList.remove('hidden');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => flashEl.classList.add('hidden'), 8000);
    }
    appendLog(text);
    if (kind === 'error') setStatus(text, 'error');
    else if (kind === 'warn') setStatus(text, 'warn');
    else setStatus(text, 'ok');
  }

  function setStatus(text, cls) {
    const state = running
      ? 'running'
      : cls === 'ok'
        ? 'ok'
        : cls === 'warn'
          ? 'warn'
          : cls === 'error'
            ? 'error'
            : 'idle';
    statusEl.dataset.state = state;
    statusEl.className = 'status' + (cls ? ` ${cls}` : '');

    if (running) {
      statusTitleEl.textContent = t('status.syncing');
      statusSubEl.textContent = text || '';
      return;
    }
    if (cls === 'ok' || cls === 'warn' || cls === 'error') {
      statusTitleEl.textContent =
        cls === 'ok' ? t('status.done') : cls === 'error' ? t('status.error') : t('status.warn');
      statusSubEl.textContent = text || '';
      return;
    }
    statusTitleEl.textContent = t('status.ready');
    statusSubEl.textContent = text || t('status.readyHint');
  }

  function appendLog(line) {
    logEl.textContent += `${line}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setProgress(index, total) {
    currentFileIndex = index;
    currentFileTotal = total || 1;
    const pct = Math.min(100, Math.round((index / currentFileTotal) * 100));
    barEl.style.width = `${pct}%`;
  }

  function updateStartEnabled() {
    const canStart = !running && selected.size > 0 && !!destPath;
    btnStart.disabled = !canStart;
    btnCancel.disabled = !running;
    btnPick.disabled = running;
    btnRefresh.disabled = running;
    btnPreview.disabled = running || !previewSessionId;

    if (!running && !canStart) {
      if (!selected.size && !destPath) setStatus(t('status.selectSessionsAndFolder'));
      else if (!selected.size) setStatus(t('status.selectOneSession'));
      else if (!destPath) setStatus(t('status.selectFolder'));
    }
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((tabBtn) => {
      tabBtn.classList.toggle('active', tabBtn.dataset.tab === name);
    });
    $('panel-pull').classList.toggle('hidden', name !== 'pull');
    $('panel-tokens').classList.toggle('hidden', name !== 'tokens');
    if (name === 'tokens') loadTokens();
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  async function loadSharesByFolder() {
    try {
      const res = await apiFetch('/api/shares');
      const data = await res.json();
      if (!res.ok) return new Map();
      const map = new Map();
      for (const sh of data.shares || []) {
        if (sh.revoked) continue;
        map.set(sh.folderId, sh);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  async function pullFromClient(session) {
    if (running || !session?.folderId) return;
    if (!projectFolderPath(session)) {
      notify(t('notify.needDownloadFirst'), 'warn');
      return;
    }
    running = true;
    updateStartEnabled();
    logEl.textContent = '';
    setProgress(0, 1);
    notify(t('notify.pullFromClientStart'), 'ok');
    try {
      const res = await apiFetch('/api/pull-from-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: session.folderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('errors.pullFromClientFailed'));
      setStatus(t('status.fromClientPath', { path: data.localPath }));
    } catch (err) {
      running = false;
      updateStartEnabled();
      notify(err.message || String(err), 'error');
    }
  }

  async function syncSession(session) {
    if (running || !session?.folderId) return;
    const pathHint = projectFolderPath(session);
    if (!pathHint) {
      notify(t('notify.needDownloadForSync'), 'warn');
      return;
    }
    running = true;
    updateStartEnabled();
    logEl.textContent = '';
    setProgress(0, 1);
    notify(t('notify.syncStart', { path: pathHint }), 'ok');
    try {
      const res = await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: session.folderId,
          localPath: pathHint,
          label: session.name,
          token: session.token || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('errors.syncFailed'));
      setStatus(t('status.syncResultPath', { path: data.localPath }));
      if (data.nestedWarning) {
        notify(data.nestedWarning, 'warn');
      }
      session._pendingShareOffer = true;
    } catch (err) {
      running = false;
      updateStartEnabled();
      notify(err.message || String(err), 'error');
    }
  }

  async function linkSessionFolder(session) {
    const suggested =
      projectFolderPath(session) || expectedPullPath(session) || destPath || '/Volumes';
    try {
      const pick = await apiFetch('/api/pick-dest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultPath: suggested,
          prompt: t('dest.linkPrompt'),
        }),
      });
      const picked = await pick.json();
      if (picked.cancelled) return;
      if (!pick.ok) {
        notify(picked.error || t('dest.rejected'), 'error');
        return;
      }
      const res = await apiFetch('/api/bindings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: session.folderId,
          localPath: picked.path,
          label: session.name,
          token: session.token || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('errors.linkFailed'));
      notify(t('notify.linkedSync', { path: data.binding.localPath }), 'ok');
      loadSessions();
    } catch (err) {
      notify(err.message || String(err), 'error');
    }
  }

  async function shareSession(folderId, label, token) {
    const res = await apiFetch('/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId, label, token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('errors.shareFailed'));
    const url = data.share?.url;
    try {
      await navigator.clipboard.writeText(url);
      notify(t('notify.shareReadyCopied', { url }), 'ok');
    } catch {
      notify(t('notify.shareReadyCopy', { url }), 'warn');
    }
    await loadSessions();
  }

  async function publishSession(session) {
    const folderId = session.folderId;
    if (!folderId) throw new Error(t('errors.missingFolderId'));
    notify(t('notify.publishing'), 'ok');
    const res = await apiFetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderId,
        token: session.token || null,
        label: session.name || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || t('errors.publishFailed'));
    const url = data.share?.url;
    const roundLabel = data.round?.label || t('sessions.draft');
    if (url) {
      try {
        await navigator.clipboard.writeText(url);
        notify(t('notify.publishedCopied', { round: roundLabel, url }), 'ok');
      } catch {
        notify(t('notify.publishedCopy', { round: roundLabel, url }), 'warn');
      }
    } else {
      notify(t('notify.published', { round: roundLabel }), 'ok');
    }
    if (data.mail?.sent) {
      notify(
        t('notify.mailSent', {
          to: data.mail.to ? `: ${data.mail.to}` : '',
        }),
        'ok'
      );
    } else if (data.mail && !data.mail.skipped) {
      notify(
        t('notify.mailFailed', {
          reason:
            data.mail.error || data.mail.skipped || t('notify.mailFailedFallback'),
        }),
        'warn'
      );
    } else if (data.mail?.skipped === 'missing_ADMIN_SECRET') {
      notify(t('notify.mailSkippedSecret'), 'warn');
    }
    await loadSessions();
    return data;
  }

  async function revokeShare(shareId) {
    try {
      notify(t('notify.revoking'), 'warn');
      const res = await apiFetch(`/api/shares/${encodeURIComponent(shareId)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(data.error || t('notify.revokeFailed'), 'error');
        return;
      }
      notify(t('notify.revoked'), 'ok');
      await loadSessions();
    } catch (err) {
      notify(err.message || String(err), 'error');
    }
  }

  async function loadSessions() {
    sessionsEl.textContent = t('sessions.loading');
    try {
      const [res, sharesByFolder] = await Promise.all([
        apiFetch('/api/sessions'),
        loadSharesByFolder(),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('sessions.listError'));
      const list = data.sessions || [];
      sessionMap.clear();
      selected.clear();
      if (!list.length) {
        sessionsEl.textContent = t('sessions.empty');
        previewSessionId = null;
        updateStartEnabled();
        return;
      }

      sessionsEl.innerHTML = '';
      let oosCount = 0;
      for (const s of list) {
        const sid = s.id || s.folderId;
        sessionMap.set(sid, s);
        if (s.syncStatus === 'out_of_sync') oosCount += 1;
        const row = document.createElement('div');
        row.className = 'session-row';
        const checkLabel = document.createElement('label');
        checkLabel.className = 'session-check';
        const checkInput = document.createElement('input');
        checkInput.type = 'checkbox';
        checkInput.dataset.id = sid;
        checkLabel.appendChild(checkInput);

        const sessionBody = document.createElement('div');
        sessionBody.className = 'session-body';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'session-name';
        nameSpan.textContent = s.name;
        const metaSpan = document.createElement('span');
        metaSpan.className = 'session-meta';
        const localEl = document.createElement('span');
        localEl.className = 'session-local';

        sessionBody.appendChild(nameSpan);
        sessionBody.appendChild(metaSpan);
        sessionBody.appendChild(localEl);

        const actions = document.createElement('div');
        actions.className = 'session-actions';

        const previewLabel = document.createElement('label');
        previewLabel.className = 'session-preview-pick';
        previewLabel.title = t('sessions.previewPickTitle');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'preview-session';
        radio.value = sid;
        const previewText = document.createTextNode(t('sessions.previewPick'));
        previewLabel.appendChild(radio);
        previewLabel.appendChild(previewText);

        row.appendChild(checkLabel);
        row.appendChild(sessionBody);
        row.appendChild(actions);
        row.appendChild(previewLabel);

        const bits = [];
        if (s.batch && s.fileCount != null) {
          bits.push(t('sessions.filesMeta', { count: s.fileCount, total: s.totalLabel || '' }));
        }
        if (s.since && s.until) {
          bits.push(t('sessions.day', { date: String(s.since).slice(0, 10) }));
        } else {
          const whenRaw = s.lastActivity || s.modifiedTime || s.createdTime;
          bits.push(
            whenRaw
              ? t('sessions.activity', { when: formatDateTime(whenRaw) })
              : t('common.emDash')
          );
        }
        if (s.token) bits.push(t('sessions.tokenRef', { token: s.token }));
        if (s.lastSyncedAt) {
          bits.push(t('sessions.syncAt', { when: formatDateTime(s.lastSyncedAt) }));
        }
        if (s.fromClientCount > 0) {
          bits.push(t('sessions.uploadsCount', { count: s.fromClientCount }));
        }
        const reasons = s.syncReasons || {};
        if (reasons.fromClientPending) bits.push(t('sessions.flagUploads'));
        if (reasons.studioRemoteNewer) bits.push(t('sessions.flagDriveChanges'));
        metaSpan.textContent = bits.join(' · ');
        if (s.syncStatus === 'out_of_sync') {
          row.classList.add('session-out-of-sync');
        }

        const syncPath = projectFolderPath(s);
        if (syncPath) {
          const chips = [];
          if (reasons.fromClientPending) {
            chips.push(t('sessions.chipUploads'));
          }
          if (reasons.studioRemoteNewer) {
            chips.push(t('sessions.chipDrive'));
          }
          const syncLabel = chips.length
            ? chips.join(' · ')
            : s.lastSyncedAt
              ? t('sessions.syncedAt', { when: formatDateTime(s.lastSyncedAt) })
              : t('sessions.notSyncedYet');
          localEl.innerHTML = '';
          const pathLine = document.createElement('div');
          pathLine.textContent = syncPath;
          localEl.appendChild(pathLine);
          const statusLine = document.createElement('div');
          statusLine.className = 'session-sync-status';
          if (chips.length) {
            for (const chip of chips) {
              const span = document.createElement('span');
              span.className = 'oos-chip';
              span.textContent = chip;
              statusLine.appendChild(span);
            }
          } else {
            const chip = document.createElement('span');
            chip.className = s.lastSyncedAt ? 'sync-chip' : 'sync-chip pending';
            chip.textContent = syncLabel;
            statusLine.appendChild(chip);
          }
          localEl.appendChild(statusLine);
          if (s.nestedWarning) {
            const warn = document.createElement('div');
            warn.className = 'session-nested-warn';
            warn.textContent = s.nestedWarning;
            localEl.appendChild(warn);
          }
          if (s.syncStatus === 'out_of_sync' || s.nestedWarning) {
            localEl.style.color = 'var(--warn)';
          }
        } else {
          const expected = expectedPullPath(s);
          localEl.textContent = expected
            ? t('sessions.afterDownload', { path: expected })
            : t('sessions.setFolderFirst');
          if (expected) localEl.style.color = 'var(--warn)';
        }

        const mkBtn = (label, cls, fn, parent = actions) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `btn ${cls} tiny`;
          b.textContent = label;
          b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fn();
          });
          parent.appendChild(b);
          return b;
        };

        const menuWrap = document.createElement('div');
        menuWrap.className = 'session-menu';
        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'btn ghost tiny';
        menuBtn.textContent = '⋯';
        menuBtn.title = t('sessions.more');
        const menuPop = document.createElement('div');
        menuPop.className = 'session-menu-pop';
        menuBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const open = menuPop.classList.contains('open');
          document.querySelectorAll('.session-menu-pop.open').forEach((el) => {
            el.classList.remove('open');
          });
          if (!open) menuPop.classList.add('open');
        });
        menuWrap.appendChild(menuBtn);
        menuWrap.appendChild(menuPop);

        const needsClientPull =
          syncPath && (s.fromClientCount > 0 || s.missingLocalFromClient > 0);
        const activeShare = sharesByFolder.get(s.folderId);

        if (activeShare?.rounds?.length) {
          const roundsEl = document.createElement('div');
          roundsEl.className = 'session-rounds';
          for (const r of activeShare.rounds) {
            const chip = document.createElement('span');
            chip.className =
              r.id === activeShare.roundId ? 'round-chip is-current' : 'round-chip';
            chip.textContent = r.label || t('sessions.draft');
            chip.title = r.publishedAt
              ? t('sessions.publishedAt', { when: formatDateTime(r.publishedAt) })
              : '';
            roundsEl.appendChild(chip);
          }
          sessionBody.appendChild(roundsEl);
        }

        if (needsClientPull) {
          const btnClient = mkBtn(t('sessions.pullFromClient'), 'ghost', () =>
            pullFromClient(s)
          );
          btnClient.title = t('sessions.pullFromClientTitle');
          if (reasons.fromClientPending || s.missingLocalFromClient > 0) {
            btnClient.classList.add('warn-accent');
          }
        }

        const pubBtn = mkBtn(t('sessions.publish'), 'primary', async () => {
          try {
            await publishSession(s);
          } catch (err) {
            notify(err.message || String(err), 'error');
          }
        });
        pubBtn.title = t('sessions.publishTitle');
        if (!syncPath) pubBtn.disabled = true;

        if (!needsClientPull) {
          const syncBtn = mkBtn(t('sessions.syncDrive'), 'ok', () => syncSession(s));
          syncBtn.title = t('sessions.syncDriveTitle');
          if (!syncPath) syncBtn.disabled = true;
        }

        if (activeShare) {
          mkBtn(t('sessions.copyLink'), 'ghost', async () => {
            try {
              await navigator.clipboard.writeText(activeShare.url);
              notify(t('notify.copiedClientLink', { url: activeShare.url }), 'ok');
            } catch {
              notify(t('notify.copyManual', { url: activeShare.url }), 'warn');
            }
          });
        } else {
          mkBtn(t('sessions.sendLink'), 'ghost', async () => {
            try {
              await shareSession(s.folderId, s.name, s.token);
            } catch (err) {
              notify(err.message || String(err), 'error');
            }
          });
        }

        if (syncPath) {
          mkBtn(
            s.nestedWarning ? t('sessions.pickCorrectFolder') : t('sessions.changeSyncFolder'),
            s.nestedWarning ? 'warn' : 'ghost',
            () => linkSessionFolder(s),
            menuPop
          );
        } else {
          mkBtn(t('sessions.pickSyncFolder'), 'ghost', () => linkSessionFolder(s), menuPop);
        }

        if (needsClientPull) {
          const syncInMenu = mkBtn(t('sessions.syncDrive'), 'ok', () => syncSession(s), menuPop);
          if (!syncPath) syncInMenu.disabled = true;
        }

        if (activeShare) {
          const btnRev = mkBtn(
            t('sessions.revokeLink'),
            'danger',
            () => {
              if (btnRev.dataset.armed === '1') {
                btnRev.dataset.armed = '';
                menuPop.classList.remove('open');
                revokeShare(activeShare.id);
                return;
              }
              btnRev.dataset.armed = '1';
              btnRev.textContent = t('sessions.revokeConfirm');
              notify(t('notify.revokeAgain'), 'warn');
              setTimeout(() => {
                if (btnRev.dataset.armed === '1') {
                  btnRev.dataset.armed = '';
                  btnRev.textContent = t('sessions.revokeLink');
                }
              }, 5000);
            },
            menuPop
          );
        }

        actions.appendChild(menuWrap);

        checkInput.addEventListener('change', () => {
          if (checkInput.checked) selected.add(sid);
          else selected.delete(sid);
          updateStartEnabled();
        });

        radio.addEventListener('change', () => {
          previewSessionId = sid;
          updateStartEnabled();
        });

        sessionsEl.appendChild(row);
      }

      const sessionsCountEl = $('sessions-count');
      if (sessionsCountEl) {
        sessionsCountEl.textContent = String(list.length);
        sessionsCountEl.classList.toggle('hidden', !list.length);
      }
      const kpiSessions = $('kpi-sessions');
      const kpiOos = $('kpi-oos');
      const kpiShares = $('kpi-shares');
      if (kpiSessions) kpiSessions.textContent = String(list.length);
      if (kpiOos) kpiOos.textContent = String(oosCount);
      if (kpiShares) kpiShares.textContent = String(sharesByFolder.size);

      const first = list[0];
      const firstId = first.id || first.folderId;
      const firstCb = [...sessionsEl.querySelectorAll('input[type=checkbox]')].find(
        (el) => el.dataset.id === firstId
      );
      const firstRadio = [...sessionsEl.querySelectorAll('input[type=radio]')].find(
        (el) => el.value === firstId
      );
      if (firstCb) {
        firstCb.checked = true;
        selected.add(firstId);
      }
      if (firstRadio) {
        firstRadio.checked = true;
        previewSessionId = firstId;
      }
      updateStartEnabled();
    } catch (err) {
      sessionsEl.textContent = err.message || String(err);
    }
  }

  async function loadPreview() {
    if (!previewSessionId) return;
    const session = sessionMap.get(previewSessionId);
    if (!session?.folderId) return;
    previewMeta.textContent = t('preview.loading');
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';
    try {
      const q = new URLSearchParams();
      if (session.since) q.set('since', session.since);
      if (session.until) q.set('until', session.until);
      const qs = q.toString() ? `?${q}` : '';
      const res = await apiFetch(
        `/api/sessions/${encodeURIComponent(session.folderId)}/files${qs}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('preview.error'));
      previewMeta.textContent = t('preview.meta', {
        count: data.fileCount,
        total: data.totalLabel,
      });
      const ul = document.createElement('ul');
      ul.className = 'preview-list';
      for (const f of (data.files || []).slice(0, 500)) {
        const li = document.createElement('li');
        const pathSpan = document.createElement('span');
        pathSpan.className = 'p-path';
        pathSpan.textContent = f.relativePath;
        const sizeSpan = document.createElement('span');
        sizeSpan.className = 'p-size';
        sizeSpan.textContent = f.sizeLabel;
        li.appendChild(pathSpan);
        li.appendChild(sizeSpan);
        ul.appendChild(li);
      }
      if ((data.files || []).length > 500) {
        const more = document.createElement('li');
        more.className = 'muted';
        more.textContent = t('preview.more', { count: data.files.length - 500 });
        ul.appendChild(more);
      }
      previewEl.appendChild(ul);
      previewEl.classList.remove('hidden');
    } catch (err) {
      previewMeta.textContent = err.message || String(err);
    }
  }

  async function pickDest() {
    destErrorEl.classList.add('hidden');
    setStatus(t('dest.opening'));
    try {
      const res = await apiFetch('/api/pick-dest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultPath: destPath || '/Volumes',
          prompt: t('dest.pickPrompt'),
        }),
      });
      const data = await res.json();
      if (data.cancelled) {
        setStatus(t('dest.cancelled'));
        return;
      }
      if (!res.ok) {
        destErrorEl.textContent = data.error || t('dest.invalid');
        destErrorEl.classList.remove('hidden');
        setStatus(t('dest.needVolumes'), 'error');
        return;
      }
      destPath = String(data.path || '').trim();
      destEl.value = destPath;
      try {
        localStorage.setItem('studioConsole.destPath', destPath);
      } catch {
        /* ignore */
      }
      destErrorEl.classList.add('hidden');
      setStatus(t('dest.base', { path: destPath }));
      updateStartEnabled();
      loadSessions();
    } catch (err) {
      destErrorEl.textContent = err.message || String(err);
      destErrorEl.classList.remove('hidden');
      setStatus(err.message || String(err), 'error');
    }
  }

  function onDestTyped() {
    destPath = destEl.value.trim();
    destErrorEl.classList.add('hidden');
    try {
      if (destPath) localStorage.setItem('studioConsole.destPath', destPath);
    } catch {
      /* ignore */
    }
    updateStartEnabled();
    if (destPath) setStatus(t('dest.base', { path: destPath }));
  }

  function onDestCommitted() {
    onDestTyped();
    loadSessions();
  }

  function defaultFreshSinceLocal() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`;
  }

  const freshOnlyEl = $('fresh-only');
  const freshSinceEl = $('fresh-since');
  if (freshSinceEl && !freshSinceEl.value) freshSinceEl.value = defaultFreshSinceLocal();

  async function startPull() {
    if (!selected.size || !destPath || running) return;
    const sessions = [...selected].map((id) => {
      const s = sessionMap.get(id);
      return {
        folderId: s?.folderId || id,
        name: s?.name || id,
        since: s?.since || null,
        until: s?.until || null,
      };
    });

    let since = null;
    const needsGlobalFresh = sessions.some((s) => !s.since);
    if (needsGlobalFresh && freshOnlyEl?.checked) {
      const local = freshSinceEl?.value;
      if (!local) {
        setStatus(t('status.needFreshDate'), 'warn');
        return;
      }
      since = new Date(local).toISOString();
    }

    running = true;
    updateStartEnabled();
    logEl.textContent = '';
    setProgress(0, 1);
    setStatus(t('status.queueStart', { count: sessions.length }));

    try {
      const res = await apiFetch('/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dest: destPath, sessions, since }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('status.startFailed'));
      setStatus(t('status.queueTo', { dest: data.dest }));
    } catch (err) {
      running = false;
      updateStartEnabled();
      setStatus(err.message || String(err), 'error');
    }
  }

  async function cancelPull() {
    await apiFetch('/api/pull/cancel', { method: 'POST' });
    setStatus(t('status.cancelling'), 'warn');
  }

  function onEvent(event) {
    switch (event.type) {
      case 'queue_start':
        appendLog(
          t('log.queue', { count: event.sessionCount, dest: event.dest })
        );
        if (event.since) {
          appendLog(t('log.freshFilter', { since: event.since }));
        }
        break;
      case 'sync_start':
        appendLog(t('log.syncDrive', { label: event.label || event.folderId }));
        appendLog(t('log.from', { dest: event.dest }));
        setStatus(t('status.syncingSession', { label: event.label || event.folderId }));
        break;
      case 'log':
        if (event.message) appendLog(event.message);
        break;
      case 'session_start':
        appendLog(
          t('log.session', {
            index: event.index,
            total: event.total,
            name: event.name,
          })
        );
        appendLog(t('log.to', { dest: event.dest }));
        setStatus(
          t('status.sessionProgress', {
            index: event.index,
            total: event.total,
            name: event.name,
          })
        );
        break;
      case 'listing':
        appendLog(t('log.listing', { folderId: event.folderId }));
        break;
      case 'listing_done':
        if (event.mode === 'sync') {
          appendLog(
            t('log.toUpload', {
              fileCount: event.fileCount,
              listedTotal: event.listedTotal || '?',
              skipCount: event.skipCount || 0,
              totalLabel: event.totalLabel,
            })
          );
        } else {
          appendLog(
            event.filtered
              ? t('log.filesFiltered', {
                  fileCount: event.fileCount,
                  listedTotal: event.listedTotal || '?',
                  since: event.since || '?',
                  totalLabel: event.totalLabel,
                })
              : t('log.files', {
                  fileCount: event.fileCount,
                  totalLabel: event.totalLabel,
                })
          );
        }
        setProgress(0, event.fileCount || 1);
        break;
      case 'skip':
        appendLog(
          t('log.skip', {
            index: event.index,
            total: event.total,
            path: event.relativePath,
          })
        );
        if (event.index) setProgress(event.index, event.total);
        break;
      case 'progress':
        if (event.phase === 'start') {
          const verb =
            event.mode === 'sync' ? (event.action === 'replace' ? 'put' : 'new') : 'get';
          appendLog(
            t('log.transfer', {
              index: event.index,
              total: event.total,
              verb,
              path: event.relativePath,
            })
          );
          setStatus(
            t('status.fileProgress', {
              name: event.sessionName || '',
              index: event.index,
              total: event.total,
              path: event.relativePath,
            })
          );
        } else if (event.phase === 'pct') {
          setStatus(
            t('status.fileProgressPct', {
              name: event.sessionName || '',
              index: event.index,
              total: event.total,
              path: event.relativePath,
              pct: event.pct,
            })
          );
        } else if (event.phase === 'done') {
          appendLog(
            t('log.transferDone', {
              index: event.index,
              total: event.total,
              path: event.relativePath,
            })
          );
          setProgress(event.index, event.total);
        }
        break;
      case 'error':
        appendLog(
          t('log.fileFail', {
            path: event.relativePath,
            message: event.message,
          })
        );
        break;
      case 'session_done':
        appendLog(
          event.empty
            ? t('log.sessionEmpty', { name: event.name })
            : t('log.sessionOk', {
                name: event.name,
                downloaded: event.downloaded,
                skipped: event.skipped,
                failed: event.failed,
              })
        );
        if (event.localPath) {
          appendLog(t('log.bound', { path: event.localPath }));
        }
        break;
      case 'cancelled':
        appendLog(t('log.cancelled'));
        setStatus(t('log.cancelled'), 'warn');
        break;
      case 'summary':
        running = false;
        updateStartEnabled();
        {
          let line;
          if (event.mode === 'sync') {
            line = t('log.syncOk', {
              uploaded: event.uploaded,
              skipped: event.skipped,
              failed: event.failed,
              bytes: event.bytesLabel,
            });
          } else if (event.mode === 'fromClient') {
            line = t('log.fromClientOk', {
              downloaded: event.downloaded,
              skipped: event.skipped,
              failed: event.failed,
              bytes: event.bytesLabel,
            });
          } else {
            line = t('log.downloaded', {
              downloaded: event.downloaded,
              skipped: event.skipped,
              failed: event.failed,
              bytes: event.bytesLabel,
            });
          }
          appendLog(line);
          setStatus(line, event.failed ? 'warn' : 'ok');
          setProgress(1, 1);
          if (event.mode === 'fromClient' && !event.failed) {
            notify(t('notify.clientUploadsInFolder'), 'ok');
          }
          if (event.mode === 'sync' && !event.failed && event.folderId) {
            notify(t('notify.syncReadyNext'), event.failed ? 'warn' : 'ok');
            const sess = [...sessionMap.values()].find(
              (x) => x.folderId === event.folderId
            );
            offerShareAfterSync(
              event.folderId,
              sess?.name || event.label || null,
              sess?.token || null
            );
          }
          loadSessions();
        }
        break;
      case 'fatal':
        running = false;
        updateStartEnabled();
        appendLog(t('log.fatal', { message: event.message }));
        setStatus(event.message, 'error');
        break;
      default:
        break;
    }
  }

  const es = apiEvents('/api/pull/events');
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      /* ignore */
    }
  };

  function statusBadgeClass(status) {
    if (status === 'active') return 'token-badge token-badge-active';
    if (status === 'expired') return 'token-badge token-badge-expired';
    return 'token-badge token-badge-revoked';
  }

  async function loadTokens() {
    tokensEl.textContent = t('tokensPanel.loading');
    const countEl = $('tokens-active-count');
    try {
      const res = await apiFetch('/api/tokens');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('tokensPanel.error'));
      const list = data.tokens || [];
      const activeCount = list.filter((tok) => tok.status === 'active').length;
      if (countEl) {
        if (activeCount > 0) {
          countEl.textContent = t('tokensPanel.activeCount', { count: activeCount });
          countEl.classList.remove('hidden');
        } else {
          countEl.classList.add('hidden');
        }
      }
      const kpiTokens = $('kpi-tokens');
      if (kpiTokens) kpiTokens.textContent = String(activeCount);
      if (!list.length) {
        tokensEl.textContent = t('tokensPanel.empty');
        return;
      }
      tokensEl.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'token-table-wrap';
      const table = document.createElement('table');
      table.className = 'token-table';
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const colKey of [
        'colClient',
        'colEmail',
        'colToken',
        'colType',
        'colLocale',
        'colStatus',
        'colExpires',
        'colLink',
      ]) {
        const th = document.createElement('th');
        th.textContent = t(`tokensPanel.${colKey}`);
        headRow.appendChild(th);
      }
      headRow.appendChild(document.createElement('th'));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const tok of list) {
        const tr = document.createElement('tr');
        if (tok.status !== 'active') tr.className = 'inactive';
        const cells = Array.from({ length: 9 }, () => {
          const td = document.createElement('td');
          tr.appendChild(td);
          return td;
        });
        cells[0].textContent = tok.clientName;
        cells[1].textContent = tok.prefillEmail || t('common.emDash');
        const code = document.createElement('code');
        code.className = 'token-code';
        code.textContent = tok.token;
        cells[2].appendChild(code);
        cells[3].textContent =
          tok.type === 'one-time' ? t('tokensPanel.oneTime') : t('tokensPanel.retainer');
        cells[4].textContent = (tok.locale || 'en').toUpperCase();
        const badge = document.createElement('span');
        badge.className = statusBadgeClass(tok.status);
        badge.textContent = tokenStatusLabel(tok.status);
        cells[5].appendChild(badge);
        cells[6].textContent = formatExpires(tok.expiresAt);
        cells[6].className = 'token-cell-date';
        const linkCell = cells[7];
        const actions = cells[8];
        actions.className = 'token-actions';
        linkCell.className = 'token-actions';

        if (tok.status === 'active') {
          const copyBtn = document.createElement('button');
          copyBtn.type = 'button';
          copyBtn.className = 'btn ghost tiny';
          copyBtn.textContent = t('tokensPanel.copyLink');
          copyBtn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(tok.uploadUrl);
              copyBtn.textContent = t('tokensPanel.copied');
              setTimeout(() => {
                copyBtn.textContent = t('tokensPanel.copyLink');
              }, 1500);
            } catch {
              window.prompt(t('tokensPanel.copyPrompt'), tok.uploadUrl);
            }
          });
          linkCell.appendChild(copyBtn);
        }

        if (tok.status === 'active' && !tok.prefillEmail) {
          const setEmail = document.createElement('button');
          setEmail.type = 'button';
          setEmail.className = 'btn ghost tiny';
          setEmail.textContent = t('tokensPanel.setEmail');
          setEmail.addEventListener('click', async () => {
            const email = window.prompt(t('tokensPanel.setEmailPrompt', { token: tok.token }), '');
            if (email == null) return;
            const patchRes = await apiFetch(`/api/tokens/${encodeURIComponent(tok.id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'identity',
                clientName: tok.clientName,
                clientEmail: email.trim(),
              }),
            });
            const patchData = await patchRes.json().catch(() => ({}));
            if (!patchRes.ok) {
              window.alert(patchData.error || t('tokensPanel.setEmailFailed'));
              return;
            }
            loadTokens();
          });
          actions.appendChild(setEmail);
        }

        if (tok.status === 'active') {
          const rev = document.createElement('button');
          rev.type = 'button';
          rev.className = 'btn danger tiny';
          rev.textContent = t('tokensPanel.revoke');
          rev.addEventListener('click', async () => {
            await apiFetch(`/api/tokens/${encodeURIComponent(tok.id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'revoke' }),
            });
            loadTokens();
          });
          actions.appendChild(rev);
        } else if (tok.status === 'revoked') {
          const rest = document.createElement('button');
          rest.type = 'button';
          rest.className = 'btn ok tiny';
          rest.textContent = t('tokensPanel.restore');
          rest.addEventListener('click', async () => {
            await apiFetch(`/api/tokens/${encodeURIComponent(tok.id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'restore' }),
            });
            loadTokens();
          });
          actions.appendChild(rest);
        }

        const loc = document.createElement('button');
        loc.type = 'button';
        loc.className = 'btn ghost tiny';
        loc.textContent = tok.locale === 'pl' ? t('tokensPanel.toEn') : t('tokensPanel.toPl');
        loc.addEventListener('click', async () => {
          await apiFetch(`/api/tokens/${encodeURIComponent(tok.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'locale',
              locale: tok.locale === 'pl' ? 'en' : 'pl',
            }),
          });
          loadTokens();
        });
        actions.appendChild(loc);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn danger tiny';
        del.textContent = t('tokensPanel.delete');
        del.addEventListener('click', async () => {
          if (!window.confirm(t('tokensPanel.deleteConfirm', { token: tok.token }))) return;
          const delRes = await apiFetch(`/api/tokens/${encodeURIComponent(tok.id)}`, {
            method: 'DELETE',
          });
          const delData = await delRes.json().catch(() => ({}));
          if (!delRes.ok) {
            window.alert(delData.error || t('tokensPanel.deleteFailed'));
            return;
          }
          loadTokens();
        });
        actions.appendChild(del);

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      tokensEl.appendChild(wrap);
    } catch (err) {
      tokensEl.textContent = err.message || String(err);
    }
  }

  tokenForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    tokenFormError.classList.add('hidden');
    const fd = new FormData(tokenForm);
    const body = Object.fromEntries(fd.entries());
    try {
      const res = await apiFetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('tokensPanel.createFailed'));
      if (data.token?.uploadUrl) {
        try {
          await navigator.clipboard.writeText(data.token.uploadUrl);
        } catch {
          /* ignore */
        }
      }
      tokenForm.reset();
      loadTokens();
    } catch (err) {
      tokenFormError.textContent = err.message || String(err);
      tokenFormError.classList.remove('hidden');
    }
  });

  btnRefresh.addEventListener('click', loadSessions);
  btnPreview.addEventListener('click', loadPreview);
  if (destPath) destEl.value = destPath;

  btnPick.addEventListener('click', pickDest);
  btnStart.addEventListener('click', startPull);
  btnCancel.addEventListener('click', cancelPull);
  destEl.addEventListener('input', onDestTyped);
  destEl.addEventListener('change', onDestCommitted);
  $('btn-tokens-refresh').addEventListener('click', loadTokens);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.session-menu')) {
      document.querySelectorAll('.session-menu-pop.open').forEach((el) => {
        el.classList.remove('open');
      });
    }
  });

  await window.StudioI18n.init();

  document.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-lang');
      if (next) window.StudioI18n.setLocale(next);
    });
  });

  window.addEventListener('studio-locale', () => {
    loadSessions();
    loadTokens();
    updateStartEnabled();
  });

  updateStartEnabled();
  loadSessions();
  loadTokens();
})();