# Wdrożenie: Security Hardening (branch `security-hardening`)

> Ostatnia aktualizacja: 2026-09-09  
> Status produkcji: **oczekuje na maintenance window** — kod gotowy lokalnie, nie zdeployowany na Vercel  
> Branch: `security-hardening` (**15 commitów** ponad `main`)

---

## Co zostało do wdrożenia

### ✅ Gotowe lokalnie (nie wymaga dalszego kodu przed deployem)

| Obszar | Status |
|---|---|
| Security hardening etapy 0–5 (VULN-01–04, 06–07) | ✅ |
| Konsola admina Faza A/B/C (historia, live progress, token manager) | ✅ |
| OAuth scope test w `/admin` + `npm run check-oauth-scopes` | ✅ |
| Token `drive.file` (regeneracja lokalna) | ✅ |
| Faza 3: flat upload + `/api/build-structure` + `_manifest.json` | ✅ |
| Walidacja tokena przy ładowaniu strony (revoked link UX) | ✅ |
| Rekurencyjny wybór zagnieżdżonych folderów (picker + drag-drop) | ✅ |

### 🔴 Wymagane przed deployem na Vercel (operacje, nie kod)

```
□ Google Cloud → OAuth consent screen → Publish app (In production)
  → wygeneruj NOWY refresh token PO publikacji (uniknij wygaśnięcia co 7 dni)
□ Ustaw env na Vercel (patrz tabela poniżej)
□ Zmerguj security-hardening → main
□ Deploy na Vercel
□ /admin → OAuth scope test → Pass
□ Test uploadu: plik, folder z podfolderami, resume sesji
□ Utwórz tokeny klientów w /admin → Client tokens
□ Wyślij klientom linki https://DOMENA/?token=Nazwa
```

### 🟡 Zalecane tuż po deployu

