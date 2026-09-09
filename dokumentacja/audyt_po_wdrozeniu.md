# Audyt po wdrożeniu — Drive Uploader

> **Data audytu:** 2026-09-09 (wieczór)  
> **Produkcja:** https://drive-uploader-three.vercel.app  
> **Projekt Vercel:** `instantperson-6437s-projects/drive-uploader`  
> **Baza kodu lokalna:** commit `3449c0b` + hotfixy delta (niezacommitowane)

---

## 0. Executive summary

Aplikacja jest **live na Vercel** z pełnym security hardeningiem, konsolą admina i flow flat-upload + `build-structure`. Pierwszy produkcyjny klient (Woodweb / Ciaran Carty, ~1 TB) przeszedł fazę 1 (~700 GB). Faza 2 (delta ~477 GB braków) wymagała **hotfixów UI/uploadu** — po wdrożeniu upload **działa** (potwierdzone plikami na Drive 2026-09-09 14:17–15:04 UTC).

| Obszar | Ocena |
|--------|-------|
| Bezpieczeństwo (VULN-01–07) | ✅ Wdrożone i zweryfikowane na produkcji |
| Rdzeń uploadu (browser → Google resumable) | ✅ Sprawdzony na ~700 GB + delta MOVs 3–12 GB |
| Delta skip + resume | ✅ Działa; wymagało 3 hotfixów tego dnia |
| Admin / tokeny | ✅ Drive-backed registry; 4 tokeny aktywne |
| Stabilność przy multi-GB MOVs | 🟡 Poprawiona; 2 znane luki do domknięcia (patrz §5) |
| Gotowość na nowych klientów | 🟡 OK po usunięciu hardcode `Woodweb (Master)/` |

---

## 1. Status wdrożenia produkcyjnego

### 1.1 Co jest na produkcji

| Komponent | Status |
|-----------|--------|
| Auth token URL (`x-upload-token`) na wszystkich API | ✅ |
| Rate limiting per IP | ✅ |
| `/admin` — historia, live progress, token manager, OAuth test | ✅ |
| Flat upload + `/api/build-structure` + `_manifest.json` | ✅ |
| Refaktor: hooki (`useUploadRunner`, `useFileQueue`, …) + komponenty UI | ✅ |
| Delta upload: skan Drive, skip istniejących, banner | ✅ (wdrożone 2026-09-09) |
| Token prefill (`prefillName` / `prefillEmail`) | ✅ |
| Auto-revoke one-time token po sukcesie | ✅ |
| Hotfixy stabilności (chunk 32 MB, throttle UI, batch skip) | ✅ (wdrożone 2026-09-09 ~16:00–16:10) |

### 1.2 Env produkcyjne (weryfikacja operacyjna)

- `GOOGLE_*` — OAuth działa (uploady idą na Drive)
- `ADMIN_SECRET` — ustawiony (produkcyjny, ≠ dev)
- `PUBLIC_UPLOAD_URL` — linki w adminie wskazują na `drive-uploader-three.vercel.app`
- `UPLOAD_TOKENS` — fallback; źródło prawdy: `_uploader_tokens.json` na Drive

### 1.3 Testy live wykonane 2026-09-09

| Test | Wynik |
|------|-------|
| `POST /api/validate-token` — `Woodweb-T7-resume` | ✅ valid + prefill Ciaran |
| `POST /api/validate-token` — `CiaranCarty` | ✅ valid |
| `POST /api/validate-token` — nieistniejący / zła wielkość liter | ✅ 401 |
| `POST /api/check-folder` z tokenem Woodweb | ✅ 200 |
| Upload MOVs 3–12 GB do sesji Ciaran | ✅ 7+ plików flat w root sesji |

---

## 2. Audyt bezpieczeństwa (po wdrożeniu)

Szczegóły źródłowe: [`analiza_bezpieczenstwa.md`](./analiza_bezpieczenstwa.md), [`wdrozenie_security_hardening.md`](./wdrozenie_security_hardening.md).

