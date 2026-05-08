# Quickstart — Stateful MVP Router

## 1. Install the skill

```bash
cd /path/to/mvp-codex-router-kit
./scripts/install-skill-user.sh
```

## 2. Install the MCP router

```bash
cd /path/to/mvp-codex-router-kit
./scripts/install-mcp-macos-linux.sh
```

## 3. Bootstrap a project

Yoga studio:

```bash
cd /path/to/yoga-studio-repo
/path/to/mvp-codex-router-kit/scripts/bootstrap-project-docs.sh yoga
```

IT help app:

```bash
cd /path/to/it-help-app-repo
/path/to/mvp-codex-router-kit/scripts/bootstrap-project-docs.sh it
```

Any future software project:

```bash
cd /path/to/any-project-repo
/path/to/mvp-codex-router-kit/scripts/bootstrap-project-docs.sh generic
```

## 4. Initialize the tracker in Codex

```text
Use $mvp-quality-router.
Call mvp-router init_project_tracker for this repo.

Project name: Yoga Studio MVP
Project type: yoga_studio
Repo size: medium
Risk level: medium
```

For a different project, use `generic` or `custom`.

## 5. Resume a project later

```text
Use $mvp-quality-router.
Call mvp-router get_project_status first.
Read AGENTS.md, docs/PROJECT_STATUS.md, docs/CURRENT_STATE.md, docs/TODO.md, and docs/DECISIONS.md.
Tell me the current phase, current slice, progress percent, remaining estimated hours, and next safest step.
Do not code yet.
```

## 6. Pause work safely

```text
Use $mvp-quality-router.
Call mvp-router pause_project_work.
Update the handoff, project status, current state, and TODO files.
Give me the exact resume prompt.
```
