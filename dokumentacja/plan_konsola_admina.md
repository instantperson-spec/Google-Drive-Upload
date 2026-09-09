# Plan: Konsola Admina — podgląd uploadów

> Status: **Fazy A + B + C wdrożone lokalnie** (branch `security-hardening`)  
> Dodatkowo: OAuth scope test, token validation on page load — patrz [`wdrozenie_security_hardening.md`](./wdrozenie_security_hardening.md)

---

## Problem

Obecnie admin dowiaduje się o uploadzie **dopiero po jego zakończeniu** — mail SMTP lub webhook Discord/Slack. W trakcie transferu (duże pliki wideo, godziny uploadu) **nie ma widoczności postępu**.

Upload odbywa się **bezpośrednio z przeglądarki klienta do Google Drive** — serwer aplikacji nie widzi przepływu bajtów. Postęp istnieje tylko w UI klienta (`Uploader.js`).

---

## Co admin potrzebuje (wymagania)

| Potrzeba | Pilność | Stan po wdrożeniu lokalnym |
|---|---|---|
| Lista aktywnych uploadów z % postępu | 🔴 Wysoka | ✅ Faza B — „Active now", heartbeat 10s, refresh 5s |
| Historia zakończonych sesji | 🟡 Średnia | ✅ Faza A — tabela z Drive + email po uploadzie |
| Powiązanie uploadu z tokenem/klientem | 🟡 Średnia | ✅ Token widoczny w „Active now"; brak mapowania na clientName z registry |
| Link do folderu sesji na Drive | 🟢 Niska | ✅ W historii + w mailu admina |
| Zarządzanie tokenami (CRUD) | 🟡 Średnia | ✅ Faza C — create / revoke / restore / copy link |
| Revoke tokena bez redeploy | 🟢 Niska | ✅ Revoke w `/admin` → natychmiastowy efekt |
| Diagnostyka OAuth przed deployem | 🟡 Średnia | ✅ OAuth scope test w panelu + CLI |

---

## Architektura — 3 fazy

### Faza A: „Drive Mirror" ✅ Wdrożone lokalnie

**Idea:** Admin panel tylko **odczytuje Google Drive** — bez zmian w flow klienta.

**Wdrożone pliki:**
- `src/app/admin/page.js` — dashboard
- `src/components/AdminDashboard.js` — UI (login, tabela, auto-refresh 60s)
- `src/app/api/admin/login/route.js` — logowanie (cookie httpOnly, 24h)
- `src/app/api/admin/logout/route.js` — wylogowanie
- `src/app/api/admin/sessions/route.js` — lista folderów sesji z Drive
- `src/lib/adminAuth.js` — weryfikacja `ADMIN_SECRET`
- Env: `ADMIN_SECRET`

**Dostęp:** `http://localhost:3000/admin` (lokalnie) · hasło z `ADMIN_SECRET`

```
[Admin /admin]  →  GET /api/admin/sessions  →  Google Drive API
                                              (list children of GOOGLE_DRIVE_FOLDER_ID)
```

**Co widać:**
- lista folderów sesji (`Jan Kowalski - jan@test.pl`)
- liczba plików, łączny rozmiar, data ostatniej modyfikacji
- link „Otwórz w Drive"

**Czego NIE widać (w samej Fazie A):**
- upload w trakcie (plik pojawia się na Drive dopiero po 100%)
- postęp procentowy na żywo → **uzupełnione przez Fazę B**

**Zabezpieczenie:**
- strona `/admin` chroniona hasłem admina (`ADMIN_SECRET` w env, weryfikacja cookie/sesji)
- endpoint `/api/admin/*` wymaga nagłówka `x-admin-secret`

**Pliki do stworzenia:**
- `src/app/admin/page.js` — dashboard
- `src/app/api/admin/sessions/route.js` — lista folderów z Drive
- `src/lib/adminAuth.js` — weryfikacja admin secret

**Zalety:** zero zmian w `Uploader.js`, zero bazy danych, szybkie wdrożenie.  
**Wady:** brak live progress.

---

### Faza B: „Progress Heartbeat" ✅ Wdrożone lokalnie

**Idea:** Klient co ~10 s wysyła snapshot postępu na serwer. Admin odpytuje te dane.

