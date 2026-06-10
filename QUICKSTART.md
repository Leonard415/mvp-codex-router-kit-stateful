# Quickstart

## 1. Install (once per machine)

**Claude Code:**

```bash
git clone https://github.com/Leonard415/mvp-codex-router-kit-stateful ~/.claude/mcp-servers/mvp-codex-router-kit-stateful
cd ~/.claude/mcp-servers/mvp-codex-router-kit-stateful/mcp/mvp-router
npm install
npm run build
claude mcp add --scope user mvp-router -- node "$PWD/dist/index.js"
mkdir -p ~/.claude/skills/mvp-quality-router
cp ../../skills/mvp-quality-router/SKILL.md ~/.claude/skills/mvp-quality-router/
```

Restart Claude Code. Check `/mcp` shows `mvp-router`.

**Codex:**

```bash
./scripts/install-skill-user.sh
cd mcp/mvp-router && npm install && npm run build
codex mcp add mvp-router -- node "$PWD/dist/index.js"
```

## 2. Start a new project

In your project repo, say:

```text
Use the mvp-quality-router skill.
Call mvp-router init_project for this repo (name: <project name>, repoSize: medium, riskLevel: medium),
then start the Think phase with the recommended skill.
```

## 3. Every session after that

```text
Use the mvp-quality-router skill.
Call mvp-router get_status first, report where we are, then continue with the next safest step.
```

## 4. Before ending a session

```text
Call mvp-router pause_work and make sure docs/HANDOFF.md has a clear resume prompt.
```

That's the whole loop. The server enforces phase gates, tracks slices and hours, writes the dashboard to `docs/PROJECT_STATUS.md`, and names the best installed skill for each phase.
