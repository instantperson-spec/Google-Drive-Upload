# Dokumentacja — Drive Uploader / Studio Console

> Ostatnia reorganizacja: 2026-11-14  
> Stare raporty z IX 2026 → [`archiwum/`](./archiwum/)

## Co czytać

| Dokument | Kiedy |
|---|---|
| [`operacje.md`](./operacje.md) | Tokeny uploadu, linki dla klientów, share, checklista przed wysyłką |
| [`oauth_drive_file.md`](./oauth_drive_file.md) | Regeneracja refresh tokena / scope `drive.file` / diagnostyka |
| [`bezpieczenstwo.md`](./bezpieczenstwo.md) | Aktualny stan zabezpieczeń i otwarty backlog |
| [`produkt_i_backlog.md`](./produkt_i_backlog.md) | Co działa + backlog UX / Post-MVP |
| [`plany/`](./plany/) | Aktywne plany Cursor (team sync, portal MVP, roadmap post-MVP) |
| [`archiwum/`](./archiwum/) | Historyczne analizy i checklisty deploy z IX 2026 |

## Mapa produktu (skrót)

```
Klient upload   →  /?token=…          (Vercel)
Admin Vercel    →  /admin             (hasło ADMIN_SECRET)
Portal klienta  →  /share/<id>        (lista, pobieranie, dogrywki FromClient/)
Studio          →  Studio Console     (localhost / Tauri — pull, Sync, share)
```
