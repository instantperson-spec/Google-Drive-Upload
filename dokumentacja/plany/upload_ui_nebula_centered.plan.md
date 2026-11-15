---
name: Client UI — Centered + Nebula (Upload + Share)
overview: "Spójny redesign /?token= i /share/[id]: Nowoczesny Centered + Nebula z mockupów, wspólny glass shell, odchudzenie tech-theater; bez Split/Bento/Media."
todos:
  - id: shared-shell
    content: "Wspólne CSS: Nebula + noise + glass + akcent slate/indigo (upload + share)"
    status: completed
  - id: upload-form-identity
    content: "Upload: etykieta projektu + identity badge; dropzone/kolejka; sticky Start"
    status: completed
  - id: upload-success
    content: "Upload success: Open Drive + kolejna partia (bez MB/s / ETA)"
    status: completed
  - id: share-centered
    content: "Share: glass centered — nagłówek, KPI/sekcje, karty plików, dogrywki dropzone"
    status: completed
  - id: share-download-ux
    content: "Share download progress: % / faza / N z M — bez fake MB/s; copy bez obietnicy tylko-ZIP"
    status: completed
  - id: i18n-polish
    content: "i18n PL/EN pod nowe UI (upload + share)"
    status: completed
  - id: deploy-vercel
    content: "Deploy na Vercel po akceptacji obu ekranów"
    status: completed
isProject: false
---

# Plan: Client UI — Centered + Nebula (Upload + Share)

## Cel

Jeden język wizualny na obu publicznych ekranach klienta:

| Ekran | Mockup | Produkcja |
|-------|--------|-----------|
| Upload | [`mockups/index.html`](drive-uploader/mockups/index.html) → `#layout-classic-centered` | [`/?token=`](drive-uploader/src/components/Uploader.js) |
| Portal | [`mockups/share.html`](drive-uploader/mockups/share.html) → `#layout-centered` | [`/share/[id]`](drive-uploader/src/components/SharePage.js) |

Tło: **Nebula**. Layout: **tylko Centered** (bez Split / Bento / Media).

## Wspólne zasady (odchudzić — jak ustalono)

**Nie przenosimy**

- Cloud Bridge / TLS 1.3 / Workspace API v3 / Resumable Chunk w UI
- Live **MB/s** i **ETA**
- Animowana Aurora (statyczna Nebula + lekki noise)
- Panele przełączników mockupu
- Layouty Split Studio / Bento / Media Browser

**Akcent:** slate + **jeden** indigo — nie full purple-glow (żeby karta nie zlewała się z Nebulą).

**Wspólny shell CSS** (jedna definicja użyta na obu stronach):

- `.bg-theme-nebula` (lub klasy produkcyjne równoważne)
- `.modern-glass-card` + specular edge
- te same inputy / dropzone / file-item / badge statusów

Pliki: [`globals.css`](drive-uploader/src/app/globals.css) (+ ewentualnie mały wrapper layoutu strony).

---

## A. Upload (`/?token=`)

Bez zmian względem wcześniejszej umowy:

1. Glass karta + Nebula  
2. Nazwa projektu: label + „wymagane”; placeholder `nowy projekt` / `new project`  
3. Identity locked → karta (inicjały, Autoryzowano)  
4. Dropzone glow + kolejka z typem pliku; **sticky Start** zostaje  
5. Progress: tylko **% / N z M**  
6. Success: **Otwórz w Drive** + wyślij kolejne  

Pliki: `Uploader.js`, `UserDetailsForm.js`, `UploadDropZone.js`, `UploadFileList.js`, `UploadStatusScreens.js`, i18n.

---

## B. Share portal (`/share/[id]`)

Źródło: mockup **Centered** w `share.html`. Logika API (lista, ZIP/download, FromClient upload) **bez zmian kontraktu** — tylko UI.

### Co przenosimy

1. **Shell** — ta sama Nebula + glass co upload (`max-w-2xl` jak w mocku share).
2. **Nagłówek** — dyskretny eyebrow „Portal projektu” (bez tech fluff); tytuł = nazwa sesji/projektu z API; krótki podtytuł.
3. **KPI / filtry** (opcjonalnie v1, zalecane) — 4 kafelki: Wszystkie / Twoje / Od studia / Dogrywki — klik filtruje widok sekcji (jak mock). Jeśli za dużo na mobile: stack 2×2.
4. **Dograj pliki** — dropzone w stylu uploadu; copy: trafiają do studia (`FromClient/`).
5. **Sekcje plików** — karty z rozszerzeniem, ścieżką, rozmiarem, status chip (oryginał / nowe od studia / dogrywka); przycisk pobierz przy sekcji (jak dziś).
6. **Pasek postępu pobierania** — faza + **%** + ewentualnie plik N/M; **bez** MB/s i ETA.  
   Copy: nie obiecywać wyłącznie „pakowanie ZIP może potrwać” jako jedyny model — trzymać neutralnie („Pobieranie…”) pod przyszłe plik-po-pliku ([`post-mvp_roadmap`](./post-mvp_roadmap_05ad683d.plan.md)); ZIP nadal OK jako obecna implementacja.

### Share — świadomie nie brać

- Layout Split / Media grid z mocka  
- Nadmiar gradientów purple na hero „Pobierz wszystko” — jeden solid indigo CTA  
- Symulacyjne „Aktywna sesja” clock badge jeśli nie ma realnego sygnału — pominąć albo tylko gdy share aktywny

Pliki: [`SharePage.js`](drive-uploader/src/components/SharePage.js), style share w `globals.css`, ewentualnie page wrapper `src/app/share/[id]/`.

---

## Poza zakresem

- Admin `/admin`, Studio Console  
- Delivery v2 / rundy / Approve  
- Implementacja pobierania plik-po-pliku (osobny plan P0) — tu tylko UI progress gotowy na fazy  
- Zmiana auth token / share id

## Kryteria sukcesu

- Upload i Share wyglądają jak **ta sama rodzina** (Nebula + glass + indigo)  
- Brak Bridge / TLS / API v3 / MB/s / ETA na obu  
- Upload: wymagana nazwa + sticky Start + identity badge  
- Share: sekcje + dogrywki + progress %; filtry KPI działają lub sekcje zawsze widoczne  
- Jeden deploy Vercel obejmuje oba ekrany  

## Kolejność wdrożenia

1. Wspólny CSS shell (Nebula + glass + file-item + dropzone)  
2. Upload (form, identity, dropzone, success)  
3. Share (centered card, sekcje, KPI, progress copy)  
4. i18n, mobile check obu URL-i  
5. Deploy Vercel  
