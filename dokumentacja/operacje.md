# Operacje: tokeny, linki uploadu i share

> Status: produkcyjny workflow · źródło prawdy tokenów: `_uploader_tokens.json` na Drive (`/admin` → Client tokens)

---

## Dwa rodzaje linków

| Link | Do czego | Auth |
|---|---|---|
| `https://DOMENA/?token=Nazwa` | Pierwszy upload materiałów od klienta | Token uploadu |
| `https://DOMENA/share/<id>` | Portal: lista, pobieranie, dogrywki (`FromClient/`) | ID share (bez `?token=`) |

Share tworzy Studio Console po Sync (nie panel `/admin`). Upload token **nie** otwiera pobierania — tylko share.

---

## Upload: jak działa token

```
https://DOMENA/?token=NAZWA_TOKENA
```

- **Bez tokena** — ekran „Access link required”, API → 401.
- **Z tokenem** — formularz + upload; weryfikacja **server-side** na każdym API.
- Token **nie wygasa sam** — revoke ręcznie w `/admin`.

| Typ klienta | Strategia |
|---|---|
| Projekt jednorazowy | Token po projekcie → **Revoke** w `/admin` po zakończeniu |
| Retainer | Stały token; ten sam link latami |
| Wiele projektów u jednego klienta | Jeden token; foldery sesji rozróżnia nazwa / email / data |

---

## Procedura: nowy klient (upload)

### 1. Utwórz token

Zalecane: **`/admin` → Client tokens → + New token`** → **Copy link**.

Zasady nazwy: bez spacji; litery, cyfry, `-`, `_`; bez NIP / pełnej nazwy firmy w samym tokenie.

### 2. Bootstrap env (tylko raz / awaryjnie)

`UPLOAD_TOKENS` w env działa jako **fallback**, gdy Drive store niedostępny. Po pierwszym zapisie `_uploader_tokens.json` **panel admina jest źródłem prawdy**.

```env
UPLOAD_TOKENS="StudioAlfa,RetainerBeta"
```

Fail-closed: pusty / brak `UPLOAD_TOKENS` **i** brak registry na Drive → API odrzuca requesty.

### 3. Wyślij link uploadu

Przykład treści:

```
Temat: Link do przesyłania materiałów — [Studio]

Cześć [Imię],

https://DOMENA/?token=StudioAlfa

1. Otwórz w Chrome / Firefox.
2. Wpisz nazwę i email.
3. Przeciągnij pliki lub wybierz folder → Start Upload.

Przy przerwaniu: ten sam link + te same pliki → wznowienie od miejsca przerwania.
```

### 4. Po projekcie jednorazowym

**`/admin` → Revoke`** — bez redeploy. Nie polegaj na usuwaniu z `UPLOAD_TOKENS` (to tylko fallback).

---

## Share (portal klienta)

1. W Studio Console: Pobierz → Sync → utwórz / skopiuj share.
2. Wyślij klientowi `https://DOMENA/share/<id>` (osobny mail / Slack).
3. Klient: przegląda statusy, pobiera, dogrywa do `FromClient/`.
4. Studio: Out of sync → **Pobierz od klienta**.

Revoke share w Console → portal zwraca niedostępność; upload token klienta zostaje bez zmian.

Szczegóły produktu: [`plany/`](./plany/), backlog: [`produkt_i_backlog.md`](./produkt_i_backlog.md).

---

## Zarządzanie tokenami (`/admin`)

- **+ New token** / **Copy link** / **Revoke** / **Restore**
- Plik: `_uploader_tokens.json` w głównym folderze uploadów na Drive
- Opcjonalnie: `prefillEmail` — `/api/notify` whitelisuje email względem rejestru (ochrona przed open relay)

---

## FAQ

**Czy klient może udostępnić link uploadu?**  
Tak — to klucz do drzwi. Dla wrażliwych projektów: token jednorazowy + Revoke.

**Czy muszę redeploy przy nowym kliencie?**  
Nie — `/admin` → New token. Redeploy tylko przy zmianie OAuth / SMTP / sekretów.

**Czy `?token=` daje pobieranie od studia?**  
Nie — tylko upload. Pobieranie = `/share/<id>`.

**Co po revoke tokena?**  
Stary link uploadu: „Upload link no longer valid” (walidacja przy ładowaniu strony).

---

## Checklist przed wysyłką do klienta

- [ ] Token aktywny w `/admin` (test w incognito)
- [ ] Testowy mały upload OK + mail admina
- [ ] (Jeśli portal) share skopiowany z Console, `/share/…` otwiera listę
- [ ] `PUBLIC_UPLOAD_URL` = produkcyjna domena (linki w panelu)
- [ ] OAuth: `npm run check-oauth-scopes` lub `/admin` → OAuth scope test → Pass  
  → szczegóły: [`oauth_drive_file.md`](./oauth_drive_file.md)