**Wdrożone pliki:**
- `src/lib/progressStore.js` — in-memory store (TTL 24h, active = heartbeat < 30s)
- `src/app/api/upload-progress/route.js` — POST heartbeat (auth token + folder validation)
- `src/app/api/admin/active/route.js` — GET aktywne sesje dla admina
- `src/components/Uploader.js` — heartbeat co 10s podczas uploadu
- `src/components/AdminDashboard.js` — sekcja „Active now", refresh 5s

```
[Uploader.js]  --POST /api/upload-progress-->  [Store: Vercel KV lub plik JSON]
                                                      ↑
[Admin /admin]  --GET /api/admin/active-->  odczyt store
```

**Payload heartbeat (co 10 s podczas uploadu):**
```json
{
  "sessionId": "uuid",
  "token": "StudioAlfa",
  "uploaderName": "Jan Kowalski",
  "uploaderEmail": "jan@studio.pl",
  "folderId": "abc123",
  "files": [
    { "name": "raw_001.mov", "size": 5368709120, "progress": 47, "status": "uploading" },
    { "name": "raw_002.mov", "size": 3221225472, "progress": 100, "status": "completed" }
  ],
  "updatedAt": "2026-09-09T12:34:56Z"
}
```

**Store — opcje:**

| Opcja | Koszt | Trwałość | Złożoność |
|---|---|---|---|
| **In-memory Map** (jak rate limiter) | $0 | ginie przy cold start Vercel | minimalna |
| **Vercel KV** (Redis) | ~$0–5/mies. | 24h TTL | niska |
| **Upstash Redis** (marketplace) | podobnie | konfigurowalny TTL | niska |
| **Plik na Drive** (`_progress.json`) | $0 | trwały | średnia (wolniejszy) |

**Rekomendacja:** Vercel KV z TTL 24h — sesje starsze niż doba znikają automatycznie.

**Admin dashboard (Faza A + B):**
- sekcja **„Aktywne teraz"** — sesje z heartbeat < 30 s temu, pasek postępu per plik
- sekcja **„Historia"** — foldery z Drive (Faza A)
- auto-refresh co 5 s (polling) lub SSE

**Zmiany w kliencie (`Uploader.js`):**
- `setInterval` co 10 s → `POST /api/upload-progress` (tylko gdy `status === 'uploading'`)
- `sessionId = crypto.randomUUID()` na start uploadu

**Zabezpieczenie endpointu progress:**
- wymaga ważnego `x-upload-token` (jak pozostałe API)
- rate limit: **8 req/min** per `sessionId`
- walidacja `folderId` przez `isSessionFolder`

---

### Faza C: „Token Manager" ✅ Wdrożone lokalnie

**Idea:** Zarządzanie klientami bez edycji env — store w `_uploader_tokens.json` na Google Drive.

**Wdrożone:**
- `src/lib/tokenStore.js` — registry na Drive + cache 30s
- `src/app/api/admin/tokens/route.js` — GET lista, POST tworzenie
- `src/app/api/admin/tokens/[id]/route.js` — PATCH revoke / restore
- `src/components/AdminTokenManager.js` — UI w `/admin`
- `verifyUploadToken()` czyta ze store (env tylko gdy Drive niedostępny)
- Bootstrap: pierwsze uruchomienie importuje `UPLOAD_TOKENS` → plik na Drive

**Jeszcze nie wdrożone (Faza C+):**
- statystyki per klient (wolumen, ostatnia aktywność)
- alert stuck upload > X godzin
- edycja istniejącego tokena (nazwa, data ważności) — tylko create/revoke/restore

---

## Kolejność wdrożenia — zrealizowane lokalnie

```
✅ Security hardening (VULN-01–07)
✅ Faza A: /admin — historia sesji Drive
✅ Faza B: live progress heartbeat (in-memory store)
✅ Faza C: token manager na Drive (_uploader_tokens.json)
✅ OAuth scope test w /admin
✅ Faza 3 uploadu: build-structure + _manifest.json

⏳ Następny krok: deploy na Vercel (maintenance window)
   patrz checklist w wdrozenie_security_hardening.md

🔮 Po deployie (opcjonalnie):
   └── Vercel KV dla progress store
   └── Admin C+: metryki, stuck alerts, edycja tokenów
   └── Recovery UI: rebuild z _manifest.json
```

