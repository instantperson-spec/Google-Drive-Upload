# Operacje: generowanie i wysyłanie linków dla klientów

> Status: wdrożone lokalnie (branch `security-hardening`) · Oczekuje na deploy w maintenance window

---

## Jak to działa

Każdy klient (lub projekt) dostaje **dedykowany token** wpisany w zmiennej środowiskowej `UPLOAD_TOKENS`. Token pojawia się w linku jako parametr URL:

```
https://TWOJA-DOMENA.pl/?token=NAZWA_TOKENA
```

Lokalnie (dev):

```
http://localhost:3000/?token=TestLokalny
```

- **Bez tokena** — strona pokazuje ekran „Access link required”, API zwraca 401.
- **Z tokenem** — pełny dostęp do uploadu (formularz, API, powiadomienia).
- Token jest weryfikowany **po stronie serwera** w każdym endpoincie — samo ukrycie UI nic nie daje.

---

## Model dostępu: jednorazowy vs ciągły

| Typ klienta | Strategia tokena | Przykład |
|---|---|---|
| **Projekt jednorazowy** | Token nazwany po projekcie; po zakończeniu prac **usuwasz go z env** i redeploy | `?token=ReklamaXYZ2026` |
| **Klient retainer / ciągły dostęp** | **Stały token** na stałe przypisany do klienta — ten sam link działa latami | `?token=StudioKowalski` |
| **Wiele projektów u tego samego klienta** | Jeden token per klient wystarczy — foldery sesji rozróżnia email wpisany w formularzu | `Jan Kowalski - jan@studio.pl` |

Token **nie wygasa sam** — to zaleta dla klientów retainer, a dla projektów jednorazowych token usuwasz ręcznie po zakończeniu.

---

## Procedura: nowy klient (krok po kroku)

### 1. Wybierz nazwę tokena

Zasady dobrego tokena:

- krótki, czytelny dla Ciebie (np. `StudioAlfa`, `Retainer_Beta`)
- **bez spacji** (unikasz problemów z URL)
- tylko litery, cyfry, myślnik, podkreślnik
- nie ujawniaj w tokenie wrażliwych danych (NIP, pełna nazwa firmy — to tylko identyfikator techniczny)

### 2. Dodaj token do env

**Lokalnie** (`.env.local`):

```env
UPLOAD_TOKENS="StudioAlfa,RetainerBeta,ProjektGamma"
```

**Produkcja** (Vercel → Settings → Environment Variables):

```
UPLOAD_TOKENS = StudioAlfa,RetainerBeta,ProjektGamma
```

> ⚠️ **Fail-closed:** jeśli `UPLOAD_TOKENS` jest pusty lub nie ustawiony, **wszystkie** requesty API są odrzucane. Po deployu upewnij się, że lista jest kompletna.

### 3. Zbuduj link

```
https://TWOJA-DOMENA.pl/?token=StudioAlfa
```

Jeśli token zawiera znaki specjalne (unikaj tego), zakoduj w URL: `encodeURIComponent('token')`.

### 4. Wyślij klientowi

Przykładowa treść maila:

```
Temat: Link do przesyłania materiałów — [Nazwa studia]

Cześć [Imię],

Poniżej znajdziesz dedykowany link do przesyłania plików bezpośrednio do naszego dysku:

https://TWOJA-DOMENA.pl/?token=StudioAlfa

Instrukcja:
1. Otwórz link w przeglądarce (Chrome lub Firefox zalecane).
2. Wpisz swoje imię/nazwę firmy i adres email.
3. Przeciągnij pliki lub wybierz folder.
4. Kliknij „Start Upload".

Link jest stały — możesz wracać do niego wielokrotnie (np. przy kolejnych dostawach materiału).
Po zakończeniu uploadu otrzymasz automatyczne potwierdzenie na podany email.

W razie przerwania transferu — otwórz ten sam link ponownie i wybierz te same pliki;
system wznowi upload od miejsca przerwania.

Pozdrawiam,
[Twoje studio]
```

### 5. Po zakończeniu projektu jednorazowego — revoke

