(() => {
  const $ = (id) => document.getElementById(id);

  const sessionsEl = $('sessions');
  const previewEl = $('preview');
  const previewMeta = $('preview-meta');
  const destEl = $('dest');
  const destErrorEl = $('dest-error');
  const statusEl = $('status');
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

  /** @type {Map<string, {folderId:string,name:string,modifiedTime:?string}>} */
  const sessionMap = new Map();
  /** @type {Set<string>} */
  const selected = new Set();
  let previewFolderId = null;
  let destPath = '';
  let running = false;
  let currentFileIndex = 0;
  let currentFileTotal = 1;

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ` ${cls}` : '');
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
    btnPreview.disabled = running || !previewFolderId;

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
        previewFolderId = null;
        updateStartEnabled();
        return;
      }

      sessionsEl.innerHTML = '';
      for (const s of list) {
        sessionMap.set(s.folderId, s);
        const row = document.createElement('div');
        row.className = 'session-row';
        row.innerHTML = `
          <label class="session-check">
            <input type="checkbox" data-id="${s.folderId}" />
            <span class="session-body">
              <span class="session-name"></span>
              <span class="session-meta"></span>
            </span>
          </label>
          <label class="session-preview-pick" title="Podgląd tej sesji">
            <input type="radio" name="preview-session" value="${s.folderId}" />
            Podgląd
          </label>`;
        row.querySelector('.session-name').textContent = s.name;
        const when = s.modifiedTime ? new Date(s.modifiedTime).toLocaleString() : '—';
        row.querySelector('.session-meta').textContent = `${s.folderId} · ${when}`;

        const cb = row.querySelector('input[type=checkbox]');
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(s.folderId);
          else selected.delete(s.folderId);
          updateStartEnabled();
        });

        const radio = row.querySelector('input[type=radio]');
        radio.addEventListener('change', () => {
          previewFolderId = s.folderId;
          updateStartEnabled();
        });

        sessionsEl.appendChild(row);
      }

      // Default: first session checked + preview focus
      const first = list[0];
      const firstCb = sessionsEl.querySelector(`input[type=checkbox][data-id="${first.folderId}"]`);
      const firstRadio = sessionsEl.querySelector(`input[type=radio][value="${first.folderId}"]`);
      if (firstCb) {
        firstCb.checked = true;
        selected.add(first.folderId);
      }
      if (firstRadio) {
        firstRadio.checked = true;
        previewFolderId = first.folderId;
      }
      updateStartEnabled();
    } catch (err) {
      sessionsEl.textContent = err.message || String(err);
    }
  }

  async function loadPreview() {
    if (!previewFolderId) return;
    previewMeta.textContent = 'Ładowanie listy plików…';
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(previewFolderId)}/files`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd podglądu');
      previewMeta.textContent = `${data.fileCount} plików · ${data.totalLabel}`;
      const ul = document.createElement('ul');
      ul.className = 'preview-list';
      for (const f of data.files.slice(0, 500)) {
        const li = document.createElement('li');
        li.innerHTML = `<span class="p-path"></span><span class="p-size"></span>`;
        li.querySelector('.p-path').textContent = f.relativePath;
        li.querySelector('.p-size').textContent = f.sizeLabel;
        ul.appendChild(li);
      }
      if (data.files.length > 500) {
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

  async function startPull() {
    if (!selected.size || !destPath || running) return;
    const sessions = [...selected].map((id) => {
      const s = sessionMap.get(id);
      return { folderId: id, name: s?.name || id };
    });

    running = true;
    updateStartEnabled();
    logEl.textContent = '';
    setProgress(0, 1);
    setStatus(`Start kolejki (${sessions.length} sesji)…`);

    try {
      const res = await fetch('/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dest: destPath, sessions }),
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
        appendLog(`Plików: ${event.fileCount}, ${event.totalLabel}`);
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

  async function loadTokens() {
    tokensEl.textContent = 'Ładowanie…';
    try {
      const res = await fetch('/api/tokens');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd tokenów');
      const list = data.tokens || [];
      if (!list.length) {
        tokensEl.textContent = 'Brak tokenów.';
        return;
      }
      tokensEl.innerHTML = '';
      const table = document.createElement('table');
      table.className = 'token-table';
      table.innerHTML =
        '<thead><tr><th>Klient</th><th>Token</th><th>Locale</th><th>Status</th><th></th></tr></thead>';
      const tbody = document.createElement('tbody');
      for (const t of list) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td></td><td><code></code></td><td></td><td></td>
          <td class="token-actions"></td>`;
        tr.cells[0].textContent = t.clientName;
        tr.cells[1].querySelector('code').textContent = t.token;
        tr.cells[2].textContent = (t.locale || 'en').toUpperCase();
        tr.cells[3].textContent = t.status;
        const actions = tr.cells[4];

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn secondary tiny';
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
        actions.appendChild(copyBtn);

        if (t.status === 'active') {
          const rev = document.createElement('button');
          rev.type = 'button';
          rev.className = 'btn secondary tiny';
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
          rest.className = 'btn secondary tiny';
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
        loc.className = 'btn secondary tiny';
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

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      tokensEl.appendChild(table);
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
