# Analiza przeglądowa — bezpieczeństwo, martwy kod, plany

> Data: 2026-11-16 · **Re-check po wdrożeniu `fca5d29`** (Delivery rounds + share mail)  
> Zakres: `src/`, `studio-pull/`, `scripts/`, `dokumentacja/`, `mockups/`, root  
> Charakter: przegląd statyczny (bez pentestu dynamicznego)

---

## Werdykt (po `fca5d29`)

Bezpieczeństwo nadal **bez otwartych krytyków** (IDOR / wyciek upload tokenu / Console CSRF).  
**P1 rundy + P2 mail share są wdrożone** na `main` — największa luka produktowa to teraz **P3 feedback**.  
Residual security bez zmian: **S-01 / S-02 Medium**, S-03–S-04 Low. Hygiene z tego PR (env, LICENSE, martwe assety/CSS) nadal aktualna.

| Obszar | Stan po re-check |
|---|---|
| Security P0/P1 (audyt 15.11) | ✅ trzyma się |
| P1 Delivery v2 (Opublikuj / rounds) | ✅ `fca5d29` |
| P2 mail `prefillEmail` przy publikacji | ✅ `/api/share/[id]/notify-client` |
| P3 feedback Approve / Changes | ⏳ brak |
| S-01 tożsamość UI-only | ⏳ otwarte |
| Martwy kod (pdf-parse, SVG, bg, Live CSS, tauri stub) | ✅ posprzątane w tym PR |

---

## 1. Bezpieczeństwo

### Powierzchnia (zaktualizowana)

```
Internet
  ├── /?token=…                 → upload API (UPLOAD token)
  ├── /share/<id>               → lista / plik / FromClient (share id)
  ├── /share/<id>/notify-client → mail po Opublikuj (ADMIN_SECRET header)
  ├── /admin + /api/admin/*     → ADMIN_SECRET (cookie / header)
  └── Drive OAuth · SMTP · webhook
Lokalnie: Studio Console (:8787) → woła notify-client z ADMIN_SECRET z .env.local
```

### Utwardzone (OK) — bez regresji po `fca5d29`

| Obszar | Evidencja |
|---|---|
| Auth upload + ownership | `verifyUploadToken`, `_uploader_session.json` fail-closed |
| Share GET bez upload tokenu | nadal tylko id/label/rounds meta + pliki |
| **notify-client** | `verifyAdminPassword`; **tylko** `prefillEmail` z tokenu share; HTML escape; rate limit 10/min |
| Admin session | `sessionId.exp.sig` + TTL + revoke |
| Rate limit trusted IP | bez zmian |
| Console Host/Origin/token | bez zmian |
| ZIP / plik-po-pliku | bez zmian |

### Znaleziska residual (nadal otwarte)

| ID | Priorytet | Temat | Status po re-check |
|---|---|---|---|
| S-01 | **Medium** | `create-folder` / upload `notify` — name/email z body, nie z `prefill*` | ⏳ bez zmian |
| S-02 | **Medium** | upload `notify`: brak `prefillEmail` → dowolny email | ⏳; **P2 mail share jest lepszy** (wymaga prefill) |
| S-03 | **Low** | PII w `console.warn` mismatch | ⏳ |
| S-04 | **Low** | SA fallback w `getAuthClient` | ⏳ (`.env.example` już OAuth-first) |
| S-05 | Info | Rate limit / revoke per warm instance | świadome |
| S-09 | Info | `ADMIN_SECRET` jako klucz M2M Console→Vercel dla maila | OK dla modelu lokalnego; wyciek `.env.local` = możliwość wysyłki share-maili |

### Nowy endpoint — ocena

`POST /api/share/[id]/notify-client` (`fca5d29`): **bezpieczny w założeniach P2** — nie jest open relay (wymaga admin secret + zarejestrowanego `prefillEmail`). Nie wprowadza regresji względem VULN-02.

---

## 2. Martwy kod / śmieci

Hygiene z tego PR: `pdf-parse`, default SVG, `bg.jpg`, Live Monitor CSS, nieużywane eksporty, stub `tauri/`, `LICENSE`, sync README/`.env.example`/`operacje.md`.

Zostaje (świadomie): `mockups/`, `dokumentacja/archiwum/`, ops `scripts/*`, duplikacja `formatBytes`/`formatDate`, monolity UI (security P3 arch).

---

## 3. Plany wdrożenia (po `fca5d29`)

| Etap | Plan | Kod |
|---|---|---|
| P0 Stabilizacja | ✅ | ✅ |
| **P1 Delivery v2 rundy** | ✅ | ✅ `publishRound` / `publishAndShare` / portal `vsPrevRound` + filtr od publikacji |
| **P2 Mail share** | ✅ | ✅ Console → `notify-client` na `prefillEmail` |
| **P3 Feedback** | ⏳ | ❌ brak Approve / Changes / `_team_feedback` |
| Security P3 arch dedupe | ⏳ | pending |

---

## 4. Rekomendowana kolejność dalej

1. **S-01** — serwerowa walidacja `prefill*` w `create-folder` (+ spójnie upload `notify`).  
2. **S-03** — bez emaili w logach mismatch.  
3. **Produkt P3** — feedback w portalu.  
4. Security P3 — wspólny moduł Drive / split monolitów.

---

## 5. Dokumenty kanoniczne

| Dokument | Rola |
|---|---|
| [`../bezpieczenstwo.md`](../bezpieczenstwo.md) | Żywy skrót security |
| Ten plik (archiwum) | Snapshot przeglądu 2026-11-16 + re-check po rundach |
| [`../produkt_i_backlog.md`](../produkt_i_backlog.md) | Stan produktu (P0–P2 ✅) |
| [`../plany/post-mvp_roadmap_….plan.md`](../plany/post-mvp_roadmap_05ad683d.plan.md) | Aktywny plan → **P3** |
