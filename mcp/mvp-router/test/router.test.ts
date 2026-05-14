import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createInitialState,
  initProjectTracker,
  loadProjectState,
  recomputeState,
  renderDashboard,
} from "../src/index.ts";

test("dashboard shows debug phase when debug is the current phase", () => {
  const state = createInitialState({
    projectName: "Debug Visibility",
    projectType: "generic",
    repoSize: "small",
    riskLevel: "medium",
  });

  state.slices.push({
    id: "debug-current-issue",
    title: "Debug current issue",
    phase: "debug",
    status: "in_progress",
    estimatedHoursMin: 1,
    estimatedHoursMax: 2,
    acceptanceCriteria: [],
    blockers: [],
    notes: "",
    updatedAt: state.updatedAt,
  });
  state.currentSliceId = "debug-current-issue";

  const dashboard = renderDashboard(recomputeState(state));

  assert.match(dashboard, /\| 🟡 Debug \| in progress \|/);
  assert.match(dashboard, /test\[".*Test"\] --> debug\[".*Debug"\] --> ship\[".*Ship"\]/);
});

test("recomputeState preserves existing phase notes", () => {
  const state = createInitialState({
    projectName: "Notes",
    projectType: "generic",
    repoSize: "small",
    riskLevel: "medium",
  });
  state.phases.think.notes = "Keep this phase note.";

  const recomputed = recomputeState(state);

  assert.equal(recomputed.phases.think.notes, "Keep this phase note.");
});

test("loadProjectState reports invalid JSON instead of treating it as missing", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "mvp-router-invalid-"));
  await mkdir(path.join(repoPath, ".mvp-router"), { recursive: true });
  await writeFile(path.join(repoPath, ".mvp-router", "project-state.json"), "{ invalid", "utf8");

  const result = await loadProjectState(repoPath);

  assert.equal(result.state, null);
  assert.equal(result.error?.kind, "invalid");
});

test("initProjectTracker refuses to overwrite existing PROJECT_STATUS.md without overwrite", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "mvp-router-existing-status-"));
  await mkdir(path.join(repoPath, "docs"), { recursive: true });
  const statusPath = path.join(repoPath, "docs", "PROJECT_STATUS.md");
  await writeFile(statusPath, "# Existing human status\n", "utf8");

  const result = await initProjectTracker({
    repoPath,
    projectName: "Existing Status",
    projectType: "generic",
    projectDescription: "",
    repoSize: "small",
    riskLevel: "medium",
    overwrite: false,
  });

  assert.equal(result.created, false);
  assert.equal(result.conflict, true);
  assert.equal(await readFile(statusPath, "utf8"), "# Existing human status\n");
});
