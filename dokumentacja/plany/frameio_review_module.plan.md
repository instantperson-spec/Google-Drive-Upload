---
name: Frame.io vs portal surowki — pozycjonowanie
overview: "Korekta analizy: Frame.io służy review gotowego wideo; ten produkt służy przesyłaniu i komunikacji wokół surowki (materiałów do / wokół gotowego cutu). Nie budować Frame.io-lite w portalu share."
todos:
  - id: positioning
    content: "Utrwalić rozdział: Frame.io = final review; portal = surowka + handoff"
    status: completed
  - id: p3-surowka
    content: "P3 feedback = status/notatka przy plikach surowki / paczki dostawy — nie TC na finalu"
    status: pending
  - id: out-of-scope-frame
    content: "Świadomie poza portalem: player TC, pins, drawings, proxy, NLE plugins"
    status: completed
isProject: false
---

# Frame.io vs portal surowki — pozycjonowanie (bez kodu)

> Data: 2026-11-16 · **Korekta** wcześniejszej wersji „Frame.io-lite”.  
> Ten dokument **nie** jest planem budowy Frame.io w Waszym stacku.

---

## 1. Dwa różne joby

| | **Frame.io** | **Ten produkt (Drive Uploader / share)** |
|---|---|---|
| Obiekt | **Gotowe / półgotowe wideo** (cut, wersja do akceptacji) | **Surowka** — materiały źródłowe i związane z produkcją cutu |
| Główna czynność | Oglądanie + komentarz przy klatce / TC | Przesyłanie, organizacja, pobieranie, dogrywki |
| Sukces | „Popraw od 01:12:03” / Approve cutu | „Surowka jest u studia / klient dostał paczkę / dograł brakujące” |
| Typowy użytkownik w momencie | Recenzent cutu | Klient oddający materiał; studio wracające z dostawą plików |

**Frame.io nie zastępuje portalu surowki. Portal surowki nie ma być Frame.io.**

Rundy Draft/Final u Was = wersje **paczki plików** (handoff), nie stack frame-accurate review jednego mastera.

---

## 2. Co robi dziś Wasz portal (właściwy zakres)

```
Klient  --upload surowki-->  Drive sesja  --pull/Sync-->  Studio
                                      |
                                      v
                              Opublikuj paczkę (runda)
                                      |
                                      v
                              /share  (pobieranie, FromClient dogrywki, mail)
```

- Upload z tokenem = oddanie surowki / materiałów.  
- Share = komunikacja wokół **plików** (co jest, co nowe od publikacji, dogrywki).  
- Console = operacje studia na surowce i paczkach, nie recenzja cutu w playerze.

To jest **workflow materiałowy**, nie **workflow review cutu**.

---

## 3. Gdzie Frame.io nadal może istnieć obok (nie w środku)

Typowy łańcuch B2B:

1. Klient wrzuca **surowkę** → **Wasze narzędzie**.  
2. Studio montuje.  
3. Studio wrzuca **cut do akceptacji** → **Frame.io** (lub podobne).  
4. Po akceptacji cutu — ewentualnie znowu Wasz share na finalne pliki / stempy / eksporty jako paczka plików (bez TC review).

Integracja „wyślij link Frame.io z Console” = opcjonalny później skrót operacyjny, **nie** embedding Frame.io w `/share`.

---

## 4. Co z P3 feedback? (nadal sensowne — ale nie Frame)

P3 z [`post-mvp_roadmap`](./post-mvp_roadmap_05ad683d.plan.md) zostaje, ale w semantyce **surowki / paczki**:

| Sens P3 | Nie-sens (Frame) |
|---|---|
| Plik: Approve / „brakuje / do wymiany” + notatka | Komentarz „przy 01:12 na timeline finalu” |
| Studio: lista plików do dogrania / poprawy w paczce | Player + pins + drawings |
| Kontekst: runda = wersja paczki handoff | Kontekst: wersja cutu w playerze |

Przykłady notatek OK dla surowki: „brak slotu B-roll z dnia 2”, „ten WAV jest cichy / zły take”, „proszę dograć logo w SVG”.  
Przykłady **poza** portalem: „od tego ujęcia zmień cut” z TC na masterze → Frame.io.

---

## 5. Wycofane z rekomendacji (względem poprzedniej wersji planu)

Następujące **nie** są celem tego portalu:

- In-browser preview jako rdzeń produktu (R1 „jak Frame”)  
- Komentarze timecode / markers na wideo (R2)  
- Drawing na klatce, proxy transcoder, pluginy NLE  
- Marketing „Frame.io-lite”

Opcjonalny lekki preview MP4 przy surowce (czy „to ten plik?”) może być wygodą UX później — **nie** mylić z review gotowego cutu.

---

## 6. Zaktualizowany werdykt

| Pytanie | Odpowiedź |
|---|---|
| Czy budować moduł Frame.io w portalu? | **Nie** |
| Czy P3 (status pliku + notatka) ma sens? | **Tak** — jako komunikacja o surowce / paczce, nie o TC finalu |
| Czy rundy ≈ Frame version stack? | Tylko luźno: wersje **paczki plików**, nie stack cutu |
| Gdzie żyje review gotowego wideo? | Poza tym produktem (np. Frame.io) |

**Jedno zdanie:** ten portal = **przesyłanie i komunikacja wokół surowki**; Frame.io = **review gotowego wideo** — inne narzędzie, inny moment w projekcie.

---

## 7. Co robić dalej (produkt)

1. Trzymać roadmapę: **P3 = feedback przy plikach paczki / surowki** (bez TC).  
2. W copy UI (portal / mail / Console) unikać języka „review cutu” / „approve filmu” — raczej „status pliku”, „do dogrania”, „zaakceptowane w paczce”.  
3. Nie planować playera TC w `/share` jako odpowiedzi na Frame.io.  
4. Jeśli studio potrzebuje review cutu — procedury operacyjne wskazują Frame.io (lub równoważny), nie ten share.
