# Studio Console — Tauri (opcjonalnie)

Docelowe opakowanie WebView (Tauri) wymaga **Rust** (`cargo`) na maszynie build.

Obecnie działa natywny launcher macOS:

`studio-pull/mac/Studio Console.app`

Gdy zainstalujesz Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cd studio-pull/tauri
npm create tauri-app@latest . -- --template vanilla
# W tauri.conf.json ustaw beforeDevCommand / zewnętrzny URL http://127.0.0.1:8787
# albo sidecar: node ../ui-server.mjs z STUDIO_CONSOLE_NO_AUTO obsłużonym w wrapperze
```

Architektura docelowa: Tauri okno ładuje ten sam UI; Node `ui-server.mjs` jako sidecar (download GB na dysk).
