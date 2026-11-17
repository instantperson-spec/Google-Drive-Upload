# Bezpieczeństwo — stan aktualny

> Skrót na **2026-11-17** (jedyny żywy dokument stanu).  
> Raport kompleksowy: [`archiwum/analiza_bezpieczenstwa_kompleksowa_2026-11-17.md`](./archiwum/analiza_bezpieczenstwa_kompleksowa_2026-11-17.md).  
> Historia: [`archiwum/audyt-bezpieczenstwa.md`](./archiwum/audyt-bezpieczenstwa.md), [`archiwum/analiza_przegladowa_2026-11-16.md`](./archiwum/analiza_przegladowa_2026-11-16.md), VULN IX: [`archiwum/analiza_bezpieczenstwa.md`](./archiwum/analiza_bezpieczenstwa.md).  
> Plan remediacji (done): [`archiwum/plany/security_audit_remediation.plan.md`](./archiwum/plany/security_audit_remediation.plan.md).

---

## Powierzchnia ataku

```
Internet
  ├── /?token=…                         → upload API (UPLOAD token; hubBound tylko przez sesję)
  ├── /client + /api/client/*           → Instant Project Studio (invite / login / projects)
  ├── /share/<id>                       → lista / plik / FromClient (auth: share id)
  ├── /share/<id>/notify-topup          → mail po dogrywce (⚠️ tylko share id — H-01)
  ├── /share/<id>/notify-client         → mail po Opublikuj (ADMIN_SECRET)
  ├── /admin + /api/admin/*             → ADMIN_SECRET (HttpOnly cookie / header)
  └── Google Drive (OAuth drive.file) · SMTP · webhooks
```

Lokalnie: Studio Console (Tauri / localhost) — Host/Origin/token; `ADMIN_SECRET` do proxy Vercel.

---

## Naprawione (VULN IX + audyt 2026-11-15)

| Temat | Stan |
|---|---|
| VULN-01 Auth upload API | ✅ |
| VULN-02 Open SMTP relay (główna ścieżka) | ✅ whitelist `prefillEmail` — **wyjątki: S-02, H-01** |
| VULN-03 SMTP secure/port | ✅ |
| VULN-04 Rate limiting | ✅ (IP: vercel / cf / bezpieczny XFF) |
| VULN-05 OAuth `drive.file` | ✅ — [`oauth_drive_file.md`](./oauth_drive_file.md) |
| VULN-06 PII w logach | ✅ częściowo — S-03 residual |
| VULN-07 noindex | ✅ |
| VULN-08 OTP klienta | ⚠️ celowo pominięte (B2B); hub = hasło + invite |
| Share GET bez upload `token` | ✅ |
| Token ↔ folder (`_uploader_session.json`) + cache ownership | ✅ |
| Console: Host/Origin/token; `Origin: null` zablokowany | ✅ |
| Admin session: losowy id + TTL + revoke | ✅ |
| Hub: invite-only, scrypt, hubBound session-only | ✅ (nowe — z residual poniżej) |
| Progress/tokeny: Drive + ETag | ✅ mechanizm; **H-02 plaintext token** |

---

## Residual / nowe (2026-11-17)

| ID | Priorytet | Temat |
|---|---|---|
| **H-01** | **High** | `notify-topup` bez auth poza share id → spam SMTP / fałszywa lista plików |
| **H-02** | **High** | Progress store + `/api/admin/active` — **plaintext upload token** |
| S-01 | Medium | Tożsamość name/email tylko w UI (`create-folder` / notify) |
| S-02 | Medium | Notify bez `prefillEmail` → dowolny email |
| S-06 | Medium | Hub `clientProjects` match po emailu progress (spoof + S-01) |
| S-07 | Medium | `CLIENT_SESSION_SECRET` fallback = `ADMIN_SECRET` |
| S-08 | Medium | Register invite nieatomowy (`createToken` / client / consume) |
| S-09 | Medium | Brak max długości hasła (scrypt DoS) |
| S-15 | Medium | `validate-token` echo `{ token }` — wyciek `linkedToken` przy sesji hub |
| S-16 | Medium | Console pull: `path.join(destRoot, relativePath)` bez confinement (`..`) |
| S-03 | Low | PII w `console.warn` mismatch |
| S-04 | Low | SA fallback w `getAuthClient` |
| S-10 | Info | Rate-limit / quota / revoke / lockout per warm instance |

Szczegóły, god objects, kolejność fixów: raport kompleksowy (link wyżej).

---

## Świadome ograniczenia

- Rate-limit, shareQuota, revoke admin/client, login lockout — per warm instance Vercel.  
- Progress na Drive+ETag (opóźnienie Drive OK; bez płatnego Redis).  
- Share id = sekret URL.  
- Stare foldery bez `_uploader_session.json` → nowa sesja uploadu.  
- Live Monitor usunięty (nieskuteczny multi-instance).

---

## Backlog (niski / arch)

- Wspólny moduł Drive + rozbicie monolitów UI i `clientStore` (P3)  
- ETag na `_uploader_shares.json` / `_team_manifest.json`  
- Drobne: `formatBytes`/`isValidEmail` wspólne, CSS admina  

Produkt: [`produkt_i_backlog.md`](./produkt_i_backlog.md).