- Silne `ADMIN_SECRET` produkcyjne (nie dev)
- `PUBLIC_UPLOAD_URL` = produkcyjna domena (linki w panelu admina)
- Revoke starych tokenów OAuth w [Third-party apps](https://myaccount.google.com/permissions)
- Test revoke tokena w `/admin` → stary link pokazuje „Upload link no longer valid"

### ⏳ Backlog — nie blokuje deployu

| Temat | Priorytet |
|---|---|
| VULN-08 — weryfikacja emaila klienta | niski |
| UX: pole Notatki, redirect po sukcesie, alert drobnicy (>500 plików) | niski |
| UX: ręczna pauza/wznowienie uploadu | niski |
| Admin C+: metryki per token, alert stuck upload, edycja tokena | niski |
| Vercel KV zamiast in-memory progress store | średni (przy wielu workerach) |
| Refaktor: inline styles, podział `Uploader.js` | niski |
| Admin: ręczne odtworzenie struktury z `_manifest.json` (recovery UI) | niski |

### ⚠️ Znane ograniczenia produkcyjne

- **Progress store in-memory** — sekcja „Active now" może być niepełna przy wielu instancjach Vercel
- **Rate limit in-memory** — ten sam efekt; przy normalnym ruchu akceptowalne
- **Token manager** — źródło prawdy: `_uploader_tokens.json` na Drive; `UPLOAD_TOKENS` w env tylko fallback

---

## Podsumowanie

Wdrożono etapy 0–5 z analizy bezpieczeństwa, konsolę admina (A/B/C), diagnostykę OAuth, rekonstrukcję podfolderów (Faza 3) oraz poprawki UX tokenów. Wszystko przetestowane lokalnie (`npm run dev`, curl, `npm run build`).

---

## Mapa commitów (security-hardening → main)

| Commit | Opis | Powiązane znaleziska |
|---|---|---|
| `0ecde47` | Dodano raporty analizy bezpieczeństwa i kodu | — |
| `b2ef1fc` | Fix SMTP `secure`, usunięto logowanie PII, dodano `noindex` | VULN-03, VULN-06, VULN-07 |
| `8687244` | Autoryzacja tokenem URL we wszystkich API routes | VULN-01 |
| `ed7f35e` | Sanityzacja i walidacja payloadu notify | VULN-02 |
| `390170c` | Walidacja plików server-side, weryfikacja folderId, wspólny googleAuth | VULN-05, kierunki: czarna lista |
| `7692a4f` | Rate limiting per IP | VULN-04 |
| `ce5aa0e` | Refaktor Uploader + deduplikacja folderów | analiza_kodu |
| `d4c58cf` | Docs: operacje, plan admina, raport wdrożenia | — |
| `5c2ee91` | Admin Faza A — historia sesji Drive | plan_konsola_admina |
| `7114e64` | Admin Faza B — live progress heartbeat | plan_konsola_admina |
| `8d9a23e` | Admin Faza C — token manager na Drive | plan_konsola_admina |
| `54f92bf` | CLI `npm run check-oauth-scopes` | VULN-05 |
| `14f4501` | Walidacja tokena przy ładowaniu strony (revoked UX) | VULN-01 |
| `003101b` | OAuth scope test w panelu admina | VULN-05 |
| `fb402fb` | Faza 3 — `/api/build-structure` | kierunki_rozwoju |

---

## Nowe pliki

| Plik | Rola |
|---|---|
| `src/lib/auth.js` | Weryfikacja tokena upload (`UPLOAD_TOKENS`), fail-closed |
| `src/lib/googleAuth.js` | Wspólny klient Google OAuth/SA (wcześniej 3× duplikat) |
| `src/lib/validation.js` | Czarna lista rozszerzeń, limit rozmiaru pliku |
| `src/lib/rateLimit.js` | In-memory rate limiter per IP + route |
| `src/lib/adminAuth.js` | Autoryzacja konsoli admina (`ADMIN_SECRET`, cookie) |
| `src/lib/formatBytes.js` | Formatowanie rozmiaru plików |
| `src/components/AdminDashboard.js` | UI konsoli admina |
| `src/app/admin/page.js` | Strona `/admin` |
| `src/app/api/admin/login/route.js` | Logowanie admina |
| `src/app/api/admin/logout/route.js` | Wylogowanie admina |
| `src/app/api/admin/sessions/route.js` | Lista sesji upload z Drive |
| `src/lib/progressStore.js` | In-memory store live progress (TTL 24h) |
| `src/app/api/upload-progress/route.js` | Heartbeat postępu uploadu od klienta |
| `src/app/api/admin/active/route.js` | Aktywne uploady dla konsoli admina |
| `src/lib/tokenStore.js` | Registry tokenów w `_uploader_tokens.json` na Drive |
| `src/app/api/admin/tokens/route.js` | CRUD tokenów (lista + tworzenie) |
| `src/app/api/admin/tokens/[id]/route.js` | Revoke / restore tokena |
| `src/components/AdminTokenManager.js` | UI token managera |
| `src/lib/pathManifest.js` | Walidacja ścieżek + unikalne flat upload names |
| `src/lib/buildStructure.js` | Rekonstrukcja podfolderów na Drive (Faza 3) |
| `src/app/api/build-structure/route.js` | POST — budowa struktury + `_manifest.json` |
| `src/lib/collectFolderFiles.js` | Rekurencyjny odczyt zagnieżdżonych folderów (picker + DnD) |
| `src/lib/checkOAuthScopes.js` | Diagnostyka scope OAuth (CLI + admin) |
| `src/components/AdminOAuthCheck.js` | UI testu OAuth w `/admin` |
| `src/app/api/admin/check-oauth-scopes/route.js` | POST — uruchomienie testu scope |
| `src/app/api/validate-token/route.js` | POST — weryfikacja tokena przy ładowaniu strony |
| `scripts/check-oauth-scopes.mjs` | CLI wrapper diagnostyki OAuth |

---

## Zmiany w istniejących plikach

### API Routes (wszystkie 4)

Każdy endpoint (`create-folder`, `upload-session`, `check-folder`, `notify`) teraz:

1. Sprawdza rate limit (limity per route)
2. Weryfikuje token (`x-upload-token` header)
3. Waliduje dane wejściowe (specyficzne per route)

### `src/app/api/notify/route.js`

- Fix bug SMTP: `secure: smtpPort === 465` (wcześniej zawsze `false` gdy env nie ustawiony)
- Usunięto `console.log(data)` z pełnymi danymi osobowymi
- Escapowanie HTML w treści maili (`escapeHtml`)
- Walidacja emaila, folderId, limit 2000 plików w payloadzie
- Mail do klienta wysyłany tylko z ważnym tokenem (auth gate)

### `src/app/api/upload-session/route.js`

- Czarna lista rozszerzeń (`.exe`, `.bat`, `.sh`, `.ps1`, `.vbs`, `.jar`, `.lnk`, `.reg`…)
- Limit rozmiaru pliku: 250 GB (konfigurowalny: `MAX_FILE_SIZE_GB`)
- Weryfikacja że `folderId` jest folderem-dzieckiem `GOOGLE_DRIVE_FOLDER_ID`

### `src/app/api/check-folder/route.js`

- Weryfikacja parentage folderId (403 dla obcych folderów)

### `src/app/api/create-folder/route.js`

- Walidacja formatu emaila i długości nazwy
- Reużycie istniejącego folderu sesji zamiast tworzenia duplikatu

### `src/components/Uploader.js`

- Odczyt `?token=` z URL, wysyłanie w nagłówku każdego API call
- Weryfikacja tokena server-side przy ładowaniu (`/api/validate-token`)
- Ekrany „Access link required" / „Upload link no longer valid"
- Lustrzana czarna lista rozszerzeń w UI (server jest authoritative)
- Flat upload + manifest → `/api/build-structure` po zakończeniu transferu
- Ekran „Compiling folder structure…" podczas Fazy 3
- `showDirectoryPicker` + rekurencyjny drag-and-drop zagnieżdżonych folderów
- Heartbeat postępu co 10 s (admin Faza B)
- Jeden warunek `canUpload`, stabilne klucze UUID, dedup folderów sesji

### `src/app/layout.js`

- `robots: { index: false, follow: false }` — strona niewidoczna dla Google

### `.env.example`

- Dodano `UPLOAD_TOKENS`

---

## Nowe zmienne środowiskowe

| Zmienna | Wymagana | Opis | Przykład |
|---|---|---|---|
| `UPLOAD_TOKENS` | **TAK** (fail-closed) | Lista tokenów dostępu, comma-separated | `"StudioAlfa,ProjektBeta"` |
| `MAX_FILE_SIZE_GB` | nie | Limit rozmiaru pliku w GB | `250` (domyślnie) |
| `ADMIN_SECRET` | tak (dla `/admin`) | Hasło do konsoli admina | `"silne-haslo"` |
| `PUBLIC_UPLOAD_URL` | nie | URL produkcyjny do linków w adminie | `"https://twoja-domena.pl"` |

Wszystkie poprzednie zmienne (`GOOGLE_*`, `SMTP_*`, `NOTIFICATION_EMAIL`, `WEBHOOK_URL`) bez zmian.

---

## Limity rate limiting

| Endpoint | Limit/min/IP | Uzasadnienie |
|---|---|---|
| `create-folder` | 10 | tworzenie folderów — rzadkie |
| `check-folder` | 30 | sprawdzanie duplikatów — umiarkowane |
| `upload-session` | 300 | bulk folder upload — jedna sesja per plik |
| `notify` | 5 | wysyłka maili — bardzo rzadkie |
| `build-structure` | 10 | rekonstrukcja podfolderów — raz na sesję |

---

## Status znalezisk bezpieczeństwa po wdrożeniu

| ID | Podatność | Status |
|---|---|---|
| VULN-01 | Brak auth na API | ✅ Wdrożone — token URL server-side |
| VULN-02 | Open SMTP relay | ✅ Wdrożone — auth gate + escapowanie + walidacja |
| VULN-03 | Bug SMTP secure | ✅ Wdrożone |
| VULN-04 | Brak rate limitingu | ✅ Wdrożone — in-memory per IP |
| VULN-05 | Nadmierny OAuth scope | ✅ Lokalnie (`drive.file` token) · ⏳ Vercel env + Publish app w Google Cloud |
| VULN-06 | Logowanie PII | ✅ Wdrożone — tylko metadane |
| VULN-07 | Brak noindex | ✅ Wdrożone |
| VULN-08 | Nieweryfikowany email | ⏳ Nie wdrożone — długoterminowe |

---

## Status kierunków rozwoju po wdrożeniu

| Funkcja z `kierunki_rozwoju.md` | Status |
|---|---|
| No-index (ukrycie przed Google) | ✅ Wdrożone |
| Token URL (`?token=X`) | ✅ Wdrożone (server-side) |
| Czarna lista rozszerzeń | ✅ Wdrożone (server + UI) |
| Pole „Notatki" | ⏳ Nie wdrożone |
| Przekierowanie po sukcesie | ⏳ Nie wdrożone |
| Alert o drobnicy (>500 plików) | ⏳ Nie wdrożone |
| Pauza/wznowienie ręczne | ⏳ Nie wdrożone |
| Faza 3: rekonstrukcja podfolderów | ✅ Wdrożone — flat upload + `/api/build-structure` |
| Konsola admina (Faza A — historia Drive) | ✅ Wdrożone lokalnie — `/admin` |
| Konsola admina (Faza B — live progress) | ✅ Wdrożone lokalnie — heartbeat 10s |
| Konsola admina (Faza C — token manager) | ✅ Wdrożone — `/admin` → Client tokens |

---

## Checklist deploy (maintenance window)

### Env na Vercel (wszystkie wymagane)

| Zmienna | Uwagi |
|---|---|
| `GOOGLE_CLIENT_ID` | bez zmian |
| `GOOGLE_CLIENT_SECRET` | bez zmian |
| `GOOGLE_REFRESH_TOKEN` | **nowy** token `drive.file`, wygenerowany PO Publish app |
| `GOOGLE_DRIVE_FOLDER_ID` | bez zmian |
| `UPLOAD_TOKENS` | bootstrap — potem `/admin` → Client tokens |
| `ADMIN_SECRET` | silne hasło produkcyjne |
| `PUBLIC_UPLOAD_URL` | np. `https://twoja-domena.vercel.app` |
| `SMTP_*`, `NOTIFICATION_EMAIL` | bez zmian |
| `MAX_FILE_SIZE_GB` | opcjonalnie (domyślnie 250) |

### Kroki deploy

```
□ Google Cloud → Publish app → nowy refresh token → Vercel env
□ Merge security-hardening → main → deploy
□ /admin → OAuth scope test → Pass (tylko drive.file)
□ Upload: pojedynczy plik + folder z podfolderami → struktura na Drive OK
□ Upload: link bez ?token= → „Access link required"
□ Upload: revoke token → „Upload link no longer valid"
□ /admin → create token → copy link → test incognito
□ Wyślij linki klientom retainer (?token=...)
```

Patrz też: [`regeneracja_oauth_scope.md`](./regeneracja_oauth_scope.md), [`operacje_tokeny_i_linki.md`](./operacje_tokeny_i_linki.md)

---

## Testy wykonane lokalnie

| Test | Wynik |
|---|---|
| POST bez tokena | 401 ✅ |
| POST z błędnym tokenem | 401 ✅ |
| Upload `.exe` | 400 + komunikat ✅ |
| Notify z invalid payload | 400 ✅ |
| Rate limit notify (6. request) | 429 ✅ |
| check-folder z obcym folderId | 403 ✅ |
| Strona główna zawiera noindex | ✅ |
| `npm run build` | ✅ bez błędów |
| OAuth scope test (admin + CLI) | ✅ `drive.file` only |
| Upload folderu z podfolderami + build-structure | ✅ lokalnie |
| Revoked token — blokada UI | ✅ |
| Nested folder picker (showDirectoryPicker) | ✅ |

---

## Co świadomie pominięto (poza zakresem deployu)

- Weryfikacja własności emaila klienta (VULN-08)
- Przepisanie inline styles na CSS variables
- Podział `Uploader.js` na hooki/komponenty
- Vercel KV dla progress store
- Admin C+: metryki, stuck alerts, edycja tokenów
- Funkcje UX: notatki, redirect po sukcesie, alert drobnicy, pauza ręczna
- Admin UI: ręczne odtworzenie struktury z `_manifest.json`
