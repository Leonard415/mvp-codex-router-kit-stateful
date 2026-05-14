import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

type Phase = "think" | "plan" | "build" | "review" | "test" | "debug" | "ship" | "reflect";
type ProjectType = "yoga_studio" | "it_help_app" | "generic" | "custom";
type RepoSize = "small" | "medium" | "large";
type RiskLevel = "low" | "medium" | "high";
type PhaseStatus = "not_started" | "in_progress" | "blocked" | "done";
type SliceStatus = "not_started" | "in_progress" | "blocked" | "done";

type WorkflowInput = {
  task: string;
  projectType: ProjectType;
  requestedPhase: "auto" | Phase;
  repoSize: RepoSize;
  riskLevel: RiskLevel;
  hasExistingPlan?: boolean;
  hasFailingTests?: boolean;
  repoPath?: string;
};

type WorkflowOutput = {
  phase: Phase;
  codingAllowed: boolean;
  primarySkillStyle: string;
  reviewerSkillStyle: string;
  phaseGate: string;
  requiredDocs: string[];
  checklist: string[];
  verificationCommands: string[];
  projectWarnings: string[];
  largeRepoAdvice: string[];
  promptToRunNext: string;
  trackerNote?: string;
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
  schemaVersion: "0.2.0";
  projectId: string;
  projectName: string;
  projectType: ProjectType;
  projectDescription: string;
  repoSize: RepoSize;
  riskLevel: RiskLevel;
  createdAt: string;
  updatedAt: string;
  currentPhase: Phase;
  currentSliceId?: string;
  phases: Record<Phase, { status: PhaseStatus; notes: string; updatedAt: string }>;
  slices: ProjectSlice[];
  risks: string[];
  nextActions: string[];
  completedCommands: string[];
  lastHandoff?: string;
  hours: {
    totalEstimatedMin: number;
    totalEstimatedMax: number;
    completedEstimated: number;
    remainingEstimatedMin: number;
    remainingEstimatedMax: number;
    progressPercent: number;
  };
};

const PHASES_WITH_DEBUG: Phase[] = ["think", "plan", "build", "review", "test", "debug", "ship", "reflect"];

const REQUIRED_DOCS = [
  "AGENTS.md",
  "docs/PROJECT_BRIEF.md",
  "docs/MVP_SCOPE.md",
  "docs/USER_STORIES.md",
  "docs/ARCHITECTURE.md",
  "docs/DECISIONS.md",
  "docs/CURRENT_STATE.md",
  "docs/TODO.md",
  "docs/TEST_PLAN.md",
  "docs/SECURITY.md",
  "docs/PROJECT_STATUS.md",
];

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

