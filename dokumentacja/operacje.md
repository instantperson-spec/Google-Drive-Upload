# Operacje: tokeny, linki uploadu i share

> Status: produkcyjny workflow · źródło prawdy tokenów: `_uploader_tokens.json` na Drive (`/admin` → Client tokens)  
> Aktualizacja: 2026-11-16

---

## Dwa rodzaje linków

| Link | Do czego | Auth |
|---|---|---|
| `https://DOMENA/?token=Nazwa` | Clip / retainer upload (shareable) | Token uploadu |
| `https://DOMENA/share/<id>` | Portal jednego projektu: rundy, pobieranie, dogrywki | ID share (bez `?token=`) |
| `https://DOMENA/client` | Hub klienta: lista projektów + nowy upload | **Email + hasło** (cookie) |

Share tworzy **Studio Console** (**Opublikuj** albo „Wyślij link”) — nie panel `/admin`.

### Hasło vs token vs hub-bound

| Credential | Loguje do `/client`? | Upload? | Udostępniać? |
|---|---|---|---|
| **Hasło hubu** | Tak (sesja `client_hub_session`) | Tak — przez sesję | Tylko klientowi (invite) |
| **Token clip/retainer** (`/?token=`) | **Nie** | Tak | Tak — Copy link w `/admin` |
| **Hub-bound** (auto przy signup) | **Nie** | Tylko po loginie hubu | **Nie** — brak Copy link; `/?token=` → 401 |

Hub-bound to wewnętrzne powiązanie konta z uprawnieniem uploadu (flaga `hubBound` / linkedToken). **Nie jest drugim loginem** i nie wolno go wysyłać jako link.

Produkcja (domyślna): `https://drive-uploader-three.vercel.app`

---

## Dwa typy klientów

| Typ | Kiedy | Wejście |
|---|---|---|
| **Clip-only** | Pojedyncze klipy / jednorazowy drop | `/?token=…` i ewentualnie `/share/…` jak dziś |
| **Project client** | Stała współpraca, wiele projektów | Konto w `/admin` → Client hub → login `/client` |

### Hub klienta (`/client`) — tylko po zaproszeniu

1. **`/admin` → Client hub → Invite client`**: email + `lang` + opcjonalnie **Send email** (SMTP).  
   Dostajesz URL (kopiowany) np.  
   `https://DOMENA/client?invite=<token>&signup=1&lang=pl`
2. Klient otwiera link → zakładka signup, język z `lang`, email **zablokowany** na adres z invite.
3. Po rejestracji: konto + **hub-bound** linked token (session-only, bez `/?token=`); invite zużyty (jednorazowy, TTL 7 dni).
4. Powrót klienta: `https://DOMENA/client?login=1&lang=en` (deep-link UI, bez sekretu).
5. Bez `invite` — signup niedostępny (API 403). Login bez zmian.
6. Admin: lista kont, Suspend / Restore, Password, Assign, Delete; pending invites: New URL + copy, Resend mail, Revoke.

Query (publiczne, tylko UX): `lang=en|pl|eng`, `login=1`, `signup=1` (+ `invite`).

Plik: `_uploader_clients.json` (`clients`, `memberships`, `invites`). Sesja: `client_hub_session`.

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
