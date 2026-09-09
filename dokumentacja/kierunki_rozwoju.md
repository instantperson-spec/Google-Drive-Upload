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
| Faza 3: rekonstrukcja podfolderów | ⏳ Planowane |
| Konsola admina | 📋 Plan: [`plan_konsola_admina.md`](./plan_konsola_admina.md) |

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

## 3. Zaawansowany User Experience (UX)
* **Ręczna pauza / wznowienie:** Aktualny system wznawiania działa świetnie w tle (reaguje na zerwane połączenie). Dodanie fizycznego przycisku "Pauza" przy każdym pliku pozwoliłoby klientowi na świadome, chwilowe zwolnienie swojego łącza internetowego na inne potrzeby, a następnie ręczne wznowienie transferu bez utraty pobranych bajtów.
* **Ostrzeżenie przed "drobnicą" (dużą ilością małych plików):** Architektura Google Drive API jest zoptymalizowana pod gigantyczne pliki, ale bywa wolna przy wgrywaniu tysięcy bardzo małych plików (np. sekwencji zdjęć po 1 MB), ponieważ każdy plik wymaga oddzielnego nawiązania sesji. Warto dodać alert: *"Wybrałeś ponad 500 plików. Rozważ spakowanie ich do jednego archiwum .ZIP przed wgraniem, aby znacznie przyspieszyć proces"*.

## 4. Architektura: Odtwarzanie struktury podfolderów (Podejście "Ścieżka A")
Koncept "Upload Flat, Reconstruct Later" rozwiązuje problem spowolnienia przy tworzeniu zagnieżdżonych folderów w locie. 

### Plan Wdrożenia (Krok po Kroku)

**Faza 1: Zbieranie metadanych w przeglądarce**
1. Podczas wybierania folderów przez użytkownika (Drag & Drop), skrypt odczytuje właściwość `webkitRelativePath` każdego pliku (np. `KameraA/video.mp4`).
2. Tworzona jest lokalna mapa JSON wiążąca nazwę pliku z jego docelową ścieżką.

**Faza 2: Upload "Na płasko" (Obecny system)**
1. Wszystkie pliki wgrywane są bezpośrednio do głównego katalogu sesji na Dysku Google (np. `Jan Kowalski - jan@test.pl`).
2. Dzięki brakowi walidacji podfolderów w tej fazie, upload osiąga maksymalną przepustowość.
3. System wznawiania (Resume) działa bez zmian.

**Faza 3: Przebudowa struktury (Po osiągnięciu 100%)**
1. Zamiast natychmiastowego ekranu sukcesu, interfejs zmienia stan na: *"Kompilowanie struktury plików..."*.
2. Przeglądarka wywołuje nowy endpoint `/api/build-structure` (lub serię endpointów):
   - Skrypt analizuje zapisaną mapę ścieżek.
   - Identyfikuje unikalne nazwy podfolderów i wywołuje Google API do ich utworzenia (`mimeType: application/vnd.google-apps.folder`).
   - Dla każdego pliku wywoływana jest funkcja Google Drive API `files.update`, w której przekazujemy parametry `addParents=NOWY_FOLDER_ID` oraz `removeParents=GLOWNY_FOLDER_ID`.
3. Przesuwanie plików w chmurze nie wymaga ponownego ich pobierania – operacja na metadanych w Google Drive trwa ułamki sekund.

**Zabezpieczenia / Edge Cases:**
- Jeśli użytkownik zamknie kartę podczas "Kompilowania", pliki pozostają bezpieczne w głównym folderze sesji. Niczego nie tracimy.
- Warto dodać plik `_manifest.json` do uploadu, by w razie potrzeby odtworzyć strukturę awaryjnym skryptem po stronie admina (Podejście awaryjne).
