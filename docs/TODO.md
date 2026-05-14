# TODO

Last updated: 2026-05-14

## Next

- Restart or reinstall the MCP router so Codex uses the patched server code.
- Re-run `init_project_tracker` against a repo with an existing `docs/PROJECT_STATUS.md` and confirm it refuses without `overwrite=true`.
- Initialize `/root/Quant-Agent` tracker only after the patched server is active, or migrate it manually while preserving the existing manual status document.

## Later

- Add a migration path that can adopt existing manual docs into tracker state instead of only refusing or overwriting.
- Add more regression tests around `update_project_progress` current-phase behavior.
- Consider splitting MCP server registration from project-state logic into separate modules for simpler testing.

