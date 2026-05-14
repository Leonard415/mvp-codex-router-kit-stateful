# Decisions

| Date | Decision | Reason | Tradeoff |
|---|---|---|---|
| 2026-05-14 | Protect existing `docs/PROJECT_STATUS.md` during tracker initialization. | Existing human project status is durable project memory and must not be overwritten silently. | Repos with manual docs need an explicit migration or `overwrite=true`. |
| 2026-05-14 | Include `debug` in dashboard rendering. | Debug is a supported phase and must be visible in saved project status. | The visual workflow now shows debug as a standard phase between test and ship. |
| 2026-05-14 | Export project-state helpers and guard stdio startup. | Regression tests need to import pure logic without launching an MCP server. | `src/index.ts` now has a small entrypoint guard. |
| 2026-05-14 | Stop ignoring `.mvp-router/` in the router kit repo. | Machine-readable tracker state is project memory and should be reviewable when the project wants durable state. | Teams can still ignore local tracker state in downstream repos if they choose. |
