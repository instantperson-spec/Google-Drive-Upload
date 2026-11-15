# Bezpieczeństwo — stan aktualny

> Skrót na 2026-11-14. Pełne raporty VULN z IX 2026: [`archiwum/analiza_bezpieczenstwa.md`](./archiwum/analiza_bezpieczenstwa.md), [`archiwum/analiza_kodu.md`](./archiwum/analiza_kodu.md).

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

## Naprawione (security-hardening + security-fixes) — nie otwierać ponownie bez powodu

| ID | Temat | Stan |
|---|---|---|
| VULN-01 | Auth na API uploadu | ✅ token server-side |
| VULN-02 | Open SMTP relay | ✅ whitelist vs `prefillEmail` w registry |
| VULN-03 | SMTP `secure` vs port | ✅ |
| VULN-04 | Rate limiting | ✅ (in-memory; limit per IP) |
| VULN-05 | Scope OAuth | ✅ tylko `drive.file` — diagnostyka: [`oauth_drive_file.md`](./oauth_drive_file.md) |
| VULN-06 | Logowanie PII | ✅ |
| VULN-07 | noindex | ✅ |
| VULN-08 | Weryfikacja emaila klienta (OTP itd.) | ⚠️ **celowo pominięte** — akceptowane dla B2B bez kont |

Dodatkowo: czarna lista rozszerzeń server-side, weryfikacja `folderId` sesji, Live Monitor (mniej invocacji Vercel).

---

## Świadome ograniczenia produkcyjne

- **Progress / rate-limit in-memory** — przy wielu workerach Vercel „Active now” i limity mogą być niespójne; przy obecnym ruchu zwykle OK. KV = backlog.
- **Share link = sekret URL** — kto ma link, ma portal (jak WeTransfer). Revoke w Console.
- **Upload token = sekret URL** — to samo; Revoke w `/admin`.

---

## Otwarty backlog jakości / hardening (niski priorytet)

Z dawnej analizy kodu — nadal sensowne, nie blokuje produkcji:

- `formatDate` / lokalny `formatBytes` w adminie → wspólne `lib/`
- Email regex → jedna `isValidEmail()` w `lib/validation.js`
- `key={index}` w listach plików → stabilne id
- Inline styles w `AdminDashboard` / `AdminTokenManager` → CSS
- Admin: ręczne odtworzenie struktury z `_manifest.json` (recovery UI)
- Vercel KV dla progress store (gdy multi-instance stanie się problemem)

Produkt / portal (binding, pobieranie plik-po-pliku, rundy): [`produkt_i_backlog.md`](./produkt_i_backlog.md) i [`plany/post-mvp_roadmap_05ad683d.plan.md`](./plany/post-mvp_roadmap_05ad683d.plan.md).
