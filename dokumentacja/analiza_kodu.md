# Analiza Kodu — Drive Uploader

> Produkt live · Okno maintenance oczekuje · Kierunki rozwoju: uwzględnione jako "planowane, nie wdrożone"

---

## TL;DR

Projekt jest **mały, ale dobrze przemyślany koncepcyjnie**. Główne problemy nie wynikają z błędów logicznych, lecz z naturalnych konsekwencji szybkiego prototypowania: duplikacji pomocniczego kodu, braku warstwy abstrakcji i kilku niedomknięć bezpieczeństwa, które stają się istotne gdy spojrzymy na planowane funkcje (tokeny URL, walidacja plików).

---

## 1. Duplikacja Kodu — Krytyczna

### `getAuthClient()` — skopiowana 3 razy

Identyczna (z drobnymi różnicami) funkcja `getAuthClient` pojawia się w każdym z trzech plików API:

| Plik | Różnica |
|---|---|
| [`create-folder/route.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/app/api/create-folder/route.js) | Brak walidacji pustych credentials (cicha awaria) |
| [`upload-session/route.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/app/api/upload-session/route.js) | Ma walidację credentials — rzuca błąd |
| [`check-folder/route.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/app/api/check-folder/route.js) | Ma walidację credentials — rzuca błąd |

**Konsekwencja praktyczna:** Zmiana logiki autoryzacji (np. odświeżanie tokena, obsługa expiry) wymaga edycji trzech niezależnych miejsc. Historia pokazuje, że takie sytuacje kończą się niespójnymi poprawkami — jedna trasa zaskakuje niezrozumiałym błędem, gdy inne działają.

**Rozwiązanie:** Wyodrębnić `lib/googleAuth.js` jako współdzielony moduł.

---

### Warunki wyłączenia przycisku — skopiowane 4 razy

W [`Uploader.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/components/Uploader.js) warunek:

```js
files.length === 0 || status === 'uploading' || !uploaderName.trim() || !uploaderEmail.trim()
```

pojawia się w linii 142 (`startUpload`), 431 (`disabled`), 438 (styl tła) i 439 (kolor tekstu), 442 (kursor). Łącznie **5 razy** ten sam warunek logiczny — rozsynchronizowanie przy zmianie reguł (np. dodanie walidacji emaila) grozi niespójnością UX.

---

## 2. Bezpieczeństwo

### 🔴 KRYTYCZNE: Brak jakiejkolwiek autoryzacji endpointów API

Każdy z 4 endpointów (`/api/create-folder`, `/api/upload-session`, `/api/check-folder`, `/api/notify`) jest w pełni publiczny. Nie istnieje żaden mechanizm weryfikacji wywołującego.

**Skutki:**

- **`/api/create-folder`** — ktokolwiek może tworzyć dowolną liczbę folderów na cudzym Google Drive, zaśmiecając przestrzeń dyskową lub wyczerpując limit API.
- **`/api/upload-session`** — można zainicjować sesję upload dla dowolnego pliku do dowolnego folderId (jeśli tylko zna się ID), a serwer podpisze to tokenem Google OAuth.
- **`/api/check-folder`** — po podaniu dowolnego `folderId` (nie tylko własnego folderu użytkownika) API zwróci listę plików z tego folderu. Jeśli atakujący odgadnie/wycieknie ID głównego folderu, zobaczy metadane wszystkich uploadów.
- **`/api/notify`** — bezwarunkowe wywołanie z fałszywymi danymi (inne imię, email, lista plików) wyśle fałszywe powiadomienie do admina i email phishingowy do ofiary.

> [!CAUTION]
> Endpoint `/api/notify` przyjmuje dowolny email jako `uploaderEmail` i wysyła na niego maila. To otwarta brama do **email spoofing / spam relay** przez cudzy serwer SMTP.

**Kontekst z kierunków rozwoju:** Planowane tokeny URL (`?token=NazwaProjektu`) są opisane jako środek bezpieczeństwa — ale bez weryfikacji tego tokena po stronie API całe zabezpieczenie istnieje tylko po stronie frontendu (co jest trivialne do obejścia przez bezpośrednie wywołanie API).

---

### 🟡 ŚREDNIE: Brak walidacji plików po stronie serwera

Kierunki rozwoju słusznie proponują "czarną listę" rozszerzeń. Aktualnie — nie istnieje żadna walidacja. Endpoint `/api/upload-session` inicjuje sesję dla absolutnie dowolnego typu pliku (`.exe`, `.sh`, `.bat`, `.php`). Wprawdzie pliki lądują na Google Drive (nie na serwerze aplikacji), ale:

1. Możliwe jest wgranie złośliwego pliku do folderu, z którego admin może go następnie pobrać.
2. Brak ograniczenia na `size` — można zainicjować upload pliku o rozmiarze np. 1 TB, wyczerpując limit Drive.

---

### 🟡 ŚREDNIE: Brak rate limitingu

Żaden endpoint nie ma ograniczenia liczby wywołań. Możliwy scenariusz: bot wysyła 1000 requestów do `/api/create-folder` → tysiąc folderów na Google Drive + wyczerpanie limitu Google API (10,000 req/day w domyślnym projekcie). Vercel nie zapewnia rate limitingu out of the box dla serverless functions.

---

### 🟡 ŚREDNIE: `uploaderEmail` jako klucz sesji bez weryfikacji

Klient wprowadza email w formularzu — ten email trafia do nazwy folderu Drive i jest adresem docelowym powiadomienia. Nie ma żadnej weryfikacji, że użytkownik faktycznie jest właścicielem podanego adresu. Każdy może wpisać `admin@klient.pl` i odebrać powiadomienie potwierdzające upload.

---

### 🟢 DOBRE: `.env.local` w `.gitignore`

`.gitignore` prawidłowo wyklucza `.env*` (z wyjątkiem `.env.example`). Klucze nie trafią do repozytorium.

---

### 🟢 DOBRE: Klucz prywatny tylko po stronie serwera

`GOOGLE_PRIVATE_KEY` / `GOOGLE_REFRESH_TOKEN` używane są wyłącznie w route handlerach (Next.js API Routes = server-side). Nie ma ryzyka wycieku do bundla klienta.

---

## 3. Jakość Kodu i Drogi na Skróty

### Inline styles — 451 linii, ~60% to style

[`Uploader.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/components/Uploader.js) to jeden z najbardziej ekstremalnych przypadków mieszania logiki z prezentacją. Dosłownie każdy element JSX ma `style={{ ... }}` z dziesiątkami właściwości CSS. Projekt ma kompletny system CSS z tokenami (`globals.css`) — ale jest używany tylko przez trzy-cztery klasy (`.btn`, `.dropzone`, `.glass-panel`), reszta jest inline.

**Skutki:** Zmiana koloru "sukcesu" z `#4ade80` wymaga edycji min. 5 niezależnych miejsc w jednym pliku. W CSS byłoby to zmienne `--success-color` (już zdefiniowane w globals.css, ale nieużywane w Uploader).

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

Cała logika aplikacji jest w jednym pliku [`Uploader.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/components/Uploader.js). Wyodrębnienie w przyszłości planowanego przycisku pauzy, alertu o "drobnicach", czy pola notatek będzie wymagało głębokiej ingerencji w już złożony komponent.

Naturalny podział:
- `useUploadSession` — hook zarządzający stanem sesji i localStorage
- `useChunkUpload` — hook z logiką chunków, retry, queryUploadStatus
- `FileList` — komponent listy plików z paskami postępu
- `DropZone` — komponent strefy upuszczania

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
| **Struktura podfolderów (Faza 3)** | Nowy endpoint `build-structure` będzie miał te same problemy z autoryzacją co pozostałe — należy zaprojektować auth przed tym krokiem |
| **Manifest `_manifest.json`** | Dobry pomysł — bez niego Faza 3 recovery jest niemożliwa po zamknięciu karty |

---

## Podsumowanie Priorytetów (przed maintenance window)

| Priorytet | Problem | Ryzyko |
|---|---|---|
| 🔴 P0 | Brak auth na endpointach API (spoofing maili, spam, waste API quota) | Produkcyjne |
| 🔴 P0 | Błąd logiki SMTP `secure` — maile mogą nie działać | Produkcyjne |
| 🟡 P1 | `getAuthClient` powielony 3× — przed rozbudową o nowe endpointy | Maintenance |
| 🟡 P1 | Brak sprawdzania duplikatów folderów w `create-folder` | UX / Data |
| 🟡 P1 | `console.log` danych osobowych w produkcji | RODO |
| 🟢 P2 | `key={index}` w liście plików | UX (rzadki bug) |
| 🟢 P2 | Inline styles vs CSS variables | Maintainability |
| 🟢 P2 | `noindex` meta tag | SEO / Security |
| 🟢 P3 | Scope OAuth zbyt szeroki | Hardening |
| 🟢 P3 | `removeFile` bez functional update | Poprawność |
