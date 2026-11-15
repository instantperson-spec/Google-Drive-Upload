# Produkt i backlog

> Aktualizacja: 2026-11-14  
> Historyczne „kierunki rozwoju” (IX): [`archiwum/kierunki_rozwoju.md`](./archiwum/kierunki_rozwoju.md)

---

## Co działa dziś

| Obszar | Stan |
|---|---|
| Upload z tokenem (`/?token=`) | ✅ |
| Flat upload + `/api/build-structure` + `_manifest.json` | ✅ |
| Czarna lista rozszerzeń (server) | ✅ |
| `/admin` — sesje, Live Monitor, tokeny, OAuth test | ✅ |
| Studio Console (pull, Sync, share, FromClient) | ✅ |
| Portal `/share/<id>` — lista, ZIP download, dogrywki | ✅ |
| noindex / rate limit / drive.file | ✅ |

---

## Backlog UX (uploader) — niski priorytet

Nadal z dawnych kierunków, **nie** wdrożone:

- Pole „Notatki / numer projektu” → plik tekstowy obok uploadu
- Przekierowanie po sukcesie na stronę studia
- Ręczna pauza / wznowienie per plik
- Alert przy bardzo dużej „drobnicy” (np. >500 małych plików)
- Awaryjne `CHUNK_SIZE` 128–256 MB tylko przy 429 od Google

---

## Roadmap produktowy (aktywny)

Szczegóły w [`plany/`](./plany/):

1. **[`post-mvp_roadmap_05ad683d.plan.md`](./plany/post-mvp_roadmap_05ad683d.plan.md)** — P0 binding + pobieranie plik-po-pliku do folderu + OOS; potem Delivery v2 (rundy), mail share, feedback Approve/Changes  
2. **[`client_portal_mvp_97952dbb.plan.md`](./plany/client_portal_mvp_97952dbb.plan.md)** — założenia MVP portalu (wdrożone; kontekst)  
3. **[`team_project_sync_76d281ab.plan.md`](./plany/team_project_sync_76d281ab.plan.md)** — założenia team sync / share (wdrożone; kontekst)

**Poza planem (świadomie):** konta klienta, dwukierunkowy sync z konfliktami, auto-watch folderu, ACL Drive na email klienta, pełny player NLE.

---

## Admin Vercel vs Studio Console

| | `/admin` (Vercel) | Studio Console (lokalnie) |
|---|---|---|
| Tokeny uploadu | ✅ CRUD | lokalne tokeny / narzędzia |
| Historia sesji Drive | ✅ | pull / przegląd lokalny |
| Live progress | ✅ (Live Monitor) | — |
| Sync origin + share + FromClient | — | ✅ |

Historyczny plan faz A/B/C admina: [`archiwum/plan_konsola_admina.md`](./archiwum/plan_konsola_admina.md).
