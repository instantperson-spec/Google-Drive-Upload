# Operacje: tokeny, linki uploadu i share

> Status: produkcyjny workflow · źródło prawdy tokenów: `_uploader_tokens.json` na Drive (`/admin` → Client tokens)  
> Aktualizacja: 2026-11-16

---

## Dwa rodzaje linków

| Link | Do czego | Auth |
|---|---|---|
| `https://DOMENA/?token=Nazwa` | Pierwszy upload materiałów od klienta | Token uploadu |
| `https://DOMENA/share/<id>` | Portal: rundy, pobieranie, dogrywki (`FromClient/`) | ID share (bez `?token=`) |

Share tworzy **Studio Console** (**Opublikuj** albo „Wyślij link”) — nie panel `/admin`. Upload token **nie** otwiera pobierania.

Produkcja (domyślna): `https://drive-uploader-three.vercel.app`

---

## Upload: jak działa token

```
https://DOMENA/?token=NAZWA_TOKENA
```

- **Bez tokena** — ekran „Access link required”, API → 401.
- **Z tokenem** — formularz + upload; weryfikacja **server-side** na każdym API.
- Token **nie wygasa sam** — revoke ręcznie w `/admin`.
- Język UI (PL/EN) zależy od locale tokena w `/admin`.

| Typ klienta | Strategia |
|---|---|
| Projekt jednorazowy | Token po projekcie → **Revoke** w `/admin` po zakończeniu |
| Retainer | Stały token; ten sam link latami |
| Wiele projektów u jednego klienta | Jeden token; foldery sesji rozróżnia nazwa projektu / email / data |

### UX uploadu (klient)

- **Nazwa projektu** jest wymagana (min. 2 znaki).
- Przy długiej liście plików przycisk Start zostaje widoczny (sticky).
- Po sukcesie: opcjonalnie **Otwórz w Google Drive** (folder sesji).

---

## Procedura: nowy klient (upload)

### 1. Utwórz token

**`/admin` → Client tokens → + New token`** → **Copy link**.

Zasady nazwy: bez spacji; litery, cyfry, `-`, `_`; bez NIP / pełnej nazwy firmy w tokenie.  
**Wymagany `prefillEmail`** — używany do whitelist `/api/notify` oraz maila po **Opublikuj**.

### 2. Bootstrap env (tylko raz / awaryjnie)

`UPLOAD_TOKENS` = fallback, gdy Drive store niedostępny. Po `_uploader_tokens.json` **admin jest źródłem prawdy**.

### 3. Wyślij link uploadu

```
Temat: Link do przesyłania materiałów — [Studio]

Cześć [Imię],

https://DOMENA/?token=StudioAlfa

1. Otwórz w Chrome (zalecane) lub Firefox.
2. Wpisz nazwę projektu (wymagane).
3. Tożsamość: jeśli link ma zapisane dane — widać je od razu; inaczej wpisz imię i email.
4. Przeciągnij pliki / folder → Rozpocznij upload.
```

### 4. Po projekcie jednorazowym

**`/admin` → Revoke`** — bez redeploy.

---

## Delivery: Sync → Opublikuj → share → mail

1. Studio Console: **Pobierz** → **Sync** (roboczy).  
2. **Wyślij zmiany** — zapisuje snapshot delty w `_team_manifest.json` (wewnętrznie), upsert share; klient widzi „od ostatniego odesłania”, bez galerii wersji.  
3. **Dogrywka klienta** (portal → `FromClient/<timestamp>__id/`) → mail na `NOTIFICATION_EMAIL` (studio) z id batcha. Klient dostaje summary **tylko** gdy token ma `prefillEmail` (jak przy uploadzie).  
3. Link `https://DOMENA/share/<id>` (kopiowany).  
4. Mail do `prefillEmail` tokenu — jeśli w `.env.local` Console jest `ADMIN_SECRET` (= Vercel) i SMTP na Vercel.  
   Endpoint: `POST /api/share/<id>/notify-client` (auth: `x-admin-secret`).  
5. Klient: portal z filtrem **od publikacji** / KPI; pobieranie plik-po-pliku; dogrywki w **batchach czasowych** (`FromClient/YYYY-MM-DD_HH-mm__xxxx/` — jedno wrzucenie = jeden batch). Stare płaskie pliki = „Wcześniejsze (bez grupy)”.  
6. Studio: Out of sync → lista batchy + **Pobierz ten batch** / **Pobierz wszystkie** (lokalnie zachowana struktura `FromClient/<batchId>/…`).

Revoke share w Console → portal niedostępny; upload token bez zmian.

Pobieranie: domyślnie **plik-po-pliku** (`showDirectoryPicker`, Chrome/Edge). ZIP tylko fallback (≤40 plików / ≤500 MB) albo brak File System Access.

---

## Zarządzanie tokenami (`/admin`)

- **+ New token** / **Copy link** / **Revoke** / **Restore**
- Plik: `_uploader_tokens.json` na Drive
- `prefillEmail` → whitelist `/api/notify` + mail po Opublikuj
- History: **In progress** (heartbeat / Drive+ETag) vs **Completed**
- **Refresh all** — bez Live Monitor

Studio Console lokalnie: Sync, Opublikuj, share, tokeny — wymaga `.env.local` z Google OAuth + opcjonalnie `ADMIN_SECRET` / `PUBLIC_UPLOAD_URL`.

---

## FAQ

**Czy klient może udostępnić link uploadu?**  
Tak. Dla wrażliwych projektów: token jednorazowy + Revoke.

**Czy muszę redeploy przy nowym kliencie?**  
Nie — tylko `/admin` → New token.

**Czy `?token=` daje pobieranie od studia?**  
Nie — tylko upload. Pobieranie = `/share/<id>` po Opublikuj.

**Mail po Opublikuj nie poszedł?**  
Sprawdź: `ADMIN_SECRET` w `.env.local` Console = Vercel; SMTP na Vercel; token ma `prefillEmail`.

**Co po revoke tokena?**  
„Upload link no longer valid”.

---

## Checklist przed wysyłką

- [ ] Token aktywny w `/admin` (test incognito) + `prefillEmail`
- [ ] Testowy mały upload OK + mail admina
- [ ] Console: Sync → Opublikuj → `/share/…` otwiera listę / rundę
- [ ] (opcjonalnie) mail klienta po Opublikuj
- [ ] `PUBLIC_UPLOAD_URL` = produkcyjna domena
- [ ] OAuth: `npm run check-oauth-scopes` lub `/admin` → OAuth scope test → Pass  
  → [`oauth_drive_file.md`](./oauth_drive_file.md)
