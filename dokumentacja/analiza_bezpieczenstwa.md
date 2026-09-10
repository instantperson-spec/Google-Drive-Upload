# Analiza Bezpieczeństwa — Drive Uploader

> Data analizy: 2026-09-09 · Status produktu: Live · branch `security-fixes` gotowy do merge

> **Status wdrożeń (2026-09-09):**
> - VULN-01–04, 06, 07 — ✅ Naprawione w `security-hardening`
> - VULN-05 — ✅ Naprawione (token `drive.file`, potwierdzone skanem live)
> - VULN-02 (email relay) — ✅ Wzmocnione w `security-fixes` (whitelist `prefillEmail`)
> - VULN-08 — ⚠️ Celowo pominięte, akceptowane ryzyko

---

## Metodologia

Analiza obejmuje przegląd statyczny kodu źródłowego (Next.js 16 / React 19) bez dynamicznego testowania penetracyjnego. Znaleziska odniesiono do planowanych funkcji z dokumentu `kierunki_rozwoju.md` — traktowanych jako **niezaimplementowane**.

---

## Mapa Powierzchni Ataku — Stan Aktualny

```
[Publiczny Internet]
        │
        ▼
┌───────────────────────────────────────┐
│  Vercel Edge / Serverless             │
│                                       │
│  /api/create-folder  ← ✅ TOKEN AUTH   │
│  /api/upload-session ← ✅ TOKEN AUTH   │
│  /api/check-folder   ← ✅ TOKEN AUTH   │
│  /api/notify         ← ✅ TOKEN + WHITELIST EMAIL │
│  /api/admin/*        ← ✅ ADMIN PASSWORD (HttpOnly cookie) │
└──────────────┴────────────────────────┐
               │
               ▼
    Google Drive API (OAuth2 — drive.file scope only)
    SMTP Server (nodemailer — email whitelist)
    Discord/Slack Webhook
```

---

## Znalezione Podatności

---

### VULN-01 · Brak autoryzacji endpointów API

**Poziom ryzyka:** 🔴 KRYTYCZNY  
**Pliki:** wszystkie cztery `route.js`

#### Opis

Wszystkie endpointy Next.js API Routes są w pełni publiczne — brak jakiegokolwiek tokena, sesji, nagłówka API Key czy weryfikacji origin. Każde żądanie HTTP do dowolnego z tych adresów jest obsługiwane bezwarunkowo.

#### Wektory ataku i skutki

**`POST /api/create-folder`**
- Atakujący może w pętli tworzyć setki/tysiące folderów na cudzym Google Drive
- Wyczerpanie limitu Google API (domyślnie 10 000 req/dziennie dla projektu)
- Zaśmiecenie Drive uniemożliwiające normalne użytkowanie

**`POST /api/upload-session`**
- Inicjuje podpisaną sesję upload do Google Drive bez weryfikacji nadawcy
- Parametr `folderId` pochodzi w całości z requestu — można wskazać **dowolny** folder, nie tylko własny
- Serwer podpisuje żądanie tokenem OAuth i zwraca URL sesji do przekazanego folderu

**`POST /api/check-folder`**
- Przyjmuje dowolny `folderId` i zwraca listę plików z tego folderu
- Jeśli atakujący pozna lub odgadnie ID głównego folderu zbiorczego, ujawni metadane **wszystkich uploadów wszystkich klientów** (nazwy plików, rozmiary)

**`POST /api/notify`**
```json
{
  "uploaderName": "Prawdziwy Klient Sp. z o.o.",
  "uploaderEmail": "victim@client.pl",
  "files": [{ "name": "faktury_Q3.zip", "size": 1234567, "status": "completed" }],
  "folderId": "real-folder-id"
}
```
- Powyższy request wyśle fałszywy mail do `victim@client.pl` z potwierdzeniem uploadu pliku, który nigdy nie istniał
- Admin otrzyma powiadomienie o uploaderze, którym nie jest
- Jeśli SMTP jest skonfigurowany, serwer staje się **otwartym email relay** — może być użyty do wysyłki phishingu/spamu z zaufanej domeny studia

