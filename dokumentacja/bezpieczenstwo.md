# Bezpieczeństwo — stan aktualny

> Skrót na 2026-11-15. Pełne raporty VULN z IX 2026: [`archiwum/analiza_bezpieczenstwa.md`](./archiwum/analiza_bezpieczenstwa.md), [`archiwum/analiza_kodu.md`](./archiwum/analiza_kodu.md).

---

## Powierzchnia ataku

```
Internet
  ├── /?token=…          → upload API (auth: UPLOAD token)
  ├── /share/<id>        → lista / plik / upload-session FromClient (auth: share id)
  ├── /admin + /api/admin/* → ADMIN_SECRET (HttpOnly cookie)
  └── Google Drive (OAuth drive.file) · SMTP (whitelist vs prefillEmail) · webhooks
```

Lokalnie: Studio Console (Tauri / localhost) — nie jest publicznym API Vercel.

---

## Naprawione — nie otwierać ponownie bez powodu

| ID | Temat | Stan |
|---|---|---|
| VULN-01 | Auth na API uploadu | ✅ token server-side |
| VULN-02 | Open SMTP relay | ✅ whitelist vs `prefillEmail` |
| VULN-03 | SMTP `secure` vs port | ✅ |
| VULN-04 | Rate limiting | ✅ in-memory per IP |
| VULN-05 | Scope OAuth | ✅ `drive.file` — [`oauth_drive_file.md`](./oauth_drive_file.md) |
| VULN-06 | Logowanie PII | ✅ |
| VULN-07 | noindex | ✅ |
| VULN-08 | Weryfikacja emaila klienta (OTP) | ⚠️ celowo pominięte (B2B bez kont) |

Dodatkowo: czarna lista rozszerzeń server-side, weryfikacja `folderId` sesji, rzadki heartbeat progress (admin History).

---

## Świadome ograniczenia

- **Progress / rate-limit in-memory** — przy wielu workerach Vercel „In progress” w History może być puste mimo trwającego uploadu; wtedy widać sesję w Completed z rosnącym `fileCount` po Refresh. KV = backlog.
- **Live Monitor usunięty** — nie dawał wiarygodnego podglądu multi-instance; zastąpiony prostym merge active → History.
- **Share / upload token = sekret URL** — kto ma link, ma dostęp. Revoke w Console / `/admin`.

UI klienta **nie** reklamuje TLS/Bridge jako badge’e bezpieczeństwa (świadomie odchudzone).

---

## Otwarty backlog hardening (niski priorytet)

- `formatDate` / `formatBytes` w adminie → wspólne `lib/`
- Email regex → `isValidEmail()` w `lib/validation.js`
- Inline styles w `AdminTokenManager` → CSS
- Admin: recovery UI z `_manifest.json`
- Vercel KV dla progress store

Produkt (binding, plik-po-pliku, rundy): [`produkt_i_backlog.md`](./produkt_i_backlog.md), [`plany/post-mvp_roadmap_05ad683d.plan.md`](./plany/post-mvp_roadmap_05ad683d.plan.md).
