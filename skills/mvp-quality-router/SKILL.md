---
name: mvp-quality-router
description: Use for high-accuracy MVP software development. Routes Codex through Think, Plan, Build, Review, Test, Ship, and Reflect using GSD for context and phase management, gstack for product/architecture/review/QA/security thinking, and Superpowers for TDD, coding, systematic debugging, verification, and branch finishing. Use for multi-step app work, large codebases, debugging, MVP planning, or reducing bugs. Do not use for tiny one-file edits.
---

# MVP Quality Router

## Purpose

Route Codex through a high-accuracy MVP workflow without overloading context or mixing too many overlapping skills at once.

Core lifecycle:

Think → Plan → Build → Review → Test → Ship → Reflect

This skill is a router. It should select the right workflow and specialist skill style for the current phase. It should not duplicate every instruction from GSD, gstack, or Superpowers.

## Core Rules

1. Use one primary skill style per phase.
2. Use at most one reviewer skill style after work is complete.
3. Do not run GSD, gstack, and Superpowers all at once unless the user explicitly asks for a full audit.
4. Do not start coding until the current phase allows it.
5. Build one vertical MVP slice at a time.
6. Prefer boring, reliable code over clever code.
7. Prefer tests before implementation when practical.
8. Before claiming completion, verify with real commands and update project state docs.

## Source-of-Truth Files

Before major work, read these files if they exist:

- AGENTS.md
- docs/PROJECT_BRIEF.md
- docs/MVP_SCOPE.md
- docs/USER_STORIES.md
- docs/ARCHITECTURE.md
- docs/DECISIONS.md
- docs/CURRENT_STATE.md
- docs/TODO.md
- docs/TEST_PLAN.md
- docs/SECURITY.md

If the repo is missing these files and the task is non-trivial, create minimal versions before coding.

The repo docs are memory. The chat is temporary.

## Project Tracker Mode

For any MVP project that will span more than one session, use the MCP project tracker if it is available.

Tracker files:

- `.mvp-router/project-state.json` = machine-readable phase/slice/hour state
- `docs/PROJECT_STATUS.md` = visual dashboard for the human
- `docs/HANDOFF.md` = pause/resume handoff

At the start of a session:

1. Call `get_project_status` if the MCP server is available.
2. Read `docs/PROJECT_STATUS.md`, `docs/CURRENT_STATE.md`, and `docs/TODO.md`.
3. Report the current phase, current slice, percent complete, remaining estimated hours, and next safest action.

After meaningful progress:

1. Call `update_project_progress` or manually update `.mvp-router/project-state.json`.
2. Regenerate `docs/PROJECT_STATUS.md`.
3. Update `docs/CURRENT_STATE.md` and `docs/TODO.md`.

Before pausing, compacting, or ending the session:

1. Call `pause_project_work` if available.
2. Make sure `docs/HANDOFF.md` has a clear resume prompt.

The project tracker can be used for any software project, not only yoga studio or IT help apps. Use `projectType: generic` or `projectType: custom` for other projects.


## Skill Ownership

### GSD owns

Use GSD-style workflow for:

- new project setup
- long-running project state
- phase planning
- context rot prevention
- pause/resume handoffs
- progress reports
- phase verification

Use this when:

- starting a project
- resuming after a long session
- planning multiple phases
- repo state is unclear
- context is messy
- the user worries about context rot

### gstack owns

Use gstack-style workflow for:

- product critique
- MVP narrowing
- architecture review
- engineering review
- UX/design review
- QA review
- security review
- production-readiness review

Use this when:

- deciding what to build
- checking if the MVP is too large
- reviewing architecture or data flow
- finding bugs after implementation
- checking security/privacy
- doing QA without immediately changing code

### Superpowers owns

Use Superpowers-style workflow for:

- implementation planning
- test-driven development
- coding
- systematic debugging
- verification before completion
- code review process
- finishing a development branch

Use this when:

- implementing a feature
- fixing a bug
- writing tests
- debugging failing tests/builds
- verifying work before calling it done

## Phase Routing

### 1. Think

Primary style: gstack product thinking  
Secondary style: GSD project setup

Goal:

- define user
- define painful problem
- define narrow MVP
- define non-goals
- define first demo success criteria

Output files:

- docs/PROJECT_BRIEF.md
- docs/MVP_SCOPE.md
- docs/USER_STORIES.md

Gate:

- Do not code.
- Cut scope aggressively.
- Identify the smallest useful workflow.

### 2. Plan

Primary style: GSD phase planning  
Secondary style: Superpowers writing-plans  
Reviewer style: gstack engineering review

