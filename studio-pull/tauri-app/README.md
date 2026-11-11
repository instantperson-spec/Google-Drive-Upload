# Studio Console (okno Mac / Tauri)

Natywne okienko ładuje ten sam UI co `http://127.0.0.1:8787` (Node `ui-server.mjs` w tle).

## Auth (ważne)

- **Brak logowania jak na Vercel `/admin`** — lokalna apka nie pyta o hasło admina.
- Dostęp do Drive bierze z **`.env.local`** w `drive-uploader` (`GOOGLE_CLIENT_*`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`).
- Serwer słucha tylko na **`127.0.0.1`** (ten Mac). To Twoja stacja robocza, nie publiczny internet.
- Vercel `/admin` zostaje awaryjnie (hasło admina + zdalny dostęp).

## Start / instalacja na stałe

```bash
cd drive-uploader
npm run studio-console:build    # jeśli trzeba przebudować .app
npm run studio-console:install  # → /Applications/Studio Console.app
```

Instalator zapisuje ścieżkę projektu w:
`~/Library/Application Support/StudioConsole/root_path.txt`
(apka w Applications wie, gdzie jest `.env.local` i `ui-server`).

Potem: Launchpad → **Studio Console** (przeciągnij na Dock).

Bez instalacji: dwuklik `studio-pull/mac/Studio Console.app`.

Wymaga: **Node.js**, dysk z `drive-uploader` + `.env.local` podmontowany. **Rust** tylko do buildu.

Log: `~/Library/Logs/StudioConsole.log`
