#!/usr/bin/env bash
# Install (or update) Blyg Publisher into an Obsidian vault from the latest
# GitHub release. Safe to re-run: it replaces the plugin's code files and
# never touches your settings (data.json) or any note.
#
# Usage:
#   bash install.sh "/path/to/your/vault" [version]
#   curl -fsSL https://raw.githubusercontent.com/brndnpink/blyg-publisher/main/scripts/install.sh | bash -s -- "/path/to/your/vault"
set -euo pipefail

REPO="${BLYG_REPO:-brndnpink/blyg-publisher}"
VAULT="${1:-}"
VERSION="${2:-latest}"

if [ -z "$VAULT" ]; then
  echo "Usage: install.sh \"/path/to/your/vault\" [version]" >&2
  exit 1
fi
if [ ! -d "$VAULT/.obsidian" ]; then
  echo "Not an Obsidian vault (no .obsidian folder): $VAULT" >&2
  echo "Open the folder in Obsidian once so it creates .obsidian, then run this again." >&2
  exit 1
fi

if [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$VERSION"
fi

DEST="$VAULT/.obsidian/plugins/blyg-publisher"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for f in main.js manifest.json styles.css; do
  curl -fsSL "$BASE/$f" -o "$TMP/$f" || { echo "Download failed: $BASE/$f" >&2; exit 1; }
done

# Sanity check: this really is the Blyg Publisher manifest.
if ! grep -q '"id": "blyg-publisher"' "$TMP/manifest.json"; then
  echo "Downloaded manifest.json isn't Blyg Publisher's; not installing." >&2
  exit 1
fi

mkdir -p "$DEST"
cp "$TMP/main.js" "$TMP/manifest.json" "$TMP/styles.css" "$DEST/"
INSTALLED="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$DEST/manifest.json" | head -1)"

echo "Installed Blyg Publisher $INSTALLED to:"
echo "  $DEST"
echo
echo "Next, in Obsidian:"
echo "  1. Settings → Community plugins → turn community plugins on (if they're off)."
echo "  2. Reload the list and enable \"Blyg Publisher\" (if it was already on, toggle it off and on)."
echo "  3. Settings → Blyg Publisher: set your site address, title, and author name."
echo "See the README for the full workflow."
