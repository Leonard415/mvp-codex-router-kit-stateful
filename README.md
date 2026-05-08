# MVP Codex Router Kit — Stateful Version

A practical starter kit for building MVPs with Codex while reducing bugs, context rot, and messy handoffs.

It gives you:

- `mvp-quality-router` skill
- stateful `mvp-router` MCP server
- visual project dashboard in `docs/PROJECT_STATUS.md`
- pause/resume handoff in `docs/HANDOFF.md`
- machine-readable tracker in `.mvp-router/project-state.json`
- `AGENTS.md` templates
- source-of-truth docs templates
- install scripts

## What this does

The workflow is:

```text
Think → Plan → Build → Review → Test → Ship → Reflect
```

The router coordinates three skill styles without merging them into one bloated mega-skill:

| Job | Owner style |
|---|---|
| Project memory, phase planning, pause/resume, context rot prevention | GSD |
| Product critique, MVP narrowing, architecture review, QA/security review | gstack |
| TDD, coding, debugging, verification, branch finishing | Superpowers |
| Current phase, checklist, progress, hour estimates, visual dashboard | MCP router |
| Durable repo rules | AGENTS.md |

Use one primary style per phase and one reviewer style after work.

## Key files in each project

```text
AGENTS.md
.mvp-router/project-state.json
docs/PROJECT_STATUS.md
docs/HANDOFF.md
docs/CURRENT_STATE.md
docs/TODO.md
docs/DECISIONS.md
```

The most important idea:

```text
The repo remembers the project. The chat does not.
```

## Install the router skill

From this kit folder:

```bash
./scripts/install-skill-user.sh
```

This copies the skill to:

```text
~/.agents/skills/mvp-quality-router
```

Restart Codex if the skill does not appear.

## Install the MCP router

From this kit folder:

```bash
./scripts/install-mcp-macos-linux.sh
```

Manual install:

```bash
cd mcp/mvp-router
npm install
npm run build
codex mcp add mvp-router -- node "$PWD/dist/index.js"
```

In Codex, run:

```text
/mcp
```

You should see `mvp-router`.

## Bootstrap a project repo

Go to your project repo, then run one of these:

```bash
/path/to/mvp-codex-router-kit/scripts/bootstrap-project-docs.sh yoga
/path/to/mvp-codex-router-kit/scripts/bootstrap-project-docs.sh it
/path/to/mvp-codex-router-kit/scripts/bootstrap-project-docs.sh generic
```

For any other software project, use:

```bash
/path/to/mvp-codex-router-kit/scripts/bootstrap-project-docs.sh generic
```

This creates the docs and `.mvp-router/` folder.

Then ask Codex to initialize the tracker:

```text
Use $mvp-quality-router.
Call mvp-router init_project_tracker for this repo.
Project name: My MVP Project
Project type: generic
Repo size: medium
Risk level: medium
```

For yoga studio use `projectType: yoga_studio`.
For IT help app use `projectType: it_help_app`.
For anything else use `projectType: generic` or `custom`.

## MCP tools included

### `init_project_tracker`

Creates:

```text
.mvp-router/project-state.json
docs/PROJECT_STATUS.md
```

This is what lets you pause and resume later.

### `get_project_status`

Reads the tracker and tells Codex:

- current phase
- current slice
- progress percent
- total estimated hours
- remaining estimated hours
- next actions
- risks
- resume prompt

It also updates `docs/PROJECT_STATUS.md`.

### `update_project_progress`

Updates the tracker after meaningful work.

Use it after:

- finishing a slice
- starting a new phase
- finding a blocker
- running tests/build
- changing next actions

### `pause_project_work`

Writes `docs/HANDOFF.md` so you can safely stop work and resume later.

Use this before:

- ending the session
- compacting context
- switching to another project

### `estimate_project_hours`

Returns a rough MVP estimate based on:

- complexity
- number of slices
- integrations
- auth
- AI features
- dashboard
- data sensitivity

It also gives rough calendar estimates for 5h/week, 10h/week, and 20h/week.

### `choose_mvp_workflow`

Chooses the correct phase/checklist for a task.

If you provide `repoPath`, it can use saved tracker state.

### `get_debug_playbook`

Returns a systematic debugging checklist for large codebases.

### `get_bootstrap_docs`

Returns starter doc contents that Codex can copy into a repo.

## Start-of-session prompt

Use this whenever you come back to a project:

```text
Use $mvp-quality-router.

Call mvp-router get_project_status first.

Read:
- AGENTS.md
- docs/PROJECT_STATUS.md
- docs/CURRENT_STATE.md
- docs/TODO.md
- docs/DECISIONS.md

Tell me:
- current phase
- current slice
- progress percent
- estimated remaining hours
- next safest step
- whether coding is allowed

Do not code yet.
```

## Build prompt

```text
Use $mvp-quality-router.

Call mvp-router get_project_status first.
Then call mvp-router choose_mvp_workflow for the next safest task.

Implement only the current slice.
Use Superpowers-style TDD where practical.
Do not add unrelated features.

After meaningful progress:
- run tests/build/lint if available
- call update_project_progress
- update docs/CURRENT_STATE.md
- update docs/TODO.md
- update docs/PROJECT_STATUS.md
- show changed files
- suggest a commit message

Do not start the next slice.
```

## Pause prompt

```text
Use $mvp-quality-router.

Pause this project safely.
Call mvp-router pause_project_work.
Update:
- docs/HANDOFF.md
- docs/PROJECT_STATUS.md
- docs/CURRENT_STATE.md
- docs/TODO.md

Include:
- what changed
- what works
- what is broken
- current phase
- current slice
- next safest step
- remaining estimated hours
- exact resume prompt
```

## Debug prompt

```text
Use $mvp-quality-router.

Call mvp-router get_debug_playbook.

No fixes until root cause is proven.
Do:
- reproduce the bug
- capture expected vs actual behavior
- read full error/stack trace
- trace data flow
- check recent changes
- list hypotheses
- test hypotheses
- identify root cause
- write regression test where practical
- apply smallest fix
- verify with tests/build
- update project tracker and PROJECT_STATUS.md
```

## Why this helps

Instead of Codex guessing from a long chat, it reads project state from the repo:

```text
Current phase: Build
Current slice: AI triage and ticket summary
Progress: 41%
Remaining estimate: 18-37 hours
Next safest action: finish the regression test before coding
```

That makes the process reusable for every future software project, not just the yoga studio or IT help app.
