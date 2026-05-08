#!/usr/bin/env bash
set -euo pipefail

PROJECT_TYPE="${1:-base}"
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(pwd)"

case "$PROJECT_TYPE" in
  yoga|yoga-studio|yoga_studio)
    cp "$KIT_DIR/templates/AGENTS.yoga-studio.md" "$REPO_DIR/AGENTS.md"
    TRACKER_TYPE="yoga_studio"
    ;;
  it|it-help|it_help_app)
    cp "$KIT_DIR/templates/AGENTS.it-help-app.md" "$REPO_DIR/AGENTS.md"
    TRACKER_TYPE="it_help_app"
    ;;
  base|generic|custom)
    cp "$KIT_DIR/templates/AGENTS.base.md" "$REPO_DIR/AGENTS.md"
    TRACKER_TYPE="generic"
    ;;
  *)
    echo "Unknown project type: $PROJECT_TYPE"
    echo "Use: base, generic, custom, yoga, or it"
    exit 1
    ;;
esac

mkdir -p "$REPO_DIR/docs/plans" "$REPO_DIR/.mvp-router"
cp -R "$KIT_DIR/templates/docs/"* "$REPO_DIR/docs/"

cat > "$REPO_DIR/.mvp-router/README.md" <<'MD'
# MVP Router Tracker

The MCP server writes project tracking state here.

Expected file after initialization:

- `.mvp-router/project-state.json`

Initialize it from Codex with:

```text
Use $mvp-quality-router.
Call mvp-router init_project_tracker for this repo.
```
MD

echo "Created AGENTS.md, docs/ templates, and .mvp-router/ in: $REPO_DIR"
echo "Tracker project type suggestion: $TRACKER_TYPE"
echo "Next: ask Codex to call mvp-router init_project_tracker to create project-state.json and update docs/PROJECT_STATUS.md."
