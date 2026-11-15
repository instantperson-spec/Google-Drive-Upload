# Produkt i backlog

> Aktualizacja: 2026-11-15  
> Historyczne „kierunki rozwoju” (IX): [`archiwum/kierunki_rozwoju.md`](./archiwum/kierunki_rozwoju.md)

---

## Co działa dziś

| Obszar | Stan |
|---|---|
| Upload z tokenem (`/?token=`) | ✅ |
| UI upload: Nebula + glass, wymagana nazwa projektu, sticky Start, identity badge | ✅ |
| Flat upload + `/api/build-structure` + `_manifest.json` | ✅ |
| Czarna lista rozszerzeń (server) | ✅ |
| `/admin` — History (In progress / Completed), tokeny, OAuth test | ✅ |
| Studio Console (pull, Sync, share, FromClient, Out of sync) | ✅ |
| Portal `/share/<id>` — lista, KPI-filtry, ZIP download, dogrywki | ✅ |
| UI share: nagłówek „Portal projektu” (PL/EN), Nebula + glass | ✅ |
| noindex / rate limit / drive.file | ✅ |

**Usunięte (świadomie):** Live Monitor ON/OFF w `/admin` — nieskuteczny na Vercel (in-memory). Progress sesji w History → *In progress* (gdy heartbeat trafi w tę samą instancję).

---

## UI klienta (Nebula Centered)

Wspólny język wizualny upload + share (mockupy: [`../mockups/`](../mockups/)):

- Tło **Nebula**, karta **glass**, akcent slate + indigo  
- **Bez** Bridge / TLS / API v3 / MB/s / ETA w UI  
- Upload: placeholder projektu `nowy projekt` / `new project`; success → opcjonalnie Open Drive  
- Share: H1 „Portal projektu” / „Project portal”; pasek „Projekt: …”; język z przeglądarki (`pl*` → PL)

Plan: [`plany/upload_ui_nebula_centered.plan.md`](./plany/upload_ui_nebula_centered.plan.md) (wdrożony).

---

## Backlog UX (uploader) — niski priorytet

- Pole „Notatki / numer projektu” → plik tekstowy obok uploadu  
- Przekierowanie po sukcesie na stronę studia  
- Ręczna pauza / wznowienie per plik  
- Alert przy bardzo dużej „drobnicy” (np. >500 małych plików)  
- Awaryjne `CHUNK_SIZE` 128–256 MB tylko przy 429 od Google  
- Lepszy copy podtytułu uploadu (EN) — do ustalenia  

---

## Roadmap produktowy

| Plan | Stan |
|---|---|
| [`team_project_sync_…`](./plany/team_project_sync_76d281ab.plan.md) | ✅ wdrożony (kontekst) |
| [`client_portal_mvp_…`](./plany/client_portal_mvp_97952dbb.plan.md) | ✅ wdrożony (kontekst) |
| [`upload_ui_nebula_centered…`](./plany/upload_ui_nebula_centered.plan.md) | ✅ wdrożony |
| Admin: bez Live Monitor + History split | ✅ wdrożony |
| Upload: wymagana nazwa + sticky Start | ✅ wdrożony |
| [`post-mvp_roadmap_…`](./plany/post-mvp_roadmap_05ad683d.plan.md) | ⏳ **aktywny** — P0 binding, pobieranie plik-po-pliku, OOS; P1 rundy; P2 mail; P3 feedback |

**Poza planem:** konta klienta, dwukierunkowy sync z konfliktami, auto-watch folderu, ACL Drive na email klienta, pełny player NLE.

---

## Admin Vercel vs Studio Console

| | `/admin` (Vercel) | Studio Console (lokalnie) |
|---|---|---|
| Tokeny uploadu | ✅ CRUD | lokalne tokeny / narzędzia |
| Historia sesji Drive | ✅ In progress / Completed | pull / przegląd lokalny |
| Live Monitor (per-plik) | ❌ usunięty | — |
| Progress N/M (heartbeat) | ✅ w History → In progress | — |
| Sync origin + share + FromClient | — | ✅ |

Historyczny plan faz A/B/C admina: [`archiwum/plan_konsola_admina.md`](./archiwum/plan_konsola_admina.md).