---

## Mockup UI (Faza A + B)

```
┌─────────────────────────────────────────────────────────┐
│  🔒 Admin — Drive Uploader                    [Logout]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ▶ AKTYWNE TERAZ (2)                    odśwież: 5s    │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Studio Alfa · jan@studio.pl                      │   │
│  │ raw_footage_001.mov  ████████░░░░  67%  3.2 GB  │   │
│  │ raw_footage_002.mov  ████████████ 100%  1.8 GB  │   │
│  │ raw_footage_003.mov  ██░░░░░░░░░░  12%  4.1 GB  │   │
│  │                              [Otwórz folder ↗]   │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Projekt Beta · anna@firma.pl                     │   │
│  │ final_cut_v3.mp4     ██████████░░  82%  12 GB   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ■ HISTORIA (ostatnie 7 dni)                           │
│  ┌──────────┬──────────────┬───────┬────────┬────────┐ │
│  │ Klient   │ Folder       │ Pliki │ Rozmiar│ Data   │ │
│  ├──────────┼──────────────┼───────┼────────┼────────┤ │
│  │ Studio A │ Jan - jan@…  │  14   │ 48 GB  │ wczoraj│ │
│  │ Retainer │ Anna - ann@… │   3   │  2 GB  │ 3 dni  │ │
│  └──────────┴──────────────┴───────┴────────┴────────┘ │
│                                                         │
│  ■ TOKENY (Faza C)                                     │
│  StudioAlfa · retainer · aktywny · [Revoke]            │
│  ProjektBeta · jednorazowy · aktywny · [Revoke]        │
│  [+ Dodaj token]                                       │
└─────────────────────────────────────────────────────────┘
```

---

## Decyzje — stan po wdrożeniu lokalnym

Poniżej: decyzje projektowe podjęte (lub domyślnie zaakceptowane) przy implementacji konsoli admina i powiązanych funkcji. Każda zawiera **wybór**, **uzasadnienie**, **implementację w kodzie** oraz **kiedy wrócić do tematu**.

---

### 1. Store na live progress (Faza B)

| | |
|---|---|
| **Wybór** | **In-memory `Map`** (`src/lib/progressStore.js`) |
| **Odrzucone** | Vercel KV, Upstash Redis, plik `_progress.json` na Drive |
| **Uzasadnienie** | Zero kosztów, zero nowych env, zero zależności npm. Przy jednym studiu i umiarkowanej liczbie równoległych uploadów wystarczy na start. Heartbeat to dane efemeryczne — nie muszą przetrwać restartu serwera. |
| **Implementacja** | TTL sesji: **24 h**. Aktywna sesja = heartbeat **< 30 s** temu + `sessionStatus: uploading`. Ukończone sesje widoczne jeszcze **2 min** w „Active now". Rate limit heartbeat: **8 req/min** per `sessionId`. |
| **Ograniczenie na Vercel** | Serverless = wiele instancji + cold start → admin może **nie widzieć** uploadu, jeśli heartbeat trafi na inną instancję niż `/api/admin/active`. Przy 1–2 równoległych uploadach zwykle OK; przy skali rośnie problem. |
| **Kiedy zmienić** | Po deployie, jeśli „Active now" regularnie pokazuje pustkę mimo trwającego uploadu → migracja na **Vercel KV** (TTL 24h, ten sam payload). Szacunek: ~$0–5/mies. |

---

### 2. Autoryzacja admina (`/admin`)