| ID | Podatność | Status po wdrożeniu | Uwagi |
|----|-----------|---------------------|-------|
| VULN-01 | Brak auth na API | ✅ | `verifyUploadToken` + `isSessionFolder()` |
| VULN-02 | Open SMTP relay | ✅ | Auth gate + walidacja + escape HTML |
| VULN-03 | Bug SMTP `secure` | ✅ | |
| VULN-04 | Brak rate limitingu | ✅ | In-memory; znane ograniczenie multi-instance |
| VULN-05 | Nadmierny OAuth scope | ✅ | `drive.file` w kodzie; refresh token produkcyjny działa |
| VULN-06 | Logowanie PII | ✅ | |
| VULN-07 | Brak noindex | ✅ | |
| VULN-08 | Nieweryfikowany email | ⏳ | Świadoma decyzja projektowa |

**Zastrzeżenie VULN-02:** autoryzowany token nadal może podać dowolny email w formularzu → mail potwierdzający idzie na podany adres. Ryzyko niskie (token znany tylko klientowi).

---

## 3. Incydent Woodweb — analiza i hotfixy

### 3.1 Kontekst

| | |
|---|---|
| Sesja Drive | `Ciaran Carty - ciarancarty@gmail.com` (`1zDyGWHbw8Fh-7Zz1LBh56G82Rf72CJDr`) |
| Oczekiwane | 452 pliki, ~1.15 TB |
| Na Drive przed delta | 366 plików (zreorganizowane pod `Woodweb (Master)/`) |
| Braki | 86 plików, ~477 GB — głównie `Day 2/Footage` (71 MOV) |
| Raport | [`raport_brakow_woodweb_2026-09-09.md`](./raport_brakow_woodweb_2026-09-09.md) |

### 3.2 Timeline 2026-09-09

| Czas (≈) | Zdarzenie |
|----------|-----------|
| Rano | Pierwszy upload delta — 12 Stills (~314 MB) do root sesji |
| 15:45 | Admin „Live" 6% — **fałszywy postęp** (skip w UI, brak nowych bajtów na Drive) |
| 15:58 | Pierwszy MOV delta: `A007C0043` (590 MB) ✅ |
| 16:00–16:10 | **Hotfix 1:** batch skip (`markFilesComplete`) — UI freeze przy 374 skip |
| 16:05–16:10 | **Hotfix 2:** chunk 32 MB, progress throttle 1/s, timeouty API, cleanup sesji między plikami |
| 16:17–17:04 | **Upload działa:** kolejne MOV-y 6–12 GB lądują w flat root sesji |

### 3.3 Root cause — dlaczego „reset po jednym pliku"

| # | Przyczyna | Typ | Status |
|---|-----------|-----|--------|
| 1 | **374× `updateFileState` w pętli skip** — zawieszenie UI przed uploadem | Bug | ✅ Naprawione (`markFilesComplete`) |
| 2 | **Postęp UI co ~5 ms** na plikach 8–15 GB (chunk 5 MB) — setki tysięcy re-renderów React | Bug | ✅ Naprawione (chunk 32 MB + `createProgressThrottle`) |
| 3 | **Brak timeoutów** na `queryUploadStatus` / fetch init | Bug | 🟡 Częściowo (timeout jest, ale timeout = `error` → kasuje URL — patrz §4) |
| 4 | **Odświeżenie strony** — lista plików znika (tylko pamięć RAM); wygląda jak reset | UX / design | ⏳ Planowane (§5 Faza 2) |
| 5 | **Drive desktop „Up to date"** — brak widoczności uploadu w trakcie | Oczekiwanie klienta | 📋 Komunikacja operacyjna |
| 6 | **Admin „Live" ≠ bajty w chmurze** — heartbeat z przeglądarki | Ograniczenie | 📋 Udokumentowane |

**Wniosek:** wczorajsze 700 GB szły **bez skip loop** — prosty flow. Dziś delta + duże MOV-y ujawniły bugi warstwy UI, nie Google API.

### 3.4 Stan uploadu Woodweb (snapshot 2026-09-09 ~17:30)

Flat files w root sesji (nowe delta uploady):

- `A007C0043` — 590 MB ✅
- `A007C0025` — 7.21 GB ✅
- `A006C0039` — 6.61 GB ✅
- `A007C0017` — 4.80 GB ✅
- `A007C0045` — 11.18 GB ✅
- `A006C0043` — 3.63 GB ✅
- `A007C0023` — 10.36 GB ✅
- `A006C0046` — 12.12 GB ✅

