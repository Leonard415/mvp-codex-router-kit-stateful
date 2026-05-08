# AGENTS.md

## Project

Yoga Studio AI Booking Assistant.

## MVP Goal

Build a simple AI-assisted booking and intake application for a yoga studio.

## Workflow

Use the MVP Quality Router for non-trivial work.

Think → Plan → Build → Review → Test → Ship → Reflect


## Project Tracking

- Use `.mvp-router/project-state.json` as the machine-readable tracker.
- Use `docs/PROJECT_STATUS.md` as the visual project dashboard.
- Use `docs/HANDOFF.md` before pausing work or compacting context.
- At the start of each Codex session, call `get_project_status` if the MVP router MCP server is available.
- After meaningful progress, update project state, `docs/CURRENT_STATE.md`, `docs/TODO.md`, and `docs/PROJECT_STATUS.md`.
- Report the current phase, current slice, progress percent, estimated remaining hours, and next safest step before coding.

## Skill Routing

- GSD owns context management, phase planning, and handoffs.
- gstack owns product critique, MVP narrowing, architecture review, QA, and security review.
- Superpowers owns implementation planning, TDD, coding, systematic debugging, verification, and branch finishing.
- Use one primary skill style per phase.
- Do not use every skill at once.

## V1 Rules

- Do not overbuild.
- Do not add payments in V1.
- Do not add memberships in V1.
- Do not add payroll, instructor management, complex analytics, or multi-location support in V1.
- Always preserve human escalation.
- Log every booking, cancellation, and escalation.
- If uncertain, escalate instead of guessing.
- Never invent studio policy.
- Confirm customer name, contact info, date, and time before booking/canceling.

## Accuracy Rules

- Build one vertical slice at a time.
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

## Completion Rules

Before saying work is complete:

- run tests if available
- run build if available
- run lint/typecheck if available
- update docs/CURRENT_STATE.md
- update docs/TODO.md
- summarize changed files
- suggest a commit message
