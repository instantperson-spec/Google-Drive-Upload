# Kierunki Rozwoju Projektu: Direct Drive Uploader

> **Aktualizacja 2026-09-09:** Część punktów z sekcji 1 (bezpieczeństwo) została wdrożona lokalnie na branchu `security-hardening`. Szczegóły: [`wdrozenie_security_hardening.md`](./wdrozenie_security_hardening.md).

| Punkt poniżej | Status |
|---|---|
| No-index | ✅ Wdrożone |
| Token URL (`?token=X`) server-side | ✅ Wdrożone |
| Czarna lista rozszerzeń (server-side) | ✅ Wdrożone |
| Pole „Notatki" | ⏳ Planowane |
| Przekierowanie po sukcesie | ⏳ Planowane |
| Pauza / wznowienie ręczne | ⏳ Planowane |
| Alert o drobnicy | ⏳ Planowane |
| Faza 3: rekonstrukcja podfolderów | ✅ Wdrożone — `/api/build-structure` + `_manifest.json` |
| Konsola admina (Faza A — historia sesji) | ✅ Wdrożone lokalnie — `/admin` |
| Konsola admina (Faza B — live progress) | ✅ Przeprojektowane — Live Monitor toggle + per-plik eventy |
| Konsola admina (Faza C — token manager) | ✅ Wdrożone — `/admin` → Client tokens |
| OAuth scope test w panelu admina | ✅ Wdrożone — `/admin` → OAuth scope test |
| Rekurencyjny wybór zagnieżdżonych folderów | ✅ Wdrożone — `showDirectoryPicker` + DnD |
| Zabezpieczenie heartbeatu Vercel | ✅ Wdrożone lokalnie — branch `security-fixes` |
| Email whitelist (notify open relay) | ✅ Wdrożone lokalnie — branch `security-fixes` |

---

Poniżej znajduje się zestawienie potencjalnych funkcji i usprawnień, które mogą zostać wdrożone w przyszłości w celu podniesienia profesjonalizmu, bezpieczeństwa i wygody korzystania z aplikacji dla zastosowań B2B.

## 1. Bezpieczeństwo i Dostęp (Security - Bez Tzw. "Tarcia")
Głównym założeniem aplikacji jest ominięcie problemów znanych z platform typu WeTransfer (rejestracje, limity, wygasające linki). Wprowadzenie dodatkowych haseł czy kont dla klientów zaburzyłoby ten cel. Zamiast tego wdraża się rozwiązania "niewidzialne":

* **Zabezpieczenie przez ukrycie (No-index):** Dodanie tagu `<meta name="robots" content="noindex">` uniemożliwia wyszukiwarkom (Google) zindeksowanie strony. Dostęp zyskują wyłącznie klienci, którzy otrzymają bezpośredni link e-mailem.
* **Sesje oparte na dedykowanych linkach (Token URLs):** Zamiast globalnego hasła, adres URL wysyłany klientowi może zawierać prosty parametr autoryzujący (np. `?token=NazwaProjektu`). Chroni to przed wejściem na stronę osób znających jedynie adres główny witryny.
* **Walidacja negatywna plików (Czarna Lista):** Zamiast tzw. białej listy (wymuszania konkretnych formatów), sprawdzamy i odrzucamy wyłącznie pliki potencjalnie groźne dla systemu (np. `.exe`, `.bat`, `.cmd`, `.vbs`, `.sh`).
  - **Dlaczego?** Klienci branży wideo często przesyłają całe struktury katalogów. Programy takie jak DaVinci Resolve czy Premiere Pro używają własnych, nietypowych rozszerzeń (np. `.drp`, `.prproj`) oraz zapisują metadane w `.xml` lub `.json`. Restrykcyjna biała lista (np. tylko `.mp4`) zablokowałaby te krytyczne pliki. Walidacja negatywna zapewnia bezpieczeństwo przed złośliwym kodem, dając klientom 100% swobody.

## 2. Organizacja i Workflow klienta
* **Dodatkowe pole "Notatki / Numer Projektu":** Wzbogacenie formularza początkowego o opcjonalne pole tekstowe na wiadomości od klienta (np. *"To są te poprawione ujęcia z drona"*). Aplikacja mogłaby na tej podstawie generować mały plik tekstowy `wiadomosc_od_klienta.txt` i wgrywać go na Dysk Google obok materiałów wideo.
* **Przekierowanie po sukcesie:** Zamiast pozostawiania użytkownika na statycznym, zielonym ekranie sukcesu, po kilku sekundach aplikacja mogłaby automatycznie przekierowywać klienta z powrotem na główną stronę firmową studia lub profil portfolio (np. na Instagramie/Vimeo).

