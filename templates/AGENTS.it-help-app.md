# AGENTS.md

## Project

IT Help Application / AI Help Desk Workflow.

## MVP Goal

Build an internal IT help intake system that helps employees submit better tickets, receive safe troubleshooting guidance, and escalate issues to IT staff.

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

## Security Rules

- Do not expose private employee data.
- Do not store production credentials in code or docs.
- Do not autonomously reset passwords.
- Do not autonomously change permissions.
- Do not autonomously disable accounts.
- Do not autonomously wipe devices.
- Do not close security incidents without human review.
- Always log ticket creation, escalation, and AI recommendations.
- Human approval is required for sensitive IT actions.

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
- check auth and access-control assumptions
- update docs/CURRENT_STATE.md
- update docs/TODO.md
- summarize changed files
- suggest a commit message
