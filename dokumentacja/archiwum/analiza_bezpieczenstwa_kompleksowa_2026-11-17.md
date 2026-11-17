# Kompleksowa analiza bezpieczeństwa — 2026-11-17

> Zakres: `main` (po Client Hub / Instant Project Studio) · `src/` · `studio-pull/` · auth / SMTP / Drive  
> Charakter: przegląd statyczny (bez pentestu dynamicznego)  
> Tematy: **god objects**, **błędy logiki**, **naruszenia / residual**, powierzchnia ataku  
> Skrót żywy: [`../bezpieczenstwo.md`](../bezpieczenstwo.md)

---

## Werdykt

Brak oczywistego **Critical** typu „publiczne IDOR bez sekretu” na upload API (token + ownership fail-closed trzymają się).  
Po wdrożeniu **Client Hub** i **notify-topup** powierzchnia urosła — pojawiają się nowe **High/Medium**, których nie było w audycie z 15–16.11.

| Obszar | Ocena |
|---|---|
| Upload token + folder ownership | ✅ solidne (fail-closed) |
| Admin cookie / header | ✅ |
| Share capability URL | ⚠️ model akceptowany; wysoki wpływ wycieku |
| Client Hub (hasła, invite, sesje) | ⚠️ nowa powierzchnia — kilka Medium |
| SMTP / notify | ⚠️ S-01/S-02 + **nowe H-01 notify-topup** |
| God objects / koncentracja ryzyka | ⚠️ monolity UI + `clientStore` / `progressStore` |
| Rate limit / quota / revoke | Info — per warm instance (świadome) |

---

## 1. Powierzchnia ataku (aktualna)

```
Internet
  ├── /?token=…                         → upload API (UPLOAD token; hubBound odrzucany w headerze)
  ├── /client + /api/client/*           → hub: invite probe, register, login, projects, upload-context
  ├── /share/<id>                       → lista / plik / FromClient upload (auth = share id)
  ├── /share/<id>/notify-topup          → SMTP studio (+ klient)  ⚠️ bez ADMIN_SECRET
  ├── /share/<id>/notify-client         → mail po Opublikuj (ADMIN_SECRET)
  ├── /admin + /api/admin/*             → ADMIN_SECRET (cookie / x-admin-secret)
  └── Drive OAuth drive.file · SMTP · WEBHOOK_URL

Lokalnie: Studio Console :8787 (Host/Origin/token) → proxy admin / notify-client z ADMIN_SECRET
```

---

## 2. Znaleziska (priorytet)

### High

| ID | Temat | Evidencja | Remediacja |
|---|---|---|---|
| **H-01** | `POST /api/share/[id]/notify-topup` — **brak auth poza share id**; dowolny posiadacz linku może spamować SMTP do `NOTIFICATION_EMAIL` i (gdy jest `prefillEmail`) do klienta z **sfabrykowaną listą plików** | `src/app/api/share/[id]/notify-topup/route.js` | Wymagać dowodu uploadu (np. batchId faktycznie na Drive + checksum) **lub** HMAC one-shot z sesji uploadu **lub** ADMIN_SECRET / hub session; rate limit per share + cap treści |
| **H-02** | `_uploader_progress.json` przechowuje **plaintext upload token**; `GET /api/admin/active` zwraca `...session` w tym `token` | `progressStore.js` `upsertProgressSession`; `admin/active/route.js` | Trzymać tylko `tokenFp` (jak ownership); admin API: strip `token`; rotacja przy wycieku pliku progress |

### Medium

