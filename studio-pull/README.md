# Studio Console

Lokalny panel studia (bez agenta, bez Live Progress):

- **Pull** — multi-select sesji, podgląd plików, kolejka zgrań na dysk zewnętrzny
- **Tokeny** — create / copy / revoke / restore / locale (ten sam `_uploader_tokens.json` co Vercel)

Vercel `/admin` zostaje **awaryjnie** (np. szybki token). Upload klientów nadal tylko na Vercel.

## Start

```bash
cd drive-uploader
npm run studio-pull:ui
```

Albo dwuklik: [`mac/Studio Console.app`](mac/Studio%20Console.app)

Otwiera `http://127.0.0.1:8787`. Zamknięcie procesu = koniec.

## Pull

1. Zaznacz 1–N sesji (checkbox).
2. Opcjonalnie: radio „Podgląd” + **Pokaż pliki** (jednorazowy listing).
3. Folder **bazowy** na `/Volumes/...` (np. `/Volumes/VIDEO_16TB/Incoming`).
4. **Start kolejki** — każda sesja → `bazowy/Nazwa sesji/`.
5. Resume: ponowny Start pomija pliki o tym samym rozmiarze.

## Tokeny

Zakładka **Tokeny** — create (opcjonalny termin ważności) / copy / revoke / restore / locale / delete (ten sam Drive registry co Vercel). Linki: `PUBLIC_UPLOAD_URL` z `.env.local` (fallback produkcja).

## CLI (bez UI)

```bash
npm run studio-pull -- --list
npm run studio-pull -- --folder-id=ID --dest=/Volumes/DISK/Folder
```

## Apka Mac / Tauri

- **Działa teraz:** `Studio Console.app` (launcher → Terminal + Node UI).
- **Tauri:** wymaga Rust — zobacz [`tauri/README.md`](tauri/README.md).

## Safety

Odmowa zapisu poza zewnętrznymi volume (`/Volumes/<Disk>/...`, nie Macintosh HD / Users).
