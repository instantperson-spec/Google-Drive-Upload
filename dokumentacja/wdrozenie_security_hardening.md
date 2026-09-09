# Wdrożenie: Security Hardening (branch `security-hardening`)

> Data wdrożenia lokalnego: 2026-09-09  
> Status produkcji: **oczekuje na maintenance window** — kod gotowy, nie zdeployowany na Vercel  
> Branch: `security-hardening` (7 commitów ponad `main`)

---

## Podsumowanie

Wdrożono etapy 0–5 z analizy bezpieczeństwa i analizy kodu. Wszystkie zmiany przetestowane lokalnie (`npm run dev`, curl, `npm run build`).

---

## Mapa commitów

| Commit | Opis | Powiązane znaleziska |
|---|---|---|
| `0ecde47` | Dodano raporty analizy bezpieczeństwa i kodu | — |
| `b2ef1fc` | Fix SMTP `secure`, usunięto logowanie PII, dodano `noindex` | VULN-03, VULN-06, VULN-07 |
| `8687244` | Autoryzacja tokenem URL we wszystkich API routes | VULN-01 |
| `ed7f35e` | Sanityzacja i walidacja payloadu notify | VULN-02 |
| `390170c` | Walidacja plików server-side, weryfikacja folderId, wspólny googleAuth | VULN-05, kierunki: czarna lista |
| `7692a4f` | Rate limiting per IP | VULN-04 |
| `ce5aa0e` | Refaktor Uploader + deduplikacja folderów | analiza_kodu |

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
- Ekran „Access link required" bez tokena
- Lustrzana czarna lista rozszerzeń w UI (server jest authoritative)
- Jeden warunek `canUpload` zamiast 5 kopii
- Stabilne klucze React (`crypto.randomUUID()`)
- Funkcyjny update w `removeFile`

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

Wszystkie poprzednie zmienne (`GOOGLE_*`, `SMTP_*`, `NOTIFICATION_EMAIL`, `WEBHOOK_URL`) bez zmian.

---

## Limity rate limiting

| Endpoint | Limit/min/IP | Uzasadnienie |
|---|---|---|
| `create-folder` | 10 | tworzenie folderów — rzadkie |
| `check-folder` | 30 | sprawdzanie duplikatów — umiarkowane |
| `upload-session` | 300 | bulk folder upload — jedna sesja per plik |
| `notify` | 5 | wysyłka maili — bardzo rzadkie |

---

## Status znalezisk bezpieczeństwa po wdrożeniu

| ID | Podatność | Status |
|---|---|---|
| VULN-01 | Brak auth na API | ✅ Wdrożone — token URL server-side |
| VULN-02 | Open SMTP relay | ✅ Wdrożone — auth gate + escapowanie + walidacja |
| VULN-03 | Bug SMTP secure | ✅ Wdrożone |
| VULN-04 | Brak rate limitingu | ✅ Wdrożone — in-memory per IP |
| VULN-05 | Nadmierny OAuth scope | ⚠️ Częściowo — kod poprawiony (SA fallback), refresh token wymaga regeneracji |
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
| Faza 3: rekonstrukcja podfolderów | ⏳ Nie wdrożone |
| Konsola admina (Faza A — historia Drive) | ✅ Wdrożone lokalnie — `/admin` |
| Konsola admina (Faza B — live progress) | ✅ Wdrożone lokalnie — heartbeat 10s |
| Konsola admina (Faza C — token manager) | 📋 Plan — `plan_konsola_admina.md` |

---

## Checklist deploy (maintenance window)

```
□ Ustaw UPLOAD_TOKENS na Vercel (wszystkie aktywne tokeny klientów)
□ Zmerguj security-hardening → main
□ Deploy na Vercel
□ Test: otwórz link z tokenem — upload działa
□ Test: otwórz link bez tokena — ekran „Access link required"
□ Test: curl bez tokena → 401
□ Wyślij zaktualizowane linki klientom retainer
□ (Opcjonalnie) Regeneruj refresh token z scope drive.file only
```

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

---

## Co świadomie pominięto (poza zakresem)

- Weryfikacja własności emaila klienta (VULN-08)
- Przepisanie inline styles na CSS variables
- Podział `Uploader.js` na hooki/komponenty
- Konsola admina (plan w osobnym dokumencie)
- Funkcje UX z kierunków rozwoju (notatki, redirect, alert drobnicy)
