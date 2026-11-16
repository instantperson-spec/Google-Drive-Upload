# Analiza przeglądowa — bezpieczeństwo, martwy kod, plany

> Data: 2026-11-16 · Zakres: `src/`, `studio-pull/`, `scripts/`, `dokumentacja/`, `mockups/`, root  
> Charakter: przegląd statyczny kodu + dokumentów (bez pentestu dynamicznego)  
> Kontekst: po remedacji audytu 2026-11-15 (`bezpieczenstwo.md`, archiwum audytów)

---

## Werdykt

Projekt jest **w dobrym stanie bezpieczeństwa względem ostatnich P0/P1**. Nie znaleziono otwartego IDOR token↔folder, wycieku upload tokenu z share ani Console bez Host/Origin/token.  
Główne problemy dziś to: **zaległości produktowe (P1–P3 roadmap)**, **śmieci dokumentacyjne / env**, **martwe assety i zależność `pdf-parse`**, oraz kilka **średnich** luk polityki (tożsamość uploadu tylko w UI, retainer bez `prefillEmail` w notify).

---

## 1. Bezpieczeństwo

### Co jest dobrze utwardzone

| Obszar | Evidencja |
|---|---|
| Auth upload API | `verifyUploadToken` + `x-upload-token` na create/upload/check/build/progress/log/notify/revoke |
| Ownership folderu | `_uploader_session.json` + `assertFolderOwnedByToken` (fail-closed) |
| Share bez upload tokenu | `GET /api/share/[id]` zwraca tylko id/label/createdAt + pliki |
| Admin | HttpOnly cookie `sessionId.exp.sig`, TTL 24h, timing-safe, logout revoke (per instance) |
| Rate limit | Preferencja `x-vercel-forwarded-for` / `x-real-ip` |
| SMTP | `secure: smtpPort === 465`; escape HTML w notify |
| OAuth | ścieżka OAuth2 `drive.file`; skrypt `check-oauth-scopes` |
| Studio Console | Host/Origin allowlista + lokalny token; Tauri fingerprint |
| Share download | `assertFileInShareFolder` + abort stream |
| ZIP | domyślnie plik-po-pliku; ZIP ≤40 plików / ≤500 MB |
| noindex | `robots: { index: false }` w layout |

### Znaleziska (aktualne)

| ID | Priorytet | Temat | Opis | Pliki |
|---|---|---|---|---|
| S-01 | **Medium** | Tożsamość uploadu tylko w UI | Formularz blokuje name/email (`identityLocked`), ale `POST /api/create-folder` i `notify` przyjmują dowolne wartości z body przy ważnym tokenie. Atakujący z tokenem może podrobić nazwę/email w folderze Drive i mailu admina. | `create-folder/route.js`, `Uploader.js`, `notify/route.js` |
| S-02 | **Medium** | Notify: retainer bez `prefillEmail` | Jeśli rekord tokenu nie ma `prefillEmail`, summary idzie na dowolny email z requestu (świadoma polityka B2B w audycie). Nowe tokeny wymagają emaila w `createToken` — ryzyko głównie legacy / env-only tokenów. | `notify/route.js` L91–94, `tokenStore.js` |
| S-03 | **Low** | PII w logu mismatch | `console.warn` loguje requestEmail i registeredEmail przy mismatch. | `notify/route.js` L90 |
| S-04 | **Low** | Service Account fallback | `getAuthClient` nadal wspiera SA; `.env.example` promuje SA zamiast OAuth. Ryzyko złej konfiguracji / szerszego klucza. | `googleAuth.js`, `.env.example` |
| S-05 | **Low** | Rate limit / revoke admin per warm instance | Świadome ograniczenie Vercel — nie jest twardą kwotą globalną. | `rateLimit.js`, `adminAuth.js` |
| S-06 | **Info** | Share id = sekret URL | Entropia OK (`shr_` + 12 B random). Brak OTP / kont (VULN-08 accepted). | `shareOps.mjs` |
| S-07 | **Info** | Tokeny uploadu = slugi ludzkie | Przewidywalność przy słabych nazwach — model B2B. | `tokenStore.js` `validateTokenSlug` |
| S-08 | **Info** | Blocklista rozszerzeń, nie magic-bytes | `.exe` itd. po nazwie; poza zakresem świadomie. | `blocklist.js`, `validation.js` |

### Świadomie poza zakresem (bez zmian)

- OTP klienta (VULN-08)  
- Redis/KV (progress = Drive + ETag)  
- Live Monitor (usunięty)  
- Magic-bytes MIME  

---

## 2. Martwy kod i zbędne śmieci

