# Regeneracja OAuth — zawężenie scope do `drive.file` (VULN-05)

> Uruchom diagnostykę: `npm run check-oauth-scopes`

---

## Problem

Refresh token wygenerowany w OAuth Playground **zapamiętuje scope’y na stałe**.  
Jeśli token zawiera `https://www.googleapis.com/auth/drive`, aplikacja ma dostęp do **całego** Google Drive — nawet gdy kod w repozytorium wymaga tylko `drive.file`.

---

## Krok 1: Sprawdź obecny stan

```bash
npm run check-oauth-scopes
```

Skrypt:
1. Odświeża access token z `GOOGLE_REFRESH_TOKEN` (`.env.local`)
2. Wywołuje Google `tokeninfo` — wypisuje faktyczne scope’y
3. Oznacza ❌ pełny `drive`, ✅ zalecany `drive.file`
4. Uruchamia testy Drive API (folder główny, lista podfolderów, registry tokenów)

Exit code `1` = wykryto pełny scope `drive` → wymagana regeneracja.

---

## Krok 2: Wygeneruj nowy refresh token (tylko `drive.file`)

1. Otwórz [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
2. ⚙️ (OAuth 2.0 configuration):
   - ✅ **Use your own OAuth credentials**
   - OAuth Client ID: `GOOGLE_CLIENT_ID`
   - OAuth Client secret: `GOOGLE_CLIENT_SECRET`
3. **Step 1** — w polu „Input your own scopes” wpisz **wyłącznie**:
   ```
   https://www.googleapis.com/auth/drive.file
   ```
   - **Nie** zaznaczaj `Drive API v3` → `../auth/drive`
   - **Nie** dodawaj `drive.readonly`
4. **Authorize APIs** → zaloguj się na konto, które **posiada** folder uploadów
5. **Step 2** → **Exchange authorization code for tokens**
6. Skopiuj **Refresh token**

---

## Krok 3: Podmień token i przetestuj

```bash
# .env.local
GOOGLE_REFRESH_TOKEN="nowy_refresh_token"
```

```bash
npm run check-oauth-scopes   # powinno pokazać ✅ drive.file, ❌ brak drive
npm run dev                  # test uploadu + /admin
```

Checklist ręczny:
- [ ] Upload pojedynczego pliku
- [ ] Upload folderu (wiele plików)
- [ ] Wznowienie przerwanej sesji
- [ ] `/admin` → historia sesji
- [ ] `/admin` → token manager (odczyt/zapis `_uploader_tokens.json`)

---

## Krok 4: Produkcja (maintenance window)

1. W Vercel → Settings → Environment Variables → zaktualizuj `GOOGLE_REFRESH_TOKEN`
2. Redeploy
3. Powtórz test uploadu na produkcji

Opcjonalnie: [Google Account → Third-party access](https://myaccount.google.com/permissions) → usuń stary dostęp aplikacji.

---

## Co jeśli testy Drive failują po zawężeniu?

`drive.file` daje dostęp do plików **utworzonych przez aplikację** oraz folderu, do którego konto OAuth ma właścicielstwo.

Typowe przyczyny błędów:
- Folder `GOOGLE_DRIVE_FOLDER_ID` należy do **innego** konta Google niż OAuth
- Folder istnieje, ale aplikacja nigdy go nie „otworzyła”

Rozwiązania:
1. Utwórz folder uploadów na **tym samym** koncie co OAuth
2. Albo udostępnij folder kontu OAuth z rolą **Edytor** i upewnij się, że upload działa (czasem wymaga to jednorazowego utworzenia pliku przez aplikację w tym folderze)

W ostateczności (mniej bezpieczne): `drive.readonly` + `drive.file` — nadal bez pełnego `drive`.

---

## Service Account (fallback)

Jeśli używasz Service Account zamiast OAuth — scope w kodzie jest już poprawiony (`drive.file` only w `src/lib/googleAuth.js`). Ten dokument dotyczy głównie ścieżki **OAuth refresh token**.
