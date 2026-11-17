# Dokumentacja — Drive Uploader / Studio Console

> Ostatnia aktualizacja: 2026-11-17  
> Produkcja: `https://drive-uploader-three.vercel.app`

## Kanon (czytaj to)

| Dokument | Rola |
|---|---|
| [`operacje.md`](./operacje.md) | Runbook: tokeny, Opublikuj, share, mail, checklista |
| [`oauth_drive_file.md`](./oauth_drive_file.md) | Regeneracja refresh tokena `drive.file` |
| [`bezpieczenstwo.md`](./bezpieczenstwo.md) | **Jedyny żywy skrót** bezpieczeństwa (+ residual H-01/H-02) |
| [`produkt_i_backlog.md`](./produkt_i_backlog.md) | Co działa + backlog produktu |
| [`plany/post-mvp_roadmap_05ad683d.plan.md`](./plany/post-mvp_roadmap_05ad683d.plan.md) | Roadmap: P0–P2 ✅ → **P3 feedback** |
| [`../mockups/`](../mockups/) | Referencja UI |

## Archiwum

Historia (nie stan produkcji): [`archiwum/`](./archiwum/) — audyty, stare plany, [przegląd 2026-11-16](./archiwum/analiza_przegladowa_2026-11-16.md), [**raport kompleksowy 2026-11-17**](./archiwum/analiza_bezpieczenstwa_kompleksowa_2026-11-17.md).

## Mapa produktu

```
Klient upload   →  /?token=… / /client   (Vercel + Instant Project Studio)
Admin Vercel    →  /admin               (History, tokeny, hub, OAuth test)
Portal klienta  →  /share/<id>          (rundy, plik-po-pliku, FromClient/)
Studio          →  Studio Console       (Sync, Opublikuj, share + mail)
```
