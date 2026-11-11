# Studio Console (okno Mac / Tauri)

Natywne okienko ładuje ten sam UI co `http://127.0.0.1:8787` (Node `ui-server.mjs` w tle).

## Auth (ważne)

- **Brak logowania jak na Vercel `/admin`** — lokalna apka nie pyta o hasło admina.
- Dostęp do Drive bierze z **`.env.local`** w `drive-uploader` (`GOOGLE_CLIENT_*`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`).
- Serwer słucha tylko na **`127.0.0.1`** (ten Mac). To Twoja stacja robocza, nie publiczny internet.
- Vercel `/admin` zostaje awaryjnie (hasło admina + zdalny dostęp).

## Start

Dwuklik:

`studio-pull/mac/Studio Console.app`

Albo:

```bash
cd drive-uploader
npm run studio-console:app    # tauri dev
npm run studio-console:build  # przebuduj .app
```

Wymaga: **Node.js**, **Rust** (tylko do buildu), plik `.env.local`.

Log: `~/Library/Logs/StudioConsole.log`
