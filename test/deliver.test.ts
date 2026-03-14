import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { runDeliver } from "../src/commands/deliver.js";
import { listRuns, readRun } from "../src/run.js";
import type { RunRecord, StageLineage } from "../src/types.js";

async function seedSpecRun(repoDir: string): Promise<string> {
  const runId = "2026-03-14T10-00-00-spec-release-hardening";
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
    summary: "Implement SSO with audit logging and release hardening",
    inputs: {
      userPrompt: "Implement SSO with audit logging and release hardening"
    }
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Spec\n\nImplement SSO with audit logging and release hardening.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "spec.md"), "# Spec\n\nImplement SSO with audit logging and release hardening.\n", "utf8");

  return runId;
}

describe("runDeliver", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-deliver-"));
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
        "",
        "[workflows.deliver]",
        'mode = "interactive"',
        'verificationCommands = ["node -e \\"process.stdout.write(\'deliver verify ok\')\\""]',
        ""
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "build.md"), "# test build prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "deliver.md"), "# test deliver prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# repo spec\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"), "# repo research\n", "utf8");
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("creates a deliver run with nested build, review, and ship artifacts", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runDeliver(repoDir, ["Implement SSO with audit logging and release pipeline hardening"]);

      const runs = await listRuns(repoDir);
      expect(runs).toHaveLength(1);

      const run = await readRun(repoDir, runs[0]!.id);
      const runDir = path.dirname(run.finalPath);
      const lineage = JSON.parse(await fs.readFile(path.join(runDir, "stage-lineage.json"), "utf8")) as StageLineage;
      const reviewVerdict = JSON.parse(await fs.readFile(path.join(runDir, "stages", "review", "artifacts", "verdict.json"), "utf8")) as {
        status: string;
      };
      const shipRecord = JSON.parse(await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "ship-record.json"), "utf8")) as {
        readiness: string;
      };
      const session = JSON.parse(await fs.readFile(path.join(runDir, "stages", "build", "session.json"), "utf8")) as {
        mode: string;
      };
      const verification = JSON.parse(
        await fs.readFile(path.join(runDir, "stages", "build", "artifacts", "verification.json"), "utf8")
      ) as { status: string };
      const finalBody = await fs.readFile(run.finalPath, "utf8");
      const deliveryReport = await fs.readFile(path.join(runDir, "artifacts", "delivery-report.md"), "utf8");
      const consoleOutput = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(run.workflow).toBe("deliver");
      expect(run.status).toBe("completed");
      expect(run.inputs.requestedMode).toBe("interactive");
      expect(run.inputs.observedMode).toBe("exec");
      expect(run.inputs.selectedSpecialists?.length).toBeGreaterThan(0);
      expect(lineage.stages.map((stage) => stage.name)).toEqual(["build", "review", "ship"]);
      expect(lineage.stages.every((stage) => stage.executed)).toBe(true);
      expect(reviewVerdict.status).toBe("ready");
      expect(shipRecord.readiness).toBe("ready");
      expect(session.mode).toBe("exec");
      expect(verification.status).toBe("passed");
      expect(finalBody).toContain("# Deliver Run Summary");
      expect(deliveryReport).toContain("# Deliver Run Summary");
      expect(consoleOutput).toContain("Workflow: deliver");
      expect(consoleOutput).toContain("Review verdict: ready");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("links a deliver run to an upstream run", async () => {
    const upstreamRunId = await seedSpecRun(repoDir);

    await runDeliver(repoDir, ["--from-run", upstreamRunId, "--exec"]);

    const runs = await listRuns(repoDir);
    const deliverRun = runs.find((run) => run.workflow === "deliver");
    expect(deliverRun).toBeTruthy();

    const run = await readRun(repoDir, deliverRun!.id);
    const runDir = path.dirname(run.finalPath);
    const buildSession = JSON.parse(await fs.readFile(path.join(runDir, "stages", "build", "session.json"), "utf8")) as {
      linkedRunId?: string;
      linkedRunWorkflow?: string;
      linkedArtifactPath?: string;
    };
    const promptBody = await fs.readFile(run.promptPath, "utf8");

    expect(run.inputs.linkedRunId).toBe(upstreamRunId);
    expect(run.inputs.requestedMode).toBe("exec");
    expect(run.inputs.observedMode).toBe("exec");
    expect(buildSession.linkedRunId).toBe(upstreamRunId);
    expect(buildSession.linkedRunWorkflow).toBe("spec");
    expect(buildSession.linkedArtifactPath).toContain("artifacts/spec.md");
    expect(promptBody).toContain("review specialists");
  });
});
