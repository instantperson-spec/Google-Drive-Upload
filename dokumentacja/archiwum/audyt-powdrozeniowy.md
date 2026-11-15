# Audyt powdrożeniowy i wdrożenie poprawek (Hotfix) — Drive Uploader & Studio Console

> **Data audytu i wdrożenia poprawek:** 2026-11-15  
> **Dokument bazowy:** [`audyt-bezpieczenstwa.md`](./audyt-bezpieczenstwa.md)  
> **Plan remediacji:** [`plany/security_audit_remediation.plan.md`](./plany/security_audit_remediation.plan.md)  
> **Żywy skrót:** [`../bezpieczenstwo.md`](../bezpieczenstwo.md) · **Archiwum** — nie traktuj jako stanu produkcji.

---

## 1. Pozytywnie zweryfikowane poprawki z pierwszego wdrożenia (P0–P1)

1. **Usunięcie wycieku tokena w Portalu Projektu ([share/[id]/route.js](../src/app/api/share/%5Bid%5D/route.js))** — publiczny endpoint nie zwraca już pola `token` uploadu klienta w odpowiedzi JSON.
2. **Naprawa raportowania awarii uploadu ([useUploadRunner.js](../src/hooks/useUploadRunner.js))** — `uploadSessionIdRef` i `uploadFolderIdRef` są zachowywane w zmiennych lokalnych przed wyzerowaniem referencji, dzięki czemu `/api/upload-log` jest wywoływany przy błędzie.
3. **Weryfikacja procesu na porcie `:8787` w Tauri ([lib.rs](../studio-pull/tauri-app/src-tauri/src/lib.rs))** — aplikacja sprawdza fingerprint w `console_auth.fp` względem `GET /api/health`, odrzucając obce procesy podszywające się pod port lokalny.
4. **Ochrona przed OOM przy pobieraniu w Portalu Projektu ([SharePage.js](../src/components/SharePage.js))** — domyślny zapis plik-po-pliku bezpośrednio na dysk przez File System Access API (`showDirectoryPicker`) oraz twardy limit `40 plików` / `500 MB` dla fallbacku `JSZip`.
5. **Wykrywanie zmian plików `.WAV` o tym samym rozmiarze przy `Sync` ([syncDelta.mjs](../studio-pull/lib/syncDelta.mjs), [driveWalk.mjs](../studio-pull/lib/driveWalk.mjs))** — porównanie lokalnego MD5 z `md5Checksum` Google Drive oraz pomocnicze sprawdzenie `mtimeMs`.
6. **Utwardzenie `/api/notify`, sesji admina i `.gitignore`** — escapowanie `uploaderEmail` w HTML wiadomości, weryfikacja `isSessionFolder` i własności folderu, sesja admina `sessionId.exp.sig` z 24-godzinnym TTL i unieważnianiem przy wylogowaniu ([adminAuth.js](../src/lib/adminAuth.js), [logout/route.js](../src/app/api/admin/logout/route.js)), dodanie `.tmp*` do [`.gitignore`](../.gitignore) oraz tryb *fail-closed* i limit 500 wpisów w `sessionFolderCache` ([googleAuth.js](../src/lib/googleAuth.js)).

---

## 2. Wykryte luki powdrożeniowe i wdrożony Hotfix

Podczas audytu powdrożeniowego zidentyfikowano 6 błędów oraz luk wprowadzonych lub pominiętych w pierwszym etapie remediacji. Wszystkie zostały naprawione:

1. **Brak cache'u w `assertFolderOwnedByToken` ([sessionOwnership.js](../src/lib/sessionOwnership.js))**
   - **Problem:** Każde wywołanie `/api/upload-session` i `/api/upload-progress` wykonywało 2 zapytania do Google Drive API (listowanie i odczyt `_uploader_session.json`), co przy setkach plików groziło przekroczeniem limitów zapytań Google i przerwaniem uploadu z błędem `403`.
   - **Poprawka:** Wprowadzono cache w pamięci `ownershipCache` (TTL 30 min, limit 500 wpisów) wypełniany już przy tworzeniu folderu (`writeSessionOwnership`) oraz przy pierwszym odczycie `_uploader_session.json`.

