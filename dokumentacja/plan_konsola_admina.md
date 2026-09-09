# Plan: Konsola Admina — podgląd uploadów

> Status: **plan** (nie wdrożone) · Priorytet: po deploy security-hardening w maintenance window

---

## Problem

Obecnie admin dowiaduje się o uploadzie **dopiero po jego zakończeniu** — mail SMTP lub webhook Discord/Slack. W trakcie transferu (duże pliki wideo, godziny uploadu) **nie ma widoczności postępu**.

Upload odbywa się **bezpośrednio z przeglądarki klienta do Google Drive** — serwer aplikacji nie widzi przepływu bajtów. Postęp istnieje tylko w UI klienta (`Uploader.js`).

---

## Co admin potrzebuje (wymagania)

| Potrzeba | Pilność | Obecny stan |
|---|---|---|
| Lista aktywnych uploadów z % postępu | 🔴 Wysoka | Brak |
| Historia zakończonych sesji | 🟡 Średnia | Tylko email + foldery na Drive |
| Powiązanie uploadu z tokenem/klientem | 🟡 Średnia | Token nie jest logowany |
| Link do folderu sesji na Drive | 🟢 Niska | Jest w mailu admina |
| Zarządzanie tokenami (CRUD) | 🟡 Średnia | Ręcznie przez env |
| Revoke tokena bez redeploy | 🟢 Niska | Wymaga edycji env + redeploy |

---

## Architektura — 3 fazy

### Faza A: „Drive Mirror" (najmniej inwazyjna, ~1–2 dni)

**Idea:** Admin panel tylko **odczytuje Google Drive** — bez zmian w flow klienta.

```
[Admin /admin]  →  GET /api/admin/sessions  →  Google Drive API
                                              (list children of GOOGLE_DRIVE_FOLDER_ID)
```

**Co widać:**
- lista folderów sesji (`Jan Kowalski - jan@test.pl`)
- liczba plików, łączny rozmiar, data ostatniej modyfikacji
- link „Otwórz w Drive"

**Czego NIE widać:**
- upload w trakcie (plik pojawia się na Drive dopiero po 100%)
- postęp procentowy na żywo

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

### Faza B: „Progress Heartbeat" (live progress, ~2–3 dni)

**Idea:** Klient co ~10 s wysyła snapshot postępu na serwer. Admin odpytuje te dane.

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
- rate limit: 6 req/min per sesja

---

### Faza C: „Token Manager + metryki" (~3–5 dni)

**Idea:** Pełna konsola operacyjna — zarządzanie klientami bez edycji env.

**Nowe elementy:**
- CRUD tokenów w UI (zapis w Vercel KV / pliku JSON na Drive / Neon Postgres)
- mapowanie `token → nazwa klienta, typ (retainer/jednorazowy), data ważności`
- revoke tokena jednym kliknięciem (natychmiastowy, bez redeploy)
- statystyki: uploady per klient, łączny wolumen, ostatnia aktywność
- opcjonalnie: alert email gdy upload przekroczy X godzin (stuck detection)

**Migracja z env:**
- przy pierwszym uruchomieniu: import istniejących tokenów z `UPLOAD_TOKENS`
- `verifyUploadToken()` czyta z store zamiast env (env jako fallback)

---

## Proponowana kolejność wdrożenia

```
Maintenance window (teraz)
  └── deploy security-hardening (tokeny w env, auth, walidacja)

Następna iteracja (~1 tydzień po deploy)
  └── Faza A: /admin z listą folderów Drive

Kolejna iteracja (~2 tygodnie)
  └── Faza B: live progress heartbeat + Vercel KV

Przyszłość (gdy rośnie liczba klientów)
  └── Faza C: token manager, metryki, revoke bez redeploy
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

## Decyzje do podjęcia przed implementacją Fazy B/C

1. **Store na progress:** Vercel KV vs in-memory (tańsze, ale niestabilne na serverless)?
2. **Hasło admina:** jeden `ADMIN_SECRET` w env vs pełne logowanie (np. NextAuth)?
3. **Czy token ma być widoczny w panelu admina** przy aktywnym uploadzie (audit trail)?
4. **Retencja danych progress:** 24h wystarczy, czy potrzebujesz historii tygodniowej?

---

## Zależności techniczne

| Faza | Nowe env | Nowe zależności npm | Zmiany w Uploader.js |
|---|---|---|---|
| A | `ADMIN_SECRET` | brak | brak |
| B | `ADMIN_SECRET` + Vercel KV env | `@vercel/kv` (opcjonalnie) | heartbeat co 10s |
| C | + store config | `@vercel/kv` lub `@neondatabase/serverless` | brak (tylko admin UI) |
