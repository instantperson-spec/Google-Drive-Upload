# Dokumentacja — Drive Uploader / Studio Console

> Ostatnia aktualizacja: 2026-11-16 (po `fca5d29` rundy + mail)  
> Produkcja: `https://drive-uploader-three.vercel.app`

## Kanon (czytaj to)

| Dokument | Rola |
|---|---|
| [`operacje.md`](./operacje.md) | Runbook: tokeny, share, checklista |
| [`oauth_drive_file.md`](./oauth_drive_file.md) | Regeneracja refresh tokena `drive.file` |
| [`bezpieczenstwo.md`](./bezpieczenstwo.md) | **Jedyny żywy skrót** bezpieczeństwa |
| [`analiza_przegladowa.md`](./analiza_przegladowa.md) | Przegląd + re-check po rundach: residual, martwy kod, plany |
| [`produkt_i_backlog.md`](./produkt_i_backlog.md) | Co działa + backlog produktu |
| [`plany/post-mvp_roadmap_05ad683d.plan.md`](./plany/post-mvp_roadmap_05ad683d.plan.md) | Roadmap: P0–P2 ✅ → **P3 feedback** |
| [`../mockups/`](../mockups/) | Referencja UI: upload, portal, admin, [studio-console](../mockups/studio-console.html) |

## Archiwum

Historia (nie stan produkcji): [`archiwum/`](./archiwum/) — w tym audyty 2026-11-15, plany wdrożone (team sync, portal, Nebula, security remediacja).

## Mapa produktu

```
Klient upload   →  /?token=…          (Vercel, Nebula + glass)
Admin Vercel    →  /admin             (History, tokeny)
Portal klienta  →  /share/<id>        (rundy, plik-po-pliku, FromClient/)
Studio          →  Studio Console     (binding, Sync, OOS, Opublikuj + mail)
```
