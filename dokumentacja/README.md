# Dokumentacja — Drive Uploader / Studio Console

> Ostatnia aktualizacja: 2026-11-16  
> Produkcja: `https://drive-uploader-three.vercel.app`

## Kanon (czytaj to)

| Dokument | Rola |
|---|---|
| [`operacje.md`](./operacje.md) | Runbook: tokeny, Opublikuj, share, mail, checklista |
| [`oauth_drive_file.md`](./oauth_drive_file.md) | Regeneracja refresh tokena `drive.file` |
| [`bezpieczenstwo.md`](./bezpieczenstwo.md) | **Jedyny żywy skrót** bezpieczeństwa (+ residual) |
| [`produkt_i_backlog.md`](./produkt_i_backlog.md) | Co działa + backlog produktu |
| [`plany/post-mvp_roadmap_05ad683d.plan.md`](./plany/post-mvp_roadmap_05ad683d.plan.md) | Roadmap: P0–P2 ✅ → **P3 feedback** |
| [`plany/frameio_review_module.plan.md`](./plany/frameio_review_module.plan.md) | Frame.io vs portal surowki — pozycjonowanie (bez budowy Frame) |
| [`../mockups/`](../mockups/) | Referencja UI |

## Archiwum

Historia (nie stan produkcji): [`archiwum/`](./archiwum/) — audyty, stare plany, [przegląd 2026-11-16](./archiwum/analiza_przegladowa_2026-11-16.md).

## Mapa produktu

```
Klient upload   →  /?token=…          (Vercel)
Admin Vercel    →  /admin             (History, tokeny, OAuth test)
Portal klienta  →  /share/<id>        (rundy, plik-po-pliku, FromClient/)
Studio          →  Studio Console     (Sync, Opublikuj, share + mail)
```