**Szacunek tempa:** ~54 GB w ~1.5 h → ~36 GB/h (wolniejsze niż pierwsze 700 GB/7 h, ale **stabilne**). Pozostało ~64 MOV / ~420 GB → **~12–15 h** przy utrzymaniu tempa.

**Uwaga:** pliki są **płasko w root** sesji — `build-structure` uruchomi się dopiero po **100%** wszystkich plików w kolejce.

---

## 4. Tokeny — stan rejestru

**Plik:** `_uploader_tokens.json` na Drive (folder `GOOGLE_DRIVE_FOLDER_ID`, file ID `1MrvU0aQi0kJAk3ihZbCvxJFKMK4MOZlk`)

| Token | Klient | Typ | Status | Link |
|-------|--------|-----|--------|------|
| `TestLokalny` | TestLokalny | retainer | active | `/?token=TestLokalny` |
| `StudioTest` | Studio Test Sp. | one-time | active | `/?token=StudioTest` |
| `Woodweb-T7-resume` | Ciaran Carty — Woodweb T7 | one-time | active | prefill: Ciaran / ciarancarty@gmail.com |
| `CiaranCarty` | CiaranCarty | retainer | active | stały token na przyszłość |

**Operacje:**

```bash
node scripts/list-tokens.mjs          # lista tokenów z Drive
node scripts/check-session-activity.mjs  # aktywność sesji Ciaran
```

**Rekomendacja operacyjna:**

- Do dokończenia Woodweb: **`Woodweb-T7-resume`** (ma prefill + notatki delta)
- Po sukcesie: token one-time **auto-revoke**; `CiaranCarty` zostaje jako retainer
- Revoke ręczny: `/admin` → Client tokens

---

## 5. Znane luki i zapachy kodu (do domknięcia)

### 🔴 P0 — przed kolejnym klientem delta

| # | Problem | Status |
|---|---------|--------|
| P0-1 | Hardcoded `Woodweb (Master)/` w `deltaMatch.js` | ✅ **2026-09-09** — `clientPathVariants()` + heurystyka volume root |
| P0-2 | `queryUploadStatus` timeout kasował URL | ✅ **2026-09-09** — `UPLOAD_STATUS`, `network_error` vs `expired`, retry |

### 🟡 P1 — stabilność i UX (1–2 dni)

| # | Problem | Status |
|---|---------|--------|
| P1-1 | `isSessionFolder()` przy każdym pliku | ⏳ Backlog |
| P1-2 | Heartbeat przed React render | ✅ **2026-09-09** — `setTimeout(0)` przed heartbeat |
| P1-3 | Resume z React state zamiast localStorage | ✅ **2026-09-09** — `readStoredUploadSession()` |
| P1-4 | Brak persystencji kolejki plików | Opcjonalnie: zapis manifestu wybranych plików w `sessionStorage` |
| P1-5 | `progressStore` in-memory — admin „Active now" niepełny przy wielu workerach | Vercel KV (backlog) |

### 🟢 P2 — jakość / admin (backlog)

- UI admin: ręczne odtworzenie struktury z `_manifest.json`
- Alert drobnicy (>500 plików)
- Ręczna pauza/wznowienie
- Pole „Notatki" od klienta
- Commit + push hotfixów delta (obecnie tylko na Vercel deploy)

---

## 6. Ocena architektury (po refaktorze)

### 6.1 Struktura kodu — ✅ bardzo dobra

| Przed | Po |
|-------|-----|
| `Uploader.js` ~451 linii, inline styles | Orchestrator ~193 linii |
| `getAuthClient` 3× duplikat | `src/lib/googleAuth.js` |
| Brak modułów delta | `deltaMatch.js`, `listSessionFiles.js`, `progressThrottle.js` |

### 6.2 Moduły kluczowe

| Moduł | Ocena |
|-------|-------|
| `tokenStore.js` | Eleganckie — Drive jako registry bez zewnętrznej DB |
| `useUploadRunner.js` | Poprawna logika sekwencyjna; wymaga dopracowania statusów resume |
| `buildStructure.js` | Działa; recovery UI w adminie — backlog |
| `collectFolderFiles.js` | Solidny picker + DnD; `Promise.all` bez limitu — OK przy <500 folderach |

