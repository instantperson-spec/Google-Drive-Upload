# Kierunki Rozwoju Projektu: Direct Drive Uploader

Poniżej znajduje się zestawienie potencjalnych funkcji i usprawnień, które mogą zostać wdrożone w przyszłości w celu podniesienia profesjonalizmu, bezpieczeństwa i wygody korzystania z aplikacji dla zastosowań B2B.

## 1. Bezpieczeństwo i Dostęp (Security)
* **Zabezpieczenie hasłem / PIN-em:** Dodanie prostego ekranu logowania z jednym globalnym hasłem (np. `SuperTajne123`), aby odsiać przypadkowych gości, zapobiec spamowi i zablokować automatyczne boty przed zapchaniem przestrzeni na dysku.
* **Filtrowanie rozszerzeń:** Wprowadzenie walidacji i blokady na wgrywanie niebezpiecznych plików (np. `.exe`, `.bat`, `.js`). Możliwość wymuszenia przyjmowania tylko określonych formatów docelowych (np. wideo: `.mp4`, `.mov`, audio: `.wav`, grafika: `.zip`, dokumenty: `.pdf`).

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
