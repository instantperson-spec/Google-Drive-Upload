(() => {
  const sessionsEl = document.getElementById('sessions');
  const destEl = document.getElementById('dest');
  const destErrorEl = document.getElementById('dest-error');
  const statusEl = document.getElementById('status');
  const barEl = document.getElementById('bar');
  const logEl = document.getElementById('log');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnPick = document.getElementById('btn-pick');
  const btnStart = document.getElementById('btn-start');
  const btnCancel = document.getElementById('btn-cancel');

  let selectedFolderId = null;
  let destPath = '';
  let running = false;
  let totalFiles = 0;

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ` ${cls}` : '');
  }

  function appendLog(line) {
    logEl.textContent += `${line}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function updateStartEnabled() {
    btnStart.disabled = running || !selectedFolderId || !destPath;
    btnCancel.disabled = !running;
    btnPick.disabled = running;
    btnRefresh.disabled = running;
  }

  function setProgress(index, total) {
    if (!total) {
      barEl.style.width = '0%';
      return;
    }
    const pct = Math.min(100, Math.round((index / total) * 100));
    barEl.style.width = `${pct}%`;
  }

  async function loadSessions() {
    sessionsEl.textContent = 'Ładowanie…';
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Nie udało się pobrać sesji');
      const list = data.sessions || [];
      if (!list.length) {
        sessionsEl.textContent = 'Brak folderów sesji.';
        return;
      }
      sessionsEl.innerHTML = '';
      for (const s of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'session' + (s.folderId === selectedFolderId ? ' selected' : '');
        const when = s.modifiedTime
          ? new Date(s.modifiedTime).toLocaleString()
          : '—';
        btn.innerHTML =
          `<div class="session-name"></div><div class="session-meta"></div>`;
        btn.querySelector('.session-name').textContent = s.name;
        btn.querySelector('.session-meta').textContent = `${s.folderId} · ${when}`;
        btn.addEventListener('click', () => {
          selectedFolderId = s.folderId;
          sessionsEl.querySelectorAll('.session').forEach((el) => el.classList.remove('selected'));
          btn.classList.add('selected');
          updateStartEnabled();
        });
        sessionsEl.appendChild(btn);
      }
    } catch (err) {
      sessionsEl.textContent = err.message || String(err);
    }
  }

  async function pickDest() {
    destErrorEl.classList.add('hidden');
    destErrorEl.textContent = '';
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
      destPath = data.path;
      destEl.value = destPath;
      setStatus(`Cel: ${destPath}`);
      updateStartEnabled();
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    }
  }

  async function startPull() {
    if (!selectedFolderId || !destPath || running) return;
    running = true;
    updateStartEnabled();
    logEl.textContent = '';
    setProgress(0, 1);
    setStatus('Start…');
    try {
      const res = await fetch('/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: selectedFolderId, dest: destPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Nie udało się uruchomić');
      }
      setStatus(`Pobieranie → ${data.dest}`);
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
      case 'connected':
        break;
      case 'listing':
        appendLog(`Listing ${event.folderId}`);
        setStatus('Listowanie plików na Drive…');
        break;
      case 'listing_done':
        totalFiles = event.fileCount || 0;
        appendLog(`Plików: ${event.fileCount}, ${event.totalLabel}`);
        setStatus(`Do pobrania: ${event.fileCount} plików (${event.totalLabel})`);
        setProgress(0, totalFiles || 1);
        break;
      case 'skip':
        appendLog(`[${event.index}/${event.total}] skip ${event.relativePath}`);
        setProgress(event.index, event.total);
        break;
      case 'progress':
        if (event.phase === 'start') {
          appendLog(`[${event.index}/${event.total}] get ${event.relativePath}`);
          setStatus(`[${event.index}/${event.total}] ${event.relativePath}`);
        } else if (event.phase === 'pct') {
          setStatus(`[${event.index}/${event.total}] ${event.relativePath} — ${event.pct}%`);
        } else if (event.phase === 'done') {
          appendLog(`[${event.index}/${event.total}] done ${event.relativePath}`);
          setProgress(event.index, event.total);
        }
        break;
      case 'error':
        appendLog(`[${event.index}/${event.total}] FAIL ${event.relativePath}: ${event.message}`);
        break;
      case 'cancelled':
        appendLog('Anulowano.');
        setStatus('Anulowano.', 'warn');
        break;
      case 'summary': {
        running = false;
        updateStartEnabled();
        const line = `Gotowe — downloaded ${event.downloaded}, skipped ${event.skipped}, failed ${event.failed}, ${event.bytesLabel}`;
        appendLog(line);
        setStatus(line, event.failed ? 'warn' : 'ok');
        setProgress(totalFiles || 1, totalFiles || 1);
        break;
      }
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
  es.onerror = () => {
    /* browser reconnects */
  };

  btnRefresh.addEventListener('click', loadSessions);
  btnPick.addEventListener('click', pickDest);
  btnStart.addEventListener('click', startPull);
  btnCancel.addEventListener('click', cancelPull);

  updateStartEnabled();
  loadSessions();
})();