| ID | Temat | Evidencja | Remediacja |
|---|---|---|---|
| **S-01** | `create-folder` / progress / notify — **name/email z body**, nie wymuszone z `prefill*` tokenu | `create-folder/route.js`, `notify/route.js` | Serwer: jeśli token ma `prefillEmail`/`prefillName` → nadpisz body |
| **S-02** | `notify`: brak `prefillEmail` → **dowolny email** uploadera (open relay dla legacy/env tokenów) | `notify/route.js` L91–94 | Fail-closed: bez prefill → bez maila do uploadera |
| **S-06** | Hub projekty: match po **`uploaderEmail`** z progress → w połączeniu z S-01 atakujący z własnym tokenem może **wpiąć folder / share** na listę ofiary (email spoof) | `clientProjects.js` L86–88 | Usunąć `emailMatch` albo wymagać zgodności z prefill + ownership; preferować tylko `linkedToken` + memberships |
| **S-07** | `CLIENT_SESSION_SECRET \|\| ADMIN_SECRET` — to samo tajemnica = hasło admina **i** HMAC sesji klienta | `clientAuth.js` | Osobny `CLIENT_SESSION_SECRET` obowiązkowy w prod; nie reuse hasła UI |
| **S-08** | Rejestracja invite: `createToken` → `createClient` → `consumeInvite` **nieatomowe** (osierocone tokeny / race) | `client/register/route.js` | Jedna mutacja / kompensacja; consume przed lub w tej samej transakcji logicznej co client |
| **S-09** | Brak **max długości hasła** → potencjalny DoS przez `scryptSync` na dużym input | `register`, `clientStore.hashPassword` | Cap np. 128–256 znaków przed scrypt |
| **S-10** | Share upload quota + rate limit + login lockout + revoke sesji — **per warm instance** (efektywnie fail-soft) | `shareQuota.js`, `rateLimit.js`, `clientAuth` / `adminAuth` | Świadome; dokumentować; krytyczne limity → Drive/ETag lub edge KV gdy potrzeba |
| **S-15** | `POST /api/validate-token` zwraca `{ token }` — przy samej sesji hub (cookie, bez headera) **wycieka `linkedToken` do przeglądarki**, wbrew modelowi session-only (header `x-upload-token` i tak odrzuca hubBound) | `validate-token/route.js`; `auth.js` cookie path | Nie zwracać slug; hub → tylko `{ valid, prefill, locale }` jak `upload-context` |
| **S-16** | Studio Console: `path.join(destRoot, file.relativePath)` **bez** `path.resolve` + `startsWith(destRoot)` — nazwa pliku/`..` z Drive może wyjść poza katalog sesji | `studio-pull/lib/download.mjs` L66; `syncStatus.mjs` L44 | Sanityzacja relativePath; reject `..` / absolute; assert resolved path under root |

### Low / Info

| ID | Temat | Notatka |
|---|---|---|
| S-03 | PII w `console.warn` mismatch notify | Maskować emaile |
| S-04 | SA fallback w `getAuthClient` | OAuth-first w `.env.example`; usuń SA gdy nieużywane |
| S-05 | Share id = sekret URL | Model B2B; revoke + krótka ważność opcjonalnie |
| S-11 | Invite probe ujawnia email dla ważnego invite | UX; rate limit OK; nie eskalować |
| S-12 | `upload-session` przyjmuje `name` ze ścieżką (`a/b/c`) | Rodzic = folderId (OK); spłaszczyć basename jak w share upload |
| S-13 | `progressStore.saveRegistry` połyka błąd zapisu | Silent fail heartbeat — monitoring |
| S-14 | Hashe haseł klientów w `_uploader_clients.json` na Drive | Akceptowalne (scrypt); koncentracja w god-store — ACL Drive |
| S-17 | Soft-open: `UPLOAD_TOKENS` env gdy Drive store pada | Tylko znane env slugi — OK jako degrade; nie mylić z bypass |
| S-18 | Brak magic-bytes MIME (tylko extension blocklist) | Świadomie OOS |

---

## 3. Co jest dobrze zrobione (nie regresować)

- Upload: `verifyUploadToken` + `assertFolderOwnedByToken` fail-closed; hub-bound tokenów nie da się użyć przez `x-upload-token`.
- Hub: invite-only register, email musi = invite, invite hash (SHA-256), TTL 7 dni, scrypt haseł, cookie HttpOnly, timing-safe HMAC sesji.
- Share download: `assertFileInShareFolder` (walk parents).
- Share FromClient: basename + `batchId` regex + quota.
- `notify-client`: ADMIN_SECRET + tylko `prefillEmail`.
- Console: Host/Origin allowlist; `Origin: null` zablokowany; query `consoleToken` tylko SSE.
- Rate limit: preferuje Vercel/CF IP, nie ślepy XFF.

---

## 4. God objects — koncentracja ryzyka

