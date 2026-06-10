import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createInitialState,
  detectGsdPlanning,
  getSkillRecommendations,
  loadProjectState,
  recomputeState,
  renderDashboard,
  SKILL_MAP,
} from "../src/index.ts";

test("createInitialState starts at think phase with empty slices by default", () => {
  const state = createInitialState({
    projectName: "Test Project",
    repoSize: "small",
    riskLevel: "medium",
  });

  assert.equal(state.schemaVersion, "0.3.0");
  assert.equal(state.currentPhase, "think");
  assert.equal(state.slices.length, 0);
  assert.equal(state.phaseHistory.length, 1);
  assert.equal(state.phaseHistory[0].phase, "think");
  assert.equal(state.phaseHistory[0].action, "entered");
});

test("createInitialState accepts custom slices", () => {
  const state = createInitialState({
    projectName: "Custom Slices",
    repoSize: "medium",
    riskLevel: "low",
    slices: [
      { title: "Build login", phase: "build", estimatedHoursMin: 3, estimatedHoursMax: 6, acceptanceCriteria: ["User can log in"] },
      { title: "Build dashboard", phase: "build", estimatedHoursMin: 4, estimatedHoursMax: 8 },
    ],
  });

  assert.equal(state.slices.length, 2);
  assert.equal(state.slices[0].title, "Build login");
  assert.deepEqual(state.slices[0].acceptanceCriteria, ["User can log in"]);
  assert.equal(state.slices[1].title, "Build dashboard");
});

test("recomputeState marks phase as skipped when explicitly set", () => {
  const state = createInitialState({
    projectName: "Skip Test",
    repoSize: "small",
    riskLevel: "low",
  });
  state.phases.think.status = "skipped";
  state.phases.think.skippedReason = "Hotfix — no planning needed";

  const recomputed = recomputeState(state);

  assert.equal(recomputed.phases.think.status, "skipped");
  assert.equal(recomputed.phases.think.skippedReason, "Hotfix — no planning needed");
});

test("recomputeState preserves existing phase notes", () => {
  const state = createInitialState({
    projectName: "Notes",
    repoSize: "small",
    riskLevel: "medium",
  });
  state.phases.think.notes = "Keep this.";

  const recomputed = recomputeState(state);

  assert.equal(recomputed.phases.think.notes, "Keep this.");
});

test("recomputeState computes hours correctly", () => {
  const state = createInitialState({
    projectName: "Hours",
    repoSize: "small",
    riskLevel: "medium",
    slices: [
      { title: "Slice A", phase: "build", estimatedHoursMin: 2, estimatedHoursMax: 4 },
      { title: "Slice B", phase: "build", estimatedHoursMin: 3, estimatedHoursMax: 6 },
    ],
  });
  state.slices[0].status = "done";
  state.slices[0].actualHours = 3;

  const recomputed = recomputeState(state);

  assert.equal(recomputed.hours.totalEstimatedMin, 5);
  assert.equal(recomputed.hours.totalEstimatedMax, 10);
  assert.equal(recomputed.hours.remainingEstimatedMin, 3);
  assert.equal(recomputed.hours.remainingEstimatedMax, 6);
  assert.ok(recomputed.hours.progressPercent > 0);
});

test("dashboard renders all phases including debug", () => {
  const state = createInitialState({
    projectName: "Dashboard Test",
    repoSize: "small",
    riskLevel: "medium",
  });

  const dashboard = renderDashboard(state);

  assert.match(dashboard, /Think/);
  assert.match(dashboard, /Plan/);
  assert.match(dashboard, /Build/);
  assert.match(dashboard, /Review/);
  assert.match(dashboard, /Test/);
  assert.match(dashboard, /Debug/);
  assert.match(dashboard, /Ship/);
  assert.match(dashboard, /Reflect/);
});

test("dashboard shows phase history", () => {
  const state = createInitialState({
    projectName: "History Test",
    repoSize: "small",
    riskLevel: "medium",
  });
  state.phaseHistory.push({ phase: "think", action: "completed", at: state.updatedAt });
  state.phaseHistory.push({ phase: "plan", action: "entered", at: state.updatedAt });

  const dashboard = renderDashboard(state);

  assert.match(dashboard, /Phase History/);
  assert.match(dashboard, /completed/);
});

test("loadProjectState reports invalid JSON", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "mvp-router-invalid-"));
  await mkdir(path.join(repoPath, ".mvp-router"), { recursive: true });
  await writeFile(path.join(repoPath, ".mvp-router", "project-state.json"), "{ invalid", "utf8");

  const result = await loadProjectState(repoPath);

  assert.equal(result.state, null);
  assert.equal(result.error?.kind, "invalid");
});

test("loadProjectState reports missing tracker", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "mvp-router-missing-"));

  const result = await loadProjectState(repoPath);

  assert.equal(result.state, null);
  assert.equal(result.error?.kind, "missing");
});

test("dashboard renders resume prompt", () => {
  const state = createInitialState({
    projectName: "Resume Test",
    repoSize: "medium",
    riskLevel: "low",
    slices: [{ title: "App shell", phase: "build", estimatedHoursMin: 2, estimatedHoursMax: 4 }],
  });

  const dashboard = renderDashboard(state);

  assert.match(dashboard, /Resume Prompt/);
  assert.match(dashboard, /get_status/);
  assert.match(dashboard, /Resume Test/);
});

test("SKILL_MAP covers every phase with exactly one primary skill", () => {
  const phases = ["think", "plan", "build", "review", "test", "debug", "ship", "reflect"] as const;
  for (const phase of phases) {
    const refs = SKILL_MAP[phase];
    assert.ok(refs && refs.length > 0, `${phase} has skill entries`);
    const primaries = refs.filter((r) => r.role === "primary");
    assert.equal(primaries.length, 1, `${phase} has exactly one primary`);
    for (const r of refs) {
      assert.ok(r.skill.length > 0, `${phase}: skill name present`);
      assert.ok(r.when.length > 0, `${phase}: when guidance present`);
    }
  }
});

test("getSkillRecommendations filters by installed families", () => {
  const all = getSkillRecommendations("build", { gsd: true, gstack: true, superpowers: true });
  assert.ok(all.available.some((r) => r.family === "superpowers"));
  assert.equal(all.missingFamilies.length, 0);

  const noSp = getSkillRecommendations("build", { gsd: true, gstack: true, superpowers: false });
  assert.ok(noSp.available.every((r) => r.family !== "superpowers"));
  assert.ok(noSp.missingFamilies.includes("superpowers"));

  const none = getSkillRecommendations("build", { gsd: false, gstack: false, superpowers: false });
  assert.equal(none.available.length, 0);
});

test("detectGsdPlanning detects .planning directory", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "mvp-router-gsd-"));
  assert.equal(await detectGsdPlanning(repoPath), false);
  await mkdir(path.join(repoPath, ".planning"), { recursive: true });
  assert.equal(await detectGsdPlanning(repoPath), true);
});

test("recomputeState advances currentSliceId when current is done", () => {
  const state = createInitialState({
    projectName: "Advance Slice",
    repoSize: "small",
    riskLevel: "low",
    slices: [
      { title: "First", phase: "build", estimatedHoursMin: 1, estimatedHoursMax: 2 },
      { title: "Second", phase: "build", estimatedHoursMin: 1, estimatedHoursMax: 2 },
    ],
  });
  state.currentSliceId = state.slices[0].id;
  state.slices[0].status = "done";

  const recomputed = recomputeState(state);

  assert.equal(recomputed.currentSliceId, state.slices[1].id);
});
