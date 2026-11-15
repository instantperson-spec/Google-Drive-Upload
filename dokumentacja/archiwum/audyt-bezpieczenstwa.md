# Audyt bezpieczeństwa, wycieków, logiki i architektury — Drive Uploader & Studio Pull

> **Zakres analizy:** aplikacja webowa Next.js (`src/`) oraz lokalny moduł studyjny `studio-pull/` (serwer HTTP, CLI oraz aplikacja desktopowa Tauri).  
> **Data audytu:** 2026-11-15  
> **Remedacja P0/P1 (+ część P2):** 2026-11-15 — wdrożone na produkcji (`drive-uploader-three.vercel.app`).  
> **Plan:** [`plany/security_audit_remediation.plan.md`](./plany/security_audit_remediation.plan.md) · żywy skrót: [`../bezpieczenstwo.md`](../bezpieczenstwo.md)  
> **Archiwum** — nie traktuj jako jedynego stanu produkcji.
> **Charakter:** pierwotnie analiza statyczna; poniżej status po wdrożeniu napraw.

---

## Status remedacji (skrót)

| # | Znalezisko | Priorytet | Stan |
|---|---|---|---|
| 1.1 | Console CSRF / brak Origin·Host·token | P0 | ✅ naprawione |
| 1.2 | Tauri ufa obcemu `:8787` | P0 | ✅ fingerprint `/api/health` |
| 1.3 | IDOR token ↔ folderId | P0 | ✅ `_uploader_session.json` (fail-closed) |
| 1.4 | Statyczny admin cookie | P1 | ✅ losowy id + TTL + revoke |
| 1.5 | Rate limit / spoof XFF | P1 | ✅ `x-vercel-forwarded-for` |
| 1.6 | notify email / folderId | P1 | ✅ escape + ownership |
| 1.7 | Share upload bez kwot | P1 | ✅ limity dzień/share (env) |
| 2.1 | ZIP OOM w SharePage | P1 | ✅ domyślnie plik-po-pliku; ZIP tylko małe |
| 2.2 | Wyciek `token` z GET share | P0 | ✅ usunięte z odpowiedzi |
| 2.3 | Cache fail-open / bez limitu | P2 | ✅ `isSessionFolder` fail-closed + cap; `folderCache` TTL 10 min |
| 2.4 | Abort na stream share file | P2 | ✅ `request.signal` → destroy stream |
| 2.5 | `.tmp*` w repo / gitignore | P2 | ✅ gitignore + usunięte ze śledzenia |
| 3.1 | Crash log martwy kod | P0 | ✅ refs przed `null` |
| 3.2 | WAV tylko po `size` | P0 | ✅ md5 / mtime w sync + share |
| 3.3–3.4 | Race JSON progress/token | P2 | ✅ token If-Match; progress Drive + ETag (bez Redis/KV) |
| 3.5–3.6 | Ambiguous match / parse myślników | P3 | ⏳ otwarte |
| 4.* | God objects / duplikacja Drive | P3 | ⏳ otwarte (świadomie po P0/P1) |

Magic-bytes MIME i OTP klienta — **poza zakresem** (jak w planie).

---

## Podsumowanie wykonawcze (stan po remedacji)

**Zamknięte jako krytyczne:** wyciek upload tokenu z Portalu, IDOR token↔folder, CSRF/DNS-rebinding Console + fingerprint Tauri, detekcja WAV (md5/mtime), crash log, ZIP OOM (domyślnie File System Access), XFF rate-limit, admin session TTL, notify harden, share quota.

**Nadal aktualne (P3):** monolity `ui-server` / `app.js` / `globals.css`, duplikacja warstwy Drive `src` vs `studio-pull`.

**Świadome skutki uboczne P0:** foldery sesji utworzone przed `_uploader_session.json` wymagają nowej sesji uploadu; admin wymaga ponownego logowania (nowy format cookie).

---

## 1. Bezpieczeństwo i luki w kodzie

### 1.1 Studio Console — CSRF / Origin / Host — ✅ naprawione

**Było:** `ui-server.mjs` na `127.0.0.1:8787` bez tokena i bez `Origin`/`Host`.

**Jest:** lokalny token w `~/Library/Application Support/StudioConsole/console_auth.txt`, wymagany nagłówek `X-Studio-Console-Token` (SSE: `?consoleToken=`), allowlista Host/Origin, `/api/health` z fingerprintem (bez pełnego auth). Moduł: `studio-pull/lib/consoleAuth.mjs`.

### 1.2 Tauri — obcy proces na `:8787` — ✅ naprawione

**Było:** `port_open()` → reuse bez weryfikacji.

**Jest:** reuse tylko gdy `GET /api/health` zwraca `app: studio-console` i `fp` zgodny z `console_auth.fp`; w przeciwnym razie błąd zamiast ładowania UI.

### 1.3 IDOR token ↔ folderId — ✅ naprawione

**Było:** dowolny aktywny token + `isSessionFolder(folderId)`.

**Jest:** przy `create-folder` zapis `_uploader_session.json` (fingerprint SHA-256 tokena); `upload-session`, `check-folder`, `build-structure`, `upload-progress`, `upload-log`, `notify` wywołują `assertFolderOwnedByToken` (`src/lib/sessionOwnership.js`). Brak pliku / mismatch → 403 (fail-closed).

### 1.4 Admin session — ✅ naprawione

**Było:** stały HMAC(`admin-session-v1`); logout nie unieważniał.

