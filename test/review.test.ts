import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { runReview } from "../src/commands/review.js";
import { listRuns, readRun } from "../src/run.js";
import type { BuildVerificationRecord, RunRecord, StageLineage } from "../src/types.js";

async function seedBuildRun(repoDir: string): Promise<string> {
  const runId = "2026-03-14T11-00-00-build-billing-cleanup";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "build",
    createdAt: "2026-03-14T11:00:00.000Z",
    updatedAt: "2026-03-14T11:00:10.000Z",
    status: "completed",
    cwd: repoDir,
    gitBranch: "main",
    codexVersion: "fake",
    codexCommand: ["codex", "exec"],
    promptPath: path.join(runDir, "prompt.md"),
    finalPath: path.join(runDir, "final.md"),
    contextPath: path.join(runDir, "context.md"),
    stdoutPath: path.join(runDir, "stdout.log"),
    stderrPath: path.join(runDir, "stderr.log"),
    configSources: [],
    sessionId: "fake-session-123",
    summary: "Implement billing cleanup",
    inputs: {
      userPrompt: "Implement billing cleanup"
    }
  };

  const verification: BuildVerificationRecord = {
    status: "passed",
    requestedCommands: ["npm test"],
    results: [
      {
        command: "npm test",
        exitCode: 0,
        status: "passed",
        durationMs: 25,
        stdoutPath: path.join(runDir, "artifacts", "verification", "1.stdout.log"),
        stderrPath: path.join(runDir, "artifacts", "verification", "1.stderr.log")
      }
    ]
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Build Summary\n\nImplemented billing cleanup.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "change-summary.md"), "# Build Summary\n\nImplemented billing cleanup.\n", "utf8");
  await fs.mkdir(path.join(runDir, "artifacts", "verification"), { recursive: true });
  await fs.writeFile(path.join(runDir, "artifacts", "verification.json"), `${JSON.stringify(verification, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "session.json"), `${JSON.stringify({ workflow: "build", requestedMode: "exec", mode: "exec", sessionId: "fake-session-123", codexCommand: ["codex"], observability: { sessionIdObserved: true, transcriptObserved: false, finalArtifactObserved: true }, startedAt: "2026-03-14T11:00:00.000Z", endedAt: "2026-03-14T11:00:10.000Z" }, null, 2)}\n`, "utf8");

  return runId;
}

async function seedInitiativeBuildRun(repoDir: string): Promise<string> {
  const runId = "2026-03-14T11-30-00-build-initiative-queue";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "build",
    createdAt: "2026-03-14T11:30:00.000Z",
    updatedAt: "2026-03-14T11:30:10.000Z",
    status: "completed",
    cwd: repoDir,
    gitBranch: "main",
    codexVersion: "fake",
    codexCommand: ["codex", "exec"],
    promptPath: path.join(runDir, "prompt.md"),
    finalPath: path.join(runDir, "final.md"),
    contextPath: path.join(runDir, "context.md"),
    stdoutPath: path.join(runDir, "stdout.log"),
    stderrPath: path.join(runDir, "stderr.log"),
    configSources: [],
    summary: "Build initiative cleanup",
    inputs: {
      userPrompt: "Build initiative cleanup",
      initiativeId: "initiative-2026",
      initiativeTitle: "Refactor platform APIs"
    }
  };

  const verification: BuildVerificationRecord = {
    status: "passed",
    requestedCommands: ["npm test"],
    results: [
      {
        command: "npm test",
        exitCode: 0,
        status: "passed",
        durationMs: 25,
        stdoutPath: path.join(runDir, "artifacts", "verification", "1.stdout.log"),
        stderrPath: path.join(runDir, "artifacts", "verification", "1.stderr.log")
      }
    ]
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Build Summary\n\nImplemented initiative cleanup.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "change-summary.md"), "# Build Summary\n\nImplemented initiative cleanup.\n", "utf8");
  await fs.mkdir(path.join(runDir, "artifacts", "verification"), { recursive: true });
  await fs.writeFile(path.join(runDir, "artifacts", "verification.json"), `${JSON.stringify(verification, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "session.json"), `${JSON.stringify({ workflow: "build", requestedMode: "exec", mode: "exec", sessionId: "fake-session-456", codexCommand: ["codex"], observability: { sessionIdObserved: true, transcriptObserved: false, finalArtifactObserved: true }, startedAt: "2026-03-14T11:30:00.000Z", endedAt: "2026-03-14T11:30:10.000Z" }, null, 2)}\n`, "utf8");

  return runId;
}

