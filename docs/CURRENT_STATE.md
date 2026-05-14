# Current State

Last updated: 2026-05-14

## What Works

- The installed `mvp-router` MCP server responds to `choose_mvp_workflow`, `get_project_status`, `init_project_tracker`, `update_project_progress`, and `pause_project_work`.
- A disposable tracker smoke test successfully created `.mvp-router/project-state.json`, wrote `docs/PROJECT_STATUS.md`, updated progress, and wrote `docs/HANDOFF.md`.
- The router package now has regression tests for tracker safety and dashboard behavior.
- `npm test`, `npm run typecheck`, and `npm run build` pass in `mcp/mvp-router`.

## Bugs Found And Fixed

- `init_project_tracker` could overwrite an existing `docs/PROJECT_STATUS.md` when a repo had manual status docs but no `.mvp-router/project-state.json`.
- Debug phase state existed in JSON but was omitted from the rendered dashboard workflow and phase table.
- `recomputeState()` dropped existing phase notes while recalculating phase status.
- Invalid tracker JSON was reported like a missing tracker, hiding corruption.
- The router kit ignored `.mvp-router/` in `.gitignore`, which made the machine-readable tracker easy to lose even though project memory is supposed to live in the repo.

## Current Limitation

- Commit `1a2b690` was pushed to `origin/main` on 2026-05-14.
- The MCP registration was removed and re-added to point at `/root/mvp-codex-router-kit-stateful/mcp/mvp-router/dist/index.js`.
- The rebuilt bundle has the patched behavior when imported directly: `initProjectTracker()` refuses to overwrite an existing `docs/PROJECT_STATUS.md` without `overwrite=true`.
- The stale in-session MCP process was terminated, but this Codex session did not reconnect the `mvp-router` tool; subsequent tool calls returned `Transport closed`. A new Codex session should start the server from the refreshed config.
- `/root/Quant-Agent` has detailed manual docs but no `.mvp-router/project-state.json`. Do not initialize it with the old server because its current `docs/PROJECT_STATUS.md` should be preserved.

## Changed Files

- `mcp/mvp-router/src/index.ts`
- `mcp/mvp-router/package.json`
- `mcp/mvp-router/test/router.test.ts`
- `.gitignore`
- `.mvp-router/project-state.json`
- `docs/PROJECT_STATUS.md`
- `docs/CURRENT_STATE.md`
- `docs/TODO.md`
- `docs/DECISIONS.md`
- `docs/HANDOFF.md`

## Verification

- `npm test`
- `npm run typecheck`
- `npm run build`
- `git push origin main`
- Direct Node import of `dist/index.js` confirmed existing-status protection returns `conflict: true`.