2. **Utrata `md5` w `setBaselineFromFiles` i brak przekazywania `md5`/`mtime` w `recomputeStatuses` ([manifestOps.mjs](../studio-pull/lib/manifestOps.mjs), [syncDelta.mjs](../studio-pull/lib/syncDelta.mjs), [ui-server.mjs](../studio-pull/ui-server.mjs))**
   - **Problem:** `setBaselineFromFiles` zapisywało do `baseline` sam rozmiar liczbowy bez `md5`, `recomputeStatuses` pomijało pole `mtimeMs` z lokalnych plików i nie zapisywało `baselineMd5`, a `planSync` nie przekazywał wyliczonego lokalnego MD5 z powrotem do `localFiles`. W rezultacie Portal Projektu wciąż potrafił oznaczać zmodyfikowane `.WAV` o tym samym rozmiarze jako `Twoje (oryginał)`.
   - **Poprawka:** `setBaselineFromFiles` zapisuje obiekty `{ size, md5 }` (gdy MD5 jest znany), `normalizeManifest` migruje `baselineMd5`/`md5Checksum`, `handlePull` w `ui-server.mjs` przekazuje `md5Checksum` pobranych plików do baseline'u, `planSync` zachowuje `local.md5`, a `recomputeStatuses` korzysta zarówno z `md5`, jak i `mtimeMs`.

3. **Pozostała luka IDOR na `sessionId` w `/api/upload-progress` ([progressStore.js](../src/lib/progressStore.js), [upload-progress/route.js](../src/app/api/upload-progress/route.js))**
   - **Problem:** `DELETE /api/upload-progress` pozwalał na usunięcie dowolnego `sessionId` przez dowolny ważny token, a `upsertProgressSession` nie blokował nadpisania wpisu należącego do innego tokena.
   - **Poprawka:** Zarówno `upsertProgressSession`, jak i `removeProgressSession` weryfikują teraz zgodność `token` względem zapisanego `session.token`, zwracając HTTP `403` przy niezgodności.

4. **Nieodfiltrowany plik `_uploader_session.json` i inne metadane ([listSessionFiles.js](../src/lib/listSessionFiles.js), [admin/sessions/route.js](../src/app/api/admin/sessions/route.js))**
   - **Problem:** Nowy plik `_uploader_session.json` nie znajdował się na liście ignorowanych plików w listowaniu sesji do wznawiania (`/api/check-folder`) ani w panelu administratora (`/api/admin/sessions`), przez co puste sesje pokazywały `fileCount: 1`.
   - **Poprawka:** Dodano wspólny zestaw `SKIP_NAMES` obejmujący `_uploader_session.json`, `_manifest.json`, `_team_manifest.json` i pozostałe pliki kontrolne w obu modułach.

5. **Akceptowanie `Origin: null` i `?consoleToken=` poza SSE ([consoleAuth.mjs](../studio-pull/lib/consoleAuth.mjs), [ui-server.mjs](../studio-pull/ui-server.mjs))**
   - **Problem:** `assertConsoleRequest` przepuszczał żądania z nagłówkiem `Origin: null` (np. z sandboksowanych ramek iframe) oraz akceptował token w parametrze URL na wszystkich endpointach modyfikujących stan.
   - **Poprawka:** Zablokowano `Origin: null`, a parametr query `?consoleToken=` jest akceptowany wyłącznie na strumieniach `GET /api/pull/events` oraz `GET /api/sync/events` wymaganych przez `EventSource`.

6. **Wspólny licznik `unknown` w Rate Limiterze poza Vercel ([rateLimit.js](../src/lib/rateLimit.js))**
   - **Problem:** W środowisku produkcyjnym bez nagłówków Vercel wszyscy klienci trafiali do wspólnej puli `unknown`.
   - **Poprawka:** Dodano odczyt `cf-connecting-ip` oraz bezpieczny fallback na ostatni (dodawany przez reverse proxy) adres z `x-forwarded-for`.

---

## 3. Backlog po hotfiksie (aktualizacja)

| Temat | Stan |
|---|---|
| Progress Drive + ETag (`If-Match`); **bez** Redis/KV | ✅ (Redis/KV usunięte z kodu) |
| Tokeny Drive + ETag (nagłówek HTTP, nie `fields=etag`) | ✅ |
| `request.signal` na share file + TTL `folderCache` | ✅ |
| Rate-limit / shareQuota / admin revoke — per warm instance | ⚠️ świadome ograniczenie |
| Wspólny moduł Drive + rozbicie monolitów UI | ⏳ P3 |
| Shares / team manifest ETag | ⏳ niski priorytet |

---

## 4. Weryfikacja

- Hotfix: `node --check` na zmodyfikowanych plikach — OK.  
- Po usunięciu Redis: deploy z poprawką ETag (header) — admin Client tokens nie może pokazywać `Invalid field selection etag`.
