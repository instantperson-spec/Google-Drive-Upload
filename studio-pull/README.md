# Studio Pull

Lokalny, **ręcznie uruchamiany** downloader sesji z Google Drive na dysk zewnętrzny.

- Bez agenta, bez tła, bez skanowania całego Drive
- Jedna komenda → postęp w terminalu → koniec procesu
- Wznawianie: drugi run pomija pliki o tym samym rozmiarze
- Odmowa zapisu na dysk systemowy (wymagane `/Volumes/<Dysk>/...` na macOS)

## Wymagania

- Node.js (ten sam projekt co `drive-uploader`)
- Uzupełnione [`.env.local`](../.env.local) (OAuth + `GOOGLE_DRIVE_FOLDER_ID`)
- Podpięty dysk zewnętrzny

## Użycie — UI (zalecane)

```bash
npm run studio-pull:ui
```

Otwiera `http://127.0.0.1:8787` w przeglądarce: wybór sesji, folder docelowy (dialog macOS), Start, postęp.  
Zamknięcie procesu w terminalu = koniec (brak agenta w tle).

## Użycie — CLI

Z katalogu `drive-uploader`:

```bash
# Lista ostatnich sesji (folderId + nazwa)
npm run studio-pull -- --list

# Ściągnij sesję na zewnętrzny dysk
npm run studio-pull -- --folder-id=FOLDER_ID --dest=/Volumes/T7/Woodweb-Sesja
```

Albo bezpośrednio:

```bash
node studio-pull/pull.mjs --list
node studio-pull/pull.mjs --folder-id=... --dest=/Volumes/T7/Folder
```

### Opcje

| Flaga | Opis |
|-------|------|
| `--list` | Pokaż ostatnie foldery sesji |
| `--folder-id=ID` | Źródło na Drive |
| `--dest=PATH` | Cel na dysku zewnętrznym |
| `--fail-fast` | Przerwij przy pierwszym błędzie pliku |
| `--limit=N` | Ile sesji pokazać przy `--list` (domyślnie 30) |

## Bezpieczeństwo ścieżki

Program **odmawia** zapisu m.in. do:

- `/Users/...`, `/System`, `/Applications`, `/Library`, root `/`
- `/Volumes/Macintosh HD/...`
- na Windows: `C:\` i profil użytkownika

Dozwolone: `/Volumes/<NazwaDyskuZewnętrznego>/...`

## Resume

Uruchom ponownie **tę samą** komendę (`--folder-id` + `--dest`). Pliki lokalne o rozmiarze równym Drive są pomijane (`skip`). Niedokończone `*.partial` są usuwane i pobierane od nowa.

## Poza zakresem

- GUI / picker myszką
- Auto-start przy podłączeniu USB
- Integracja z mailem / Vercel admin