| Moduł | ~LOC | Co trzyma | Ryzyko |
|---|---|---|---|
| `src/app/globals.css` | ~2473 | Globalne style | Monolit CSS (P3) |
| `studio-pull/ui/app.js` | ~2002 | Całe UI Console | Błędy auth/UX w jednym pliku; trudny review |
| `studio-pull/ui-server.mjs` | ~1309 | HTTP API, publish, mail, proxy hub | M2M `ADMIN_SECRET`, Origin, SSE |
| `SharePage.js` | ~935 | Portal share + upload | Cała UX Capability URL |
| `AdminClientManager.js` | ~702 | Admin hub UI | Invites / linkowanie tokenów |
| **`clientStore.js`** | ~656 | Klienci + hasła + invites + memberships | **God data store** — wyciek pliku = konta |
| `ClientHub.js` | ~545 | UI logowania / projektów | |
| `tokenStore.js` | ~462 | Tokeny upload + hubBound | |
| `shareStore.js` | ~453 | Share registry + listing + download | Capability + FromClient |
| `progressStore.js` | ~276 | Heartbeat + **plaintext token** | H-02 |

**Naruszenie architektoniczne (nie „bug”, ale ryzyko):** jeden plik Drive = wiele domen bezpieczeństwa (`clientStore`: authN + authZ + invite). Rozbić: `clients` / `invites` / `memberships` lub przynajmniej osobne pliki JSON + mniejsze API surface.

**UI monolit:** Console + Share — osobny refactor P3 (już w backlogu), nie bloker security hotfixów.

---

## 5. Błędy logiki (ścieżki)

1. **S-01 → S-06:** spoof email w progress → hub ofiary widzi obcy `folderId` / ewentualnie `shareId`.  
2. **H-01:** top-up mail ≠ dowód uploadu — powiadomienie da się wysłać bez pliku na Drive.  
3. **S-08:** częściowa rejestracja zostawia `hubBound` token bez konta / zaproszenie w niejednoznacznym stanie przy race.  
4. **Quota share:** wiele instancji Vercel = wielokrotność limitu (S-10).  
5. **notify S-02:** legacy token bez prefill = SMTP do adresu z requestu (świadomy wyjątek — powinien zniknąć).  
6. **S-15:** hub cookie + `validate-token` → slug w JSON (UI hub używa `upload-context`, ale endpoint zostaje footgunem).  
7. **S-16:** złośliwa nazwa na Drive → zapis poza `destRoot` przy pull w Console.

---

## 6. Naruszenia polityki / modelu zagrożeń

| Zasada | Stan |
|---|---|
| Least privilege Drive (`drive.file`) | ✅ OAuth ścieżka |
| Fail-closed ownership folderów | ✅ |
| Brak open SMTP relay | ⚠️ H-01 + S-02 dziury |
| Separacja sekretów (admin ≠ client) | ❌ S-07 fallback |
| Nie logować PII | ⚠️ S-03 |
| Token upload nie w storage plaintext | ❌ H-02 |
| Hubbound slug nigdy w przeglądarce | ⚠️ S-15 (`validate-token` echo) |
| Path confinement lokalnego pull | ❌ S-16 |
| Konta klienta poza scope → **wdrożone** | Hub jest — audyt musi nadążać |

---

## 7. Rekomendowana kolejność remediacji

1. **H-02** — fingerprint w progress + strip token z admin API (szybkie, wysoki zwrot).  
2. **H-01** — utwardzić `notify-topup` (dowód batch / auth).  
3. **S-15 + S-16** — nie echo tokenu; confine `relativePath` w Console.  
4. **S-01 + S-06** — lock prefill + usuń/zaostrz emailMatch w hub projects.  
5. **S-02** — fail-closed notify bez prefill.  
6. **S-07 / S-09 / S-08** — osobny secret, max password, atomowość invite.  
7. Hygiene S-03/S-04/S-12 + split god-stores (P3 arch).

> Uzupełnienie mapy API / auth: wewnętrzny przegląd tras (2026-11-17).

---

## 8. Mapa API × auth (skrót)

| Route | Auth |
|---|---|
| `/api/upload-session`, `create-folder`, `notify`, `upload-progress`, `build-structure`, … | Upload token **lub** hub session → linkedToken |
| `/api/validate-token` | j.w. — **nie zwracać slug** (S-15) |
| `/api/share/[id]`, `…/file`, `…/upload-session` | Share id |
| `/api/share/[id]/notify-topup` | **Tylko share id** ⚠️ |
| `/api/share/[id]/notify-client` | `x-admin-secret` |
| `/api/admin/*` | Admin cookie / secret |
| `/api/client/invite` GET | Public (probe) |
| `/api/client/register` | Invite token |
| `/api/client/login` | Password |
| `/api/client/me|projects|upload-context|logout` | Client cookie |

---

*Koniec raportu 2026-11-17.*
