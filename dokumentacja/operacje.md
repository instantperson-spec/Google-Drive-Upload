# Operacje: tokeny, linki uploadu i share

> Status: produkcyjny workflow · źródło prawdy tokenów: `_uploader_tokens.json` na Drive (`/admin` → Client tokens)  
> Aktualizacja: 2026-11-15

---

## Dwa rodzaje linków

| Link | Do czego | Auth |
|---|---|---|
| `https://DOMENA/?token=Nazwa` | Pierwszy upload materiałów od klienta | Token uploadu |
| `https://DOMENA/share/<id>` | Portal: lista, pobieranie, dogrywki (`FromClient/`) | ID share (bez `?token=`) |

Share tworzy **Studio Console** po Sync (nie panel `/admin`). Upload token **nie** otwiera pobierania — tylko share.

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

- **Nazwa projektu** jest wymagana (min. 2 znaki) — etykieta „wymagane”; placeholder: `nowy projekt` / `new project`.
- Przy długiej liście plików przycisk Start zostaje widoczny (sticky); lista się przewija.
- Po sukcesie: opcjonalnie **Otwórz w Google Drive** (folder sesji).

---

## Procedura: nowy klient (upload)

### 1. Utwórz token

**`/admin` → Client tokens → + New token`** → **Copy link**.

Zasady nazwy: bez spacji; litery, cyfry, `-`, `_`; bez NIP / pełnej nazwy firmy w tokenie.

### 2. Bootstrap env (tylko raz / awaryjnie)

`UPLOAD_TOKENS` = fallback, gdy Drive store niedostępny. Po `_uploader_tokens.json` **admin jest źródłem prawdy**.

```env
UPLOAD_TOKENS="StudioAlfa,RetainerBeta"
```

Fail-closed: pusty env **i** brak registry → API odrzuca requesty.

### 3. Wyślij link uploadu

```
Temat: Link do przesyłania materiałów — [Studio]

Cześć [Imię],

https://DOMENA/?token=StudioAlfa

1. Otwórz w Chrome (zalecane) lub Firefox.
2. Wpisz nazwę projektu (wymagane).
3. Tożsamość: jeśli link ma zapisane dane — widać je od razu; inaczej wpisz imię i email.
4. Przeciągnij pliki / folder → Rozpocznij upload.

Przy przerwaniu: ten sam link + te same pliki → wznowienie.
```

### 4. Po projekcie jednorazowym

**`/admin` → Revoke`** — bez redeploy.

---

## Share (portal klienta)

1. Studio Console: Pobierz → Sync → utwórz / skopiuj share.  
2. Wyślij `https://DOMENA/share/<id>`.  
3. Klient widzi nagłówek **Portal projektu** / **Project portal**, nazwę projektu, KPI (Wszystkie / Twoje / Od studia / Dogrywki), pobieranie, dogrywki do `FromClient/`.  
4. Język portalu: przeglądarka `pl*` → PL, inaczej EN.  
5. Studio: Out of sync → **Pobierz od klienta**.

Revoke share w Console → portal niedostępny; upload token bez zmian.

Pobieranie: domyślnie **plik-po-pliku** do wybranego folderu (`showDirectoryPicker`, Chrome/Edge). ZIP tylko jako fallback dla małych paczek (≤40 plików / ≤500 MB) albo gdy brak File System Access.

---

## Zarządzanie tokenami (`/admin`)

- **+ New token** / **Copy link** / **Revoke** / **Restore**
- Plik: `_uploader_tokens.json` na Drive
- `prefillEmail` → whitelist w `/api/notify`
- History: **In progress** (gdy jest heartbeat) vs **Completed** (stan Drive)
- **Refresh all** — bez Live Monitor

---

## FAQ

**Czy klient może udostępnić link uploadu?**  
Tak. Dla wrażliwych projektów: token jednorazowy + Revoke.

**Czy muszę redeploy przy nowym kliencie?**  
Nie — tylko `/admin` → New token.

**Czy `?token=` daje pobieranie od studia?**  
Nie — tylko upload. Pobieranie = `/share/<id>`.

**Co po revoke tokena?**  
„Upload link no longer valid”.

---

## Checklist przed wysyłką

- [ ] Token aktywny w `/admin` (test incognito)
- [ ] Testowy mały upload OK + mail admina
- [ ] (Portal) share z Console, `/share/…` otwiera listę
- [ ] `PUBLIC_UPLOAD_URL` = produkcyjna domena
- [ ] OAuth: `npm run check-oauth-scopes` lub `/admin` → OAuth scope test → Pass  
  → [`oauth_drive_file.md`](./oauth_drive_file.md)