| | |
|---|---|
| **Wybór** | Pojedyncze hasło **`ADMIN_SECRET`** w env |
| **Odrzucone** | NextAuth, Google Login admina, lista dozwolonych emaili |
| **Uzasadnienie** | Jeden operator (studio). Brak multi-user, brak rejestracji — zgodnie z filozofią „zero tarcia" dla klientów. Hasło z env to ten sam wzorzec co reszta projektu (OAuth w env, tokeny w env jako fallback). |
| **Implementacja** | Login: `POST /api/admin/login` → porównanie hasła (`timingSafeEqual`) → cookie **`admin_session`** (httpOnly, secure w prod, sameSite strict, **24 h**). Wartość cookie = HMAC(`ADMIN_SECRET`, `'admin-session-v1'`) — hasło nie trafia do cookie w plaintext. Skrypty/API: nagłówek **`x-admin-secret`** = surowe `ADMIN_SECRET`. Brak `ADMIN_SECRET` → wszystkie `/api/admin/*` zwracają 401. |
| **Produkcja** | Ustaw **silne, unikalne** hasło (min. 20 znaków). Nie używaj `admin-local-dev`. |
| **Kiedy zmienić** | Gdy panel ma obsługiwać **wielu użytkowników** (asystent, współwłaściciel) lub wymagany jest audit *kto* zrevokował token → NextAuth + Google Workspace albo magic link. |

---

### 3. Token klienta w widoku „Active now"

| | |
|---|---|
| **Wybór** | **Tak — token jest zapisywany i wyświetlany** w sekcji aktywnych uploadów |
| **Początkowy plan** | „Token nie jest logowany" (wymagania z początku projektu) |
| **Stan faktyczny** | Heartbeat wysyła `token` z nagłówka `x-upload-token`; `AdminDashboard` pokazuje `· token: StudioAlfa` przy aktywnej sesji. |
| **Uzasadnienie zmiany** | Przy wielu retainerach jednocześnie admin musi wiedzieć, **który link** uploaduje — bez tego widać tylko email i nazwę z formularza (może być mylące). |
| **Ryzyko** | Token w panelu admina to OK (chroniony `ADMIN_SECRET`). Token **nie** trafia do logów serwera ani maili. |
| **Backlog** | Powiązanie sesji z **clientName** z rejestru tokenów (czytelniejsza etykieta niż surowy slug). Statystyki per token (Faza C+). |

---

### 4. Retencja danych progress

| | |
|---|---|
| **Wybór** | **24 h TTL** w pamięci; brak archiwum heartbeat |
| **Uzasadnienie** | Progress to dane operacyjne „tu i teraz". Historia uploadów i tak jest na **Drive** (Faza A) + **email admina** po zakończeniu. Nie duplikować danych. |
| **Wyjątek** | Sesje `completed` widoczne w „Active now" przez **2 min** po ostatnim heartbeat — żeby admin zdążył zobaczyć 100% bez mrugnięcia. |
| **Kiedy zmienić** | Jeśli potrzebujesz wykresów „upload w czasie" lub alertów stuck > X h → persystentny store (KV) + job czyszczący. |

---

### 5. Rejestr tokenów klientów (Faza C)

| | |
|---|---|
| **Wybór** | Plik **`_uploader_tokens.json`** na Google Drive (w głównym folderze uploadów) |
| **Odrzucone** | Edycja tylko `UPLOAD_TOKENS` w env, Vercel KV, Postgres/Neon |
| **Uzasadnienie** | Revoke **natychmiastowy** bez redeploy. Jeden źródłowy magazyn obok danych klientów. Brak dodatkowej bazy. Cache 30 s w pamięci procesu. |
| **Bootstrap** | Pierwsze `/admin` → tokens lub pierwszy upload: import z **`UPLOAD_TOKENS`** env → utworzenie pliku na Drive. Potem **panel admina = źródło prawdy**; env tylko fallback gdy Drive niedostępny. |
| **Operacje** | Create, revoke, restore, copy link (`PUBLIC_UPLOAD_URL` + `?token=`). Brak edycji nazwy/expiry (Faza C+). |
| **Kiedy zmienić** | Przy >100 tokenów lub potrzebie SQL/query → Neon lub KV; na razie JSON na Drive wystarczy. |

---

### 6. Odświeżanie UI admina (polling vs SSE)

| | |
|---|---|
| **Wybór** | **Polling HTTP** — „Active now" co **5 s**, „History" co **60 s** |
| **Odrzucone** | Server-Sent Events, WebSocket |
| **Uzasadnienie** | Prostota na serverless Vercel. Brak utrzymanych połączeń. Przy 1 adminie i kilku sesjach obciążenie znikome. |
| **Kiedy zmienić** | Przy wielu równoczesnych adminach lub potrzebie sub-sekundowego refresh → SSE na dedykowanym route. |

