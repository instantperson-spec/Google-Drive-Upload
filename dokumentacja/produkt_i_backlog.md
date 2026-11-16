# Produkt i backlog

> Aktualizacja: 2026-11-16 (P1 rundy + P2 mail)  
> Historyczne „kierunki rozwoju” (IX): [`archiwum/kierunki_rozwoju.md`](./archiwum/kierunki_rozwoju.md) · przegląd: [`archiwum/analiza_przegladowa_2026-11-16.md`](./archiwum/analiza_przegladowa_2026-11-16.md)

---

## Co działa dziś

| Obszar | Stan |
|---|---|
| Upload z tokenem (`/?token=`) | ✅ |
| UI upload: Nebula + glass, wymagana nazwa projektu, sticky Start, identity badge | ✅ |
| Flat upload + `/api/build-structure` + `_manifest.json` | ✅ |
| Czarna lista rozszerzeń (server) | ✅ |
| `/admin` — Modern Glass + Nebula (hero/KPI), History, tokeny, OAuth test | ✅ |
| Studio Console — Modern Glass + Nebula; **Wyślij zmiany** (delta, bez wersji/Final) | ✅ |
| Portal `/share/<id>` — rundy, filtr „od publikacji”, plik-po-pliku, dogrywki | ✅ |
| Mail do `prefillEmail` przy Opublikuj (`/api/share/…/notify-client`) | ✅ |
| UI share: nagłówek „Portal projektu” (PL/EN), Nebula + glass | ✅ |
| noindex / rate limit / drive.file | ✅ |

**Usunięte (świadomie):** Live Monitor ON/OFF w `/admin` — nieskuteczny multi-instance. Progress sesji w History → *In progress* z `_uploader_progress.json` (Drive + ETag), nie z pamięci lambdy.

---

## UI (Nebula + Modern Glass)

Wspólny język wizualny (mockupy: [`../mockups/`](../mockups/)):

- Tło **Nebula**, karty **modern glass**, akcent indigo / emerald  
- Upload + share: [`index.html`](../mockups/index.html), [`share.html`](../mockups/share.html)  
- Admin Vercel: [`admin.html`](../mockups/admin.html)  
- Studio Console (lokal): [`studio-console.html`](../mockups/studio-console.html) — Stack + tabs, wiersz sesji z primary + ⋯  
- **Bez** Bridge / TLS / API v3 / MB/s / ETA w UI klienta  

Plan upload (archiwum): [`archiwum/plany/upload_ui_nebula_centered.plan.md`](./archiwum/plany/upload_ui_nebula_centered.plan.md).

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
| [`team_project_sync_…`](./archiwum/plany/team_project_sync_76d281ab.plan.md) | ✅ → archiwum |
| [`client_portal_mvp_…`](./archiwum/plany/client_portal_mvp_97952dbb.plan.md) | ✅ → archiwum |
| [`upload_ui_nebula_centered…`](./archiwum/plany/upload_ui_nebula_centered.plan.md) | ✅ → archiwum |
| Admin: bez Live Monitor + History split | ✅ |
| Upload: wymagana nazwa + sticky Start | ✅ |
| [`post-mvp_roadmap_…`](./plany/post-mvp_roadmap_05ad683d.plan.md) | ⏳ **aktywny** — P0–P2 ✅ (rundy + mail); **następne: P3 feedback** |
| Security remediacja 2026-11-15 (P0–P2) | ✅ → [`archiwum/plany/security_audit_…`](./archiwum/plany/security_audit_remediation.plan.md) |
| Binding+OOS + progress Drive+ETag | ✅ (bez Redis/KV) |

**Poza planem:** konta klienta, dwukierunkowy sync z konfliktami, auto-watch folderu, ACL Drive na email klienta, pełny player NLE.

---

## Admin Vercel vs Studio Console

| | `/admin` (Vercel) | Studio Console (lokalnie) |
|---|---|---|
| Tokeny uploadu (`/?token=`) | ✅ CRUD (bez hub-bound) | ✅ lokalne tokeny (bez hub-bound) |
| Hub klienta (`/client`) | ✅ Invite + konta + assign | ✅ zakładka Clients (invite, konta, assign, proxy → Vercel) |
| Historia sesji Drive | ✅ In progress / Completed | pull / przegląd lokalny |
| Live Monitor (per-plik) | ❌ usunięty | — |
| Progress N/M (heartbeat) | ✅ w History → In progress | — |
| Sync origin + share + FromClient | — | ✅ |

Historyczny plan faz A/B/C admina: [`archiwum/plan_konsola_admina.md`](./archiwum/plan_konsola_admina.md).
