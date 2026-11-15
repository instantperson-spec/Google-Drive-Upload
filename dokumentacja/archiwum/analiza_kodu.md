# Analiza Kodu — Drive Uploader

> Produkt live · branch `security-fixes` gotowy do merge · Ostatnia analiza: 2026-09-09

> **Status wdrożeń:**
> - `security-hardening` — naprawione P0/P1 (auth, rate limit, SMTP, OAuth scope, noindex, PII logging)
> - `security-fixes` — optymalizacja Vercela (Live Monitor, per-plik heartbeat, email whitelist, rate limit upload-progress)

---

## TL;DR

Projekt jest **mały, ale dobrze przemyślany koncepcyjnie**. Główne problemy nie wynikają z błędów logicznych, lecz z naturalnych konsekwencji szybkiego prototypowania: duplikacji pomocniczego kodu, braku warstwy abstrakcji i kilku niedomknięć bezpieczeństwa, które stają się istotne gdy spojrzymy na planowane funkcje (tokeny URL, walidacja plików).

---

## 1. Duplikacja Kodu — Aktualna

### `formatDate()` — zdefiniowana 2× w komponentach

| Plik | Status |
|---|---|
| [`AdminDashboard.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/components/AdminDashboard.js#L7) | Lokalna kopia |
| [`AdminTokenManager.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/components/AdminTokenManager.js#L5) | Lokalna kopia |

Istnieje `lib/formatBytes.js` (shared) — brakuje analogicznego `lib/formatDate.js`. Obydwa komponenty definiują identyczną funkcję.

---

### `formatBytes()` — zdefiniowana lokalnie + importowana z lib

`AdminDashboard.js` L15 definiuje lokalną kopię zamiast importować z `@/lib/formatBytes`. Serwer API (`admin/sessions`, `admin/active`) poprawnie importuje z lib.

---

### Email regex — powielony 3×

Identyczny wzorzec `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` w:
- `notify/route.js` L20
- `create-folder/route.js` L25  
- `tokenStore.js` L247

Istnieje `lib/validation.js` — naturalne miejsce dla `isValidEmail()`. Funkcja z `notify/route.js` ma dodatkowo limit długości 254 (RFC) — ta wersja powinna być kanoniczna.

---

### ~~`getAuthClient()` — skopiowana 3 razy~~ ✅ Naprawione

Wyodrębniony wspólny `lib/googleAuth.js`.

---

## 2. Bezpieczeństwo — Stan Po Naprawach

| VULN | Problem | Status |
|---|---|---|
| VULN-01 | Brak auth na API | ✅ Naprawione — token server-side |
| VULN-02 | Open SMTP relay | ✅ Naprawione — email whitelist vs. `prefillEmail` |
| VULN-03 | Błąd SMTP `secure` | ✅ Naprawione — `smtpPort === 465` |
| VULN-04 | Brak rate limitingu | ✅ Naprawione — wszystkie endpointy |
| VULN-05 | Nadmierny OAuth scope | ✅ Naprawione — tylko `drive.file`, potwierdzone skanem |
| VULN-06 | Logowanie PII | ✅ Naprawione — tylko metadane diagnostyczne |
| VULN-07 | Brak noindex | ✅ Naprawione — metadata Next.js |
| VULN-08 | Nieweryfikowany email klienta | ⚠️ Celowo pominięte — akceptowane ryzyko dla narzędzia B2B |

Szczegóły każdego VULN: [`analiza_bezpieczenstwa.md`](./analiza_bezpieczenstwa.md)

---


## 3. Jakość Kodu i Drogi na Skróty

## 3. Jakość Kodu i Drogi na Skróty

### ~~Inline styles — 451 linii, ~60% to style~~ ✅ Refaktor 2026-09-09

[`Uploader.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/components/Uploader.js) rozbity na hooki + komponenty w `src/components/upload/`; style przeniesione do `globals.css` (klasy `.upload-*`, `.glass-input`). Jedyny pozostały inline: dynamiczna szerokość paska postępu (`width: N%`).

### Inline styles pozostałe — AdminDashboard.js

Komponent admina zawiera kilka bloków inline, które powinny być klasami CSS:

| Linia | Styl | Problem |
|---|---|---|
| L74 | `maxHeight: '250px', overflowY: 'auto'` | Powinno być klasą `.admin-active-files` |
| L93 | `borderTop: '1px solid rgba(255,255,255,0.1)'` | Hardcoded design token — powinien być CSS var |
| L104-113 | Cały blok `.admin-terminal` | 8 properties inline, naturalny kandydat na klasę |
| L123 | `color: 'rgba(255,255,255,0.35)'` | Hardcoded opacity bez CSS var |
| L86 | `width: ${f.progress}%` | ✅ Uzasadniony — dynamiczna wartość |

`AdminTokenManager.js` L259: `display: 'flex', gap: '5px'` na `<td>` — powinno być klasą.

---

### `key={index}` w liście plików

Linia 391: `<li key={index} ...>`. Użycie indeksu tablicy jako klucza React to antypattern, gdy lista może być modyfikowana (a jest — `removeFile(index)` usuwa elementy). React może źle odgadnąć tożsamość elementu przy rerenderze, co prowadzi do błędów UI (np. pokazanie progress baru usuniętego pliku na nowym elemencie).

**Rozwiązanie:** Dodać `id: crypto.randomUUID()` przy dodawaniu pliku, używać jako klucza.

---

### `removeFile` używa zewnętrznej wartości `files`

Linia 77:
```js
const removeFile = (indexToRemove) => {
  setFiles(files.filter((_, index) => index !== indexToRemove));
};
```

Zamiast używać funkcyjnej aktualizacji stanu (`prev => ...`), odwołuje się do zamkniętej wartości `files`. W teorii może prowadzić do wyścigów stanu — jeśli dwa zdarzenia trafią w tym samym cyklu renderowania. Spójne z resztą kodu (gdzie `updateFileState` prawidłowo używa `prev =>`), ale ta funkcja jest niespójna.

---

### Sesja w `localStorage` — model kolizji

Sesja jest zapisywana pod stałym kluczem `drive_uploader_session`. Jeśli ten sam klient otworzy dwie karty przeglądarki i rozpocznie dwa różne uploady, obie karty nadpiszą sobie nawzajem sesję. W kontekście docelowym (klient wideoowy, duże pliki) to realny przypadek użycia.

---

### `parseInt(df.size)` bez walidacji

Linia 186:
```js
const exists = existingDriveFiles.find(df => df.name === fObj.name && parseInt(df.size) === fObj.size);
```

Google Drive API może zwrócić `size` jako `null` dla folderów lub plików Google Docs. `parseInt(null)` = `NaN`, a `NaN === fObj.size` = `false` — brak awarii, ale logika porównania cicho się nie wykona. Bezpieczniej: `Number(df.size) === fObj.size`.

---

### `secure: process.env.SMTP_PORT === '465'` — błąd logiki

Linia 32 w [`notify/route.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/app/api/notify/route.js):
```js
port: parseInt(process.env.SMTP_PORT || '465'),
secure: process.env.SMTP_PORT === '465', 
```

Jeśli `SMTP_PORT` nie jest ustawiony, `parseInt('465')` = 465 (port SSL), ale `process.env.SMTP_PORT === '465'` = `false` (bo `undefined !== '465'`). Wynik: połączenie SMTP próbuje SSL na porcie 465, ale z `secure: false` — co skutkuje błędem SMTP lub niezaszyfrowanym połączeniem w zależności od serwera.

**Rozwiązanie:**
```js
const smtpPort = parseInt(process.env.SMTP_PORT || '465');
secure: smtpPort === 465,
```

---

### `console.log('Received notification data:', data)` w produkcji

Linia 7 [`notify/route.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/app/api/notify/route.js): Loguje pełne dane żądania (imię, email, lista plików) do logów serwera produkcyjnego. W Vercel te logi są dostępne dla całego teamu, a dane osobowe klientów (RODO) nie powinny być logowane bez potrzeby.

---

### Brak `noindex` w `<head>` (kierunki rozwoju)

Layout nie zawiera `<meta name="robots" content="noindex">`. To jeden z pierwszych punktów z `kierunki_rozwoju.md`, ale jest jeszcze nieimplementowany — strona jest indeksowalna przez Google.

---

## 4. Architektura i Skalowalność

### Jeden monolityczny komponent — 451 linii

### ~~God object Uploader.js~~ ✅ Refaktor 2026-09-09

Podział wdrożony:
- **Hooki:** `useUploadToken`, `useUploadSession`, `useFileQueue`, `useUploadHeartbeat`, `useUploadRunner`
- **Lib:** `blocklist.js`, `apiErrors.js`, `chunkUpload.js`
- **Komponenty:** `UploadStatusScreens`, `UserDetailsForm`, `SessionResumeBanner`, `UploadDropZone`, `UploadFileList`
- **`Uploader.js`** (~170 linii) — orchestrator UI

---

### Powiadomienie (notify) — fire-and-forget bez gwarancji

Linia 257:
```js
fetch('/api/notify', { ... }).catch(err => console.error('Notification failed:', err));
```

Wywołanie jest asynchroniczne i ignorowane — jeśli serwer notification padnie, admin nie dowie się o uploadzie. Nie istnieje żaden fallback, retry, ani kolejka. Dla narzędzia produkcyjnego B2B, gdzie powiadomienie jest krytyczną funkcją biznesową, to istotna luka.

---

### `create-folder` nie sprawdza duplikatów

Każde wywołanie `/api/create-folder` tworzy nowy folder, nawet jeśli folder dla danego `uploaderName - uploaderEmail` już istnieje. Ponowne przesłanie pliku przez tego samego klienta (np. po wyczyszczeniu localStorage) tworzy drugi folder `Jan Kowalski - jan@test.pl (2)` — lub dwa foldery o identycznej nazwie. Na Google Drive nie ma ograniczenia unikalności nazw.

---

### Scope OAuth za szeroki

Linia 23/27 (wszystkie trasy): scope `https://www.googleapis.com/auth/drive` to dostęp do **całego Drive** konta serwisowego. Wystarczyłby `drive.file` (dostęp tylko do plików stworzonych przez aplikację). Zasada minimalnych uprawnień — jeśli credentials wyciekną, zakres szkód jest większy niż konieczny.

---

## 5. Korelacja z Kierunkami Rozwoju

| Planowana Funkcja | Wpływ na istniejące problemy |
|---|---|
| **Token URL** (`?token=NazwaProjektu`) | Wymaga weryfikacji po stronie **serwera** — samo dodanie do URL nic nie daje jeśli API nie sprawdza tokena |
| **Czarna lista rozszerzeń** | Powinna być po stronie **serwera** (`/api/upload-session`), nie tylko frontendu — inaczej bypassowalna |
| **Pole "Notatki"** | Doda kolejny parametr do `notify` — wzmocni ryzyko spoofingu jeśli brak autoryzacji |
| **Przekierowanie po sukcesie** | Trywialne w implementacji, nie rodzi nowych problemów |
| **Alert o "drobnicach"** | Wymaga dostępu do `webkitRelativePath` — już odczytywany w `addFiles`, można liczyć pliki |
| **Struktura podfolderów (Faza 3)** | ✅ Wdrożone — `/api/build-structure`, flat upload, `_manifest.json` |
| **Manifest `_manifest.json`** | ✅ Zapisywany po build-structure; recovery UI w adminie — backlog |
| **Zagnieżdżone foldery w UI** | ✅ `collectFolderFiles.js` — showDirectoryPicker + rekurencyjny DnD |

---

## Podsumowanie Priorytetów — Stan Aktualny

| Priorytet | Problem | Status |
|---|---|---|
| ~~🔴 P0~~ | Brak auth na endpointach API | ✅ Naprawione |
| ~~🔴 P0~~ | Błąd logiki SMTP `secure` | ✅ Naprawione |
| ~~🟡 P1~~ | `getAuthClient` powielony 3× | ✅ Naprawione — `lib/googleAuth.js` |
| 🟡 P1 | `formatDate` / `formatBytes` powielone w komponentach | ⏳ Backlog — przenieść do `lib/` |
| 🟡 P1 | Email regex powielony 3× | ⏳ Backlog — `lib/validation.js` → `isValidEmail()` |
| ~~🟡 P1~~ | `console.log` danych osobowych w produkcji | ✅ Naprawione |
| 🟢 P2 | `key={index}` w liście plików | ⏳ Backlog |
| 🟢 P2 | Inline styles w AdminDashboard / AdminTokenManager | ⏳ Backlog |
| ~~🟢 P2~~ | `noindex` meta tag | ✅ Naprawione |
| ~~🟢 P3~~ | Scope OAuth zbyt szeroki | ✅ Naprawione — `drive.file` only |
| 🟢 P3 | `removeFile` bez functional update | ⏳ Backlog |
| 🟢 P3 | Rate limit upload-progress zbyt ciasny (429 przy burst) | ✅ Naprawione — 500/min |
| 🟢 P3 | Heartbeat Vercel invocations — przekraczał limit | ✅ Naprawione — Live Monitor + per-plik |
