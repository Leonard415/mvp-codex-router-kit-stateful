import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = "think" | "plan" | "build" | "review" | "test" | "debug" | "ship" | "reflect";
type RepoSize = "small" | "medium" | "large";
type RiskLevel = "low" | "medium" | "high";
type PhaseStatus = "not_started" | "in_progress" | "blocked" | "skipped" | "done";
type SliceStatus = "not_started" | "in_progress" | "blocked" | "done";

type PhaseRecord = {
  status: PhaseStatus;
  notes: string;
  skippedReason?: string;
  updatedAt: string;
};

type ProjectSlice = {
  id: string;
  title: string;
  phase: Phase;
  status: SliceStatus;
  estimatedHoursMin: number;
  estimatedHoursMax: number;
  actualHours?: number;
  acceptanceCriteria: string[];
  blockers: string[];
  notes: string;
  updatedAt: string;
};

type ProjectState = {
  schemaVersion: "0.3.0";
  projectId: string;
  projectName: string;
  projectDescription: string;
  repoSize: RepoSize;
  riskLevel: RiskLevel;
  createdAt: string;
  updatedAt: string;
  currentPhase: Phase;
  currentSliceId?: string;
  phases: Record<Phase, PhaseRecord>;
  slices: ProjectSlice[];
  risks: string[];
  nextActions: string[];
  completedCommands: string[];
  lastHandoff?: string;
  phaseHistory: { phase: Phase; action: "entered" | "completed" | "skipped"; reason?: string; at: string }[];
  hours: {
    totalEstimatedMin: number;
    totalEstimatedMax: number;
    completedEstimated: number;
    remainingEstimatedMin: number;
    remainingEstimatedMax: number;
    progressPercent: number;
  };
};

type GateCondition = {
  description: string;
  check: (repoPath: string, state: ProjectState) => Promise<boolean>;
};

type SkillFamily = "gsd" | "gstack" | "superpowers";
type SkillRole = "primary" | "secondary" | "reviewer" | "situational";
type Runtime = "claude" | "codex" | "generic";

type SkillRef = {
  skill: string;
  family: SkillFamily;
  role: SkillRole;
  when: string;
};

type InstalledFamilies = Record<SkillFamily, boolean>;