| Element | Ocena | Rekomendacja |
|---|---|---|
| `pdf-parse` w `devDependencies` | **Martwy** — zero importów | ✅ usunięty w tym przeglądzie |
| `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` | **Martwe** — default Next | ✅ usunięte |
| `public/bg.jpg` (~590 KB) | **Prawie martwy** — route w `ui-server`, UI nie używa | ✅ usunięty asset + route |
| `studio-pull/tauri/` | Tylko README → `tauri-app` | ✅ usunięty stub |
| Martwy CSS (Live Monitor cards, stary uploader/share) | `.admin-active-*`, `.dropzone-subtext`, `.status-*`, `.share-header`… | ✅ usunięty |
| Nieużywane eksporty | `isStampedSessionFolderName`, `assertFileInFromClient`, `useLocale`, `SUPPORTED_LOCALES` | ✅ usunięte |
| `mockups/*.html` + screenshoty | **Świadoma referencja UI** (nie runtime) | Zostawić; nie mylić z produkcją |
| `dokumentacja/archiwum/**` | Historia — OK | Nie linkować z README jako „żywe” ścieżki |
| Duplikacja `formatBytes` / `formatDate` / email regex | Techniczny dług (P3 audytu) | Wspólny `lib/` przy okazji |
| `buildBaselineFromLocal` `@deprecated` | Alias żywy w call sites | OK tymczasowo |
| Monolity `ui-server.mjs` (~1.1k LOC), `ui/app.js` (~1.1k), `globals.css` (~2.2k) | Dług architektoniczny P3 | Rozbicie po P1 rund |
| README → MIT / `LICENSE` | Brakowało pliku mimo deklaracji | ✅ dodany `LICENSE` (MIT) |
| Skrypty w `scripts/` (poza `check-oauth-scopes`) | Narzędzia ops, nie w `package.json` | OK jako CLI ad-hoc |

### Złamane / stale linki dokumentacji

| Źródło | Cel | Stan |
|---|---|---|
| `README.md` | `dokumentacja/regeneracja_oauth_scope.md` | Brak — żywy: `oauth_drive_file.md` (archiwum: `archiwum/regeneracja_oauth_scope.md`) |
| `README.md` | `dokumentacja/operacje_tokeny_i_linki.md` | Brak — żywy: `operacje.md` |
| `README.md` | `dokumentacja/wdrozenie_security_hardening.md` | Tylko w archiwum; branch `security-hardening` **nie istnieje** na remote |
| `.env.example` | Service Account + `WEBHOOK_URL`, bez OAuth/SMTP | ✅ zsynchronizowany |
| `operacje.md` „ZIP dziś, plik-po-pliku później” | Sprzeczne z P0 | ✅ poprawione |
| README „Active now” / ścieżki w `AdminOAuthCheck` + `checkOAuthScopes` | Stale | ✅ poprawione |
| `scripts/*.mjs` (poza `check-oauth-scopes`) | Ops ad-hoc, nie w `package.json` | Zostawić jako CLI |

---

## 3. Niedokończone plany wdrożenia

### Aktywny roadmap (`plany/post-mvp_roadmap_…`)

| Etap | Status w planie | W kodzie |
|---|---|---|
| P0 binding + nested path warn | ✅ | ✅ `projectBindings.mjs`, `pathHints.mjs`, Console |
| P0 pobieranie plik-po-pliku | ✅ | ✅ `SharePage.js` (`showDirectoryPicker`) |
| P0 OOS dogrywki vs studio | ✅ | ✅ sync / statusy |
| **P1 Delivery v2 — rundy (Draft N)** | ⏳ **następne** | ❌ brak `rounds` w manifeście / UI „Opublikuj” |
| **P2 mail z share przy publikacji** | ⏳ | ❌ brak; jest tylko notify po uploadie klienta |
| **P3 feedback Approve / Changes** | ⏳ | ❌ brak `_team_feedback` / UI |

### Remediacja security (archiwum planu)

| Todo | Status |
|---|---|
| P0–P2 (share leak, IDOR, CSRF Console, WAV, admin session, ZIP, quota, ETag…) | ✅ completed |
| **P3 wspólny moduł Drive + rozbicie monolitów** | ⏳ pending |

### Inne „niedomknięte” ze starych planów (archiwum)

- `plan_konsola_admina.md` / Live Monitor / KV — **świadomie zarzucone**; kod `/api/admin/active` żyje jako „In progress” w History (nie jako Live Monitor UI).  
- `kierunki_rozwoju.md` — historyczny; backlog: `produkt_i_backlog.md`.  
- README „Branch `security-hardening` ready for merge” — **przestarzałe** (już na `main`).

### Backlog UX (niski, z `produkt_i_backlog.md`)

Notatki projektu, redirect po sukcesie, pauza per plik, alert drobnicy, awaryjny `CHUNK_SIZE`, copy EN — wszystko **niezaimplementowane**, celowo niskie.

---

## 4. Rekomendowana kolejność sprzątania

1. ~~**Docs/env hygiene**~~ — zrobione w tym PR (README, `.env.example`, LICENSE, martwe assety).  
2. **S-01:** serwerowa walidacja name/email vs `getTokenPrefill` w `create-folder` (+ spójnie w notify).  
3. **S-03:** nie logować emaili przy mismatch.  
4. **Produkt:** P1 rundy (największy gap roadmapy), potem P2 mail share.  
5. **P3 arch:** dedup Drive + split `ui-server` / `app.js` (nie blokuje bezpieczeństwa).

---

## 5. Mapowanie do dokumentów kanonicznych

| Dokument | Rola po tej analizie |
|---|---|
| [`bezpieczenstwo.md`](./bezpieczenstwo.md) | Żywy skrót stanu security — uzupełnić o S-01…S-03 jeśli zostają otwarte |
| Ten plik | Pełniejszy przegląd 2026-11-16 |
| [`produkt_i_backlog.md`](./produkt_i_backlog.md) | Backlog produktu |
| [`plany/post-mvp_roadmap_….plan.md`](./plany/post-mvp_roadmap_05ad683d.plan.md) | Jedyny aktywny plan wdrożenia |
| [`archiwum/`](./archiwum/) | Historia audytów / planów — nie stan produkcji |
