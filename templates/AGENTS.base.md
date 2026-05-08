# AGENTS.md

## Workflow

Use the MVP Quality Router for non-trivial software work.

Default lifecycle:

Think → Plan → Build → Review → Test → Ship → Reflect


## Project Tracking

- Use `.mvp-router/project-state.json` as the machine-readable tracker.
- Use `docs/PROJECT_STATUS.md` as the visual project dashboard.
- Use `docs/HANDOFF.md` before pausing work or compacting context.
- At the start of each Codex session, call `get_project_status` if the MVP router MCP server is available.
- After meaningful progress, update project state, `docs/CURRENT_STATE.md`, `docs/TODO.md`, and `docs/PROJECT_STATUS.md`.
- Report the current phase, current slice, progress percent, estimated remaining hours, and next safest step before coding.

## Skill Routing

- Use GSD-style workflow for project setup, phase planning, context rot prevention, state tracking, and handoffs.
- Use gstack-style workflow for product critique, MVP narrowing, architecture review, QA, security, and production-quality review.
- Use Superpowers-style workflow for implementation planning, TDD, coding, systematic debugging, verification, and finishing development branches.
- Use one primary skill style per phase.
- Use at most one reviewer skill style after implementation.
- Do not use every skill at once.

## Accuracy Rules

- Plan before coding for complex work.
- Build one vertical slice at a time.
- Do not add extra features.
- Do not add major dependencies without approval.
- Prefer tests before implementation.
- Run tests/build/lint before claiming completion.
- Update docs/CURRENT_STATE.md after meaningful changes.
- Update docs/TODO.md after each slice.
- Update docs/DECISIONS.md when architecture or product decisions change.

## Debugging Rules

- No fixes before root cause is proven.
- Reproduce the bug first.
- Read the full error message and stack trace.
- Trace data flow.
- Check recent changes.
- Write a regression test when practical.
- Apply the smallest fix.
- Verify with tests/build.
- Do not make broad refactors while debugging.

## Review Rules

Before shipping a slice, check:

- correctness
- missing tests
- unnecessary complexity
- security/privacy issues
- broken user flows
- stale docs
- changed files that should not have changed

## Completion Rules

Before saying work is complete:

- show changed files
- run available checks
- summarize failures honestly
- update docs/CURRENT_STATE.md
- update docs/TODO.md
- suggest a commit message