---

## 7. Plan wdrożenia (kolejne kroki)

### Faza A — **teraz** (Woodweb w toku)

```
□ Klient: ten sam link Woodweb-T7-resume, folder Day 2/Footage, karta otwarta overnight
□ Monitor: node scripts/check-session-activity.mjs co kilka godzin
□ Nie revoke Woodweb-T7-resume do czasu build-structure + weryfikacji raportu braków
□ Po sukcesie: sprawdź _manifest.json, uruchom porównanie z raport_brakow_woodweb
```

### Faza B — **po zakończeniu Woodweb** (1 sesja dev)

```
✅ P0-1: Generyczna normalizacja ścieżek (clientPathVariants + volume root heuristic)
✅ P0-2: Statusy queryUploadStatus (expired / network_error / error)
✅ P1-2: Heartbeat po renderze
✅ P1-3: readStoredUploadSession() z localStorage
✅ Deploy produkcja (2026-09-09 wieczór)
□ git commit + push wszystkich hotfixów delta
□ Test: upload 3 plików (1 mały, 2× >5 GB) + przerwanie sieci + resume
```

### Faza C — **przed następnym klientem B2B**

```
□ P1-1: Cache isSessionFolder
□ P1-4: sessionStorage dla kolejki (opcjonalnie)
□ Revoke tokenów testowych: StudioTest (jeśli nieużywany)
□ Uzupełnij prefill na CiaranCarty (name + email) — wygoda klienta
□ Aktualizacja wdrozenie_security_hardening.md → status: LIVE
```

### Faza D — **backlog Q4**

```
□ Vercel KV dla progressStore
□ Admin: recovery build-structure z manifestu
□ UX: pauza, notatki, redirect po sukcesie, alert drobnicy
□ VULN-08: opcjonalna weryfikacja email (magic link / kod)
```

---

## 8. Skrypty operacyjne (nowe)

| Skrypt | Cel |
|--------|-----|
| `scripts/list-tokens.mjs` | Lista tokenów z Drive |
| `scripts/check-session-activity.mjs` | Ostatnie pliki w sesji (flat root) |
| `scripts/create-client-token.mjs` | Tworzenie tokena CLI |
| `scripts/patch-token-prefill.mjs` | Prefill na istniejącym tokenie |
| `scripts/recover-woodweb-session.mjs` | Recovery sesji Woodweb |
| `scripts/extract-pdf-inventory.mjs` | Inventory z PDF raportu |

---

## 9. Podsumowanie decyzyjne

| Pytanie | Odpowiedź |
|---------|-----------|
| Czy produkcja jest bezpieczna? | **Tak** — VULN-01–07 wdrożone |
| Czy nowe uploady będą szły OK? | **Tak** — prosty flow jak wczoraj; delta wymagała hotfixów (już na prod) |
| Czy Woodweb delta zadziała? | **Tak, w toku** — 8+ MOV-ów potwierdzonych na Drive; zostawić kartę otwartą |
| Co blokuje kolejnego klienta? | Hardcode `Woodweb (Master)/` — **usunąć przed innym delta projektem** |
| Czy commit na GitHub = prod? | **Nie** — hotfixy delta wdrożone przez `vercel --prod`; **git niezsynchronizowany** |

---

## 10. Powiązane dokumenty

- [`wdrozenie_security_hardening.md`](./wdrozenie_security_hardening.md) — mapa commitów i checklist deploy
- [`analiza_bezpieczenstwa.md`](./analiza_bezpieczenstwa.md) — oryginalne VULN
- [`plan_konsola_admina.md`](./plan_konsola_admina.md) — admin Faza A/B/C
- [`operacje_tokeny_i_linki.md`](./operacje_tokeny_i_linki.md) — operacje tokenów
- [`raport_brakow_woodweb_2026-09-09.md`](./raport_brakow_woodweb_2026-09-09.md) — delta Woodweb

---

*Ostatnia aktualizacja: 2026-09-09 · Autor: audyt po wdrożeniu produkcyjnym + incydent Woodweb*
