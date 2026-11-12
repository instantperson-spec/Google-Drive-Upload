(() => {
  const $ = (id) => document.getElementById(id);

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
      statusTitleEl.textContent = 'Syncing…';
      statusSubEl.textContent = text || '';
      return;
    }
    if (cls === 'ok' || cls === 'warn' || cls === 'error') {
      statusTitleEl.textContent = text || (cls === 'ok' ? 'Gotowe' : 'Uwaga');
      statusSubEl.textContent =
        cls === 'ok' ? 'Pull zakończony.' : cls === 'error' ? 'Coś poszło nie tak.' : 'Sprawdź log.';
      return;
    }
    statusTitleEl.textContent = 'Gotowy';
    statusSubEl.textContent = text || 'Zaznacz sesje i folder bazowy.';
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
      if (!selected.size && !destPath) setStatus('Zaznacz sesje i wybierz folder bazowy.');
      else if (!selected.size) setStatus('Zaznacz co najmniej jedną sesję.');
      else if (!destPath) setStatus('Wybierz folder bazowy na dysku zewnętrznym.');
    }
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    $('panel-pull').classList.toggle('hidden', name !== 'pull');
    $('panel-tokens').classList.toggle('hidden', name !== 'tokens');
    if (name === 'tokens') loadTokens();
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  async function loadSessions() {
    sessionsEl.textContent = 'Ładowanie…';
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd listy sesji');
      const list = data.sessions || [];
      sessionMap.clear();
      selected.clear();
      if (!list.length) {
        sessionsEl.textContent = 'Brak folderów sesji.';
        previewSessionId = null;
        updateStartEnabled();
        return;
      }

      sessionsEl.innerHTML = '';
      for (const s of list) {
        const sid = s.id || s.folderId;
        sessionMap.set(sid, s);
        const row = document.createElement('div');
        row.className = 'session-row';
        row.innerHTML = `
          <label class="session-check">
            <input type="checkbox" data-id="" />
            <span class="session-body">
              <span class="session-name"></span>
              <span class="session-meta"></span>
            </span>
          </label>
          <label class="session-preview-pick" title="Podgląd tej sesji">
            <input type="radio" name="preview-session" value="" />
            Podgląd
          </label>`;
        row.querySelector('input[type=checkbox]').dataset.id = sid;
        row.querySelector('input[type=radio]').value = sid;
        row.querySelector('.session-name').textContent = s.name;
        const bits = [];
        if (s.batch && s.fileCount != null) {
          bits.push(`${s.fileCount} plików · ${s.totalLabel || ''}`);
        }
        if (s.since && s.until) {
          bits.push(`dzień ${String(s.since).slice(0, 10)}`);
        } else {
          const whenRaw = s.lastActivity || s.modifiedTime || s.createdTime;
          bits.push(whenRaw ? `aktywność ${new Date(whenRaw).toLocaleString()}` : '—');
        }
        if (s.token) bits.push(`token:${s.token}`);
        row.querySelector('.session-meta').textContent = bits.join(' · ');

        const cb = row.querySelector('input[type=checkbox]');
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(sid);
          else selected.delete(sid);
          updateStartEnabled();
        });

        const radio = row.querySelector('input[type=radio]');
        radio.addEventListener('change', () => {
          previewSessionId = sid;
          updateStartEnabled();
        });

        sessionsEl.appendChild(row);
      }

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
    previewMeta.textContent = 'Ładowanie listy plików…';
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';
    try {
      const q = new URLSearchParams();
      if (session.since) q.set('since', session.since);
      if (session.until) q.set('until', session.until);
      const qs = q.toString() ? `?${q}` : '';
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(session.folderId)}/files${qs}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd podglądu');
      previewMeta.textContent = `${data.fileCount} plików · ${data.totalLabel}`;
      const ul = document.createElement('ul');
      ul.className = 'preview-list';
      for (const f of (data.files || []).slice(0, 500)) {
        const li = document.createElement('li');
        li.innerHTML = `<span class="p-path"></span><span class="p-size"></span>`;
        li.querySelector('.p-path').textContent = f.relativePath;
        li.querySelector('.p-size').textContent = f.sizeLabel;
        ul.appendChild(li);
      }
      if ((data.files || []).length > 500) {
        const more = document.createElement('li');
        more.className = 'muted';
        more.textContent = `… i ${data.files.length - 500} więcej`;
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
    setStatus('Otwieranie dialogu folderu…');
    try {
      const res = await fetch('/api/pick-dest', { method: 'POST' });
      const data = await res.json();
      if (data.cancelled) {
        setStatus('Anulowano wybór folderu.');
        return;
      }
      if (!res.ok) {
        destErrorEl.textContent = data.error || 'Nieprawidłowy folder';
        destErrorEl.classList.remove('hidden');
        setStatus('Folder odrzucony (safety).', 'error');
        return;
      }
      destPath = String(data.path || '').trim();
      destEl.value = destPath;
      setStatus(`Baza: ${destPath}`);
      updateStartEnabled();
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    }
  }

  function onDestTyped() {
    destPath = destEl.value.trim();
    destErrorEl.classList.add('hidden');
    updateStartEnabled();
    if (destPath) setStatus(`Baza: ${destPath}`);
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

    // Global "fresh only" only for rows without their own day window (stamped folders).
    let since = null;
    const needsGlobalFresh = sessions.some((s) => !s.since);
    if (needsGlobalFresh && freshOnlyEl?.checked) {
      const local = freshSinceEl?.value;
      if (!local) {
        setStatus('Ustaw datę „Od” albo wyłącz filtr świeżych plików.', 'warn');
        return;
      }
      since = new Date(local).toISOString();
    }

    running = true;
    updateStartEnabled();
    logEl.textContent = '';
    setProgress(0, 1);
    setStatus(`Start kolejki (${sessions.length})…`);

    try {
      const res = await fetch('/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dest: destPath, sessions, since }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Nie udało się uruchomić');
      setStatus(`Kolejka → ${data.dest}`);
    } catch (err) {
      running = false;
      updateStartEnabled();
      setStatus(err.message || String(err), 'error');
    }
  }

  async function cancelPull() {
    await fetch('/api/pull/cancel', { method: 'POST' });
    setStatus('Anulowanie…', 'warn');
  }

  function onEvent(event) {
    switch (event.type) {
      case 'queue_start':
        appendLog(`Kolejka: ${event.sessionCount} sesji → ${event.dest}`);
        if (event.since) appendLog(`Filtr świeżych: createdTime ≥ ${event.since}`);
        break;
      case 'session_start':
        appendLog(`── Sesja ${event.index}/${event.total}: ${event.name}`);
        appendLog(`   → ${event.dest}`);
        setStatus(`Sesja ${event.index}/${event.total}: ${event.name}`);
        break;
      case 'listing':
        appendLog(`Listing ${event.folderId}`);
        break;
      case 'listing_done':
        appendLog(
          event.filtered
            ? `Plików po filtrze: ${event.fileCount}/${event.listedTotal || '?'} (od ${event.since || '?'}), ${event.totalLabel}`
            : `Plików: ${event.fileCount}, ${event.totalLabel}`
        );
        setProgress(0, event.fileCount || 1);
        break;
      case 'skip':
        appendLog(`[${event.index}/${event.total}] skip ${event.relativePath}`);
        setProgress(event.index, event.total);
        break;
      case 'progress':
        if (event.phase === 'start') {
          appendLog(`[${event.index}/${event.total}] get ${event.relativePath}`);
          setStatus(
            `${event.sessionName || ''} [${event.index}/${event.total}] ${event.relativePath}`
          );
        } else if (event.phase === 'pct') {
          setStatus(
            `${event.sessionName || ''} [${event.index}/${event.total}] ${event.relativePath} — ${event.pct}%`
          );
        } else if (event.phase === 'done') {
          appendLog(`[${event.index}/${event.total}] done ${event.relativePath}`);
          setProgress(event.index, event.total);
        }
        break;
      case 'error':
        appendLog(`FAIL ${event.relativePath}: ${event.message}`);
        break;
      case 'session_done':
        appendLog(
          event.empty
            ? `Sesja pusta: ${event.name}`
            : `Sesja OK: ${event.name} (dl ${event.downloaded}, skip ${event.skipped}, fail ${event.failed})`
        );
        break;
      case 'cancelled':
        appendLog('Anulowano.');
        setStatus('Anulowano.', 'warn');
        break;
      case 'summary':
        running = false;
        updateStartEnabled();
        {
          const line = `Gotowe — dl ${event.downloaded}, skip ${event.skipped}, fail ${event.failed}, ${event.bytesLabel}`;
          appendLog(line);
          setStatus(line, event.failed ? 'warn' : 'ok');
          setProgress(1, 1);
        }
        break;
      case 'fatal':
        running = false;
        updateStartEnabled();
        appendLog(`FATAL: ${event.message}`);
        setStatus(event.message, 'error');
        break;
      default:
        break;
    }
  }

  const es = new EventSource('/api/pull/events');
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      /* ignore */
    }
  };

  function formatExpires(iso) {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(new Date(iso));
    } catch {
      return String(iso);
    }
  }

  function statusBadgeClass(status) {
    if (status === 'active') return 'token-badge token-badge-active';
    if (status === 'expired') return 'token-badge token-badge-expired';
    return 'token-badge token-badge-revoked';
  }

  async function loadTokens() {
    tokensEl.textContent = 'Ładowanie…';
    const countEl = $('tokens-active-count');
    try {
      const res = await fetch('/api/tokens');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd tokenów');
      const list = data.tokens || [];
      const activeCount = list.filter((t) => t.status === 'active').length;
      if (activeCount > 0) {
        countEl.textContent = `${activeCount} active`;
        countEl.classList.remove('hidden');
      } else {
        countEl.classList.add('hidden');
      }
      if (!list.length) {
        tokensEl.textContent = 'No tokens yet.';
        return;
      }
      tokensEl.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'token-table-wrap';
      const table = document.createElement('table');
      table.className = 'token-table';
      table.innerHTML =
        '<thead><tr><th>Client</th><th>Token</th><th>Type</th><th>Locale</th><th>Status</th><th>Expires</th><th>Link</th><th></th></tr></thead>';
      const tbody = document.createElement('tbody');
      for (const t of list) {
        const tr = document.createElement('tr');
        if (t.status !== 'active') tr.className = 'inactive';
        tr.innerHTML = `
          <td></td><td><code class="token-code"></code></td><td></td><td></td>
          <td><span class="${statusBadgeClass(t.status)}"></span></td>
          <td class="token-cell-date"></td>
          <td class="token-actions"></td>
          <td class="token-actions"></td>`;
        tr.cells[0].textContent = t.clientName;
        tr.cells[1].querySelector('code').textContent = t.token;
        tr.cells[2].textContent = t.type === 'one-time' ? 'One-time' : 'Retainer';
        tr.cells[3].textContent = (t.locale || 'en').toUpperCase();
        tr.cells[4].querySelector('span').textContent = t.status;
        tr.cells[5].textContent = formatExpires(t.expiresAt);
        const linkCell = tr.cells[6];
        const actions = tr.cells[7];

        if (t.status === 'active') {
          const copyBtn = document.createElement('button');
          copyBtn.type = 'button';
          copyBtn.className = 'btn ghost tiny';
          copyBtn.textContent = 'Copy link';
          copyBtn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(t.uploadUrl);
              copyBtn.textContent = 'Copied';
              setTimeout(() => {
                copyBtn.textContent = 'Copy link';
              }, 1500);
            } catch {
              window.prompt('Copy:', t.uploadUrl);
            }
          });
          linkCell.appendChild(copyBtn);
        }

        if (t.status === 'active') {
          const rev = document.createElement('button');
          rev.type = 'button';
          rev.className = 'btn danger tiny';
          rev.textContent = 'Revoke';
          rev.addEventListener('click', async () => {
            await fetch(`/api/tokens/${encodeURIComponent(t.id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'revoke' }),
            });
            loadTokens();
          });
          actions.appendChild(rev);
        } else if (t.status === 'revoked') {
          const rest = document.createElement('button');
          rest.type = 'button';
          rest.className = 'btn ok tiny';
          rest.textContent = 'Restore';
          rest.addEventListener('click', async () => {
            await fetch(`/api/tokens/${encodeURIComponent(t.id)}`, {
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
        loc.textContent = t.locale === 'pl' ? '→ EN' : '→ PL';
        loc.addEventListener('click', async () => {
          await fetch(`/api/tokens/${encodeURIComponent(t.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'locale',
              locale: t.locale === 'pl' ? 'en' : 'pl',
            }),
          });
          loadTokens();
        });
        actions.appendChild(loc);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn danger tiny';
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
          if (!window.confirm(`Na pewno usunąć token „${t.token}”?`)) return;
          const delRes = await fetch(`/api/tokens/${encodeURIComponent(t.id)}`, {
            method: 'DELETE',
          });
          const delData = await delRes.json().catch(() => ({}));
          if (!delRes.ok) {
            window.alert(delData.error || 'Delete failed');
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
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
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
  btnPick.addEventListener('click', pickDest);
  btnStart.addEventListener('click', startPull);
  btnCancel.addEventListener('click', cancelPull);
  destEl.addEventListener('input', onDestTyped);
  destEl.addEventListener('change', onDestTyped);
  $('btn-tokens-refresh').addEventListener('click', loadTokens);

  updateStartEnabled();
  loadSessions();
})();