#### Kontekst z kierunków rozwoju

Dokument `kierunki_rozwoju.md` planuje tokeny URL (`?token=NazwaProjektu`) jako zabezpieczenie. **Uwaga:** Token w URL frontendu **nie chroni API** — każdy może wywołać endpoint bezpośrednio z `curl` lub Postmana, pomijając UI. Token musi być weryfikowany **w kodzie każdego route handlera**.

#### Rekomendacja

Minimum przed wdrożeniem token URL: dodać prosty shared secret jako nagłówek lub weryfikację po stronie API:

```js
// lib/verifyRequest.js
export function verifyRequest(request) {
  const secret = request.headers.get('x-upload-secret');
  if (secret !== process.env.UPLOAD_SECRET) {
    return false;
  }
  return true;
}
```

Docelowo: weryfikacja tokena z URL (`?token=...`) po stronie serwera z mapą token→projekt w zmiennych środowiskowych lub pliku konfiguracyjnym.

---

### VULN-02 · Open SMTP Relay — spoofing danych nadawcy

**Poziom ryzyka:** 🔴 KRYTYCZNY  
**Plik:** [`notify/route.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/app/api/notify/route.js)

#### Opis

Endpoint `/api/notify` wysyła email na adres podany przez klienta w polu `uploaderEmail` bez żadnej weryfikacji, że nadawca faktycznie jest właścicielem tego adresu.

```js
// linia 85
to: data.uploaderEmail,  // ← dowolny adres z requestu
```

Podobnie `uploaderName` — wstawiane bezpośrednio do treści maila:

```js
// linia 90
<p>Hello <strong>${data.uploaderName}</strong>,</p>
```

#### Skutki

1. Wysyłka fałszywych potwierdzeń do osób trzecich (phishing przez zaufaną domenę)
2. Fałszywe powiadomienia do admina o nieistniejących uploadach
3. Możliwe oznaczenie domeny jako spam przez dostawców email

#### Rekomendacja

- Nie wysyłać emaila potwierdzającego do klienta na podstawie danych z requestu — dopóki nie ma weryfikacji tokena/sesji
- Opcja minimalna: wysyłać maila potwierdzającego **tylko do admina** (adres hardcoded w env), bez możliwości wskazania adresata z zewnątrz

---

### VULN-03 · Błąd konfiguracji SMTP — potencjalnie niezaszyfrowane połączenie

**Poziom ryzyka:** 🟡 ŚREDNI  
**Plik:** [`notify/route.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/app/api/notify/route.js#L31-L32)

#### Opis

```js
port: parseInt(process.env.SMTP_PORT || '465'),
secure: process.env.SMTP_PORT === '465',   // ← BUG
```

Gdy `SMTP_PORT` nie jest ustawiony w `.env`:
- `port` = `465` (poprawnie — SSL)  
- `secure` = `undefined === '465'` = **`false`** (błędnie — powinno być `true`)

Nodemailer na porcie 465 z `secure: false` próbuje nawiązać połączenie TLS przez STARTTLS zamiast natywnego SSL. Zachowanie zależy od serwera SMTP — część serwerów odrzuci połączenie, część nawiąże je bez szyfrowania.

#### Skutek

Dane uwierzytelniające SMTP (`SMTP_USER`, `SMTP_PASS`) mogą być transmitowane przez niezaszyfrowane połączenie.

#### Poprawka

```js
const smtpPort = parseInt(process.env.SMTP_PORT || '465');
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465,  // true dla 465, false dla 587 (STARTTLS)
  auth: { ... }
});
```

---

### VULN-04 · Brak Rate Limitingu

**Poziom ryzyka:** 🟡 ŚREDNI  
**Pliki:** wszystkie cztery `route.js`

#### Opis

Brak jakiegokolwiek ograniczenia liczby żądań. Vercel Serverless Functions nie stosują rate limitingu domyślnie.

#### Skutki

- Wyczerpanie dziennego limitu Google API (10 000 req/dzień)
- Kosztowe przebicie limitu (jeśli włączone billing w Google Cloud)
- Flooding serwera SMTP powiadomieniami

#### Rekomendacja

Dla Vercel: middleware Next.js z prostym in-memory rate limiterem per IP (np. `lru-cache`) lub Vercel Edge Config + `@vercel/kv` dla rate limit state. Alternatywnie Cloudflare przed Vercelem.

---

### VULN-05 · Nadmierny Scope OAuth2

**Poziom ryzyka:** 🟡 ŚREDNI  
**Pliki:** [`create-folder/route.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/app/api/create-folder/route.js#L23), [`upload-session/route.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/app/api/upload-session/route.js#L27), [`check-folder/route.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/app/api/check-folder/route.js#L27)

#### Opis

```js
scopes: [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive',   // ← zbyt szeroki
],
```

Scope `drive` daje dostęp do **całego Google Drive** konta serwisowego, włącznie z plikami niekreowanymi przez tę aplikację. Scope `drive.file` (już obecny) wystarczyłby sam w sobie.

#### Skutek

W przypadku wycieku Service Account credentials lub przejęcia aplikacji, atakujący uzyska dostęp do wszystkich plików na Drive — nie tylko do folderu uploadów.

#### Rekomendacja

Usunąć scope `drive`, zostawić wyłącznie `drive.file`. Przetestować czy operacje `files.list` na folderze nadrzędnym działają poprawnie z ograniczonym scopem (jeśli folder nie był stworzony przez SA — może wymagać `drive.readonly` zamiast `drive`).

---

### VULN-06 · Logowanie Danych Osobowych w Produkcji

**Poziom ryzyka:** 🟡 ŚREDNI (RODO)  
**Plik:** [`notify/route.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/app/api/notify/route.js#L7)

#### Opis

```js
console.log('Received notification data:', data);
```

Loguje pełny obiekt żądania zawierający: imię klienta, adres email, listę nazw plików, ID folderu. Logi Vercel są dostępne dla wszystkich członków projektu i przechowywane przez 30 dni (lub dłużej przy płatnych planach).

#### Skutek

- Dane osobowe klientów w logach serwera produkcyjnego
- Potencjalna niezgodność z RODO (brak podstawy prawnej przechowywania danych w logach zewnętrznego dostawcy)

#### Rekomendacja

```js
// Zamiast pełnego obiektu — tylko metadane diagnostyczne
console.log(`Notification received: ${files.length} files, folder: ${data.folderId}`);
```

---

### VULN-07 · Brak Meta Tagu noindex

**Poziom ryzyka:** 🟢 NISKI  
**Plik:** [`layout.js`](file:///Volumes/ENV/Google Drive/drive-uploader/src/app/layout.js)

#### Opis

Aplikacja nie zawiera `<meta name="robots" content="noindex, nofollow">`. Strona jest indeksowalna przez wyszukiwarki — bezpośredni adres może pojawić się w wynikach Google lub zostać skatalogowany przez pająki.

Punkt wprost z `kierunki_rozwoju.md` — wymieniony jako podstawowe zabezpieczenie przez ukrycie.

#### Rekomendacja

```js
// layout.js
export const metadata = {
  title: "Secure File Upload",
  robots: { index: false, follow: false },
};
```

W Next.js 13+ Metadata API obsługuje to natywnie bez ręcznego `<meta>`.

---

### VULN-08 · Email klienta jako nieweryfikowany klucz sesji

**Poziom ryzyka:** 🟢 NISKI  
**Plik:** [`Uploader.js`](file:///Volumes/ENV/Google%20Drive/drive-uploader/src/components/Uploader.js#L12-L13)

#### Opis

Adres email wpisany przez użytkownika w formularzu staje się: nazwą folderu na Drive, adresem docelowym powiadomienia, kluczem identyfikacji sesji. Nie istnieje żadna weryfikacja własności adresu.

#### Skutek

Użytkownik może wpisać `prezes@klientfirma.pl` i odebrać oficjalne potwierdzenie uploadu do tej firmy — mimo że jest osobą trzecią.

---

## Tabela Priorytetów Naprawy — Stan Aktualny

| ID | Podatność | Ryzyko | Status |
|---|---|---|---|
| VULN-01 | Brak auth na API | 🔴 Krytyczny | ✅ Naprawione — token server-side |
| VULN-02 | Open SMTP relay | 🔴 Krytyczny | ✅ Wzmocnione — whitelist `prefillEmail` |
| VULN-03 | Błąd SMTP secure | 🟡 Średnni | ✅ Naprawione |
| VULN-04 | Brak rate limitingu | 🟡 Średni | ✅ Naprawione — wszystkie endpointy |
| VULN-05 | Nadmierny OAuth scope | 🟡 Średni | ✅ Naprawione — `drive.file` only, skan live potwierdził |
| VULN-06 | Logowanie PII | 🟡 Średni (RODO) | ✅ Naprawione — tylko metadane |
| VULN-07 | Brak noindex | 🟢 Niski | ✅ Naprawione — metadata Next.js |
| VULN-08 | Nieweryfikowany email | 🟢 Niski | ⚠️ Celowo pominięte — akceptowane ryzyko B2B |

---

## Korelacja z Kierunkami Rozwoju

> Każda planowana funkcja niesie implikacje bezpieczeństwa, które muszą być adresowane **przed** wdrożeniem.

| Planowana Funkcja | Implikacja Bezpieczeństwa |
|---|---|
| **Token URL** (`?token=X`) | ✅ Dobry kierunek — ale token **musi być weryfikowany server-side** w każdym route handlerze. Inaczej to wyłącznie fałszywe poczucie bezpieczeństwa. |
| **Walidacja czarna lista rozszerzeń** | ⚠️ Musi być zaimplementowana w `/api/upload-session` (server-side), nie tylko w UI. Walidacja po stronie klienta jest trivialna do ominięcia. |
| **Pole "Notatki"** | ⚠️ Dodatkowe pole tekstowe → większa powierzchnia dla content injection w emailach. Wymaga sanityzacji HTML przed wstawieniem do szablonu maila. |
| **Endpoint `build-structure`** | ✅ Wdrożony — auth token + `isSessionFolder` + rate limit (jak pozostałe API). |
| **Manifest `_manifest.json`** | ⚠️ Zapis na Drive w folderze sesji (dostępny adminowi OAuth). Backlog: admin recovery UI. |

---

## Historia Działań — Wszystkie Punkty Zrealizowane ✅

### ~~Natychmiast (przed maintenance window)~~
1. ✅ `/api/notify` zabezpieczony — token auth + whitelist `prefillEmail` z rejestru tokenów (`security-fixes`)
2. ✅ Bug SMTP `secure` naprawiony — `smtpPort === 465` (`security-hardening`)

### ~~W maintenance window~~
3. ✅ Token URL (`?token=X`) weryfikowany server-side w każdym route handlerze — `lib/auth.js` + `verifyUploadToken()` (`security-hardening`)
4. ✅ `console.log(data)` zastąpiony logowaniem metadanych — tylko `files.length` + `folderId` (`security-hardening`)
5. ✅ OAuth scope — tylko `drive.file`, potwierdzone live skanem `checkOAuthScopes.js`
6. ✅ `noindex` — metadata API Next.js w `layout.js` (`security-hardening`)

### ~~Wraz z wdrożeniem Token URL~~
7. ✅ Token projekt-specific po stronie serwera — `tokenStore.js` + Google Drive registry (`security-hardening`)
8. ✅ Walidacja rozszerzeń w `/api/upload-session` — `lib/blocklist.js` + `lib/validation.js` (`security-hardening`)
9. ✅ Rate limiting per IP — `lib/rateLimit.js` (sliding window, wszystkie endpointy) (`security-hardening`)

---

> [!NOTE]
> Jedyny otwarty punkt: **VULN-08** (email klienta bez weryfikacji własności) — celowo pominięty jako akceptowane ryzyko dla narzędzia B2B z tokenami per-klient.
