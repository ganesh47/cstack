import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { runBuild } from "../src/commands/build.js";
import { listRuns, readRun } from "../src/run.js";
import type { RunRecord } from "../src/types.js";

async function seedSpecRun(repoDir: string): Promise<string> {
  const runId = "2026-03-14T10-00-00-spec-billing-retry";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "spec",
    createdAt: "2026-03-14T10:00:00.000Z",
    updatedAt: "2026-03-14T10:00:10.000Z",
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
    summary: "Implement the queued billing retry cleanup",
    inputs: {
      userPrompt: "Implement the queued billing retry cleanup"
    }
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Spec\n\nImplement the queued billing retry cleanup.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "spec.md"), "# Spec\n\nImplement the queued billing retry cleanup.\n", "utf8");

  return runId;
}

describe("runBuild", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-build-"));
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
        "",
        "[workflows.build]",
        'mode = "interactive"',
        'verificationCommands = ["node -e \\"process.stdout.write(\'verify ok\')\\""]',
        ""
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "build.md"), "# test build prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# repo spec\n", "utf8");
    await fs.writeFile(
      path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"),
      "# repo research\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("creates a build run with session and verification artifacts", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runBuild(repoDir, ["Implement the queued billing retry cleanup"]);

      const runs = await listRuns(repoDir);
      expect(runs).toHaveLength(1);

      const run = await readRun(repoDir, runs[0]!.id);
      const runDir = path.dirname(run.finalPath);
      const session = JSON.parse(await fs.readFile(path.join(runDir, "session.json"), "utf8")) as {
        requestedMode: string;
        mode: string;
        observability: { fallbackReason?: string };
      };
      const verification = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "verification.json"), "utf8")) as {
        status: string;
        results: Array<{ command: string; status: string }>;
      };
      const finalBody = await fs.readFile(run.finalPath, "utf8");
      const changeSummary = await fs.readFile(path.join(runDir, "artifacts", "change-summary.md"), "utf8");
      const consoleOutput = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(run.workflow).toBe("build");
      expect(run.status).toBe("completed");
      expect(run.inputs.requestedMode).toBe("interactive");
      expect(run.inputs.observedMode).toBe("exec");
      expect(session.requestedMode).toBe("interactive");
      expect(session.mode).toBe("exec");
      expect(session.observability.fallbackReason).toContain("no TTY");
      expect(verification.status).toBe("passed");
      expect(verification.results[0]?.command).toContain("verify ok");
      expect(finalBody).toContain("# Build Summary");
      expect(changeSummary).toContain("# Build Summary");
      expect(consoleOutput).toContain("Mode: requested=interactive observed=exec");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("links a build run to an upstream run", async () => {
    const upstreamRunId = await seedSpecRun(repoDir);

    await runBuild(repoDir, ["--from-run", upstreamRunId, "--exec"]);

    const runs = await listRuns(repoDir);
    const buildRun = runs.find((run) => run.workflow === "build");
    expect(buildRun).toBeTruthy();

    const run = await readRun(repoDir, buildRun!.id);
    const runDir = path.dirname(run.finalPath);
    const session = JSON.parse(await fs.readFile(path.join(runDir, "session.json"), "utf8")) as {
      linkedRunId?: string;
      linkedRunWorkflow?: string;
      linkedArtifactPath?: string;
    };
    const promptBody = await fs.readFile(run.promptPath, "utf8");

    expect(run.inputs.linkedRunId).toBe(upstreamRunId);
    expect(run.inputs.requestedMode).toBe("exec");
    expect(run.inputs.observedMode).toBe("exec");
    expect(session.linkedRunId).toBe(upstreamRunId);
    expect(session.linkedRunWorkflow).toBe("spec");
    expect(session.linkedArtifactPath).toContain("artifacts/spec.md");
    expect(promptBody).toContain(upstreamRunId);
    expect(promptBody).toContain("Implement the queued billing retry cleanup");
  });
});
