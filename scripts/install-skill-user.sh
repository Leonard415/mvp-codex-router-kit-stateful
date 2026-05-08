#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="$HOME/.agents/skills/mvp-quality-router"

mkdir -p "$HOME/.agents/skills"
rm -rf "$DEST_DIR"
cp -R "$SOURCE_DIR/skills/mvp-quality-router" "$DEST_DIR"

echo "Installed mvp-quality-router skill to: $DEST_DIR"
echo "Restart Codex if the skill does not appear."
