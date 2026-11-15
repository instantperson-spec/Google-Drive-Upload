# Dokumentacja — Drive Uploader / Studio Console

> Ostatnia aktualizacja: 2026-11-15  
> Stare raporty z IX 2026 → [`archiwum/`](./archiwum/)  
> Produkcja: `https://drive-uploader-three.vercel.app`

## Co czytać

| Dokument | Kiedy |
|---|---|
| [`operacje.md`](./operacje.md) | Tokeny uploadu, linki dla klientów, share, checklista |
| [`oauth_drive_file.md`](./oauth_drive_file.md) | Regeneracja refresh tokena / scope `drive.file` |
| [`bezpieczenstwo.md`](./bezpieczenstwo.md) | Stan zabezpieczeń + backlog hardening |
| [`produkt_i_backlog.md`](./produkt_i_backlog.md) | Co działa, UI Nebula, backlog / Post-MVP |
| [`plany/`](./plany/) | Plany Cursor (wdrożone + roadmap) |
| [`../mockups/`](../mockups/) | Mockupy HTML (upload + share) — referencja UI |
| [`archiwum/`](./archiwum/) | Historyczne analizy IX 2026 |

## Mapa produktu

```
Klient upload   →  /?token=…          (Vercel, UI Nebula + glass)
Admin Vercel    →  /admin             (History: In progress / Completed; bez Live Monitor)
Portal klienta  →  /share/<id>        (Portal projektu, KPI, dogrywki FromClient/)
Studio          →  Studio Console     (localhost / Tauri — pull, Sync, share)
```

## Szybki rollback

Ostatni checkpoint przed dużym rolloutem UI/share w git: commit `9fe83fb` na `main`.  
Deploy Vercel: poprzedni deployment w dashboardzie projektu `drive-uploader`.
