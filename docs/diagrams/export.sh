#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXPORT_DIR="$SCRIPT_DIR/exports"

if ! command -v plantuml &>/dev/null; then
  echo "Error: plantuml not found. Install with: brew install plantuml"
  exit 1
fi

mkdir -p "$EXPORT_DIR"

count=0
while IFS= read -r -d '' file; do
  name="$(basename "${file%.puml}")"
  echo "Exporting $file → exports/$name.png"
  plantuml -tpng -o "$EXPORT_DIR" "$file"
  count=$((count + 1))
done < <(find "$SCRIPT_DIR" -path "$EXPORT_DIR" -prune -o -name '*.puml' -print0)

if [ "$count" -eq 0 ]; then
  echo "No .puml files found."
else
  echo "Exported $count diagram(s) to $EXPORT_DIR"
fi