Usuń token z `UPLOAD_TOKENS` → redeploy. Stary link natychmiast przestaje działać.

---

## Klient z ciągłym dostępem (retainer)

**Rekomendowany workflow:**

1. Przy onboardingu klienta tworzysz **jeden stały token** (np. `Retainer_StudioXYZ`).
2. Wysyłasz link raz — klient zapisuje go w zakładkach.
3. Przy każdej dostawie klient:
   - otwiera ten sam link,
   - wpisuje swoje dane (email identyfikuje sesję),
   - wgrywa pliki → powstaje folder `Imię - email@firma.pl` na Drive.
4. Ty dostajesz mail admina po każdym uploadzie (jak dotychczas).
5. **Nigdy nie usuwaj tokena** dopóki współpraca trwa.

### Wiele osób z tej samej firmy

Obecny system: każda osoba wpisuje swój email → osobny folder sesji.  
Jeśli chcesz jeden folder per firma — to wymaga przyszłej funkcji (mapowanie token → domyślna nazwa folderu). Na razie: jeden token per firma, każdy pracownik wpisuje ten sam email firmowy.

---

## Zarządzanie tokenami — panel admina (zalecane)

Tokeny zarządzasz w **`/admin` → sekcja „Client tokens"**:

- **+ New token** — tworzy token, kopiuje link do schowka
- **Copy link** — kopiuje gotowy URL `?token=...`
- **Revoke** — natychmiast blokuje dostęp (bez redeploy)
- **Restore** — przywraca revoke'owany token

Tokeny są przechowywane w pliku `_uploader_tokens.json` na Twoim Google Drive (w głównym folderze uploadów). Przy pierwszym uruchomieniu importowane są z `UPLOAD_TOKENS` w env.

### Ręczne zarządzanie (legacy / backup)

Alternatywnie możesz nadal edytować `UPLOAD_TOKENS` w env — działa **tylko gdy Drive store jest niedostępny**. Po utworzeniu pliku na Drive **panel admina jest źródłem prawdy**.

Prowadź też rejestr poza systemem (opcjonalnie):

| Token | Klient / projekt | Typ | Data utworzenia | Data revoke | Link |
|---|---|---|---|---|---|
| `StudioAlfa` | Studio Alfa Sp. z o.o. | retainer | 2026-01-15 | — | `?token=StudioAlfa` |
| `ReklamaXYZ2026` | Kampania XYZ | jednorazowy | 2026-03-01 | 2026-04-30 | `?token=ReklamaXYZ2026` |

Arkusz Google / Notion / plik CSV — cokolwiek wygodne.

---

## FAQ operacyjne

**Czy klient może udostępnić link innym?**  
Tak — każdy z linkiem może wgrywać pliki. Token to „klucz do drzwi", nie personalizacja użytkownika. Dla projektów wrażliwych: token jednorazowy + revoke po zakończeniu.

**Czy link wygasa?**  
Nie — dopóki token jest w `UPLOAD_TOKENS`.

**Czy muszę redeployować przy każdym nowym kliencie?**  
Tak — na Vercelu zmiana env wymaga redeploy (lub automatycznego pick-up przy następnym deploy). To naturalny moment na maintenance window.

**Co jeśli klient otworzy link bez `?token=`?**  
Zobaczy ekran „Access link required" — nie będzie mógł nic wgrać.

**Czy mogę mieć różne tokeny z różnymi uprawnieniami?**  
Obecnie wszystkie tokeny mają identyczne uprawnienia. Różnicowanie (np. limit rozmiaru per token) — planowane w konsoli admina (Faza 2).

---

## Checklist przed wysłaniem linku klientowi

- [ ] Token dodany do `UPLOAD_TOKENS` (lokalnie przetestowany)
- [ ] Link otwarty w przeglądarce incognito — formularz uploadu widoczny
- [ ] Testowy upload małego pliku przeszedł
- [ ] Mail admina dotarł po teście
- [ ] Wpis w rejestrze tokenów uzupełniony
- [ ] (Produkcja) env ustawiony na Vercelu przed/po deploy