describe("runReview", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-review-"));
    const fakeCodexPath = path.resolve("test/fixtures/fake-codex.mjs");
    chmodSync(fakeCodexPath, 0o755);

    await fs.mkdir(path.join(repoDir, ".cstack", "prompts"), { recursive: true });
    await fs.mkdir(path.join(repoDir, ".cstack", "runs"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "specs"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "research"), { recursive: true });

    await fs.writeFile(
      path.join(repoDir, ".cstack", "config.toml"),
      [
        "[codex]",
        `command = "${fakeCodexPath.replaceAll("\\", "\\\\")}"`,
        'sandbox = "workspace-write"',
        ""
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# repo spec\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"), "# repo research\n", "utf8");
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("creates a standalone review run from a linked build run", async () => {
    const buildRunId = await seedBuildRun(repoDir);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await runReview(repoDir, ["--from-run", buildRunId, "Review billing cleanup and release safety"]);

      const runs = await listRuns(repoDir);
      const reviewRun = runs.find((run) => run.workflow === "review");
      expect(reviewRun).toBeTruthy();

      const run = await readRun(repoDir, reviewRun!.id);
      const runDir = path.dirname(run.finalPath);
      const verdict = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "verdict.json"), "utf8")) as {
        mode: string;
        status: string;
        summary: string;
      };
      const findings = await fs.readFile(path.join(runDir, "artifacts", "findings.md"), "utf8");
      const lineage = JSON.parse(await fs.readFile(path.join(runDir, "stage-lineage.json"), "utf8")) as StageLineage;

      expect(run.inputs.linkedRunId).toBe(buildRunId);
      expect(run.status).toBe("completed");
      expect(verdict.mode).toBe("readiness");
      expect(verdict.status).toBe("ready");
      expect(findings).toContain("Review Findings");
      expect(lineage.stages[0]?.name).toBe("review");
      expect(lineage.stages[0]?.status).toBe("completed");
      expect(lineage.specialists.length).toBeGreaterThan(0);
      expect(stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("Workflow: review");
    } finally {
      stdoutSpy.mockRestore();
    }
  }, 60_000);

  it("suppresses post-run inspection prompts when invoked as a downstream child workflow", async () => {
    const buildRunId = await seedBuildRun(repoDir);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });

    try {
      await runReview(repoDir, ["--from-run", buildRunId, "Review billing cleanup and release safety"], {
        suppressInteractiveInspect: true
      });

      const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Workflow: review");
      expect(output).not.toContain("Inspect this run now?");
    } finally {
      if (stdinIsTTY) {
        Object.defineProperty(process.stdin, "isTTY", stdinIsTTY);
      } else {
        delete (process.stdin as { isTTY?: boolean }).isTTY;
      }
      if (stdoutIsTTY) {
        Object.defineProperty(process.stdout, "isTTY", stdoutIsTTY);
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      }
      stdoutSpy.mockRestore();
    }
  }, 60_000);

  it("keeps the review run completed when the verdict is blocked but the analysis succeeded", async () => {
    const buildRunId = await seedBuildRun(repoDir);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await runReview(repoDir, ["--from-run", buildRunId, "What are the gaps in this project"]);

      const runs = await listRuns(repoDir);
      const reviewRun = runs.find((run) => run.workflow === "review");
      expect(reviewRun).toBeTruthy();

      const run = await readRun(repoDir, reviewRun!.id);
      const runDir = path.dirname(run.finalPath);
      const verdict = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "verdict.json"), "utf8")) as {
        mode: string;
        status: string;
        summary: string;
        gapClusters?: Array<{ title: string }>;
      };

      expect(run.status).toBe("completed");
      expect(run.error).toBeUndefined();
      expect(verdict.mode).toBe("analysis");
      expect(verdict.status).toBe("completed");
      expect(verdict.gapClusters?.[0]?.title).toBe("Contract drift");
      expect(await fs.readFile(run.finalPath, "utf8")).toContain("Gap analysis completed.");
    } finally {
      stdoutSpy.mockRestore();
    }
  }, 60_000);

  it("inherits and overrides initiative metadata", async () => {
    const buildRunId = await seedInitiativeBuildRun(repoDir);

    await runReview(repoDir, [
      "--from-run",
      buildRunId,
      "Review initiative cleanup"
    ]);

    const inheritedRun = await readRun(
      repoDir,
      (await listRuns(repoDir)).filter((entry) => entry.workflow === "review")[0]!.id
    );
    expect(inheritedRun.inputs.initiativeId).toBe("initiative-2026");
    expect(inheritedRun.inputs.initiativeTitle).toBe("Refactor platform APIs");

    await runReview(repoDir, [
      "--from-run",
      buildRunId,
      "--initiative",
      "initiative-review-override",
      "--initiative-title",
      "Override initiative title",
      "Review initiative cleanup"
    ]);

    const overrideRun = await readRun(
      repoDir,
      (await listRuns(repoDir)).filter((entry) => entry.workflow === "review")[0]!.id
    );
    expect(overrideRun.inputs.initiativeId).toBe("initiative-review-override");
    expect(overrideRun.inputs.initiativeTitle).toBe("Override initiative title");
    expect(inheritedRun.id).not.toBe(overrideRun.id);
  }, 60_000);
});