Goal:

- turn MVP into small vertical slices
- define files to edit
- define tests to write
- define acceptance criteria
- define commands to run
- define risks and dependencies

Output files:

- docs/ARCHITECTURE.md
- docs/TEST_PLAN.md
- docs/SECURITY.md
- docs/plans/001-mvp-implementation.md

Gate:

- Do not code until the slice is clear.
- Every slice must have acceptance criteria.
- Every slice must have verification commands.

### 3. Build

Primary style: Superpowers TDD and executing-plans  
Secondary style: GSD execute phase

Goal:

- implement one vertical slice only
- write tests first where practical
- make the smallest code change that satisfies the acceptance criteria

Rules:

- do not add unrelated features
- do not start the next slice automatically
- do not add major dependencies without approval
- do not silently change architecture
- do not use production credentials

Gate:

- targeted tests pass or failures are clearly explained
- changed files are summarized
- CURRENT_STATE.md and TODO.md are updated

### 4. Review

Primary style: gstack review  
Secondary style: Superpowers requesting-code-review

Review for:

- correctness
- missed requirements
- unnecessary complexity
- missing tests
- architecture drift
- security/privacy issues
- files that should not have changed

Gate:

- Do not add new features.
- Only fix issues directly related to the completed slice.

### 5. Test

Primary style: Superpowers verification-before-completion  
Secondary style: gstack QA

Required checks:

- run tests if available
- run build if available
- run lint/typecheck if available
- manually verify the core user flow
- document failures honestly
- update docs/CURRENT_STATE.md
- update docs/TODO.md

Gate:

- Work is not done until checks pass or failures are clearly documented.

### 6. Debug

Primary style: Superpowers systematic-debugging  
Secondary style: gstack investigate  
Optional style: GSD debug if the bug is part of a tracked phase

Rules:

- no fixes before root cause is proven
- reproduce the bug first
- read the full error and stack trace
- trace data flow
- check recent changes
- list hypotheses
- test hypotheses
- identify root cause
- write a regression test where practical
- apply the smallest fix
- verify with tests/build

Large-codebase debugging:

- freeze feature work
- use read-only subagents for investigation if available
- keep noisy logs out of the main thread
- summarize findings before editing code

### 7. Ship

Primary style: Superpowers finishing-development-branch  
Secondary style: GSD ship/report

Before commit/push:

- show git status
- show changed files
- confirm tests/build/lint
- update CURRENT_STATE.md
- update DECISIONS.md if needed
- suggest commit message
- do not push unless user approves

Gate:

- Do not push or deploy without explicit user approval.

### 8. Reflect

Primary style: GSD pause/report  
Secondary style: gstack context-save style

Update:

- docs/CURRENT_STATE.md
- docs/TODO.md
- docs/DECISIONS.md

Include:

- what changed
- what works
- what is broken
- files changed
- commands run
- risks and assumptions
- next recommended step

Gate:

- Do this before compaction, ending a session, or switching phases.

## Debugger Mode

Use this when the user reports a bug, build failure, test failure, or unexpected app behavior.

Process:

1. Stop feature work.
2. Reproduce the bug.
3. Capture expected vs actual behavior.
4. Read the full error and stack trace.
5. Trace the data flow.
6. Check recent changes.
7. List hypotheses.
8. Test hypotheses with evidence.
9. Identify root cause.
10. Write regression test where practical.
11. Apply the smallest fix.
12. Verify with tests/build.
13. Update CURRENT_STATE.md.

Do not patch randomly.

## Project Defaults

### Yoga Studio MVP

Prioritize:

- FAQ/intake
- booking request
- cancellation request
- availability check or mock availability check
- confirmation message
- human escalation
- request logging
- simple admin review

Avoid in V1 unless approved:

- payments
- memberships
- payroll
- instructor management
- complex analytics
- multi-location support

Safety:

- do not invent studio policy
- confirm date/time/name/contact before booking or cancellation
- log every booking/cancellation/escalation
- escalate when uncertain

### IT Help App MVP

Prioritize:

- employee issue intake
- AI triage questions
- clean ticket summary
- category/severity detection
- ticket creation or mock ticket creation
- escalation rules
- audit log
- human approval for sensitive actions

Never allow autonomous:

- password resets
- permission changes
- account disabling
- device wipes
- security incident closure
- exposure of private employee data

Sensitive IT actions require human approval.

## Standard Prompt Pattern

When using this skill, start by saying:

- current phase
- primary skill style
- reviewer skill style, if any
- whether coding is allowed
- the phase gate

Then execute the phase.
