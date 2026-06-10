# MVP Router Kit — Stateful Skill Conductor

A stateful MCP server + router skill that conducts software development through a disciplined lifecycle, routing each phase to the best installed specialist skill.

```text
Think → Plan → Build → Review → Test → Ship → Reflect
            (Debug branches off Build/Test)
```

It gives you:

- `mvp-router` MCP server — phase state machine with **real gate enforcement** and **skill-aware routing**
- `mvp-quality-router` skill — the conductor that ties the MCP server to your installed skills
- visual project dashboard in `docs/PROJECT_STATUS.md`
- pause/resume handoff in `docs/HANDOFF.md`
- machine-readable tracker in `.mvp-router/project-state.json`

## The conductor architecture

The router coordinates three specialist skill families without merging them into one bloated mega-skill:

| Job | Owner |
|---|---|
| Project memory, phase planning, pause/resume, context-rot prevention | GSD (`gsd-*` skills) |
| Product critique, MVP narrowing, architecture review, QA/security review, shipping | gstack (`gstack-*` skills) |
| TDD, coding, systematic debugging, verification, branch finishing | superpowers (`superpowers:*` skills) |
| Current phase, gates, checklists, progress, hour estimates, skill picks | mvp-router MCP |

**One primary skill per phase, at most one reviewer after the work.** The server detects which skills are installed — per individual skill, not just per family, so slimmed installs (GSD surface profiles) are handled — and only recommends skills that exist. On runtimes without these skills (Codex, generic agents), it falls back to self-contained phase instructions.

### Phase → skill map (defaults)

| Phase | Primary | Reviewer / secondary |
|---|---|---|
| Think | gstack-office-hours | gstack-plan-ceo-review |
| Plan | gsd-plan-phase | gstack-plan-eng-review |
| Build | superpowers:test-driven-development | gsd-execute-phase |
| Review | gstack-review | gsd-code-review |
| Test | superpowers:verification-before-completion | gstack-qa |
| Debug | superpowers:systematic-debugging | gsd-debug |
| Ship | gstack-ship | superpowers:finishing-a-development-branch |
| Reflect | gsd-pause-work | gsd-extract-learnings |

Run the `get_skill_map` tool to see the full table with situational picks and per-skill installed/missing status.

### State ownership

If a repo already uses GSD's `.planning/` state, the server detects it and defers: GSD owns project state there, and the router provides phase discipline and skill picks only. **Never double-track state.**

## Key files in each project

```text
.mvp-router/project-state.json   # machine-readable phase/slice/hour state
docs/PROJECT_STATUS.md           # visual dashboard (auto-generated)
docs/HANDOFF.md                  # pause/resume handoff
docs/CURRENT_STATE.md            # what works / what's broken
docs/TODO.md                     # next slice + backlog
docs/DECISIONS.md                # decision log
```

The most important idea:

```text
The repo remembers the project. The chat does not.
```

## Install — Claude Code

```bash
# Clone this repo AS the deployed location (single source of truth)
git clone https://github.com/Leonard415/mvp-codex-router-kit-stateful ~/.claude/mcp-servers/mvp-codex-router-kit-stateful
cd ~/.claude/mcp-servers/mvp-codex-router-kit-stateful/mcp/mvp-router
npm install
npm run build
claude mcp add --scope user mvp-router -- node "$PWD/dist/index.js"

# Skill
mkdir -p ~/.claude/skills/mvp-quality-router
cp ../../skills/mvp-quality-router/SKILL.md ~/.claude/skills/mvp-quality-router/
```

Restart Claude Code, then check `/mcp` shows `mvp-router`.

## Install — Codex

```bash
./scripts/install-skill-user.sh          # skill → ~/.agents/skills/
cd mcp/mvp-router && npm install && npm run build
codex mcp add mvp-router -- node "$PWD/dist/index.js"
```

When calling `choose_workflow` from Codex, pass `runtime: "codex"` to get self-contained instructions instead of Claude-skill recommendations.

## MCP tools (13)

| Tool | Purpose |
|---|---|
| `choose_workflow` | Route a task to the right phase + best installed skill. State-first, keyword fallback. Call at the start of every non-trivial task. |
| `get_status` | Load project state: phase, slice, progress, dashboard, skill picks. Call at session start. |
| `init_project` | Create the tracker and dashboard. Optional initial slices. |
| `advance_phase` | Move to the next phase. **Enforces exit/entry gates** — refuses if required docs or slices are missing (`force: true` overrides, recorded in history). |
| `skip_phase` | Explicitly skip a phase (hotfix, spike) with a permanently recorded reason. |
| `check_gate` | See what's blocking a phase transition without advancing. |
| `add_slice` | Add a vertical slice with estimates and acceptance criteria. |
| `update_progress` | Update slice status, notes, risks, next actions after meaningful work. |
| `pause_work` | Write `docs/HANDOFF.md` with a resume prompt. Call before ending a session. |
| `get_skill_map` | Full phase→skill routing table with per-skill installed/missing status. |
| `get_phase_instructions` | Instructions, checklist, and gates for any phase. |
| `estimate_hours` | MVP hour estimate from complexity, slices, integrations, and feature flags. |
| `get_bootstrap_docs` | Starter AGENTS.md and docs/*.md templates. |

## Deploying changes (Claude Code)

The deployed server at `~/.claude/mcp-servers/mvp-codex-router-kit-stateful/` IS a clone of this repo — edit there, not in a scratch copy.

1. Edit `mcp/mvp-router/src/index.ts`
2. `npm run typecheck && npm test && npm run build` — the MCP registration points at `dist/index.js`, so **an unbuilt edit does nothing**
3. Commit and push — local-only work gets lost
4. Restart Claude Code to load the new build

## Start-of-session prompt

```text
Use the mvp-quality-router skill.
Call mvp-router get_status first, report where we are, then continue with the next safest step.
```

## New-project prompt

```text
Use the mvp-quality-router skill.
Call mvp-router init_project for this repo (name: <project>, repoSize: medium, riskLevel: medium),
then start the Think phase with the recommended skill.
```

## Pause prompt

```text
Call mvp-router pause_work and make sure docs/HANDOFF.md has a clear resume prompt.
```

## Why this helps

Instead of the agent guessing from a long chat, it reads project state from the repo:

```text
Current phase: Build
Current slice: AI triage and ticket summary
Progress: 41%
Remaining estimate: 18-37 hours
Next action: finish the regression test before coding
Recommended skill: superpowers:test-driven-development
```

Gates make phase discipline real instead of advisory: you cannot advance out of Think without a project brief, out of Plan without architecture docs and slices, or out of Build with an unfinished slice — unless you explicitly force it, and the force is recorded.

## Version history

- **0.4.1** — Per-skill installed detection (handles GSD surface-slimmed installs), precedence rules in the conductor skill, deploy SOP documented, README/QUICKSTART actually updated (0.4.0's doc rewrite missed the commit).
- **0.4.0** — Skill-aware routing restored: per-phase skill recommendations (gsd/gstack/superpowers) with installed detection, `get_skill_map` tool, GSD `.planning/` coexistence detection, `runtime` parameter for Codex fallback.
- **0.3.0** — State-first routing, real gate enforcement, phase history, configurable lifecycle (`skip_phase`), no hardcoded project types, v0.2 state auto-migration.
- **0.2.0** — Stateful tracker, dashboard, handoff docs.
- **0.1.0** — Initial keyword router.