---

### 7. Historia sesji — skąd dane (Faza A)

| | |
|---|---|
| **Wybór** | **Bezpośredni odczyt Google Drive** — lista podfolderów `GOOGLE_DRIVE_FOLDER_ID` |
| **Uzasadnienie** | Drive jest source of truth. Zero synchronizacji. Folder sesji = `Imię - email@firma.pl`. Widać liczbę plików, rozmiar, datę modyfikacji, link. |
| **Ograniczenie** | Plik pojawia się na liście dopiero po **100% uploadu** (resumable upload). W trakcie — tylko Faza B (heartbeat). |
| **Kiedy zmienić** | Jeśli potrzebny filtr per token lub wyszukiwarka → indeks w KV/DB budowany z notify webhook. |

---

### 8. Diagnostyka OAuth (poza konsolą, ale w `/admin`)

| | |
|---|---|
| **Wybór** | Wspólna lib `checkOAuthScopes.js` + **CLI** (`npm run check-oauth-scopes`) + **przycisk w `/admin`** |
| **Uzasadnienie** | VULN-05 wymaga weryfikacji przed deployem. Admin nie powinien używać terminala na produkcji. Test `files.get` na root folderze = informacyjny (normalne przy `drive.file`). |
| **Deploy** | Po Publish app w Google Cloud → nowy refresh token → Vercel env → test Pass w panelu. |

---

### 9. Powiązane decyzje spoza panelu (wpływ na admina)

| Temat | Wybór | Wpływ na `/admin` |
|---|---|---|
| Rate limiting | In-memory per IP | Te same ograniczenia serverless co progress store |
| Upload token verify | Drive registry + env fallback | Revoke w panelu natychmiast blokuje klienta |
| Walidacja tokena w UI | `POST /api/validate-token` | Revoked link nie pokazuje formularza — mniej „fałszywych" sesji |
| Faza 3 struktury | `_manifest.json` w folderze sesji | Backlog: przycisk „Rebuild structure" w adminie |

---

### 10. Decyzje odłożone (backlog — świadomy brak implementacji)

| Temat | Dlaczego odłożone | Trigger do implementacji |
|---|---|---|
| **Vercel KV** dla progress | Koszt/złożoność vs korzyść na start | „Active now" niestabilne po deployie |
| **NextAuth** dla admina | Jeden użytkownik | Wielu operatorów studia |
| **Metryki per token** (Faza C+) | Wymaga agregacji z Drive/notify | >10 klientów retainer |
| **Alert stuck upload** (>X h) | Brak persystentnego store + cron | Po KV |
| **Recovery UI** z `_manifest.json` | Rzadki edge case | Pierwszy incydent przerwanego build-structure |
| **Edycja tokena** (rename, expiry) | Create/revoke/restore wystarcza | Prośba operacyjna |
| **Audit trail** (kto revoke) | Brak multi-user | NextAuth |

---

### Podsumowanie decyzji (skrót)

| # | Decyzja | Wybór |
|---|---|---|
| 1 | Progress store | In-memory, TTL 24h → KV opcjonalnie |
| 2 | Auth admina | `ADMIN_SECRET` + cookie 24h |
| 3 | Token w „Active now" | **Wyświetlany** (audit operacyjny) |
| 4 | Retencja progress | 24h + 2 min po completed |
| 5 | Registry tokenów | `_uploader_tokens.json` na Drive |
| 6 | Refresh UI | Polling 5s / 60s |
| 7 | Historia | Odczyt Drive API |
| 8 | OAuth test | CLI + panel admina |
| 9 | Manifest / struktura | `_manifest.json`; recovery UI — backlog |

---

## Zależności techniczne

| Faza | Nowe env | Nowe zależności npm | Zmiany w Uploader.js |
|---|---|---|---|
| A | `ADMIN_SECRET` | brak | brak |
| B | `ADMIN_SECRET` + Vercel KV env | `@vercel/kv` (opcjonalnie) | heartbeat co 10s |
| C | + store config | `@vercel/kv` lub `@neondatabase/serverless` | brak (tylko admin UI) |
