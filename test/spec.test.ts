import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { runSpec } from "../src/commands/spec.js";
import { listRuns, readRun } from "../src/run.js";
import type { RunRecord } from "../src/types.js";

async function seedDiscoverRun(repoDir: string): Promise<string> {
  const runId = "2026-03-14T10-00-00-discover-billing-research";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "discover",
    createdAt: "2026-03-14T10:00:00.000Z",
    updatedAt: "2026-03-14T10:00:05.000Z",
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
    summary: "Map billing cleanup",
    inputs: {
      userPrompt: "Map billing cleanup"
    }
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Discovery\n\nBilling cleanup findings.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "findings.md"), "# Discovery\n\nBilling cleanup findings.\n", "utf8");
  return runId;
}

describe("runSpec", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-spec-"));
    const fakeCodexPath = path.resolve("test/fixtures/fake-codex.mjs");
    chmodSync(fakeCodexPath, 0o755);

    await fs.mkdir(path.join(repoDir, ".cstack", "prompts"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "specs"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "research"), { recursive: true });

    await fs.writeFile(
      path.join(repoDir, ".cstack", "config.toml"),
      [
        "[codex]",
        `command = "${fakeCodexPath.replaceAll("\\", "\\\\")}"`,
        'sandbox = "workspace-write"',
        "",
        "[workflows.spec.delegation]",
        "enabled = false",
        "maxAgents = 0",
        ""
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "spec.md"), "# test prompt asset\n", "utf8");
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

  it("creates a completed run with artifact, progress events, and session metadata", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runSpec(repoDir, "Draft the first vertical slice.");

      const runs = await listRuns(repoDir);
      expect(runs).toHaveLength(1);

      const run = await readRun(repoDir, runs[0]!.id);
      const finalBody = await fs.readFile(run.finalPath, "utf8");
      const artifactBody = await fs.readFile(path.join(path.dirname(run.finalPath), "artifacts", "spec.md"), "utf8");
      const plan = JSON.parse(await fs.readFile(path.join(path.dirname(run.finalPath), "artifacts", "plan.json"), "utf8")) as {
        summary: string;
      };
      const openQuestions = await fs.readFile(path.join(path.dirname(run.finalPath), "artifacts", "open-questions.md"), "utf8");
      const eventsBody = await fs.readFile(run.eventsPath!, "utf8");
      const consoleOutput = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(run.status).toBe("completed");
      expect([null, "fake-codex 0.0.1"]).toContain(run.codexVersion);
      expect([undefined, "fake-session-123"]).toContain(run.sessionId);
      expect(run.codexCommand.some((part) => part.includes("fake-codex.mjs"))).toBe(true);
      expect(run.lastActivity).toBe("Exit code 0");
      expect(finalBody).toContain("fake Codex response");
      expect(artifactBody).toContain("Fake Spec");
      expect(plan.summary).toBeTruthy();
      expect(openQuestions).toContain("# Open Questions");
      expect(eventsBody).toContain("\"type\":\"starting\"");
      expect(eventsBody).toContain("scanning repository context");
      expect(eventsBody).toContain("\"type\":\"completed\"");
      expect(consoleOutput).toContain("Starting Codex run");
      expect(consoleOutput).toContain("Activity (stdout): scanning repository context");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("can link a spec run to an upstream run", async () => {
    const discoverRunId = await seedDiscoverRun(repoDir);

    await runSpec(repoDir, ["--from-run", discoverRunId]);

    const runs = await listRuns(repoDir);
    const run = runs.find((entry) => entry.workflow === "spec");
    expect(run?.inputs.linkedRunId).toBe(discoverRunId);

    const promptBody = await fs.readFile(run!.promptPath, "utf8");
    expect(promptBody).toContain(discoverRunId);
    expect(promptBody).toContain("Billing cleanup findings");
  });

  it("fails closed when the spec stage times out", async () => {
    const configPath = path.join(repoDir, ".cstack", "config.toml");
    const existing = await fs.readFile(configPath, "utf8");
    await fs.writeFile(configPath, `${existing}\n[workflows.spec]\ntimeoutSeconds = 1\n`, "utf8");

    process.env.FAKE_CODEX_DELAY_MS = "1500";
    try {
      await expect(runSpec(repoDir, "Draft the first vertical slice.")).rejects.toThrow(/code 124/);

      const runs = await listRuns(repoDir);
      const run = await readRun(repoDir, runs[0]!.id);
      expect(run.status).toBe("failed");
      expect(run.error).toContain("code 124");
    } finally {
      delete process.env.FAKE_CODEX_DELAY_MS;
    }
  });
});