## 3. Optymalizacja i Zaawansowany UX
* **Awaryjne zwiększenie CHUNK_SIZE do 256 MB:** Obecny rozmiar paczki (64 MB) działa wzorowo, dlatego traktujemy to jako ukrytą "ścieżkę naprawy". Gdyby w przyszłości przy gigantycznych projektach (tzw. "1 TB monster sessions") Google zaczęło blokować sesje z powodu zbyt dużej ilości zapytań (błąd 429), szybką metodą ratunkową będzie zmiana parametru na 128 MB lub 256 MB. W normalnych warunkach zostajemy przy 64 MB.
* **Ręczna pauza / wznowienie:** Aktualny system wznawiania działa świetnie w tle (reaguje na zerwane połączenie). Dodanie fizycznego przycisku "Pauza" przy każdym pliku pozwoliłoby klientowi na świadome, chwilowe zwolnienie swojego łącza internetowego na inne potrzeby, a następnie ręczne wznowienie transferu bez utraty pobranych bajtów.
*(Uwaga: Problem wgrywania tysięcy małych plików tzw. "drobnicy" został celowo pominięty, ponieważ w obecnym workflow postprodukcyjnym jest on bardzo mało prawdopodobny. Jeśli kiedykolwiek wystąpi, zostanie dołożona obsługa archiwizacji w przeglądarce).*

## 4. Architektura: Odtwarzanie struktury podfolderów (Podejście "Ścieżka A") — ✅ WDROŻONE

Koncept "Upload Flat, Reconstruct Later" — wdrożony lokalnie na branchu `security-hardening`.

| Faza | Status | Implementacja |
|---|---|---|
| **Faza 1** — metadane ścieżek | ✅ | `collectFolderFiles.js` + `relativePath` / `uploadName` w `Uploader.js` |
| **Faza 2** — flat upload | ✅ | `upload-session` z `uploadName` (basename) do folderu sesji |
| **Faza 3** — rebuild + manifest | ✅ | `POST /api/build-structure` → `buildStructure.js` → `_manifest.json` |

**Flow użytkownika:**
1. Wybór folderu (Chrome: `showDirectoryPicker` z pełnym zagnieżdżeniem) lub drag-and-drop całego projektu
2. Upload płaski — maksymalna prędkość, resume bez zmian
3. Ekran *„Compiling folder structure…"* → serwer tworzy podfoldery i przenosi pliki
4. Sukces + powiadomienie email

**Edge cases:**
- Zamknięcie karty podczas kompilacji → pliki bezpieczne płasko w folderze sesji; `_manifest.json` umożliwia ręczne odtworzenie
- **Nie wdrożono:** UI admina do ponownego uruchomienia build-structure z manifestu (backlog)

## 5. Optymalizacja Vercel — Live Monitor (branch `security-fixes`) — ✅ WDROŻONE LOKALNIE

Problem: stary heartbeat co 10s + polling admina co 5s generował ~150 000 wywołań Vercel/miesiąc przy jednej sesji 4-dniowej (limit: 100 000).

**Nowa architektura (wzorzec „Patrz i Oszczędzaj"):**

| Zdarzenie | Wywołania Vercela |
|---|---|
| Klient: start każdego pliku (`file-started`) | 1 / plik |
| Klient: koniec każdego pliku (`file-completed`) | 1 / plik |
| Klient: błąd lub zakończenie sesji | 1 |
| Admin: Live Monitor OFF (domyślnie) | **0** |
| Admin: Live Monitor ON (polling 5s, 2h oglądania) | ~1 440 |

**Kosztorys dla sesji 450 plików (Wood Web):**
- Bez oglądania: ~900 wywołań / całą sesję
- Z 2h oglądania: ~2 580 wywołań / całą sesję
- Miesięczna przepustowość przy 2h oglądania/sesję: **~38 sesji** (vs. 0 bez zmian)

**Przełącznik w panelu CMS:**
- Przycisk `⚫ Live Monitor OFF` / `🟢 Live Monitor ON` w toolbarze panelu admina
- OFF: zero auto-pollingu, widok odświeża się tylko przy ręcznym kliknięciu „Refresh all"
- ON: polling co 5s aktywny dopóki masz otwarty panel
- Oba tryby zawsze pokazują eventy `file-completed` i `error` od klienta

**Bezpieczeństwo email (open relay fix):**
- Endpoint `/api/notify` weryfikuje `uploaderEmail` z requestu względem `prefillEmail` zapisanego w rejestrze tokenów na Google Drive
- Tokeny bez `prefillEmail` (retainerowe) przepuszczają dowolny email jak poprzednio
- Zapobiega użyciu skradzionego tokenu do wysyłki emaili do arbitralnych adresatów