type PhaseDefinition = {
  codingAllowed: boolean;
  instructions: string[];
  checklist: string[];
  verificationCommands: string[];
  gateToEnter: GateCondition[];
  gateToLeave: GateCondition[];
  requiredDocs: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHASE_ORDER: Phase[] = ["think", "plan", "build", "review", "test", "ship", "reflect"];
const ALL_PHASES: Phase[] = ["think", "plan", "build", "review", "test", "debug", "ship", "reflect"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function normalizeRepoPath(repoPath?: string): string {
  return path.resolve(repoPath || process.cwd());
}

function trackerPaths(repoPath?: string) {
  const root = normalizeRepoPath(repoPath);
  return {
    root,
    stateDir: path.join(root, ".mvp-router"),
    stateFile: path.join(root, ".mvp-router", "project-state.json"),
    docsDir: path.join(root, "docs"),
    statusFile: path.join(root, "docs", "PROJECT_STATUS.md"),
    handoffFile: path.join(root, "docs", "HANDOFF.md"),
  };
}

function safeId(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || `slice-${randomUUID().slice(0, 8)}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function backupPath(filePath: string): string {
  const parsed = path.parse(filePath);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return path.join(parsed.dir, `${parsed.name}.backup-${stamp}${parsed.ext}`);
}

async function backupIfExists(filePath: string): Promise<string | undefined> {
  if (!(await fileExists(filePath))) return undefined;
  const target = backupPath(filePath);
  await fs.copyFile(filePath, target);
  return target;
}

function nextPhase(current: Phase): Phase | null {
  const idx = PHASE_ORDER.indexOf(current);
  if (idx === -1 || idx === PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1];
}

function currentSliceTitle(state: ProjectState): string | undefined {
  return state.slices.find((s) => s.id === state.currentSliceId)?.title;
}

// ---------------------------------------------------------------------------
// Gate checks — filesystem and state checks that enforce phase discipline
// ---------------------------------------------------------------------------

function docExists(docPath: string): GateCondition {
  return {
    description: `${docPath} must exist`,
    check: async (repoPath) => fileExists(path.join(normalizeRepoPath(repoPath), docPath)),
  };
}

function slicesDefined(): GateCondition {
  return {
    description: "At least one build slice must be defined",
    check: async (_repoPath, state) => state.slices.some((s) => s.phase === "build"),
  };
}

function currentSliceDone(): GateCondition {
  return {
    description: "Current slice must be marked done (or no active slice)",
    check: async (_repoPath, state) => {
      if (!state.currentSliceId) return true;
      const slice = state.slices.find((s) => s.id === state.currentSliceId);
      return !slice || slice.status === "done";
    },
  };
}

function phaseHasNotes(phase: Phase): GateCondition {
  return {
    description: `${phase} phase must have notes recorded`,
    check: async (_repoPath, state) => {
      const p = state.phases[phase];
      return Boolean(p && p.notes && p.notes.trim().length > 0);
    },
  };
}

// ---------------------------------------------------------------------------
// Skill routing — maps each phase to the best installed skill, by role.
// One primary per phase, one reviewer after the work. The self-contained
// instructions below remain the fallback for runtimes without these skills.
// ---------------------------------------------------------------------------

export const SKILL_MAP: Record<Phase, SkillRef[]> = {
  think: [
    { skill: "gstack-office-hours", family: "gstack", role: "primary", when: "Sharpen the product idea: user, problem, narrowest useful MVP." },
    { skill: "gsd-new-project", family: "gsd", role: "secondary", when: "Brand-new project: deep context gathering, writes PROJECT.md." },
    { skill: "gstack-plan-ceo-review", family: "gstack", role: "reviewer", when: "Pressure-test scope and priorities before planning." },
    { skill: "gsd-explore", family: "gsd", role: "situational", when: "Idea still vague — Socratic ideation before committing." },
  ],
  plan: [
    { skill: "gsd-plan-phase", family: "gsd", role: "primary", when: "Create the executable phase plan (PLAN.md). Run gsd-discuss-phase first if requirements are fuzzy." },
    { skill: "superpowers:writing-plans", family: "superpowers", role: "secondary", when: "Tight implementation plan for a single feature or branch." },
    { skill: "gstack-plan-eng-review", family: "gstack", role: "reviewer", when: "Architecture and engineering review of the plan before building." },
    { skill: "gsd-mvp-phase", family: "gsd", role: "situational", when: "Plan the phase as a vertical MVP slice (SPIDR splitting)." },
  ],
  build: [
    { skill: "superpowers:test-driven-development", family: "superpowers", role: "primary", when: "RED/GREEN/REFACTOR discipline for the current slice." },
    { skill: "gsd-execute-phase", family: "gsd", role: "secondary", when: "Execute a planned GSD phase with atomic commits and state tracking." },
    { skill: "gsd-quick", family: "gsd", role: "situational", when: "Small task: GSD guarantees without the optional agents." },
    { skill: "superpowers:executing-plans", family: "superpowers", role: "situational", when: "Execute an existing written plan in reviewed batches." },
  ],
  review: [
    { skill: "gstack-review", family: "gstack", role: "primary", when: "Pre-landing review of the diff." },
    { skill: "gsd-code-review", family: "gsd", role: "secondary", when: "Severity-classified REVIEW.md for files changed during the phase." },
    { skill: "gstack-cso", family: "gstack", role: "situational", when: "Security-sensitive change: dedicated security review." },
    { skill: "superpowers:receiving-code-review", family: "superpowers", role: "situational", when: "Process and apply review feedback systematically." },
  ],
  test: [
    { skill: "superpowers:verification-before-completion", family: "superpowers", role: "primary", when: "Prove it works with real commands before claiming done." },
    { skill: "gstack-qa", family: "gstack", role: "secondary", when: "Web app: headless-browser QA that finds and fixes bugs." },
    { skill: "gstack-qa-only", family: "gstack", role: "situational", when: "Report-only QA — no fixes applied." },
    { skill: "gsd-verify-work", family: "gsd", role: "situational", when: "Conversational UAT against acceptance criteria." },
  ],
  debug: [
    { skill: "superpowers:systematic-debugging", family: "superpowers", role: "primary", when: "Root-cause-first debugging; no fixes before the cause is proven." },
    { skill: "gsd-debug", family: "gsd", role: "secondary", when: "Long hunt: persistent debug state across context resets." },
    { skill: "gstack-investigate", family: "gstack", role: "situational", when: "Alternative systematic investigation flavor." },
  ],
  ship: [
    { skill: "gstack-ship", family: "gstack", role: "primary", when: "Full ship: merge base, tests, diff review, VERSION/CHANGELOG, commit, push, PR." },
    { skill: "superpowers:finishing-a-development-branch", family: "superpowers", role: "secondary", when: "Verify, merge or PR, clean up the worktree." },
    { skill: "gsd-ship", family: "gsd", role: "situational", when: "GSD-tracked project: PR + review + merge prep after verification." },
    { skill: "gstack-land-and-deploy", family: "gstack", role: "situational", when: "Deployment configured: land and deploy in one flow." },
  ],
  reflect: [
    { skill: "gsd-pause-work", family: "gsd", role: "primary", when: "Pausing mid-phase: context handoff for the next session." },
    { skill: "gsd-extract-learnings", family: "gsd", role: "secondary", when: "Phase complete: capture decisions, lessons, surprises." },
    { skill: "gstack-context-save", family: "gstack", role: "situational", when: "Save working context for /gstack-context-restore later." },
    { skill: "gstack-retro", family: "gstack", role: "situational", when: "Periodic engineering retrospective." },
  ],
};

export async function detectInstalledFamilies(): Promise<InstalledFamilies> {
  const home = os.homedir();
  const skillsDir = path.join(home, ".claude", "skills");
  const [gsd, gstack] = await Promise.all([
    fileExists(path.join(skillsDir, "gsd-help", "SKILL.md")),
    fileExists(path.join(skillsDir, "gstack", "SKILL.md")),
  ]);
  let superpowers = false;
  try {
    const raw = await fs.readFile(path.join(home, ".claude", "plugins", "installed_plugins.json"), "utf8");
    const parsed = JSON.parse(raw) as { plugins?: Record<string, unknown> };
    superpowers = Object.keys(parsed.plugins ?? {}).some((key) => key.startsWith("superpowers@"));
  } catch {
    superpowers = false;
  }
  return { gsd, gstack, superpowers };
}

export type SkillAvailability = { families: InstalledFamilies; installedSkills: Set<string> };

// Per-skill detection: GSD's surface profiles and gstack updates can remove
// individual skill dirs while the family stays installed, so family-level
// checks alone would recommend skills that no longer exist.
export async function detectSkillAvailability(): Promise<SkillAvailability> {
  const families = await detectInstalledFamilies();
  const skillsDir = path.join(os.homedir(), ".claude", "skills");
  const unique = new Set<string>();
  for (const refs of Object.values(SKILL_MAP)) for (const r of refs) unique.add(r.skill);

  const installedSkills = new Set<string>();
  await Promise.all(
    [...unique].map(async (name) => {
      if (name.includes(":")) {
        const family = name.split(":")[0] as SkillFamily;
        if (families[family]) installedSkills.add(name);
      } else if (await fileExists(path.join(skillsDir, name, "SKILL.md"))) {
        installedSkills.add(name);
      }
    })
  );
  return { families, installedSkills };
}

export function getSkillRecommendations(phase: Phase, availability: SkillAvailability): { available: SkillRef[]; missingSkills: string[] } {
  const refs = SKILL_MAP[phase] || [];
  const available = refs.filter((r) => availability.installedSkills.has(r.skill));
  const missingSkills = refs.filter((r) => !availability.installedSkills.has(r.skill)).map((r) => r.skill);
  return { available, missingSkills };
}

function formatSkillSection(phase: Phase, recs: { available: SkillRef[]; missingSkills: string[] }): string[] {
  if (recs.available.length === 0) {
    return ["", "Recommended skills: none installed for this phase — follow the instructions above directly."];
  }
  const lines = [
    "",
    "Recommended skills (invoke with the Skill tool — one PRIMARY per phase, plus one REVIEWER after the work is done):",
    ...recs.available.map((r) => `- [${r.role.toUpperCase()}] ${r.skill} — ${r.when}`),
  ];
  if (recs.missingSkills.length) {
    lines.push(`(Not installed, skipped: ${recs.missingSkills.join(", ")})`);
  }
  return lines;
}

export async function detectGsdPlanning(repoPath?: string): Promise<boolean> {
  return fileExists(path.join(normalizeRepoPath(repoPath), ".planning"));
}

function gsdCoexistenceNote(hasTracker: boolean): string {
  return hasTracker
    ? "WARNING: Both GSD planning state (.planning/) and an mvp-router tracker exist in this repo. Pick ONE state owner — GSD (.planning/) for GSD-driven projects, or this tracker. Do not double-track phase state."
    : "GSD planning state detected (.planning/). GSD owns project state here — use gsd-progress for status and GSD phase commands for transitions. Use this router for phase discipline and skill picks only; skip init_project.";
}

// ---------------------------------------------------------------------------
// Phase definitions — self-contained behavioral instructions per phase
// ---------------------------------------------------------------------------

function getPhaseDefinition(phase: Phase, riskLevel: RiskLevel): PhaseDefinition {
  const highRiskExtras = riskLevel === "high"
    ? [
        "Explicitly check security, privacy, data-loss, and rollback assumptions before proceeding.",
        "Do not perform destructive actions without explicit user approval.",
      ]
    : [];

  const defs: Record<Phase, PhaseDefinition> = {
    think: {
      codingAllowed: false,
      instructions: [
        "Define the exact user and the painful problem they have.",
        "Define the narrowest useful MVP — one core workflow, not a platform.",
        "List explicit non-goals to prevent scope creep.",
        "Define first-demo success criteria: what does 'working' look like?",
        "Cut scope aggressively. If in doubt, cut it.",
        "Do NOT write any application code during this phase.",
        ...highRiskExtras,
      ],
      checklist: [
        "User persona defined",
        "Core problem stated in one sentence",
        "MVP workflow identified (single happy path)",
        "Non-goals listed",
        "Demo success criteria written",
        "Write docs/PROJECT_BRIEF.md",
        "Write docs/MVP_SCOPE.md",
        "Write docs/USER_STORIES.md",
      ],
      verificationCommands: [],
      gateToEnter: [],
      gateToLeave: [
        docExists("docs/PROJECT_BRIEF.md"),
        docExists("docs/MVP_SCOPE.md"),
      ],
      requiredDocs: ["docs/PROJECT_BRIEF.md", "docs/MVP_SCOPE.md", "docs/USER_STORIES.md"],
    },

    plan: {
      codingAllowed: false,
      instructions: [
        "Read PROJECT_BRIEF.md and MVP_SCOPE.md before planning.",
        "Break the MVP into vertical slices — each slice is a complete user-facing workflow, not a horizontal layer.",
        "For each slice: list files to create/edit, tests to write, acceptance criteria, and verification commands.",
        "Define the architecture: data flow, integrations, failure modes.",
        "Identify risks and dependencies between slices.",
        "Order slices so the riskiest or most uncertain slice comes first.",
        "Do NOT write application code during this phase.",
        ...highRiskExtras,
      ],
      checklist: [
        "Read existing project docs",
        "Vertical slices defined with acceptance criteria",
        "Files-to-change listed per slice",
        "Tests-to-write listed per slice",
        "Verification commands listed per slice",
        "Architecture documented",
        "Risks and dependencies identified",
        "Write docs/ARCHITECTURE.md",
        "Write docs/TEST_PLAN.md",
        "Write docs/SECURITY.md (if applicable)",
      ],
      verificationCommands: [],
      gateToEnter: [
        docExists("docs/PROJECT_BRIEF.md"),
        docExists("docs/MVP_SCOPE.md"),
      ],
      gateToLeave: [
        docExists("docs/ARCHITECTURE.md"),
        slicesDefined(),
      ],
      requiredDocs: ["docs/PROJECT_BRIEF.md", "docs/MVP_SCOPE.md", "docs/ARCHITECTURE.md", "docs/TEST_PLAN.md"],
    },

    build: {
      codingAllowed: true,
      instructions: [
        "Implement ONE vertical slice at a time. Do not start the next slice until the current one is done.",
        "Write tests first where practical — define expected behavior before implementing it.",
        "Make the smallest code change that satisfies the acceptance criteria.",
        "Do NOT add features that aren't in the current slice.",
        "Do NOT add major dependencies without user approval.",
        "Do NOT silently change architecture decisions.",
        "Prefer boring, reliable code over clever code.",
        "After completing the slice: run tests, update CURRENT_STATE.md and TODO.md.",
        ...highRiskExtras,
      ],
      checklist: [
        "Restate the exact slice and its acceptance criteria",
        "List files to change before editing",
        "Write failing tests first where practical",
        "Implement the smallest satisfying change",
        "Run tests",
        "Run build",
        "Update docs/CURRENT_STATE.md",
        "Update docs/TODO.md",
        "Summarize changed files",
      ],
      verificationCommands: ["npm test", "npm run build", "npm run lint"],
      gateToEnter: [
        docExists("docs/ARCHITECTURE.md"),
        slicesDefined(),
      ],
      gateToLeave: [
        currentSliceDone(),
      ],
      requiredDocs: ["docs/CURRENT_STATE.md", "docs/TODO.md", "docs/TEST_PLAN.md"],
    },

    review: {
      codingAllowed: false,
      instructions: [
        "Review the completed slice against its acceptance criteria.",
        "Check for: correctness, missing tests, unnecessary complexity, architecture drift, security/privacy issues.",
        "Check that only expected files were changed.",
        "Do NOT add new features during review.",
        "Only fix issues directly related to the completed slice.",
        "Record findings as notes before any fixes are applied.",
        ...highRiskExtras,
      ],
      checklist: [
        "Acceptance criteria verified",
        "No missing tests for core paths",
        "No unnecessary complexity added",
        "Architecture matches docs/ARCHITECTURE.md",
        "Security and privacy assumptions checked",
        "Only expected files were changed",
        "Findings recorded",
      ],
      verificationCommands: ["git status --short", "git diff --stat"],
      gateToEnter: [],
      gateToLeave: [
        phaseHasNotes("review"),
      ],
      requiredDocs: ["docs/CURRENT_STATE.md", "docs/SECURITY.md"],
    },

    test: {
      codingAllowed: false,
      instructions: [
        "Run all available automated checks: tests, build, lint, typecheck.",
        "Manually verify the core user flow end-to-end.",
        "Document all failures honestly — do not hide or minimize them.",
        "Work is NOT done until checks pass or failures are clearly documented with next steps.",
        "Update CURRENT_STATE.md and TODO.md with results.",
        ...highRiskExtras,
      ],
      checklist: [
        "Run test suite",
        "Run build",
        "Run lint / typecheck",
        "Manually verify the main user flow",
        "Document any failures with details",
        "Update docs/CURRENT_STATE.md",
        "Update docs/TODO.md",
      ],
      verificationCommands: ["npm test", "npm run build", "npm run lint"],
      gateToEnter: [],
      gateToLeave: [
        phaseHasNotes("test"),
      ],
      requiredDocs: ["docs/TEST_PLAN.md", "docs/CURRENT_STATE.md", "docs/TODO.md"],
    },

    debug: {
      codingAllowed: false,
      instructions: [
        "STOP all feature work immediately.",
        "Reproduce the bug first — confirm expected vs actual behavior.",
        "Read the FULL error message and stack trace before doing anything else.",
        "Trace the data flow from input to failure point.",
        "Check recent changes (git log, git diff) for likely causes.",
        "List hypotheses ranked by likelihood. Test each with evidence.",
        "Identify the root cause BEFORE writing any fix.",
        "Write a regression test for the bug where practical.",
        "Apply the SMALLEST fix that addresses the root cause.",
        "Verify the fix with tests/build. Confirm the original bug is gone.",
        "Do NOT patch randomly. Do NOT apply fixes without understanding why they work.",
        ...highRiskExtras,
      ],
      checklist: [
        "Feature work frozen",
        "Bug reproduced",
        "Expected vs actual behavior recorded",
        "Full error and stack trace read",
        "Data flow traced",
        "Recent changes checked",
        "Hypotheses listed and tested",
        "Root cause identified with evidence",
        "Regression test written (where practical)",
        "Smallest fix applied",
        "Fix verified with tests/build",
        "docs/CURRENT_STATE.md updated",
      ],
      verificationCommands: ["npm test", "npm run build", "git status --short"],
      gateToEnter: [],
      gateToLeave: [
        phaseHasNotes("debug"),
      ],
      requiredDocs: ["docs/CURRENT_STATE.md", "docs/TODO.md"],
    },

    ship: {
      codingAllowed: false,
      instructions: [
        "Show git status and changed files to the user.",
        "Confirm tests, build, and lint all pass.",
        "Update CURRENT_STATE.md and DECISIONS.md.",
        "Suggest a clear commit message.",
        "Do NOT push or deploy without explicit user approval.",
        "Do NOT force-push, rewrite history, or skip hooks.",
        ...highRiskExtras,
      ],
      checklist: [
        "git status shown",
        "Changed files summarized",
        "Tests/build/lint confirmed passing",
        "docs/CURRENT_STATE.md updated",
        "docs/DECISIONS.md updated (if decisions were made)",
        "Commit message suggested",
        "User approved push (if pushing)",
      ],
      verificationCommands: ["git status --short", "git diff --stat", "npm test", "npm run build"],
      gateToEnter: [],
      gateToLeave: [],
      requiredDocs: ["docs/CURRENT_STATE.md", "docs/DECISIONS.md"],
    },

    reflect: {
      codingAllowed: false,
      instructions: [
        "Capture the full project state before ending the session, compacting context, or switching phases.",
        "Document: what changed, what works, what's broken, files changed, commands run, risks, assumptions.",
        "Write a clear resume prompt so the next session can pick up without re-reading everything.",
        "Update all state-tracking docs.",
        ...highRiskExtras,
      ],
      checklist: [
        "What changed — summarized",
        "What works — listed",
        "What is broken — listed honestly",
        "Files changed — listed",
        "Commands run — listed",
        "Risks and assumptions — listed",
        "Next recommended step — stated",
        "Resume prompt written",
        "docs/CURRENT_STATE.md updated",
        "docs/TODO.md updated",
        "docs/DECISIONS.md updated (if applicable)",
      ],
      verificationCommands: ["git status --short"],
      gateToEnter: [],
      gateToLeave: [
        docExists("docs/CURRENT_STATE.md"),
      ],
      requiredDocs: ["docs/CURRENT_STATE.md", "docs/TODO.md", "docs/DECISIONS.md"],
    },
  };

  return defs[phase];
}

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

type GateResult = {
  passed: boolean;
  results: { description: string; passed: boolean }[];
};

async function evaluateGate(conditions: GateCondition[], repoPath: string, state: ProjectState): Promise<GateResult> {
  const results = await Promise.all(
    conditions.map(async (c) => ({
      description: c.description,
      passed: await c.check(repoPath, state),
    }))
  );
  return {
    passed: results.every((r) => r.passed),
    results,
  };
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

export function recomputeState(state: ProjectState): ProjectState {
  const timestamp = now();
  const phases = {} as ProjectState["phases"];

  for (const phase of ALL_PHASES) {
    const existing = state.phases[phase] || { status: "not_started" as PhaseStatus, notes: "", updatedAt: timestamp };
    const phaseSlices = state.slices.filter((s) => s.phase === phase);

    if (existing.status === "skipped") {
      phases[phase] = { ...existing };
      continue;
    }

    let status: PhaseStatus;
    if (phaseSlices.length === 0) {
      status = existing.status || "not_started";
    } else if (phaseSlices.every((s) => s.status === "done")) {
      status = "done";
    } else if (phaseSlices.some((s) => s.status === "blocked")) {
      status = "blocked";
    } else if (phaseSlices.some((s) => s.status === "in_progress" || s.status === "done")) {
      status = "in_progress";
    } else {
      status = "not_started";
    }

    phases[phase] = {
      status,
      notes: existing.notes || "",
      skippedReason: existing.skippedReason,
      updatedAt: existing.status === status && existing.updatedAt ? existing.updatedAt : timestamp,
    };
  }

  state.phases = phases;

  const totalMin = state.slices.reduce((sum, s) => sum + s.estimatedHoursMin, 0);
  const totalMax = state.slices.reduce((sum, s) => sum + s.estimatedHoursMax, 0);
  let completedEstimated = 0;
  let remainingMin = 0;
  let remainingMax = 0;

  for (const slice of state.slices) {
    const avg = (slice.estimatedHoursMin + slice.estimatedHoursMax) / 2;
    if (slice.status === "done") {
      completedEstimated += slice.actualHours ?? avg;
    } else {
      remainingMin += slice.estimatedHoursMin;
      remainingMax += slice.estimatedHoursMax;
      if (slice.status === "in_progress") completedEstimated += Math.min(avg * 0.35, avg);
    }
  }

  const totalAvg = Math.max(1, (totalMin + totalMax) / 2);
  const progressPercent = Math.max(0, Math.min(100, Math.round((completedEstimated / totalAvg) * 100)));

  state.hours = {
    totalEstimatedMin: totalMin,
    totalEstimatedMax: totalMax,
    completedEstimated: Number(completedEstimated.toFixed(1)),
    remainingEstimatedMin: remainingMin,
    remainingEstimatedMax: remainingMax,
    progressPercent,
  };

  if (!state.currentSliceId || !state.slices.find((s) => s.id === state.currentSliceId && s.status !== "done")) {
    const nextSlice =
      state.slices.find((s) => s.status === "in_progress") ||
      state.slices.find((s) => s.status === "blocked") ||
      state.slices.find((s) => s.status === "not_started");
    state.currentSliceId = nextSlice?.id;
  }

  state.updatedAt = now();
  return state;
}

export async function loadProjectState(repoPath?: string): Promise<{ state: ProjectState | null; error?: { kind: "missing" | "invalid"; file: string; message: string } }> {
  const { stateFile } = trackerPaths(repoPath);
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw) as ProjectState;
    if (parsed.schemaVersion && parsed.schemaVersion !== "0.3.0") {
      parsed.schemaVersion = "0.3.0";
      if (!parsed.phaseHistory) parsed.phaseHistory = [];
      for (const phase of ALL_PHASES) {
        if (parsed.phases[phase] && !("skippedReason" in parsed.phases[phase])) {
          (parsed.phases[phase] as PhaseRecord).skippedReason = undefined;
        }
      }
    }
    return { state: recomputeState(parsed) };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { state: null, error: { kind: "missing", file: stateFile, message: "No tracker found. Run init_project first." } };
    }
    return { state: null, error: { kind: "invalid", file: stateFile, message: `Tracker exists but could not be read: ${error instanceof Error ? error.message : String(error)}` } };
  }
}

async function writeProjectState(repoPath: string | undefined, state: ProjectState, writeDashboard = true): Promise<void> {
  const paths = trackerPaths(repoPath);
  const next = recomputeState(state);
  await fs.mkdir(paths.stateDir, { recursive: true });
  await fs.mkdir(paths.docsDir, { recursive: true });
  await fs.writeFile(paths.stateFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  if (writeDashboard) await fs.writeFile(paths.statusFile, renderDashboard(next), "utf8");
}

// ---------------------------------------------------------------------------
// State creation
// ---------------------------------------------------------------------------

function initialPhases(): ProjectState["phases"] {
  const updatedAt = now();
  const phases = {} as ProjectState["phases"];
  for (const phase of ALL_PHASES) phases[phase] = { status: "not_started", notes: "", updatedAt };
  return phases;
}

export function createInitialState(input: {
  projectName: string;
  projectDescription?: string;
  repoSize: RepoSize;
  riskLevel: RiskLevel;
  slices?: { title: string; phase: Phase; estimatedHoursMin: number; estimatedHoursMax: number; acceptanceCriteria?: string[] }[];
}): ProjectState {
  const timestamp = now();
  const slices: ProjectSlice[] = (input.slices || []).map((s) => ({
    id: safeId(s.title),
    title: s.title,
    phase: s.phase,
    status: "not_started" as SliceStatus,
    estimatedHoursMin: s.estimatedHoursMin,
    estimatedHoursMax: s.estimatedHoursMax,
    acceptanceCriteria: s.acceptanceCriteria || [],
    blockers: [],
    notes: "",
    updatedAt: timestamp,
  }));

  const state: ProjectState = {
    schemaVersion: "0.3.0",
    projectId: safeId(input.projectName) || randomUUID(),
    projectName: input.projectName,
    projectDescription: input.projectDescription || "",
    repoSize: input.repoSize,
    riskLevel: input.riskLevel,
    createdAt: timestamp,
    updatedAt: timestamp,
    currentPhase: "think",
    currentSliceId: slices[0]?.id,
    phases: initialPhases(),
    slices,
    risks: [],
    nextActions: ["Complete the Think phase: define user, problem, and MVP scope"],
    completedCommands: [],
    phaseHistory: [{ phase: "think", action: "entered", at: timestamp }],
    hours: { totalEstimatedMin: 0, totalEstimatedMax: 0, completedEstimated: 0, remainingEstimatedMin: 0, remainingEstimatedMax: 0, progressPercent: 0 },
  };

  return recomputeState(state);
}

// ---------------------------------------------------------------------------
// Dashboard rendering
// ---------------------------------------------------------------------------

function statusIcon(status: PhaseStatus | SliceStatus): string {
  switch (status) {
    case "done": return "DONE";
    case "in_progress": return ">>>";
    case "blocked": return "BLOCKED";
    case "skipped": return "SKIP";
    case "not_started": return "---";
  }
}

function titleCase(phase: Phase): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function progressBar(percent: number, width = 20): string {
  const filled = Math.round((percent / 100) * width);
  return "[" + "#".repeat(filled) + ".".repeat(Math.max(0, width - filled)) + "]";
}

function renderMermaid(state: ProjectState): string {
  const icon = (phase: Phase) => {
    const s = state.phases[phase]?.status || "not_started";
    if (s === "done") return "v";
    if (s === "in_progress") return ">";
    if (s === "skipped") return "x";
    if (s === "blocked") return "!";
    return " ";
  };
  const node = (phase: Phase) => `${phase}["(${icon(phase)}) ${titleCase(phase)}"]`;
  const mainFlow = PHASE_ORDER.map(node).join(" --> ");
  return ["```mermaid", "flowchart LR", `  ${mainFlow}`, `  build -.-> debug["(${icon("debug")}) Debug"] -.-> build`, "```"].join("\n");
}

export function renderDashboard(state: ProjectState): string {
  const currentSlice = state.slices.find((s) => s.id === state.currentSliceId);

  const phaseRows = ALL_PHASES.map((phase) => {
    const p = state.phases[phase];
    const marker = phase === state.currentPhase ? " <-- current" : "";
    const skipNote = p.skippedReason ? ` (${p.skippedReason})` : "";
    return `| ${statusIcon(p.status)} | ${titleCase(phase)}${marker} | ${p.status.replace(/_/g, " ")}${skipNote} | ${p.notes || ""} |`;
  }).join("\n");

  const sliceRows = state.slices.length > 0
    ? state.slices.map((s) => {
        const marker = s.id === state.currentSliceId ? " <-- current" : "";
        const hours = `${s.estimatedHoursMin}-${s.estimatedHoursMax}h`;
        const blockers = s.blockers.length ? s.blockers.join("; ") : "";
        return `| ${statusIcon(s.status)} | ${s.title}${marker} | ${titleCase(s.phase)} | ${s.status.replace(/_/g, " ")} | ${hours} | ${blockers} |`;
      }).join("\n")
    : "| --- | No slices defined yet | - | - | - | - |";

  const nextActions = state.nextActions.length ? state.nextActions.map((a) => `- ${a}`).join("\n") : "- None";
  const risks = state.risks.length ? state.risks.map((r) => `- ${r}`).join("\n") : "- None";

  const historyRows = state.phaseHistory.slice(-10).map((h) => {
    const reason = h.reason ? ` — ${h.reason}` : "";
    return `| ${h.at} | ${titleCase(h.phase)} | ${h.action}${reason} |`;
  }).join("\n");

  const resumePrompt = [
    `Project: ${state.projectName}`,
    `Current phase: ${state.currentPhase}`,
    `Current slice: ${currentSlice?.title || "not set"}`,
    `Progress: ${state.hours.progressPercent}%`,
    "",
    "Start by calling get_status to load the current project state, then continue with the next safest step.",
  ].join("\n");

  return (
    `# Project Status — ${state.projectName}\n\n` +
    `**Updated:** ${state.updatedAt}\n` +
    `**Current Phase:** ${titleCase(state.currentPhase)}\n` +
    `**Current Slice:** ${currentSlice?.title || "Not set"}\n` +
    `**Progress:** ${progressBar(state.hours.progressPercent)} ${state.hours.progressPercent}%\n` +
    `**Estimated Total:** ${state.hours.totalEstimatedMin}-${state.hours.totalEstimatedMax} hours\n` +
    `**Remaining:** ${state.hours.remainingEstimatedMin}-${state.hours.remainingEstimatedMax} hours\n\n` +
    `## Workflow\n\n${renderMermaid(state)}\n\n` +
    `## Phases\n\n| Status | Phase | State | Notes |\n|---|---|---|---|\n${phaseRows}\n\n` +
    `## Slices\n\n| Status | Slice | Phase | State | Estimate | Blockers |\n|---|---|---|---|---:|---|\n${sliceRows}\n\n` +
    `## Next Actions\n\n${nextActions}\n\n` +
    `## Risks\n\n${risks}\n\n` +
    `## Phase History (last 10)\n\n| Time | Phase | Action |\n|---|---|---|\n${historyRows}\n\n` +
    `## Resume Prompt\n\n\`\`\`text\n${resumePrompt}\n\`\`\`\n`
  );
}

// ---------------------------------------------------------------------------
// Workflow routing — state-first, keyword-fallback
// ---------------------------------------------------------------------------

function inferPhaseFromKeywords(task: string): Phase | null {
  const t = task.toLowerCase();
  if (/\b(bug|debug|error|exception|stack trace|failing test|failed test|broken|crash|regression|doesn't work|does not work)\b/.test(t)) return "debug";
  if (/\b(review|audit|critique|check my code|code review|security review|architecture review)\b/.test(t)) return "review";
  if (/\b(test|qa|verify|verification|quality gate)\b/.test(t)) return "test";
  if (/\b(ship|commit|push|release|merge|pr|pull request|ready to ship)\b/.test(t)) return "ship";
  if (/\b(reflect|handoff|pause|summarize state|context save|resume)\b/.test(t)) return "reflect";
  if (/\b(plan|architecture|roadmap|implementation plan|design the system)\b/.test(t)) return "plan";
  if (/\b(idea|mvp|scope|define|requirements|what should we build|product)\b/.test(t)) return "think";
  return null;
}

type WorkflowOutput = {
  phase: Phase;
  codingAllowed: boolean;
  instructions: string[];
  checklist: string[];
  verificationCommands: string[];
  requiredDocs: string[];
  gateStatus: { entryGate: GateResult; exitGate: GateResult };
  routingMethod: "state" | "keyword" | "explicit" | "default";
  warnings: string[];
  promptSummary: string;
  trackerNote?: string;
  recommendedSkills: SkillRef[];
  missingSkills: string[];
  externalState?: { system: "gsd"; note: string };
};

async function routeWorkflow(input: {
  task: string;
  requestedPhase: "auto" | Phase;
  repoSize: RepoSize;
  riskLevel: RiskLevel;
  hasFailingTests?: boolean;
  repoPath?: string;
  runtime?: Runtime;
}): Promise<WorkflowOutput> {
  const repoPath = input.repoPath || ".";
  const loaded = await loadProjectState(repoPath);
  const state = loaded.state;

  let phase: Phase;
  let routingMethod: WorkflowOutput["routingMethod"];
  let trackerNote: string | undefined;

  if (input.requestedPhase !== "auto") {
    phase = input.requestedPhase;
    routingMethod = "explicit";
  } else if (input.hasFailingTests) {
    phase = "debug";
    routingMethod = "keyword";
    trackerNote = "Routed to debug because hasFailingTests=true.";
  } else if (state) {
    phase = state.currentPhase;
    routingMethod = "state";
    trackerNote = `Using saved state. Current phase: ${state.currentPhase}. Current slice: ${currentSliceTitle(state) || "not set"}. Progress: ${state.hours.progressPercent}%.`;
  } else {
    const inferred = inferPhaseFromKeywords(input.task);
    if (inferred) {
      phase = inferred;
      routingMethod = "keyword";
      trackerNote = `No project tracker found. Inferred phase "${phase}" from task description. Consider running init_project for state tracking.`;
    } else {
      phase = "think";
      routingMethod = "default";
      trackerNote = "No tracker and no clear phase signal. Defaulting to Think phase. Run init_project to set up tracking.";
    }
  }

  const def = getPhaseDefinition(phase, input.riskLevel);
  const entryGate = await evaluateGate(def.gateToEnter, repoPath, state || createInitialState({ projectName: "temp", repoSize: input.repoSize, riskLevel: input.riskLevel }));
  const exitGate = await evaluateGate(def.gateToLeave, repoPath, state || createInitialState({ projectName: "temp", repoSize: input.repoSize, riskLevel: input.riskLevel }));

  const warnings: string[] = [];
  if (!entryGate.passed) {
    const failing = entryGate.results.filter((r) => !r.passed).map((r) => r.description);
    warnings.push(`Entry gate not satisfied: ${failing.join(", ")}. You may need to complete a prior phase first.`);
  }
  if (input.repoSize === "large") {
    warnings.push("Large repo: use read-only subagents for codebase exploration. Keep noisy logs out of the main thread.");
  }

  const runtime: Runtime = input.runtime || "claude";
  const availability: SkillAvailability = runtime === "claude"
    ? await detectSkillAvailability()
    : { families: { gsd: false, gstack: false, superpowers: false }, installedSkills: new Set<string>() };
  const recs = getSkillRecommendations(phase, availability);

  let externalState: WorkflowOutput["externalState"];
  if (await detectGsdPlanning(repoPath)) {
    externalState = { system: "gsd", note: gsdCoexistenceNote(Boolean(state)) };
    warnings.push(externalState.note);
  }

  const promptLines = [
    `Phase: ${phase} | Coding allowed: ${def.codingAllowed ? "yes (current slice only)" : "no"}`,
    "",
    "Instructions:",
    ...def.instructions.map((i) => `- ${i}`),
    "",
    "Checklist:",
    ...def.checklist.map((c) => `- [ ] ${c}`),
    ...(runtime === "claude" ? formatSkillSection(phase, recs) : []),
  ];

  if (warnings.length) {
    promptLines.push("", "Warnings:", ...warnings.map((w) => `- ${w}`));
  }

  return {
    phase,
    codingAllowed: def.codingAllowed,
    instructions: def.instructions,
    checklist: def.checklist,
    verificationCommands: def.verificationCommands,
    requiredDocs: def.requiredDocs,
    gateStatus: { entryGate, exitGate },
    routingMethod,
    warnings,
    promptSummary: promptLines.join("\n"),
    trackerNote,
    recommendedSkills: recs.available,
    missingSkills: recs.missingSkills,
    externalState,
  };
}

// ---------------------------------------------------------------------------
// Bootstrap docs
// ---------------------------------------------------------------------------

async function bootstrapDocs(projectName: string): Promise<Record<string, string>> {
  const title = projectName || "MVP Project";
  return {
    "AGENTS.md": [
      `# ${title}`,
      "",
      "## Workflow",
      "",
      "Think -> Plan -> Build -> Review -> Test -> Ship -> Reflect",
      "",
      "Use the mvp-router MCP server for all non-trivial work.",
      "Call `choose_workflow` at the start of each task to get phase-specific instructions.",
      "Call `get_status` at the start of each session to load project state.",
      "",
      "## Rules",
      "",
      "- One vertical slice at a time.",
      "- Tests before implementation where practical.",
      "- Run tests/build/lint before claiming completion.",
      "- No fixes before root cause is proven.",
      "- No push/deploy without user approval.",
      "- Update docs/CURRENT_STATE.md and docs/TODO.md after meaningful changes.",
      "- Do not add features, dependencies, or architecture changes without approval.",
      "",
    ].join("\n"),
    "docs/PROJECT_BRIEF.md": `# ${title} — Project Brief\n\n## User\n\nTBD\n\n## Problem\n\nTBD\n\n## MVP Goal\n\nTBD\n\n## Success Criteria\n\nTBD\n`,
    "docs/MVP_SCOPE.md": "# MVP Scope\n\n## Included in V1\n\n- TBD\n\n## Not Included in V1\n\n- TBD\n",
    "docs/USER_STORIES.md": "# User Stories\n\n- As a [user], I want [goal] so that [reason].\n",
    "docs/ARCHITECTURE.md": "# Architecture\n\n## Data Flow\n\nTBD\n\n## Integrations\n\nTBD\n\n## Failure Modes\n\nTBD\n",
    "docs/DECISIONS.md": "# Decisions\n\n| Date | Decision | Reason | Tradeoff |\n|---|---|---|---|\n",
    "docs/CURRENT_STATE.md": "# Current State\n\n## What Works\n\n- TBD\n\n## What Is Broken\n\n- TBD\n\n## Changed Files\n\n- TBD\n\n## Next Step\n\n- TBD\n",
    "docs/TODO.md": "# TODO\n\n## Next Slice\n\n- TBD\n\n## Backlog\n\n- TBD\n",
    "docs/TEST_PLAN.md": "# Test Plan\n\n## Automated Checks\n\n- TBD\n\n## Manual Checks\n\n- TBD\n",
    "docs/SECURITY.md": "# Security\n\n## Sensitive Data\n\nTBD\n\n## Human Approval Requirements\n\nTBD\n\n## Audit Logging\n\nTBD\n",
  };
}

// ---------------------------------------------------------------------------
// Hour estimation
// ---------------------------------------------------------------------------

function estimateHours(input: {
  complexity: "small" | "medium" | "large";
  sliceCount: number;
  integrationCount: number;
  hasAuth: boolean;
  hasAI: boolean;
  hasDashboard: boolean;
  dataSensitivity: "low" | "medium" | "high";
}) {
  const basePerSlice = input.complexity === "small" ? [3, 6] : input.complexity === "large" ? [8, 18] : [5, 12];
  let min = input.sliceCount * basePerSlice[0];
  let max = input.sliceCount * basePerSlice[1];

  min += input.integrationCount * 3;
  max += input.integrationCount * 8;
  if (input.hasAuth) { min += 4; max += 12; }
  if (input.hasAI) { min += 5; max += 16; }
  if (input.hasDashboard) { min += 4; max += 12; }
  if (input.dataSensitivity === "medium") { min += 3; max += 8; }
  if (input.dataSensitivity === "high") { min += 8; max += 20; }
  min += 6;
  max += 18;

  return {
    estimatedHoursMin: min,
    estimatedHoursMax: max,
    calendar: {
      "5h_per_week": `${Math.ceil(min / 5)}-${Math.ceil(max / 5)} weeks`,
      "10h_per_week": `${Math.ceil(min / 10)}-${Math.ceil(max / 10)} weeks`,
      "20h_per_week": `${Math.ceil(min / 20)}-${Math.ceil(max / 20)} weeks`,
    },
    assumptions: [
      "Estimate assumes an MVP, not polished production SaaS.",
      "Bug fixing and integration surprises can change the range.",
      "Update project state after each slice to refine the estimate.",
    ],
  };
}

// ---------------------------------------------------------------------------
// MCP Server registration
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "mvp-router", version: "0.4.1" });

// --- choose_workflow ---
server.registerTool(
  "choose_workflow",
  {
    title: "Choose Workflow Phase",
    description: "Route any software task to the correct development phase (think/plan/build/review/test/debug/ship/reflect) and the best installed skill to execute it. State-first: uses saved project state if available, falls back to task analysis. Call this at the start of every non-trivial task, when unsure what to do next, or when switching between planning, coding, reviewing, testing, or shipping.",
    inputSchema: {
      task: z.string().describe("What you are trying to do."),
      requestedPhase: z.enum(["auto", "think", "plan", "build", "review", "test", "debug", "ship", "reflect"]).default("auto").describe("Set a specific phase, or 'auto' to let the router decide."),
      repoSize: z.enum(["small", "medium", "large"]).default("medium"),
      riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
      hasFailingTests: z.boolean().default(false),
      repoPath: z.string().default(".").describe("Repo root path for state lookup."),
      runtime: z.enum(["claude", "codex", "generic"]).default("claude").describe("Runtime hosting this session. 'claude' returns installed-skill recommendations; others get self-contained instructions only."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const result = await routeWorkflow(input as any);
    return { structuredContent: result, content: [{ type: "text", text: result.promptSummary }] };
  }
);

// --- get_skill_map ---
server.registerTool(
  "get_skill_map",
  {
    title: "Get Skill Map",
    description: "Return the full phase-to-skill routing table (gsd / gstack / superpowers picks per phase) with installed/missing status for each skill family. Use to see which specialist skill handles which part of the development lifecycle.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => {
    const availability = await detectSkillAvailability();
    const { families } = availability;
    const lines: string[] = [
      `Installed skill families: gsd=${families.gsd} gstack=${families.gstack} superpowers=${families.superpowers}`,
      "",
    ];
    for (const phase of ALL_PHASES) {
      const recs = getSkillRecommendations(phase, availability);
      lines.push(`${titleCase(phase)}:`);
      const refs = SKILL_MAP[phase] || [];
      for (const r of refs) {
        const mark = availability.installedSkills.has(r.skill) ? "" : " [NOT INSTALLED]";
        lines.push(`- [${r.role.toUpperCase()}] ${r.skill}${mark} — ${r.when}`);
      }
      if (recs.available.length === 0) lines.push("- (no installed skills — use self-contained phase instructions)");
      lines.push("");
    }
    return {
      structuredContent: { installed: families, installedSkills: [...availability.installedSkills].sort(), skillMap: SKILL_MAP },
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }
);

// --- init_project ---
server.registerTool(
  "init_project",
  {
    title: "Initialize Project",
    description: "Create project tracker (.mvp-router/project-state.json) and dashboard (docs/PROJECT_STATUS.md). Optionally provide slices, or add them later with add_slice.",
    inputSchema: {
      repoPath: z.string().default("."),
      projectName: z.string(),
      projectDescription: z.string().default(""),
      repoSize: z.enum(["small", "medium", "large"]).default("medium"),
      riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
      slices: z.array(z.object({
        title: z.string(),
        phase: z.enum(["think", "plan", "build", "review", "test", "debug", "ship", "reflect"]),
        estimatedHoursMin: z.number(),
        estimatedHoursMax: z.number(),
        acceptanceCriteria: z.array(z.string()).default([]),
      })).default([]).describe("Optional initial slices. Can also be added later with add_slice."),
      overwrite: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { repoPath: string; projectName: string; projectDescription: string; repoSize: RepoSize; riskLevel: RiskLevel; slices: any[]; overwrite: boolean };
    const paths = trackerPaths(data.repoPath);
    const existing = await loadProjectState(data.repoPath);

    if (existing.state && !data.overwrite) {
      const dashboard = renderDashboard(existing.state);
      return { structuredContent: { created: false, alreadyExists: true, state: existing.state, dashboard }, content: [{ type: "text", text: `Project tracker already exists.\n\n${dashboard}` }] };
    }

    if (existing.error?.kind === "invalid" && !data.overwrite) {
      return { structuredContent: { created: false, message: existing.error.message }, content: [{ type: "text", text: existing.error.message }] };
    }

    const statusExists = await fileExists(paths.statusFile);
    if (!existing.state && statusExists && !data.overwrite) {
      const msg = "docs/PROJECT_STATUS.md exists but .mvp-router/project-state.json is missing. Pass overwrite=true to replace.";
      return { structuredContent: { created: false, conflict: true, message: msg }, content: [{ type: "text", text: msg }] };
    }

    const backupFiles = data.overwrite
      ? (await Promise.all([backupIfExists(paths.stateFile), backupIfExists(paths.statusFile)])).filter(Boolean) as string[]
      : [];

    const state = createInitialState(data);
    await writeProjectState(data.repoPath, state, true);
    const dashboard = renderDashboard(state);

    return {
      structuredContent: { created: true, state, dashboard, files: [".mvp-router/project-state.json", "docs/PROJECT_STATUS.md"], backupFiles: backupFiles.map((f) => path.relative(paths.root, f)) },
      content: [{ type: "text", text: `Project initialized.\n\n${dashboard}` }],
    };
  }
);

// --- get_status ---
server.registerTool(
  "get_status",
  {
    title: "Get Project Status",
    description: "Read project state and return current phase, slice, dashboard, and resume prompt. Call this at the start of every session.",
    inputSchema: {
      repoPath: z.string().default("."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { repoPath: string };
    const loaded = await loadProjectState(data.repoPath);
    const hasGsd = await detectGsdPlanning(data.repoPath);
    if (!loaded.state) {
      const gsdNote = hasGsd ? `\n\n${gsdCoexistenceNote(false)}` : "";
      const msg = (loaded.error?.message || "No tracker found. Run init_project first.") + gsdNote;
      return { structuredContent: { found: false, message: msg, externalState: hasGsd ? "gsd" : undefined }, content: [{ type: "text", text: msg }] };
    }
    await writeProjectState(data.repoPath, loaded.state, true);
    const availability = await detectSkillAvailability();
    const recs = getSkillRecommendations(loaded.state.currentPhase, availability);
    const extras = [
      ...formatSkillSection(loaded.state.currentPhase, recs),
      ...(hasGsd ? ["", gsdCoexistenceNote(true)] : []),
    ].join("\n");
    const dashboard = renderDashboard(loaded.state);
    return {
      structuredContent: { found: true, state: loaded.state, dashboard, recommendedSkills: recs.available, externalState: hasGsd ? "gsd" : undefined },
      content: [{ type: "text", text: `${dashboard}${extras}` }],
    };
  }
);

// --- advance_phase ---
server.registerTool(
  "advance_phase",
  {
    title: "Advance to Next Phase",
    description: "Move to the next phase in the lifecycle. Enforces exit gates on the current phase and entry gates on the next. Refuses if conditions are not met.",
    inputSchema: {
      repoPath: z.string().default("."),
      phaseNotes: z.string().default("").describe("Notes to record on the current phase before advancing."),
      force: z.boolean().default(false).describe("Force advance even if gates fail. The skip is recorded in history."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { repoPath: string; phaseNotes: string; force: boolean };
    const loaded = await loadProjectState(data.repoPath);
    if (!loaded.state) {
      const msg = loaded.error?.message || "No tracker found. Run init_project first.";
      return { structuredContent: { advanced: false, message: msg }, content: [{ type: "text", text: msg }] };
    }

    const state = loaded.state;
    const current = state.currentPhase;
    const next = nextPhase(current);

    if (!next) {
      const msg = `Already at the last phase (${current}). The lifecycle is complete. Start a new cycle by setting the phase back to "think" or "plan".`;
      return { structuredContent: { advanced: false, message: msg, currentPhase: current }, content: [{ type: "text", text: msg }] };
    }

    const currentDef = getPhaseDefinition(current, state.riskLevel);
    const nextDef = getPhaseDefinition(next, state.riskLevel);

    const exitGate = await evaluateGate(currentDef.gateToLeave, data.repoPath, state);
    const entryGate = await evaluateGate(nextDef.gateToEnter, data.repoPath, state);

    const failedExit = exitGate.results.filter((r) => !r.passed);
    const failedEntry = entryGate.results.filter((r) => !r.passed);
    const allFailed = [...failedExit, ...failedEntry];

    if (allFailed.length > 0 && !data.force) {
      const reasons = allFailed.map((r) => `- ${r.description}`).join("\n");
      const msg = `Cannot advance from ${current} to ${next}. Gate conditions not met:\n${reasons}\n\nFix these conditions or pass force=true to override (the skip will be recorded).`;
      return {
        structuredContent: { advanced: false, blocked: true, currentPhase: current, targetPhase: next, failedConditions: allFailed.map((r) => r.description) },
        content: [{ type: "text", text: msg }],
      };
    }

    if (data.phaseNotes) state.phases[current].notes = data.phaseNotes;
    state.phases[current].status = "done";
    state.phases[current].updatedAt = now();

    const forceNote = allFailed.length > 0 ? ` (forced — skipped gates: ${allFailed.map((r) => r.description).join(", ")})` : "";
    state.phaseHistory.push({ phase: current, action: "completed", reason: forceNote || undefined, at: now() });
    state.phaseHistory.push({ phase: next, action: "entered", at: now() });

    state.currentPhase = next;
    state.phases[next].status = "in_progress";
    state.phases[next].updatedAt = now();

    await writeProjectState(data.repoPath, state, true);
    const updated = (await loadProjectState(data.repoPath)).state!;
    const dashboard = renderDashboard(updated);

    const nextDefFull = getPhaseDefinition(next, updated.riskLevel);
    const availability = await detectSkillAvailability();
    const recs = getSkillRecommendations(next, availability);
    const summary = [
      `Advanced: ${current} -> ${next}${forceNote}`,
      "",
      `Phase: ${next} | Coding allowed: ${nextDefFull.codingAllowed ? "yes (current slice only)" : "no"}`,
      "",
      "Instructions:",
      ...nextDefFull.instructions.map((i) => `- ${i}`),
      "",
      "Checklist:",
      ...nextDefFull.checklist.map((c) => `- [ ] ${c}`),
      ...formatSkillSection(next, recs),
    ].join("\n");

    return {
      structuredContent: { advanced: true, previousPhase: current, currentPhase: next, instructions: nextDefFull.instructions, checklist: nextDefFull.checklist, recommendedSkills: recs.available, dashboard },
      content: [{ type: "text", text: summary }],
    };
  }
);

// --- skip_phase ---
server.registerTool(
  "skip_phase",
  {
    title: "Skip a Phase",
    description: "Explicitly skip a phase (e.g., skip Think for a hotfix, skip Ship for a spike). The skip is permanently recorded in project history.",
    inputSchema: {
      repoPath: z.string().default("."),
      phase: z.enum(["think", "plan", "build", "review", "test", "ship", "reflect"]).describe("The phase to skip."),
      reason: z.string().describe("Why this phase is being skipped. Recorded permanently."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { repoPath: string; phase: Phase; reason: string };
    const loaded = await loadProjectState(data.repoPath);
    if (!loaded.state) {
      const msg = loaded.error?.message || "No tracker found. Run init_project first.";
      return { structuredContent: { skipped: false, message: msg }, content: [{ type: "text", text: msg }] };
    }

    const state = loaded.state;

    if (state.phases[data.phase].status === "done") {
      const msg = `Phase ${data.phase} is already done. Cannot skip a completed phase.`;
      return { structuredContent: { skipped: false, message: msg }, content: [{ type: "text", text: msg }] };
    }

    state.phases[data.phase].status = "skipped";
    state.phases[data.phase].skippedReason = data.reason;
    state.phases[data.phase].updatedAt = now();
    state.phaseHistory.push({ phase: data.phase, action: "skipped", reason: data.reason, at: now() });

    if (state.currentPhase === data.phase) {
      const next = nextPhase(data.phase);
      if (next) {
        state.currentPhase = next;
        state.phases[next].status = "in_progress";
        state.phases[next].updatedAt = now();
        state.phaseHistory.push({ phase: next, action: "entered", at: now() });
      }
    }

    await writeProjectState(data.repoPath, state, true);
    const updated = (await loadProjectState(data.repoPath)).state!;
    const dashboard = renderDashboard(updated);
    const msg = `Skipped phase: ${data.phase}. Reason: ${data.reason}. Current phase is now: ${updated.currentPhase}.`;

    return { structuredContent: { skipped: true, phase: data.phase, reason: data.reason, currentPhase: updated.currentPhase, dashboard }, content: [{ type: "text", text: `${msg}\n\n${dashboard}` }] };
  }
);

// --- check_gate ---
server.registerTool(
  "check_gate",
  {
    title: "Check Phase Gate",
    description: "Check whether the current phase's exit gate (or a specific phase's entry/exit gate) is satisfied, without advancing. Use this to see what's blocking progress.",
    inputSchema: {
      repoPath: z.string().default("."),
      phase: z.enum(["think", "plan", "build", "review", "test", "debug", "ship", "reflect"]).optional().describe("Phase to check. Defaults to current phase."),
      gateType: z.enum(["entry", "exit"]).default("exit").describe("Check entry or exit gate."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { repoPath: string; phase?: Phase; gateType: "entry" | "exit" };
    const loaded = await loadProjectState(data.repoPath);
    const state = loaded.state || createInitialState({ projectName: "check", repoSize: "medium", riskLevel: "medium" });
    const phase = data.phase || state.currentPhase;
    const def = getPhaseDefinition(phase, state.riskLevel);
    const conditions = data.gateType === "entry" ? def.gateToEnter : def.gateToLeave;

    if (conditions.length === 0) {
      const msg = `No ${data.gateType} gate conditions defined for phase: ${phase}.`;
      return { structuredContent: { phase, gateType: data.gateType, passed: true, conditions: [] }, content: [{ type: "text", text: msg }] };
    }

    const result = await evaluateGate(conditions, data.repoPath, state);
    const lines = result.results.map((r) => `${r.passed ? "[PASS]" : "[FAIL]"} ${r.description}`);
    const summary = `${titleCase(phase)} ${data.gateType} gate: ${result.passed ? "ALL PASSED" : "BLOCKED"}\n\n${lines.join("\n")}`;

    return { structuredContent: { phase, gateType: data.gateType, passed: result.passed, conditions: result.results }, content: [{ type: "text", text: summary }] };
  }
);

// --- add_slice ---
server.registerTool(
  "add_slice",
  {
    title: "Add Slice",
    description: "Add a new vertical slice to the project. Each slice represents a complete, testable unit of user-facing work.",
    inputSchema: {
      repoPath: z.string().default("."),
      title: z.string(),
      phase: z.enum(["think", "plan", "build", "review", "test", "debug", "ship", "reflect"]).default("build"),
      estimatedHoursMin: z.number().default(2),
      estimatedHoursMax: z.number().default(6),
      acceptanceCriteria: z.array(z.string()).default([]),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { repoPath: string; title: string; phase: Phase; estimatedHoursMin: number; estimatedHoursMax: number; acceptanceCriteria: string[] };
    const loaded = await loadProjectState(data.repoPath);
    if (!loaded.state) {
      const msg = loaded.error?.message || "No tracker found. Run init_project first.";
      return { structuredContent: { added: false, message: msg }, content: [{ type: "text", text: msg }] };
    }

    const state = loaded.state;
    const existingSlice = state.slices.find((s) => s.title.toLowerCase() === data.title.toLowerCase());
    if (existingSlice) {
      const msg = `Slice "${data.title}" already exists (id: ${existingSlice.id}, status: ${existingSlice.status}).`;
      return { structuredContent: { added: false, duplicate: true, existing: existingSlice, message: msg }, content: [{ type: "text", text: msg }] };
    }

    const slice: ProjectSlice = {
      id: safeId(data.title),
      title: data.title,
      phase: data.phase,
      status: "not_started",
      estimatedHoursMin: data.estimatedHoursMin,
      estimatedHoursMax: data.estimatedHoursMax,
      acceptanceCriteria: data.acceptanceCriteria,
      blockers: [],
      notes: "",
      updatedAt: now(),
    };
    state.slices.push(slice);

    await writeProjectState(data.repoPath, state, true);
    const updated = (await loadProjectState(data.repoPath)).state!;
    const msg = `Added slice: "${data.title}" (phase: ${data.phase}, estimate: ${data.estimatedHoursMin}-${data.estimatedHoursMax}h)`;
    return { structuredContent: { added: true, slice, totalSlices: updated.slices.length }, content: [{ type: "text", text: msg }] };
  }
);

// --- update_progress ---
server.registerTool(
  "update_progress",
  {
    title: "Update Progress",
    description: "Update the current slice status, notes, completed commands, risks, and next actions. Use after meaningful work to keep the tracker current.",
    inputSchema: {
      repoPath: z.string().default("."),
      currentSliceId: z.string().optional().describe("Slice ID to update. Defaults to current slice."),
      sliceStatus: z.enum(["not_started", "in_progress", "blocked", "done"]).optional(),
      sliceNotes: z.string().optional(),
      actualHours: z.number().optional(),
      blockers: z.array(z.string()).default([]),
      completedCommands: z.array(z.string()).default([]),
      risks: z.array(z.string()).default([]),
      nextActions: z.array(z.string()).default([]),
      phaseNotes: z.string().optional().describe("Notes for the current phase."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as {
      repoPath: string; currentSliceId?: string; sliceStatus?: SliceStatus; sliceNotes?: string; actualHours?: number;
      blockers: string[]; completedCommands: string[]; risks: string[]; nextActions: string[]; phaseNotes?: string;
    };
    const loaded = await loadProjectState(data.repoPath);
    if (!loaded.state) {
      const msg = loaded.error?.message || "No tracker found. Run init_project first.";
      return { structuredContent: { updated: false, message: msg }, content: [{ type: "text", text: msg }] };
    }

    const state = loaded.state;
    const sliceId = data.currentSliceId || state.currentSliceId;
    const slice = sliceId ? state.slices.find((s) => s.id === sliceId) : undefined;

    if (slice) {
      if (data.sliceStatus) slice.status = data.sliceStatus;
      if (data.sliceNotes) slice.notes = data.sliceNotes;
      if (typeof data.actualHours === "number") slice.actualHours = data.actualHours;
      if (data.blockers.length) slice.blockers = Array.from(new Set([...slice.blockers, ...data.blockers]));
      slice.updatedAt = now();
      state.currentSliceId = slice.id;
    }

    if (data.phaseNotes) {
      state.phases[state.currentPhase].notes = data.phaseNotes;
      state.phases[state.currentPhase].updatedAt = now();
    }

    if (data.completedCommands.length) state.completedCommands = Array.from(new Set([...state.completedCommands, ...data.completedCommands]));
    if (data.risks.length) state.risks = Array.from(new Set([...state.risks, ...data.risks]));
    if (data.nextActions.length) state.nextActions = data.nextActions;

    await writeProjectState(data.repoPath, state, true);
    const updated = (await loadProjectState(data.repoPath)).state!;
    const dashboard = renderDashboard(updated);
    return { structuredContent: { updated: true, state: updated, dashboard }, content: [{ type: "text", text: dashboard }] };
  }
);

// --- pause_work ---
server.registerTool(
  "pause_work",
  {
    title: "Pause Work",
    description: "Create docs/HANDOFF.md with a resume prompt, current state, and next actions. Use before ending a session or switching context.",
    inputSchema: {
      repoPath: z.string().default("."),
      handoffNotes: z.string().default(""),
      nextActions: z.array(z.string()).default([]),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { repoPath: string; handoffNotes: string; nextActions: string[] };
    const loaded = await loadProjectState(data.repoPath);
    if (!loaded.state) {
      const msg = loaded.error?.message || "No tracker found. Run init_project first.";
      return { structuredContent: { paused: false, message: msg }, content: [{ type: "text", text: msg }] };
    }

    const state = loaded.state;
    if (data.nextActions.length) state.nextActions = data.nextActions;
    state.lastHandoff = data.handoffNotes || `Paused at phase ${state.currentPhase}, slice ${currentSliceTitle(state) || "not set"}.`;

    await writeProjectState(data.repoPath, state, true);
    const updated = (await loadProjectState(data.repoPath)).state!;
    const paths = trackerPaths(data.repoPath);
    const handoff = `# Project Handoff\n\n${renderDashboard(updated)}\n\n## Handoff Notes\n\n${updated.lastHandoff || "None"}\n`;
    await fs.mkdir(paths.docsDir, { recursive: true });
    await fs.writeFile(paths.handoffFile, handoff, "utf8");

    return { structuredContent: { paused: true, state: updated, handoffFile: "docs/HANDOFF.md" }, content: [{ type: "text", text: handoff }] };
  }
);

// --- estimate_hours ---
server.registerTool(
  "estimate_hours",
  {
    title: "Estimate Hours",
    description: "Estimate MVP development hours based on complexity, slices, integrations, and feature flags.",
    inputSchema: {
      complexity: z.enum(["small", "medium", "large"]).default("medium"),
      sliceCount: z.number().int().min(1).max(40).default(8),
      integrationCount: z.number().int().min(0).max(20).default(1),
      hasAuth: z.boolean().default(false),
      hasAI: z.boolean().default(false),
      hasDashboard: z.boolean().default(false),
      dataSensitivity: z.enum(["low", "medium", "high"]).default("medium"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const result = estimateHours(input as any);
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- get_bootstrap_docs ---
server.registerTool(
  "get_bootstrap_docs",
  {
    title: "Get Bootstrap Docs",
    description: "Return starter AGENTS.md and docs/*.md templates for a new project. Read-only — copy the content into files after review.",
    inputSchema: {
      projectName: z.string().default("MVP Project"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { projectName: string };
    const docs = await bootstrapDocs(data.projectName);
    const fileList = Object.keys(docs).map((f) => `- ${f}`).join("\n");
    return { structuredContent: { files: docs }, content: [{ type: "text", text: `Bootstrap docs ready:\n${fileList}\n\nReview and copy into your project.` }] };
  }
);

// --- get_phase_instructions ---
server.registerTool(
  "get_phase_instructions",
  {
    title: "Get Phase Instructions",
    description: "Get the full instructions, checklist, and gate conditions for any phase. Useful for understanding what a phase requires without routing.",
    inputSchema: {
      phase: z.enum(["think", "plan", "build", "review", "test", "debug", "ship", "reflect"]),
      riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { phase: Phase; riskLevel: RiskLevel };
    const def = getPhaseDefinition(data.phase, data.riskLevel);
    const availability = await detectSkillAvailability();
    const recs = getSkillRecommendations(data.phase, availability);

    const summary = [
      `Phase: ${titleCase(data.phase)} | Coding allowed: ${def.codingAllowed ? "yes" : "no"}`,
      "",
      "Instructions:",
      ...def.instructions.map((i) => `- ${i}`),
      "",
      "Checklist:",
      ...def.checklist.map((c) => `- [ ] ${c}`),
      "",
      "Entry gate conditions:",
      ...(def.gateToEnter.length ? def.gateToEnter.map((g) => `- ${g.description}`) : ["- None"]),
      "",
      "Exit gate conditions:",
      ...(def.gateToLeave.length ? def.gateToLeave.map((g) => `- ${g.description}`) : ["- None"]),
      "",
      "Verification commands:",
      ...(def.verificationCommands.length ? def.verificationCommands.map((c) => `- ${c}`) : ["- None"]),
      "",
      "Required docs:",
      ...def.requiredDocs.map((d) => `- ${d}`),
      ...formatSkillSection(data.phase, recs),
    ].join("\n");

    return { structuredContent: { ...def, recommendedSkills: recs.available }, content: [{ type: "text", text: summary }] };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export async function startServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
