---
name: mvp-quality-router
description: Conductor for software development. Routes any non-trivial software work through Think → Plan → Build → Review → Test → Ship → Reflect, picking the best installed skill (GSD, gstack, or superpowers) for each phase via the mvp-router MCP server. Use when starting a project or feature, when unsure what to do next, when switching phases (planning → coding → reviewing → testing → shipping), or when resuming work. Do not use for tiny one-file edits.
---

# MVP Quality Router

You are conducting an orchestra of specialist skills. The mvp-router MCP server tracks where the project is in the lifecycle and names the best installed skill for each phase. Your job: ask the router, then invoke what it recommends.

## The loop

1. **Session start / resuming:** call `get_status` (mvp-router MCP).
   - Tracker found → report phase, current slice, and progress to the user, then continue from there.
   - No tracker and this is a multi-session project → call `init_project`.
   - If it reports GSD planning state (`.planning/`) → GSD owns project state; use GSD commands for status and phase transitions, and use this router only for skill picks. Do not double-track.
2. **Each non-trivial task:** call `choose_workflow` with the task description. It returns the phase, instructions, a checklist, and `recommendedSkills`.
3. **Invoke the PRIMARY skill** via the Skill tool and do the work inside that skill's workflow. Use SECONDARY/SITUATIONAL picks only when their `when` condition matches.
4. **After the work:** invoke the REVIEWER skill (at most one).
5. **After meaningful progress:** call `update_progress` (slice status, notes, risks, next actions).
6. **Phase done:** call `advance_phase`. If it blocks, satisfy the listed gate conditions — do not force without telling the user.
7. **Pausing / ending session:** call `pause_work` to write the handoff doc.

## Rules

- One PRIMARY skill per phase, at most one REVIEWER after. Never stack GSD + gstack + superpowers simultaneously unless the user asks for a full audit.
- Do not code when the router says `codingAllowed: no`.
- Build one vertical slice at a time; the smallest change that satisfies acceptance criteria.
- If the router blocks a phase advance, fix the gate conditions before retrying.
- The repo remembers the project; the chat does not. Keep the tracker and docs current.

## Fallback (MCP server unavailable)

If mvp-router tools are not available, route by hand with this table and tell the user the server is down:

| Phase | Primary | Reviewer/secondary |
|---|---|---|
| Think | gstack-office-hours | gstack-plan-ceo-review |
| Plan | gsd-plan-phase (gsd-discuss-phase first if fuzzy) | gstack-plan-eng-review |
| Build | superpowers:test-driven-development | gsd-execute-phase |
| Review | gstack-review | gsd-code-review |
| Test | superpowers:verification-before-completion | gstack-qa |
| Debug | superpowers:systematic-debugging | gsd-debug |
| Ship | gstack-ship | superpowers:finishing-a-development-branch |
| Reflect | gsd-pause-work | gsd-extract-learnings |