**Jest:** `sessionId.exp.sig` (losowy id + TTL 24h + HMAC); `revokeAdminSessionToken` przy logout (best-effort per warm instance). Rotate `ADMIN_SECRET` nadal unieważnia wszystko.

### 1.5 Rate limit / XFF — ✅ naprawione

**Było:** pierwszy adres z surowego `X-Forwarded-For`.

**Jest:** preferencja `x-vercel-forwarded-for`, potem `x-real-ip`; surowy XFF tylko poza production (dev).

### 1.6 notify — ✅ naprawione (częściowo polityka retainer)

**Było:** `uploaderEmail` bez escape w HTML; brak `isSessionFolder`.

**Jest:** escape email w HTML; link do folderu tylko po `isSessionFolder` + ownership. Retainer bez `prefillEmail` nadal może dostać summary na podany email (świadoma polityka B2B — bez OTP).

### 1.7 Share upload quota — ✅ naprawione (bez magic-bytes)

**Było:** brak limitów liczby/bajtów na share.

**Jest:** `shareQuota.js` — domyślnie 200 plików / 5 GB na share / dzień (`SHARE_UPLOAD_MAX_FILES_PER_DAY`, `SHARE_UPLOAD_MAX_BYTES_PER_DAY`). Walidacja nadal po rozszerzeniu (magic-bytes poza zakresem).

---

## 2. Wycieki pamięci, zasobów i danych

### 2.1 ZIP OOM — ✅ naprawione (domyślna ścieżka)

**Było:** zawsze `JSZip` w RAM.

**Jest:** domyślnie `showDirectoryPicker` + zapis plik-po-pliku; ZIP tylko gdy brak File System Access **i** paczka ≤ 40 plików / ≤ 500 MB; inaczej komunikat o Chrome/Edge.

### 2.2 Wyciek tokenu z GET share — ✅ naprawione

**Było:** `share.token` w JSON Portalu.

**Jest:** odpowiedź bez `token` (id, label, createdAt + pliki/statusy).

### 2.3 Cache — ✅

- `sessionFolderCache`: fail-closed przy błędzie Drive; cap ~500 wpisów.  
- `folderCache` w `studio-pull/lib/upload.mjs`: TTL 10 min + max 500.  
- `hits` rate-limit: XFF-spoof w production ograniczony (1.5).

### 2.4 Abort na stream share file — ✅

`request.signal` niszczy strumień Drive przy anulowaniu klienta.

### 2.5 Pliki `.tmp*` — ✅ naprawione

`.gitignore` ma `.tmp*` / `.tmp-*`; pliki usunięte ze śledzenia Gita.

---

## 3. Logika, wyścigi i martwy kod

### 3.1 Crash log — ✅ naprawione

`useUploadRunner` zachowuje `sessionId`/`folderId` w lokalnych zmiennych przed `ref = null`, potem woła `/api/upload-log`.

### 3.2 WAV / same-size — ✅ naprawione (sync + share status)

- `planSync`: przy tym samym size → md5 lokalny vs `md5Checksum` Drive, inaczej mtime vs `modifiedTime`.  
- `shareStore` / `manifestOps`: size + md5 + `modifiedTime` vs `baselineAt`.  
- **Uwaga:** `deltaMatch.js` (wznawianie uploadu klienta) nadal toleruje size — to ścieżka resume, nie sync studia.

### 3.3–3.4 Race / progress serverless — ✅ (Drive + ETag)

- Tokeny: `If-Match` + jednorazowy retry (`tokenStore.js`, `tokenOps.mjs`).  
- Progress: wyłącznie `_uploader_progress.json` na Drive z ETag (Redis/KV usunięte — bez płatnego Marketplace).

### 3.5–3.6 Ambiguous match / parse myślników — ⏳ otwarte (niski priorytet)

Bez zmian w tej remedacji.

---

## 4. Architektura — ⏳ otwarte (P3)

God objects (`ui-server.mjs`, `app.js`, `globals.css`, ciężkie hooki/strony) oraz duplikacja `src/lib` vs `studio-pull/lib` pozostają. Nie mieszane z P0 ze względu na ryzyko regresji sync/share.

Drive jako magazyn tokenów/share/progress z ETag — bez zewnętrznego Redis.

---

## 5. Kolejność działań — aktualizacja

1. ~~Natychmiastowe (P0)~~ — **wykonane** (share token, ownership, Console/Tauri, WAV, crash log).  
2. ~~Średnioterminowe kluczowe (P1)~~ — **wykonane** (ZIP→plik-po-pliku, admin session, XFF, notify, share quota).  
3. **Pozostałe:**
   - P3: wspólny moduł Drive; rozbicie monolitów UI/CSS; ambiguous match / parse myślników.  
   - Poza zakresem: magic-bytes MIME; OTP klienta (VULN-08 accepted).

---

## Historia

| Data | Zdarzenie |
|---|---|
| 2026-11-15 | Audyt statyczny (ten dokument, sekcje 1–4 jako znaleziska). |
| 2026-11-15 | Remedacja P0/P1 + gitignore/cache fail-closed; deploy production; aktualizacja statusów w tym pliku. |
| 2026-11-15 | Binding+OOS (Console) + token If-Match + abort/TTL; progress Drive+ETag. |
| 2026-11-15 | Usunięcie Redis/KV (deps, kod, docs, lokalne env) — bez płatnego Marketplace. |
