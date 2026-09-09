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
| Konsola admina (Faza B — live progress) | ✅ Wdrożone lokalnie — heartbeat 10s |
| Konsola admina (Faza C — token manager) | ✅ Wdrożone — `/admin` → Client tokens |
| OAuth scope test w panelu admina | ✅ Wdrożone — `/admin` → OAuth scope test |
| Rekurencyjny wybór zagnieżdżonych folderów | ✅ Wdrożone — `showDirectoryPicker` + DnD |

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
* **Zwiększenie CHUNK_SIZE do 256 MB:** W celu optymalizacji przesyłania ogromnych sesji (tzw. "1 TB monster sessions"), rozmiar pojedynczej paczki zostanie zwiększony z 64 MB do 256 MB. Drastycznie zmniejszy to ilość zapytań do API Google (np. 4-krotnie mniej zapytań dla pliku wideo) i niemal całkowicie zlikwiduje ryzyko zablokowania transferu (błąd 429 Rate Limit) przy wielkich plikach.
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
