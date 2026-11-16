# Bezpieczeństwo — stan aktualny

> Skrót na 2026-11-15 (jedyny żywy dokument stanu).  
> Historia: [`archiwum/audyt-bezpieczenstwa.md`](./archiwum/audyt-bezpieczenstwa.md), [`archiwum/audyt-powdrozeniowy.md`](./archiwum/audyt-powdrozeniowy.md), VULN IX: [`archiwum/analiza_bezpieczenstwa.md`](./archiwum/analiza_bezpieczenstwa.md).  
> Plan remediacji (done): [`archiwum/plany/security_audit_remediation.plan.md`](./archiwum/plany/security_audit_remediation.plan.md).

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

## Naprawione (VULN IX + audyt 2026-11-15)

| Temat | Stan |
|---|---|
| VULN-01 Auth upload API | ✅ |
| VULN-02 Open SMTP relay | ✅ whitelist `prefillEmail` |
| VULN-03 SMTP secure/port | ✅ |
| VULN-04 Rate limiting | ✅ (IP: vercel / cf / bezpieczny XFF) |
| VULN-05 OAuth `drive.file` | ✅ — [`oauth_drive_file.md`](./oauth_drive_file.md) |
| VULN-06 PII w logach | ✅ |
| VULN-07 noindex | ✅ |
| VULN-08 OTP klienta | ⚠️ celowo pominięte (B2B) |
| Share GET bez upload `token` | ✅ |
| Token ↔ folder (`_uploader_session.json`) + cache ownership | ✅ |
| Console: Host/Origin/token; `Origin: null` zablokowany; `?consoleToken=` tylko SSE | ✅ |
| Tauri fingerprint `:8787` | ✅ |
| WAV: md5/mtime w sync + baseline/share | ✅ |
| Crash log przed `ref = null` | ✅ |
| Admin session: losowy id + TTL + revoke | ✅ |
| notify: escape email + ownership | ✅ |
| Share download plik-po-pliku; ZIP tylko małe | ✅ |
| Share upload quota | ✅ |
| Progress/tokeny: Drive + ETag (nagłówek HTTP; **bez Redis/KV**) | ✅ |
| Share file `request.signal`; `folderCache` TTL | ✅ |
| sessionId ownership w upload-progress | ✅ |
| SKIP_NAMES (`_uploader_session.json`, manifesty) | ✅ |
| `.gitignore` `.tmp*`; `isSessionFolder` fail-closed | ✅ |

---

## Świadome ograniczenia

- Rate-limit, shareQuota, revoke admin — per warm instance Vercel.  
- Progress na Drive+ETag (opóźnienie Drive OK; bez płatnego Redis).  
- Share id = sekret URL.  
- Stare foldery bez `_uploader_session.json` → nowa sesja uploadu.  
- Live Monitor usunięty (nieskuteczny multi-instance).

---

## Residual (przegląd 2026-11-16)

| Temat | Priorytet | Notatka |
|---|---|---|
| Tożsamość name/email tylko w UI (`create-folder` / notify) | Medium | Serwer nie wymusza `prefill*` z tokenu |
| Notify bez `prefillEmail` → dowolny email | Medium | Głównie legacy / env tokeny |
| Log mismatch z emailami | Low | PII w `console.warn` |
| SA fallback + stare `.env.example` | Low | Hygiene (przykład env zsynchronizowany w tym samym przeglądzie) |

Pełny raport: [`analiza_przegladowa.md`](./analiza_przegladowa.md).

---

## Backlog (niski)

- Wspólny moduł Drive + rozbicie monolitów UI (P3)  
- ETag na `_uploader_shares.json` / `_team_manifest.json`  
- Drobne: `formatBytes`/`isValidEmail` wspólne, CSS admina, recovery UI manifest  

Produkt: [`produkt_i_backlog.md`](./produkt_i_backlog.md), rundy: [`plany/post-mvp_roadmap_05ad683d.plan.md`](./plany/post-mvp_roadmap_05ad683d.plan.md).