function inferPhase(task: string, requestedPhase: "auto" | Phase, hasFailingTests?: boolean): Phase {
  if (requestedPhase !== "auto") return requestedPhase;

  const t = task.toLowerCase();

  if (
    hasFailingTests ||
    /\b(bug|debug|error|exception|stack trace|failing|failed|broken|crash|regression|doesn't work|does not work)\b/.test(t)
  ) {
    return "debug";
  }

  if (/\b(review|audit|critique|check my code|code review|security review|architecture review)\b/.test(t)) return "review";
  if (/\b(test|qa|verify|verification|lint|typecheck|build failing|quality gate)\b/.test(t)) return "test";
  if (/\b(ship|commit|push|release|merge|pr|pull request|ready to ship)\b/.test(t)) return "ship";
  if (/\b(reflect|handoff|pause|summarize state|context save|compact|resume)\b/.test(t)) return "reflect";
  if (/\b(plan|architecture|roadmap|implementation plan|design the system|phase)\b/.test(t)) return "plan";
  if (/\b(idea|mvp|scope|define|requirements|what should we build|product)\b/.test(t)) return "think";

  return "build";
}

function phaseDefinition(phase: Phase, riskLevel: RiskLevel) {
  const base: Record<Phase, Omit<WorkflowOutput, "phase" | "projectWarnings" | "largeRepoAdvice" | "promptToRunNext" | "trackerNote">> = {
    think: {
      codingAllowed: false,
      primarySkillStyle: "gstack product thinking / office-hours style",
      reviewerSkillStyle: "GSD project setup",
      phaseGate: "No code. Define the narrowest useful MVP, non-goals, and demo success criteria.",
      requiredDocs: ["docs/PROJECT_BRIEF.md", "docs/MVP_SCOPE.md", "docs/USER_STORIES.md", "docs/PROJECT_STATUS.md"],
      checklist: [
        "Define the exact user",
        "Define the painful problem",
        "Define the smallest useful workflow",
        "List V1 non-goals",
        "Define first demo success criteria",
        "Identify riskiest assumptions",
      ],
      verificationCommands: [],
    },
    plan: {
      codingAllowed: false,
      primarySkillStyle: "GSD phase planning",
      reviewerSkillStyle: "Superpowers writing-plans + gstack engineering review",
      phaseGate: "No code until vertical slices, files, tests, acceptance criteria, and verification commands are clear.",
      requiredDocs: [...REQUIRED_DOCS, "docs/plans/001-mvp-implementation.md"],
      checklist: [
        "Read AGENTS.md and current docs",
        "Break the MVP into vertical slices",
        "For each slice, list files to edit",
        "For each slice, list tests to write first where practical",
        "For each slice, list acceptance criteria",
        "For each slice, list commands to run",
        "Run an architecture/failure-mode review before coding",
      ],
      verificationCommands: [],
    },
    build: {
      codingAllowed: true,
      primarySkillStyle: "Superpowers TDD / executing-plans",
      reviewerSkillStyle: "GSD execute phase",
      phaseGate: "Implement one vertical slice only. Do not add unrelated features or begin the next slice.",
      requiredDocs: ["AGENTS.md", "docs/CURRENT_STATE.md", "docs/TODO.md", "docs/TEST_PLAN.md", "docs/PROJECT_STATUS.md"],
      checklist: [
        "Restate the exact slice",
        "List files to change before editing",
        "Write failing tests first where practical",
        "Implement the smallest code change that satisfies the slice",
        "Run targeted tests",
        "Update docs/CURRENT_STATE.md",
        "Update docs/TODO.md",
        "Update .mvp-router/project-state.json",
        "Update docs/PROJECT_STATUS.md",
        "Summarize changed files",
      ],
      verificationCommands: ["npm test", "npm run build", "npm run lint"],
    },
    review: {
      codingAllowed: false,
      primarySkillStyle: "gstack review",
      reviewerSkillStyle: "Superpowers requesting-code-review",
      phaseGate: "Review first. Do not add features. Only fix issues directly related to the completed slice after findings are clear.",
      requiredDocs: ["AGENTS.md", "docs/CURRENT_STATE.md", "docs/TODO.md", "docs/SECURITY.md", "docs/PROJECT_STATUS.md"],
      checklist: [
        "Check correctness against acceptance criteria",
        "Check for missing tests",
        "Check for unnecessary complexity",
        "Check for architecture drift",
        "Check security and privacy assumptions",
        "Check files that should not have changed",
        "Return critical issues and recommended fixes",
      ],
      verificationCommands: ["git status --short", "git diff --stat"],
    },
    test: {
      codingAllowed: false,
      primarySkillStyle: "Superpowers verification-before-completion",
      reviewerSkillStyle: "gstack QA",
      phaseGate: "Work is not done until checks pass or failures are honestly documented.",
      requiredDocs: ["AGENTS.md", "docs/TEST_PLAN.md", "docs/CURRENT_STATE.md", "docs/TODO.md", "docs/PROJECT_STATUS.md"],
      checklist: [
        "Run tests if available",
        "Run build if available",
        "Run lint/typecheck if available",
        "Manually verify the main user flow",
        "Document failures clearly",
        "Update docs/CURRENT_STATE.md",
        "Update docs/TODO.md",
        "Update docs/PROJECT_STATUS.md",
      ],
      verificationCommands: ["npm test", "npm run build", "npm run lint"],
    },
    debug: {
      codingAllowed: false,
      primarySkillStyle: "Superpowers systematic-debugging",
      reviewerSkillStyle: "gstack investigate",
      phaseGate: "No fix before root cause is proven. Reproduce first, then trace data flow and test hypotheses.",
      requiredDocs: ["AGENTS.md", "docs/CURRENT_STATE.md", "docs/TODO.md", "docs/TEST_PLAN.md", "docs/PROJECT_STATUS.md"],
      checklist: [
        "Freeze feature work",
        "Reproduce the bug",
        "Record expected vs actual behavior",
        "Read the full error and stack trace",
        "Trace the data flow",
        "Check recent changes",
        "List hypotheses",
        "Test each hypothesis with evidence",
        "Identify root cause",
        "Write a regression test where practical",
        "Apply the smallest fix only after root cause is proven",
        "Verify with tests/build",
        "Update docs/CURRENT_STATE.md",
        "Update docs/PROJECT_STATUS.md",
      ],
      verificationCommands: ["npm test", "npm run build", "npm run lint", "git status --short"],
    },
    ship: {
      codingAllowed: false,
      primarySkillStyle: "Superpowers finishing-development-branch",
      reviewerSkillStyle: "GSD ship/report",
      phaseGate: "Do not push or deploy without explicit user approval.",
      requiredDocs: ["AGENTS.md", "docs/CURRENT_STATE.md", "docs/TODO.md", "docs/DECISIONS.md", "docs/PROJECT_STATUS.md"],
      checklist: [
        "Show git status",
        "Show changed files",
        "Confirm tests/build/lint",
        "Update CURRENT_STATE.md",
        "Update DECISIONS.md if needed",
        "Update PROJECT_STATUS.md",
        "Suggest commit message",
        "Ask before push/deploy",
      ],
      verificationCommands: ["git status --short", "git diff --stat", "npm test", "npm run build", "npm run lint"],
    },
    reflect: {
      codingAllowed: false,
      primarySkillStyle: "GSD pause/report",
      reviewerSkillStyle: "gstack context-save style",
      phaseGate: "Capture state before compaction, ending session, or switching phases.",
      requiredDocs: ["docs/CURRENT_STATE.md", "docs/TODO.md", "docs/DECISIONS.md", "docs/PROJECT_STATUS.md", "docs/HANDOFF.md"],
      checklist: [
        "Summarize what changed",
        "Summarize what works",
        "Summarize what is broken",
        "List files changed",
        "List commands run",
        "List risks and assumptions",
        "List the next recommended step",
        "Write a resume prompt",
      ],
      verificationCommands: ["git status --short", "git diff --stat"],
    },
  };

  const selected = base[phase];

  if (riskLevel === "high") {
    return {
      ...selected,
      checklist: [
        ...selected.checklist,
        "High-risk gate: explicitly check security, privacy, data loss, and rollback assumptions",
        "High-risk gate: do not perform destructive actions without approval",
      ],
    };
  }

  return selected;
}

function projectWarnings(projectType: ProjectType): string[] {
  if (projectType === "it_help_app") {
    return [
      "Require human approval for password resets, permission changes, account disabling, device wipes, and security incident closure.",
      "Check privacy, audit logging, employee-data exposure, and access-control assumptions.",
      "Do not store production credentials in code or docs.",
    ];
  }

  if (projectType === "yoga_studio") {
    return [
      "Do not add payments, memberships, payroll, complex analytics, instructor management, or multi-location support in V1 unless approved.",
      "Preserve human escalation and logging for booking, cancellation, and uncertainty.",
      "Do not invent studio policies. Escalate when unsure.",
    ];
  }

  return [
    "Keep MVP scope narrow.",
    "Prefer boring, reliable code.",
    "Do not add major dependencies or paid services without approval.",
  ];
}

function largeRepoAdvice(repoSize: RepoSize, phase: Phase): string[] {
  if (repoSize === "large" || phase === "debug") {
    return [
      "Use read-only subagents for codebase exploration if available.",
      "Keep noisy logs out of the main thread; summarize findings.",
      "Avoid broad refactors during debugging.",
    ];
  }
  return [];
}

async function routeWorkflow(input: WorkflowInput): Promise<WorkflowOutput> {
  let trackerNote: string | undefined;
  let state: ProjectState | null = null;

  if (input.repoPath) {
    state = await readProjectState(input.repoPath);
    if (state && input.requestedPhase === "auto" && !input.hasFailingTests) {
      trackerNote = `Tracker state found. Saved current phase is ${state.currentPhase}. Saved current slice is ${currentSliceTitle(state) || "not set"}.`;
    }
  }

  const phase = state && input.requestedPhase === "auto" && !input.hasFailingTests
    ? state.currentPhase
    : inferPhase(input.task, input.requestedPhase, input.hasFailingTests);
  const def = phaseDefinition(phase, input.riskLevel);
  const warnings = projectWarnings(input.projectType);
  const repoAdvice = largeRepoAdvice(input.repoSize, phase);

  const promptLines = [
    "Use $mvp-quality-router.",
    `Current phase: ${phase}.`,
    `Coding allowed: ${def.codingAllowed ? "yes, but only within this slice" : "no"}.`,
    `Primary skill style: ${def.primarySkillStyle}.`,
    `Reviewer skill style: ${def.reviewerSkillStyle}.`,
    `Phase gate: ${def.phaseGate}`,
    "Follow the checklist exactly.",
    "Use one primary skill style only unless the phase calls for review.",
    "Update docs/CURRENT_STATE.md, docs/TODO.md, .mvp-router/project-state.json, and docs/PROJECT_STATUS.md after meaningful work.",
  ];

  if (trackerNote) promptLines.push(`Tracker note: ${trackerNote}`);
  if (warnings.length) promptLines.push("Project warnings:", ...warnings.map((w) => `- ${w}`));
  if (repoAdvice.length) promptLines.push("Large-codebase/debugging advice:", ...repoAdvice.map((w) => `- ${w}`));

  return {
    phase,
    codingAllowed: def.codingAllowed,
    primarySkillStyle: def.primarySkillStyle,
    reviewerSkillStyle: def.reviewerSkillStyle,
    phaseGate: def.phaseGate,
    requiredDocs: def.requiredDocs,
    checklist: def.checklist,
    verificationCommands: def.verificationCommands,
    projectWarnings: warnings,
    largeRepoAdvice: repoAdvice,
    promptToRunNext: promptLines.join("\n"),
    trackerNote,
  };
}

function defaultSlices(projectType: ProjectType): ProjectSlice[] {
  const updatedAt = now();
  const mk = (
    title: string,
    phase: Phase,
    estimatedHoursMin: number,
    estimatedHoursMax: number,
    acceptanceCriteria: string[] = []
  ): ProjectSlice => ({
    id: safeId(title),
    title,
    phase,
    status: "not_started",
    estimatedHoursMin,
    estimatedHoursMax,
    acceptanceCriteria,
    blockers: [],
    notes: "",
    updatedAt,
  });

  if (projectType === "yoga_studio") {
    return [
      mk("Define narrow yoga studio MVP", "think", 1, 3, ["User, core workflow, non-goals, and success criteria are written"]),
      mk("Plan architecture and vertical slices", "plan", 2, 5, ["Architecture, test plan, and implementation plan exist"]),
      mk("Build app shell", "build", 3, 6, ["App runs locally", "Basic layout exists", "Smoke test passes"]),
      mk("Build FAQ/intake flow", "build", 4, 8, ["Customer can ask or submit a request", "Request is validated"]),
      mk("Build booking/cancellation request flow", "build", 6, 12, ["Booking/cancel request is captured", "Customer info is confirmed", "Human escalation works"]),
      mk("Build logging and staff review", "build", 3, 7, ["Requests are logged", "Staff can review recent requests"]),
      mk("Review MVP for bugs and scope creep", "review", 2, 5, ["Critical bugs and unnecessary features are identified"]),
      mk("Run QA and verification", "test", 3, 6, ["Tests/build pass or failures are documented", "Main user flow is manually checked"]),
      mk("Prepare MVP handoff", "ship", 1, 3, ["Git status is clean or documented", "Commit message is ready"]),
      mk("Reflect and save resume state", "reflect", 1, 2, ["HANDOFF.md and PROJECT_STATUS.md are up to date"]),
    ];
  }

  if (projectType === "it_help_app") {
    return [
      mk("Define narrow IT help MVP", "think", 1, 3, ["User, core ticket workflow, non-goals, and success criteria are written"]),
      mk("Plan architecture, security, and vertical slices", "plan", 3, 6, ["Architecture, security rules, test plan, and implementation plan exist"]),
      mk("Build app shell", "build", 3, 6, ["App runs locally", "Basic layout exists", "Smoke test passes"]),
      mk("Build employee issue intake", "build", 4, 8, ["Employee can submit issue", "Required fields are validated"]),
      mk("Build AI triage and ticket summary", "build", 6, 14, ["Triage questions work", "Ticket summary is generated", "Human approval rules are respected"]),
      mk("Build ticket creation or mock integration", "build", 5, 12, ["Ticket is created or queued", "Failure path is handled"]),
      mk("Build audit log and escalation rules", "build", 4, 8, ["Sensitive actions require human approval", "Audit log records key events"]),
      mk("Security and architecture review", "review", 3, 7, ["Access-control, privacy, and destructive-action risks are reviewed"]),
      mk("Run QA and verification", "test", 4, 8, ["Tests/build pass or failures are documented", "Main user flow is manually checked"]),
      mk("Prepare MVP handoff", "ship", 1, 3, ["Git status is clean or documented", "Commit message is ready"]),
      mk("Reflect and save resume state", "reflect", 1, 2, ["HANDOFF.md and PROJECT_STATUS.md are up to date"]),
    ];
  }

  return [
    mk("Define narrow MVP", "think", 1, 3, ["User, core workflow, non-goals, and success criteria are written"]),
    mk("Plan architecture and vertical slices", "plan", 2, 5, ["Architecture, test plan, and implementation plan exist"]),
    mk("Build app shell", "build", 3, 6, ["App runs locally", "Basic shell is working"]),
    mk("Build core user flow", "build", 6, 14, ["Core workflow works end to end"]),
    mk("Build persistence/logging", "build", 3, 8, ["Important data is saved or logged"]),
    mk("Review MVP for bugs and scope creep", "review", 2, 5, ["Critical bugs and unnecessary features are identified"]),
    mk("Run QA and verification", "test", 3, 7, ["Tests/build pass or failures are documented"]),
    mk("Prepare MVP handoff", "ship", 1, 3, ["Git status and commit plan are clear"]),
    mk("Reflect and save resume state", "reflect", 1, 2, ["HANDOFF.md and PROJECT_STATUS.md are up to date"]),
  ];
}

function initialPhases(): ProjectState["phases"] {
  const updatedAt = now();
  const phases = {} as ProjectState["phases"];
  for (const phase of PHASES_WITH_DEBUG) phases[phase] = { status: "not_started", notes: "", updatedAt };
  return phases;
}

export function recomputeState(state: ProjectState): ProjectState {
  const timestamp = now();
  const phases = {} as ProjectState["phases"];
  for (const phase of PHASES_WITH_DEBUG) {
    const existing = state.phases[phase] || { status: "not_started", notes: "", updatedAt: timestamp };
    const phaseSlices = state.slices.filter((s) => s.phase === phase);
    let status: PhaseStatus;

    if (phaseSlices.length === 0) {
      status = existing.status || "not_started";
      phases[phase] = {
        status,
        notes: existing.notes || "",
        updatedAt: existing.updatedAt || timestamp,
      };
      continue;
    }

    if (phaseSlices.every((s) => s.status === "done")) status = "done";
    else if (phaseSlices.some((s) => s.status === "blocked")) status = "blocked";
    else if (phaseSlices.some((s) => s.status === "in_progress" || s.status === "done")) status = "in_progress";
    else status = "not_started";

    phases[phase] = {
      status,
      notes: existing.notes || "",
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
    if (slice.status === "done") completedEstimated += slice.actualHours ?? avg;
    else {
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
    const nextSlice = state.slices.find((s) => s.status === "in_progress") || state.slices.find((s) => s.status === "blocked") || state.slices.find((s) => s.status === "not_started");
    state.currentSliceId = nextSlice?.id;
    if (nextSlice) state.currentPhase = nextSlice.phase;
  } else {
    const current = state.slices.find((s) => s.id === state.currentSliceId);
    if (current) state.currentPhase = current.phase;
  }

  state.updatedAt = now();
  return state;
}

type ProjectStateLoadError = {
  kind: "missing" | "invalid";
  file: string;
  message: string;
};

export type ProjectStateLoadResult = {
  state: ProjectState | null;
  error?: ProjectStateLoadError;
};

export async function loadProjectState(repoPath?: string): Promise<ProjectStateLoadResult> {
  const { stateFile } = trackerPaths(repoPath);
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    return { state: recomputeState(JSON.parse(raw) as ProjectState) };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {
        state: null,
        error: {
          kind: "missing",
          file: stateFile,
          message: "No tracker found. Run init_project_tracker first.",
        },
      };
    }
    return {
      state: null,
      error: {
        kind: "invalid",
        file: stateFile,
        message: `Tracker exists but could not be read: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

async function readProjectState(repoPath?: string): Promise<ProjectState | null> {
  return (await loadProjectState(repoPath)).state;
}

async function writeProjectState(repoPath: string | undefined, state: ProjectState, writeDashboard: boolean = true): Promise<void> {
  const paths = trackerPaths(repoPath);
  const next = recomputeState(state);
  await fs.mkdir(paths.stateDir, { recursive: true });
  await fs.mkdir(paths.docsDir, { recursive: true });
  await fs.writeFile(paths.stateFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  if (writeDashboard) await fs.writeFile(paths.statusFile, renderDashboard(next), "utf8");
}

export function createInitialState(input: {
  projectName: string;
  projectType: ProjectType;
  projectDescription?: string;
  repoSize: RepoSize;
  riskLevel: RiskLevel;
  customSlices?: { title: string; phase: Phase; estimatedHoursMin: number; estimatedHoursMax: number; acceptanceCriteria?: string[] }[];
}): ProjectState {
  const timestamp = now();
  const slices = (input.customSlices && input.customSlices.length > 0
    ? input.customSlices.map((s) => ({
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
      }))
    : defaultSlices(input.projectType));

  const state: ProjectState = {
    schemaVersion: "0.2.0",
    projectId: safeId(input.projectName) || randomUUID(),
    projectName: input.projectName,
    projectType: input.projectType,
    projectDescription: input.projectDescription || "",
    repoSize: input.repoSize,
    riskLevel: input.riskLevel,
    createdAt: timestamp,
    updatedAt: timestamp,
    currentPhase: "think",
    currentSliceId: slices[0]?.id,
    phases: initialPhases(),
    slices,
    risks: projectWarnings(input.projectType),
    nextActions: ["Finish the current phase gate", "Update PROJECT_STATUS.md after meaningful progress"],
    completedCommands: [],
    hours: {
      totalEstimatedMin: 0,
      totalEstimatedMax: 0,
      completedEstimated: 0,
      remainingEstimatedMin: 0,
      remainingEstimatedMax: 0,
      progressPercent: 0,
    },
  };

  if (slices[0]) slices[0].status = "in_progress";
  return recomputeState(state);
}

type InitProjectTrackerInput = {
  repoPath: string;
  projectName: string;
  projectType: ProjectType;
  projectDescription: string;
  repoSize: RepoSize;
  riskLevel: RiskLevel;
  overwrite: boolean;
};

type InitProjectTrackerResult = {
  created?: boolean;
  alreadyExists?: boolean;
  conflict?: boolean;
  invalid?: boolean;
  message?: string;
  state?: ProjectState;
  dashboard?: string;
  files?: string[];
  backupFiles?: string[];
};

async function pathExists(filePath: string): Promise<boolean> {
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
  if (!(await pathExists(filePath))) return undefined;
  const target = backupPath(filePath);
  await fs.copyFile(filePath, target);
  return target;
}

export async function initProjectTracker(data: InitProjectTrackerInput): Promise<InitProjectTrackerResult> {
  const paths = trackerPaths(data.repoPath);
  const existing = await loadProjectState(data.repoPath);

  if (existing.state && !data.overwrite) {
    const dashboard = renderDashboard(existing.state);
    return { alreadyExists: true, state: existing.state, dashboard };
  }

  if (existing.error?.kind === "invalid" && !data.overwrite) {
    return {
      created: false,
      invalid: true,
      message: `${existing.error.message} Pass overwrite=true only after backing up or repairing ${path.relative(paths.root, existing.error.file)}.`,
    };
  }

  const statusExists = await pathExists(paths.statusFile);
  if (!existing.state && statusExists && !data.overwrite) {
    return {
      created: false,
      conflict: true,
      message: "docs/PROJECT_STATUS.md already exists but .mvp-router/project-state.json is missing. Refusing to overwrite human project status without overwrite=true.",
      files: ["docs/PROJECT_STATUS.md"],
    };
  }

  const backupFiles = data.overwrite
    ? (await Promise.all([backupIfExists(paths.stateFile), backupIfExists(paths.statusFile)])).filter((file): file is string => Boolean(file))
    : [];
  const state = createInitialState(data);
  await writeProjectState(data.repoPath, state, true);
  const dashboard = renderDashboard(state);

  return {
    created: true,
    state,
    dashboard,
    files: [".mvp-router/project-state.json", "docs/PROJECT_STATUS.md"],
    backupFiles: backupFiles.map((file) => path.relative(paths.root, file)),
  };
}

function statusIcon(status: PhaseStatus | SliceStatus): string {
  switch (status) {
    case "done": return "✅";
    case "in_progress": return "🟡";
    case "blocked": return "⛔";
    case "not_started": return "⬜";
  }
}

function titleCasePhase(phase: Phase): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function progressBar(percent: number, width: number = 18): string {
  const filled = Math.round((percent / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

function currentSliceTitle(state: ProjectState): string | undefined {
  return state.slices.find((s) => s.id === state.currentSliceId)?.title;
}

function renderMermaid(state: ProjectState): string {
  const node = (phase: Phase) => {
    const p = state.phases[phase];
    const icon = statusIcon(p?.status || "not_started");
    return `${phase}["${icon} ${titleCasePhase(phase)}"]`;
  };
  const workflow = PHASES_WITH_DEBUG.map(node).join(" --> ");
  return [
    "```mermaid",
    "flowchart LR",
    `  ${workflow}`,
    "```",
  ].join("\n");
}

export function renderDashboard(state: ProjectState): string {
  const currentSlice = state.slices.find((s) => s.id === state.currentSliceId);
  const phaseRows = PHASES_WITH_DEBUG.map((phase) => {
    const p = state.phases[phase];
    return `| ${statusIcon(p.status)} ${titleCasePhase(phase)} | ${p.status.replace(/_/g, " ")} | ${p.notes || ""} |`;
  }).join("\n");

  const sliceRows = state.slices.map((s) => {
    const marker = s.id === state.currentSliceId ? " ← current" : "";
    const hours = `${s.estimatedHoursMin}-${s.estimatedHoursMax}h`;
    const blockers = s.blockers.length ? s.blockers.join("; ") : "";
    return `| ${statusIcon(s.status)} ${s.title}${marker} | ${titleCasePhase(s.phase)} | ${s.status.replace(/_/g, " ")} | ${hours} | ${blockers} |`;
  }).join("\n");

  const nextActions = state.nextActions.length ? state.nextActions.map((a) => `- ${a}`).join("\n") : "- None recorded";
  const risks = state.risks.length ? state.risks.map((r) => `- ${r}`).join("\n") : "- None recorded";

  const resumePrompt = [
    "Use $mvp-quality-router.",
    "Read AGENTS.md, docs/CURRENT_STATE.md, docs/TODO.md, docs/DECISIONS.md, and docs/PROJECT_STATUS.md.",
    `Project: ${state.projectName}`,
    `Current phase: ${state.currentPhase}.`,
    `Current slice: ${currentSlice?.title || "not set"}.`,
    "Call mvp-router get_project_status first, then continue only with the next safest step.",
  ].join("\n");

  return `# MVP Project Status\n\n` +
    `**Project:** ${state.projectName}\n\n` +
    `**Type:** ${state.projectType}\n\n` +
    `**Updated:** ${state.updatedAt}\n\n` +
    `**Current Phase:** ${statusIcon(state.phases[state.currentPhase]?.status || "not_started")} ${titleCasePhase(state.currentPhase)}\n\n` +
    `**Current Slice:** ${currentSlice?.title || "Not set"}\n\n` +
    `**Overall Progress:** \`${progressBar(state.hours.progressPercent)}\` ${state.hours.progressPercent}%\n\n` +
    `**Estimated Total:** ${state.hours.totalEstimatedMin}-${state.hours.totalEstimatedMax} hours\n\n` +
    `**Estimated Remaining:** ${state.hours.remainingEstimatedMin}-${state.hours.remainingEstimatedMax} hours\n\n` +
    `## Visual Workflow\n\n${renderMermaid(state)}\n\n` +
    `## Phase Status\n\n| Phase | Status | Notes |\n|---|---|---|\n${phaseRows}\n\n` +
    `## MVP Slices\n\n| Slice | Phase | Status | Estimate | Blockers |\n|---|---|---|---:|---|\n${sliceRows}\n\n` +
    `## Next Actions\n\n${nextActions}\n\n` +
    `## Risks / Guardrails\n\n${risks}\n\n` +
    `## Resume Prompt\n\n\`\`\`text\n${resumePrompt}\n\`\`\`\n`;
}

function estimateHours(input: {
  projectType: ProjectType;
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

  min += 6; // planning/review/test overhead
  max += 18;

  const assumptions = [
    "Estimate assumes an MVP, not a polished production SaaS.",
    "Estimate assumes one developer using Codex with phase-gated review and testing.",
    "Bug fixing and integration surprises can change the range.",
    "Use project-state tracking to update the estimate after each completed slice.",
  ];

  const calendar = {
    "5h_per_week": `${Math.ceil(min / 5)}-${Math.ceil(max / 5)} weeks`,
    "10h_per_week": `${Math.ceil(min / 10)}-${Math.ceil(max / 10)} weeks`,
    "20h_per_week": `${Math.ceil(min / 20)}-${Math.ceil(max / 20)} weeks`,
  };

  return { estimatedHoursMin: min, estimatedHoursMax: max, calendar, assumptions };
}

async function bootstrapDocs(projectType: ProjectType, projectName: string): Promise<Record<string, string>> {
  const projectTitle = projectName || (projectType === "yoga_studio" ? "Yoga Studio MVP" : projectType === "it_help_app" ? "IT Help App MVP" : "MVP Project");
  return {
    "AGENTS.md": `# AGENTS.md\n\n## Project\n\n${projectTitle}\n\n## Workflow\n\nUse the MVP Quality Router for non-trivial work.\n\nThink → Plan → Build → Review → Test → Ship → Reflect\n\n## Skill Routing\n\n- GSD owns context management, phase planning, and handoffs.\n- gstack owns product critique, MVP narrowing, architecture review, QA, and security review.\n- Superpowers owns implementation planning, TDD, coding, systematic debugging, verification, and branch finishing.\n- Do not use all skills at once.\n\n## Project Tracking\n\n- Use .mvp-router/project-state.json as the machine-readable tracker.\n- Use docs/PROJECT_STATUS.md as the visual dashboard.\n- Update both after meaningful progress, before pausing, and before compaction.\n\n## Accuracy Rules\n\n- Build one vertical slice at a time.\n- Prefer tests before implementation.\n- Run tests/build/lint before claiming completion.\n- Update docs/CURRENT_STATE.md and docs/TODO.md after meaningful changes.\n\n## Debugging Rules\n\n- No fixes before root cause is proven.\n- Reproduce the bug first.\n- Read the full error.\n- Trace data flow.\n- Write a regression test when practical.\n- Apply the smallest fix.\n`,
    "docs/PROJECT_BRIEF.md": `# ${projectTitle} — Project Brief\n\n## User\n\nTBD.\n\n## Problem\n\nTBD.\n\n## MVP Goal\n\nTBD.\n\n## Success Criteria\n\nTBD.\n`,
    "docs/MVP_SCOPE.md": "# MVP Scope\n\n## Included in V1\n\n- TBD\n\n## Not Included in V1\n\n- TBD\n",
    "docs/USER_STORIES.md": "# User Stories\n\n- As a user, I want TBD so that TBD.\n",
    "docs/ARCHITECTURE.md": "# Architecture\n\n## Data Flow\n\nTBD.\n\n## Integrations\n\nTBD.\n\n## Failure Modes\n\nTBD.\n",
    "docs/DECISIONS.md": "# Decisions\n\n| Date | Decision | Reason | Tradeoff |\n|---|---|---|---|\n| TBD | TBD | TBD | TBD |\n",
    "docs/CURRENT_STATE.md": "# Current State\n\n## What Works\n\n- TBD\n\n## What Is Broken\n\n- TBD\n\n## Changed Files\n\n- TBD\n\n## Next Step\n\n- TBD\n",
    "docs/TODO.md": "# TODO\n\n## Next Slice\n\n- TBD\n\n## Backlog\n\n- TBD\n",
    "docs/TEST_PLAN.md": "# Test Plan\n\n## Automated Checks\n\n- TBD\n\n## Manual User Flow Checks\n\n- TBD\n",
    "docs/SECURITY.md": "# Security\n\n## Sensitive Data\n\nTBD.\n\n## Human Approval Requirements\n\nTBD.\n\n## Audit Logging\n\nTBD.\n",
  };
}

const server = new McpServer({ name: "mvp-workflow-router", version: "0.2.0" });

server.registerTool(
  "choose_mvp_workflow",
  {
    title: "Choose MVP Workflow",
    description: "Choose the correct high-accuracy MVP workflow phase and route Codex to the right skill/checklist. If repoPath is provided, it can use the saved project tracker state.",
    inputSchema: {
      task: z.string().describe("The user's task or problem."),
      projectType: z.enum(["yoga_studio", "it_help_app", "generic", "custom"]).default("generic"),
      requestedPhase: z.enum(["auto", "think", "plan", "build", "review", "test", "debug", "ship", "reflect"]).default("auto"),
      repoSize: z.enum(["small", "medium", "large"]).default("medium"),
      riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
      hasExistingPlan: z.boolean().default(false),
      hasFailingTests: z.boolean().default(false),
      repoPath: z.string().optional().describe("Optional repo path. When provided, saved tracker state is used."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const result = await routeWorkflow(input as WorkflowInput);
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "init_project_tracker",
  {
    title: "Initialize MVP Project Tracker",
    description: "Create .mvp-router/project-state.json and docs/PROJECT_STATUS.md so Codex can resume project phase, current slice, visual progress, and hour estimates.",
    inputSchema: {
      repoPath: z.string().default("."),
      projectName: z.string(),
      projectType: z.enum(["yoga_studio", "it_help_app", "generic", "custom"]).default("generic"),
      projectDescription: z.string().default(""),
      repoSize: z.enum(["small", "medium", "large"]).default("medium"),
      riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
      overwrite: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const result = await initProjectTracker(input as InitProjectTrackerInput);
    return { structuredContent: result, content: [{ type: "text", text: result.dashboard || result.message || JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "get_project_status",
  {
    title: "Get MVP Project Status",
    description: "Read .mvp-router/project-state.json and return current phase, current slice, visual dashboard, remaining estimate, and resume prompt.",
    inputSchema: { repoPath: z.string().default("."), writeDashboard: z.boolean().default(true) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { repoPath: string; writeDashboard: boolean };
    const loaded = await loadProjectState(data.repoPath);
    const state = loaded.state;
    if (!state) {
      const message = loaded.error?.kind === "invalid"
        ? loaded.error.message
        : "No tracker found. Run init_project_tracker first to create .mvp-router/project-state.json and docs/PROJECT_STATUS.md.";
      return { structuredContent: { found: false, message }, content: [{ type: "text", text: message }] };
    }
    if (data.writeDashboard) await writeProjectState(data.repoPath, state, true);
    const dashboard = renderDashboard(state);
    return { structuredContent: { found: true, state, dashboard }, content: [{ type: "text", text: dashboard }] };
  }
);

server.registerTool(
  "update_project_progress",
  {
    title: "Update MVP Project Progress",
    description: "Update current phase, current slice, status, notes, commands run, risks, next actions, and visual dashboard. This writes only tracker/docs files, not application source code.",
    inputSchema: {
      repoPath: z.string().default("."),
      currentPhase: z.enum(["think", "plan", "build", "review", "test", "debug", "ship", "reflect"]).optional(),
      currentSliceId: z.string().optional(),
      sliceTitle: z.string().optional().describe("Can identify an existing slice by title, or create a new one if not found."),
      slicePhase: z.enum(["think", "plan", "build", "review", "test", "debug", "ship", "reflect"]).optional(),
      sliceStatus: z.enum(["not_started", "in_progress", "blocked", "done"]).optional(),
      sliceNotes: z.string().optional(),
      actualHours: z.number().optional(),
      blockers: z.array(z.string()).default([]),
      completedCommands: z.array(z.string()).default([]),
      risks: z.array(z.string()).default([]),
      nextActions: z.array(z.string()).default([]),
      writeDashboard: z.boolean().default(true),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as {
      repoPath: string; currentPhase?: Phase; currentSliceId?: string; sliceTitle?: string; slicePhase?: Phase; sliceStatus?: SliceStatus; sliceNotes?: string; actualHours?: number; blockers: string[]; completedCommands: string[]; risks: string[]; nextActions: string[]; writeDashboard: boolean;
    };
    const loaded = await loadProjectState(data.repoPath);
    const state = loaded.state;
    if (!state) {
      const message = loaded.error?.kind === "invalid" ? loaded.error.message : "No tracker found. Run init_project_tracker first.";
      return { structuredContent: { updated: false, message }, content: [{ type: "text", text: message }] };
    }

    if (data.currentPhase) state.currentPhase = data.currentPhase;
    let slice: ProjectSlice | undefined;
    if (data.currentSliceId) slice = state.slices.find((s) => s.id === data.currentSliceId);
    if (!slice && data.sliceTitle) slice = state.slices.find((s) => s.title.toLowerCase() === data.sliceTitle!.toLowerCase());
    if (!slice && data.sliceTitle) {
      slice = {
        id: safeId(data.sliceTitle),
        title: data.sliceTitle,
        phase: data.slicePhase || data.currentPhase || state.currentPhase,
        status: data.sliceStatus || "in_progress",
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        acceptanceCriteria: [],
        blockers: [],
        notes: "",
        updatedAt: now(),
      };
      state.slices.push(slice);
    }
    if (slice) {
      if (data.slicePhase) slice.phase = data.slicePhase;
      if (data.sliceStatus) slice.status = data.sliceStatus;
      if (data.sliceNotes) slice.notes = data.sliceNotes;
      if (typeof data.actualHours === "number") slice.actualHours = data.actualHours;
      if (data.blockers.length) slice.blockers = Array.from(new Set([...slice.blockers, ...data.blockers]));
      slice.updatedAt = now();
      state.currentSliceId = slice.id;
      state.currentPhase = slice.phase;
    }

    if (data.completedCommands.length) state.completedCommands = Array.from(new Set([...state.completedCommands, ...data.completedCommands]));
    if (data.risks.length) state.risks = Array.from(new Set([...state.risks, ...data.risks]));
    if (data.nextActions.length) state.nextActions = data.nextActions;

    await writeProjectState(data.repoPath, state, data.writeDashboard);
    const updated = await readProjectState(data.repoPath) as ProjectState;
    const dashboard = renderDashboard(updated);
    return { structuredContent: { updated: true, state: updated, dashboard }, content: [{ type: "text", text: dashboard }] };
  }
);

server.registerTool(
  "pause_project_work",
  {
    title: "Pause MVP Project Work",
    description: "Create/update docs/HANDOFF.md with a resume prompt, current phase, current slice, risks, next actions, and remaining estimate.",
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
    const state = loaded.state;
    if (!state) {
      const message = loaded.error?.kind === "invalid" ? loaded.error.message : "No tracker found. Run init_project_tracker first.";
      return { structuredContent: { paused: false, message }, content: [{ type: "text", text: message }] };
    }
    if (data.nextActions.length) state.nextActions = data.nextActions;
    state.lastHandoff = data.handoffNotes || `Paused at phase ${state.currentPhase}, slice ${currentSliceTitle(state) || "not set"}.`;
    await writeProjectState(data.repoPath, state, true);
    const updated = await readProjectState(data.repoPath) as ProjectState;
    const paths = trackerPaths(data.repoPath);
    const handoff = `# Project Handoff\n\n${renderDashboard(updated)}\n\n## Handoff Notes\n\n${updated.lastHandoff || "None"}\n`;
    await fs.mkdir(paths.docsDir, { recursive: true });
    await fs.writeFile(paths.handoffFile, handoff, "utf8");
    return { structuredContent: { paused: true, state: updated, handoffFile: "docs/HANDOFF.md" }, content: [{ type: "text", text: handoff }] };
  }
);

server.registerTool(
  "estimate_project_hours",
  {
    title: "Estimate MVP Project Hours",
    description: "Estimate MVP hours using complexity, slices, integrations, AI/auth/dashboard, and data sensitivity. Can be used for any project type.",
    inputSchema: {
      projectType: z.enum(["yoga_studio", "it_help_app", "generic", "custom"]).default("generic"),
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

server.registerTool(
  "get_debug_playbook",
  {
    title: "Get Debug Playbook",
    description: "Return a systematic debugging playbook for large-codebase bugs. Read-only.",
    inputSchema: {
      bugSummary: z.string(),
      repoSize: z.enum(["small", "medium", "large"]).default("medium"),
      riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { bugSummary: string; repoSize: RepoSize; riskLevel: RiskLevel };
    const result = await routeWorkflow({ task: data.bugSummary, projectType: "generic", requestedPhase: "debug", repoSize: data.repoSize, riskLevel: data.riskLevel, hasFailingTests: true });
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "get_bootstrap_docs",
  {
    title: "Get Bootstrap Docs",
    description: "Return starter AGENTS.md and docs/*.md content for an MVP project. Read-only; Codex can copy the content into files after user approval.",
    inputSchema: {
      projectType: z.enum(["yoga_studio", "it_help_app", "generic", "custom"]).default("generic"),
      projectName: z.string().default("MVP Project"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const data = input as { projectType: ProjectType; projectName: string };
    const docs = await bootstrapDocs(data.projectType, data.projectName);
    return { structuredContent: { files: docs }, content: [{ type: "text", text: JSON.stringify({ files: docs }, null, 2) }] };
  }
);

export async function startServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
