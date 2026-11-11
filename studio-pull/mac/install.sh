#!/bin/bash
# Install Studio Console permanently: /Applications + remember project root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/studio-pull/mac/Studio Console.app"
DEST="/Applications/Studio Console.app"
CFG_DIR="$HOME/Library/Application Support/StudioConsole"
CFG="$CFG_DIR/root_path.txt"

if [[ ! -d "$SRC" ]]; then
  echo "Brak: $SRC"
  echo "Najpierw zbuduj: npm run studio-console:build"
  exit 1
fi

if [[ ! -f "$ROOT/studio-pull/ui-server.mjs" ]]; then
  echo "Nie znaleziono drive-uploader w: $ROOT"
  exit 1
fi

mkdir -p "$CFG_DIR"
printf '%s\n' "$ROOT" > "$CFG"
echo "Zapisano root → $CFG"
echo "  $ROOT"

# Replace previous install
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true

echo
echo "Zainstalowano: $DEST"
echo
echo "Dalej:"
echo "  1. Otwórz Launchpad / Applications → Studio Console"
echo "  2. (opcjonalnie) przeciągnij ikonę na Dock"
echo "  3. Dyski Google Drive / ENV muszą być podmontowane (tu jest projekt + .env.local)"
echo
open -R "$DEST"
