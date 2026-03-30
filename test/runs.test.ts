import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runRuns } from "../src/commands/runs.js";
import type { RunRecord, StageLineage, WorkflowMachineSnapshot } from "../src/types.js";

async function writeRun(repoDir: string, run: RunRecord, stageLineage?: StageLineage, machineState?: WorkflowMachineSnapshot): Promise<void> {
  const runDir = path.join(repoDir, ".cstack", "runs", run.id);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# final\n", "utf8");
  if (stageLineage) {
    await fs.writeFile(path.join(runDir, "stage-lineage.json"), `${JSON.stringify(stageLineage, null, 2)}\n`, "utf8");
  }
  if (machineState) {
    await fs.writeFile(path.join(runDir, "machine-state.json"), `${JSON.stringify(machineState, null, 2)}\n`, "utf8");
  }
}

describe("runRuns", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-runs-"));
    await fs.mkdir(path.join(repoDir, ".cstack", "runs"), { recursive: true });

    await writeRun(repoDir, {
      id: "2026-03-13T18-10-00-intent-broad-task",
      workflow: "intent",
      createdAt: "2026-03-13T18:10:00.000Z",
      updatedAt: "2026-03-13T18:10:05.000Z",
      status: "running",
      cwd: repoDir,
      gitBranch: "main",
      codexVersion: "fake",
      codexCommand: ["codex", "exec"],
      promptPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-10-00-intent-broad-task", "prompt.md"),
      finalPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-10-00-intent-broad-task", "final.md"),
      contextPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-10-00-intent-broad-task", "context.md"),
      stdoutPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-10-00-intent-broad-task", "stdout.log"),
      stderrPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-10-00-intent-broad-task", "stderr.log"),
      configSources: [],
      currentStage: "spec",
      activeSpecialists: ["audit-review"],
      summary: "Plan a compliance-safe billing migration",
      inputs: {
        userPrompt: "Plan a compliance-safe billing migration"
      }
    });

    await writeRun(repoDir, {
      id: "2026-03-13T18-00-00-discover-map-repo",
      workflow: "discover",
      createdAt: "2026-03-13T18:00:00.000Z",
      updatedAt: "2026-03-13T18:00:10.000Z",
      status: "completed",
      cwd: repoDir,
      gitBranch: "main",
      codexVersion: "fake",
      codexCommand: ["codex", "exec"],
      promptPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-00-00-discover-map-repo", "prompt.md"),
      finalPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-00-00-discover-map-repo", "final.md"),
      contextPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-00-00-discover-map-repo", "context.md"),
      stdoutPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-00-00-discover-map-repo", "stdout.log"),
      stderrPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-00-00-discover-map-repo", "stderr.log"),
      configSources: [],
      summary: "Map the repo architecture",
      inputs: {
        userPrompt: "Map the repo architecture"
      }
    });

    await writeRun(repoDir, {
      id: "2026-03-13T18-20-00-spec-initiative",
      workflow: "spec",
      createdAt: "2026-03-13T18:20:00.000Z",
      updatedAt: "2026-03-13T18:20:05.000Z",
      status: "completed",
      cwd: repoDir,
      gitBranch: "main",
      codexVersion: "fake",
      codexCommand: ["codex", "exec"],
      promptPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-20-00-spec-initiative", "prompt.md"),
      finalPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-20-00-spec-initiative", "final.md"),
      contextPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-20-00-spec-initiative", "context.md"),
      stdoutPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-20-00-spec-initiative", "stdout.log"),
      stderrPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-20-00-spec-initiative", "stderr.log"),
      configSources: [],
      summary: "Group initiative-scoped runs",
      inputs: {
        userPrompt: "Group initiative-scoped runs",
        initiativeId: "initiative-cache",
        initiativeTitle: "Cache rollout"
      }
    });

    await writeRun(
      repoDir,
      {
        id: "2026-03-13T17-50-00-spec-old-failure",
        workflow: "spec",
        createdAt: "2026-03-13T17:50:00.000Z",
        updatedAt: "2026-03-13T17:50:04.000Z",
        status: "failed",
        cwd: repoDir,
        gitBranch: "main",
        codexVersion: "fake",
        codexCommand: ["codex", "exec"],
        promptPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T17-50-00-spec-old-failure", "prompt.md"),
        finalPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T17-50-00-spec-old-failure", "final.md"),
        contextPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T17-50-00-spec-old-failure", "context.md"),
        stdoutPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T17-50-00-spec-old-failure", "stdout.log"),
        stderrPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T17-50-00-spec-old-failure", "stderr.log"),
        configSources: [],
        summary: "Old failed spec run",
        inputs: {
          userPrompt: "Old failed spec run"
        }
      },
      {
        intent: "Old failed spec run",
        stages: [
          {
            name: "discover",
            rationale: "context",
            status: "completed",
            executed: true
          },
          {
            name: "spec",
            rationale: "planning",
            status: "failed",
            executed: false,
            notes: "Codex exited with code 1"
          }
        ],
        specialists: []
      }
    );
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("renders a human ledger with active and historical runs", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runRuns(repoDir);
      const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(output).toContain("run_id");
      expect(output).toContain("intent");
      expect(output).toContain("audit-review");
      expect(output).toContain("Plan a compliance-safe billing migration");
      expect(output).toContain("failed");
      expect(output).toContain("initiative-cache (Cache rollout)");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("filters active runs and supports json output", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runRuns(repoDir, ["--active", "--json"]);
      const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
      const entries = JSON.parse(output) as Array<{ id: string; currentStage?: string; activeSpecialists: string[] }>;

      expect(entries).toHaveLength(1);
      expect(entries[0]?.id).toContain("intent-broad-task");
      expect(entries[0]?.currentStage).toBe("spec");
      expect(entries[0]?.activeSpecialists).toEqual(["audit-review"]);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("prefers machine-state metadata for current stage and active specialists when present", async () => {
    await writeRun(
      repoDir,
      {
        id: "2026-03-13T18-30-00-intent-machine-backed",
        workflow: "intent",
        createdAt: "2026-03-13T18:30:00.000Z",
        updatedAt: "2026-03-13T18:30:05.000Z",
        status: "running",
        cwd: repoDir,
        gitBranch: "main",
        codexVersion: "fake",
        codexCommand: ["codex", "exec"],
        promptPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-30-00-intent-machine-backed", "prompt.md"),
        finalPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-30-00-intent-machine-backed", "final.md"),
        contextPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-30-00-intent-machine-backed", "context.md"),
        stdoutPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-30-00-intent-machine-backed", "stdout.log"),
        stderrPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T18-30-00-intent-machine-backed", "stderr.log"),
        configSources: [],
        currentStage: "stale-stage",
        activeSpecialists: ["stale-specialist"],
        summary: "Machine-backed intent run",
        inputs: {
          userPrompt: "Machine-backed intent run"
        }
      },
      undefined,
      {
        version: 1,
        workflow: "intent",
        intent: "Machine-backed intent run",
        activePath: ["intent", "child", "review", "running"],
        runStatus: "running",
        visibleStages: [
          {
            name: "review",
            rationale: "review rationale",
            status: "running",
            executed: true,
            childRunId: "review-run-1",
            statePath: ["intent", "child", "review", "running"]
          }
        ],
        specialists: [],
        activeSpecialists: ["audit-review"],
        childWorkflows: [
          {
            stageName: "review",
            runId: "review-run-1",
            workflow: "review",
            status: "running",
            currentStage: "review"
          }
        ],
        transitions: [
          {
            at: "2026-03-13T18:30:00.000Z",
            event: "INIT",
            fromPath: ["intent", "stage", "review", "planned"],
            toPath: ["intent", "child", "review", "running"]
          }
        ],
        context: {},
        lastActivity: "Downstream review in progress"
      }
    );

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runRuns(repoDir, ["--active", "--json"]);
      const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
      const entries = JSON.parse(output) as Array<{ id: string; currentStage?: string; activeSpecialists: string[] }>;
      const machineEntry = entries.find((entry) => entry.id.includes("intent-machine-backed"));

      expect(machineEntry?.currentStage).toBe("review");
      expect(machineEntry?.activeSpecialists).toEqual(["audit-review"]);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("filters runs by initiative in json output", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runRuns(repoDir, ["--initiative", "initiative-cache", "--json"]);
      const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
      const entries = JSON.parse(output) as Array<{ id: string; initiativeId?: string }>;

      expect(entries).toHaveLength(1);
      expect(entries[0]?.initiativeId).toBe("initiative-cache");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("falls back to prompt or workflow metadata when run summary is missing", async () => {
    await writeRun(repoDir, {
      id: "2026-03-13T17-40-00-build-no-summary",
      workflow: "build",
      createdAt: "2026-03-13T17:40:00.000Z",
      updatedAt: "2026-03-13T17:40:05.000Z",
      status: "completed",
      cwd: repoDir,
      gitBranch: "main",
      codexVersion: "fake",
      codexCommand: ["codex", "exec"],
      promptPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T17-40-00-build-no-summary", "prompt.md"),
      finalPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T17-40-00-build-no-summary", "final.md"),
      contextPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T17-40-00-build-no-summary", "context.md"),
      stdoutPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T17-40-00-build-no-summary", "stdout.log"),
      stderrPath: path.join(repoDir, ".cstack", "runs", "2026-03-13T17-40-00-build-no-summary", "stderr.log"),
      configSources: [],
      inputs: {
        userPrompt: "Investigate a missing summary fallback in the run ledger"
      }
    });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runRuns(repoDir);
      const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Investigate a missing summary fallback in the run ledger");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("skips corrupt run files and still renders malformed-but-parseable runs", async () => {
    const corruptRunDir = path.join(repoDir, ".cstack", "runs", "2026-03-13T17-40-00-build-corrupt");
    await fs.mkdir(corruptRunDir, { recursive: true });
    await fs.writeFile(path.join(corruptRunDir, "run.json"), "{not-json\n", "utf8");

    const partialRunDir = path.join(repoDir, ".cstack", "runs", "2026-03-13T17-45-00-review-partial");
    await fs.mkdir(partialRunDir, { recursive: true });
    await fs.writeFile(
      path.join(partialRunDir, "run.json"),
      `${JSON.stringify({
        id: "2026-03-13T17-45-00-review-partial",
        workflow: "review",
        createdAt: "2026-03-13T17:45:00.000Z",
        updatedAt: "2026-03-13T17:45:05.000Z",
        status: "completed",
        cwd: repoDir,
        gitBranch: "main",
        codexVersion: "fake",
        codexCommand: ["codex", "exec"],
        promptPath: path.join(partialRunDir, "prompt.md"),
        finalPath: path.join(partialRunDir, "final.md"),
        contextPath: path.join(partialRunDir, "context.md"),
        stdoutPath: path.join(partialRunDir, "stdout.log"),
        stderrPath: path.join(partialRunDir, "stderr.log"),
        configSources: []
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(path.join(partialRunDir, "final.md"), "# final\n", "utf8");

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runRuns(repoDir);
      const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(output).toContain("2026-03-13T17-45-00-review-partial");
      expect(output).toContain("2026-03-13 17:45:05Z");
      expect(output).toContain("review 2026-03-13T17-45-00-review-partial");
      expect(output).not.toContain("2026-03-13T17-40-00-build-corrupt");
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
