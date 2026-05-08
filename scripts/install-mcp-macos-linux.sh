#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$SOURCE_DIR/mcp/mvp-router"

cd "$MCP_DIR"
npm install
npm run build

codex mcp add mvp-router -- node "$MCP_DIR/dist/index.js"

echo "Installed mvp-router MCP server. In Codex, run /mcp to verify."
