import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { chmodSync } from "node:fs";
import { promisify } from "node:util";
import { inferRoutingPlan, runIntent } from "../src/intent.js";
import { listRuns, readRun } from "../src/run.js";
import type { RoutingPlan, StageLineage } from "../src/types.js";

const execFileAsync = promisify(execFile);

async function initGitRepo(repoDir: string): Promise<string> {
  const remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-intent-remote-"));
  await execFileAsync("git", ["init", "--bare", remoteDir]);
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.name", "cstack test"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.email", "cstack-test@example.com"], { cwd: repoDir });
  await execFileAsync("git", ["remote", "add", "origin", remoteDir], { cwd: repoDir });
  await execFileAsync("git", ["add", "."], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: repoDir });
  await execFileAsync("git", ["push", "-u", "origin", "main"], { cwd: repoDir });
  return remoteDir;
}

describe("intent router", () => {
  let repoDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-intent-"));
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
        "",
        "[workflows.discover.delegation]",
        "enabled = true",
        "maxAgents = 3",
        "",
        "[workflows.discover.research]",
        "enabled = true",
        "allowWeb = true",
        ""
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "spec.md"), "# test prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "discover.md"), "# test discover prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# repo spec\n", "utf8");
    await fs.writeFile(
      path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"),
      "# repo research\n",
      "utf8"
    );
    remoteDir = await initGitRepo(repoDir);
  });

  afterEach(async () => {
    delete process.env.FAKE_CODEX_FAIL_BUILD;
    delete process.env.FAKE_CODEX_DELAY_MS;
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.rm(remoteDir, { recursive: true, force: true });
  });

  it("infers staged execution and specialists from intent", () => {
    const plan = inferRoutingPlan("Introduce SSO with audit logging and hardened security checks", "bare");
    expect(plan.stages.map((stage) => stage.name)).toEqual(["discover", "spec", "build", "review", "ship"]);
    expect(plan.specialists.filter((specialist) => specialist.selected).map((specialist) => specialist.name)).toEqual([
      "security-review",
      "audit-review"
    ]);
  });

  it("routes broad gap-analysis prompts directly into review", () => {
    const plan = inferRoutingPlan("What are the gaps in the current project?", "bare");
    expect(plan.stages.map((stage) => stage.name)).toEqual(["review"]);
    expect(plan.decision?.classification).toBe("analysis");
    expect(plan.decision?.winningSignals).toEqual(expect.arrayContaining(["analysis", "review"]));
    expect(plan.signals?.find((signal) => signal.name === "analysis")?.matched).toBe(true);
    expect(plan.signals?.find((signal) => signal.name === "implementation")?.matched).toBe(false);
  });

  it("routes gap-analysis prompts with explicit remediation intent into delivery stages", () => {
    const plan = inferRoutingPlan("What are the gaps in this project? Can you work on closing the gaps?", "bare");
    expect(plan.stages.map((stage) => stage.name)).toEqual(["discover", "spec", "build", "review", "ship"]);
    expect(plan.decision?.classification).toBe("mixed");
    expect(plan.decision?.winningSignals).toEqual(expect.arrayContaining(["analysis", "implementation", "review"]));
    expect(plan.signals?.find((signal) => signal.name === "implementation")?.evidence).toEqual(
      expect.arrayContaining(["work on", "closing"])
    );
  });

  it("creates an intent run and auto-executes downstream delivery when the inferred plan warrants it", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runIntent(repoDir, "Introduce SSO with audit logging and hardened security checks", {
        entrypoint: "bare",
        dryRun: false
      });

      const runs = await listRuns(repoDir);
      expect(runs.map((run) => run.workflow).sort()).toEqual(["deliver", "intent"]);

      const run = await readRun(
        repoDir,
        runs.find((entry) => entry.workflow === "intent")!.id
      );
      const runDir = path.dirname(run.finalPath);
      const deliverRun = await readRun(
        repoDir,
        runs.find((entry) => entry.workflow === "deliver")!.id
      );
      const routingPlan = JSON.parse(await fs.readFile(path.join(runDir, "routing-plan.json"), "utf8")) as RoutingPlan;
      const lineage = JSON.parse(await fs.readFile(path.join(runDir, "stage-lineage.json"), "utf8")) as StageLineage;
      const discoverResearchPlan = JSON.parse(
        await fs.readFile(path.join(runDir, "stages", "discover", "research-plan.json"), "utf8")
      ) as { mode: string; tracks: Array<{ name: string; selected: boolean }> };
      const finalBody = await fs.readFile(run.finalPath, "utf8");

      expect(run.workflow).toBe("intent");
      expect(run.status).toBe("completed");
      expect(deliverRun.workflow).toBe("deliver");
      expect(routingPlan.stages.map((stage) => stage.name)).toEqual(["discover", "spec", "build", "review", "ship"]);
      expect(lineage.stages.find((stage) => stage.name === "discover")?.status).toBe("completed");
      expect(lineage.stages.find((stage) => stage.name === "spec")?.status).toBe("completed");
      expect(lineage.stages.find((stage) => stage.name === "build")?.status).toBe("completed");
      expect(lineage.stages.find((stage) => stage.name === "build")?.childRunId).toBe(deliverRun.id);
      expect(lineage.stages.find((stage) => stage.name === "review")?.status).toBe("completed");
      expect(lineage.stages.find((stage) => stage.name === "ship")?.status).toBe("completed");
      expect(lineage.specialists).toHaveLength(0);
      expect(discoverResearchPlan.mode).toBe("research-team");
      expect(discoverResearchPlan.tracks.filter((track) => track.selected).map((track) => track.name)).toEqual([
        "repo-explorer",
        "risk-researcher",
        "external-researcher"
      ]);
      expect(await fs.readFile(path.join(runDir, "stages", "discover", "artifacts", "findings.md"), "utf8")).toContain(
        "Research Lead synthesis complete."
      );
      expect(await fs.readFile(path.join(runDir, "stages", "discover", "artifacts", "discovery-report.md"), "utf8")).toContain(
        "Research Lead synthesis complete."
      );
      expect(await fs.readFile(path.join(runDir, "stages", "discover", "delegates", "risk-researcher", "result.json"), "utf8")).toContain(
        "\"track\": \"risk-researcher\""
      );
      expect(await fs.readFile(path.join(runDir, "stages", "spec", "artifacts", "spec.md"), "utf8")).toContain("Fake Spec");
      expect(finalBody).toContain("Stage status");
      expect(finalBody).toContain("Specialist status");
      expect(finalBody).toContain(deliverRun.id);
      expect(stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("Inferred stages:");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("tracks downstream review progress in the parent intent run", async () => {
    await runIntent(repoDir, "What are the gaps in the current project?", {
      entrypoint: "bare",
      dryRun: false
    });

    const runs = await listRuns(repoDir);
    expect(runs.map((run) => run.workflow).sort()).toEqual(["intent", "review"]);

    const intentRun = await readRun(
      repoDir,
      runs.find((entry) => entry.workflow === "intent")!.id
    );
    const reviewRun = await readRun(
      repoDir,
      runs.find((entry) => entry.workflow === "review")!.id
    );
    const intentRunDir = path.dirname(intentRun.finalPath);
    const lineage = JSON.parse(await fs.readFile(path.join(intentRunDir, "stage-lineage.json"), "utf8")) as StageLineage;
    const eventsBody = await fs.readFile(path.join(intentRunDir, "events.jsonl"), "utf8");

    expect(intentRun.status).toBe("completed");
    expect(intentRun.sessionId).toBe(reviewRun.sessionId);
    expect(lineage.stages.map((stage) => stage.name)).toEqual(["review"]);
    expect(lineage.stages.find((stage) => stage.name === "review")?.status).toBe("completed");
    expect(lineage.stages.find((stage) => stage.name === "review")?.childRunId).toBe(reviewRun.id);
    expect(eventsBody).toContain("Running downstream review workflow from intent");
    expect(eventsBody).toContain(`Downstream review run ${reviewRun.id} started`);
    expect(eventsBody).toContain("Downstream review stage: review");
    expect(eventsBody).not.toContain("Running discover stage");
    expect(eventsBody).not.toContain("Running spec stage");
  });

  it("keeps intent completed when downstream review finds blocked gaps", async () => {
    const intentRunId = await runIntent(repoDir, "What are the gaps in this project", {
      entrypoint: "bare",
      dryRun: false
    });

    const intentRun = await readRun(repoDir, intentRunId);
    const intentRunDir = path.dirname(intentRun.finalPath);
    const lineage = JSON.parse(await fs.readFile(path.join(intentRunDir, "stage-lineage.json"), "utf8")) as StageLineage;
    const reviewRunId = lineage.stages.find((stage) => stage.name === "review")?.childRunId;
    expect(reviewRunId).toBeTruthy();
    const reviewRun = await readRun(repoDir, reviewRunId!);
    const reviewRunDir = path.dirname(reviewRun.finalPath);
    const reviewVerdict = JSON.parse(await fs.readFile(path.join(reviewRunDir, "artifacts", "verdict.json"), "utf8")) as {
      mode: string;
      status: string;
      summary: string;
      gapClusters?: Array<{ title: string }>;
    };

    expect(intentRun.status).toBe("completed");
    expect(intentRun.error).toBeUndefined();
    expect(reviewRun.status).toBe("completed");
    expect(reviewVerdict.mode).toBe("analysis");
    expect(reviewVerdict.status).toBe("completed");
    expect(reviewVerdict.gapClusters?.[0]?.title).toBe("Contract drift");
    expect(lineage.stages.map((stage) => stage.name)).toEqual(["review"]);
    expect(lineage.stages.find((stage) => stage.name === "review")?.status).toBe("completed");
    expect(await fs.readFile(intentRun.finalPath, "utf8")).toContain("Gap analysis completed. High-priority product and delivery gaps remain.");
  });

  it("auto-executes downstream delivery for gap-analysis prompts that also ask for remediation", async () => {
    await fs.writeFile(path.join(repoDir, "dirty-local.txt"), "do not copy\n", "utf8");
    await runIntent(repoDir, "What are the gaps in this project? Can you work on closing the gaps?", {
      entrypoint: "bare",
      dryRun: false
    });

    const runs = await listRuns(repoDir);
    expect(runs.map((run) => run.workflow).sort()).toEqual(["deliver", "intent"]);

    const intentRun = await readRun(
      repoDir,
      runs.find((entry) => entry.workflow === "intent")!.id
    );
    const deliverRun = await readRun(
      repoDir,
      runs.find((entry) => entry.workflow === "deliver")!.id
    );
    const intentRunDir = path.dirname(intentRun.finalPath);
    const deliverRunDir = path.dirname(deliverRun.finalPath);
    const lineage = JSON.parse(await fs.readFile(path.join(intentRunDir, "stage-lineage.json"), "utf8")) as StageLineage;
    const executionContext = JSON.parse(await fs.readFile(path.join(deliverRunDir, "execution-context.json"), "utf8")) as {
      source: { dirtyFiles: string[]; localChangesIgnored: boolean };
      execution: { kind: string; cwd: string };
    };

    expect(intentRun.status).toBe("completed");
    expect(deliverRun.status).toBe("completed");
    expect(lineage.stages.map((stage) => stage.name)).toEqual(["discover", "spec", "build", "review", "ship"]);
    expect(lineage.stages.find((stage) => stage.name === "build")?.childRunId).toBe(deliverRun.id);
    expect(executionContext.execution.kind).toBe("git-worktree");
    expect(executionContext.source.dirtyFiles).toContain("dirty-local.txt");
    expect(executionContext.source.localChangesIgnored).toBe(true);
  });

  it("surfaces downstream build failure promptly and marks later stages deferred", async () => {
    process.env.FAKE_CODEX_FAIL_BUILD = "1";

    await runIntent(repoDir, "What are the gaps in this project? Can you work on closing the gaps?", {
      entrypoint: "bare",
      dryRun: false
    });

    const runs = await listRuns(repoDir);
    const intentRun = await readRun(
      repoDir,
      runs.find((entry) => entry.workflow === "intent")!.id
    );
    const intentRunDir = path.dirname(intentRun.finalPath);
    const lineage = JSON.parse(await fs.readFile(path.join(intentRunDir, "stage-lineage.json"), "utf8")) as StageLineage;
    const finalBody = await fs.readFile(intentRun.finalPath, "utf8");

    expect(intentRun.status).toBe("failed");
    expect(intentRun.error).toContain("build failed");
    expect(lineage.stages.find((stage) => stage.name === "build")?.status).toBe("failed");
    expect(lineage.stages.find((stage) => stage.name === "review")?.status).toBe("deferred");
    expect(lineage.stages.find((stage) => stage.name === "ship")?.status).toBe("deferred");
    expect(finalBody).toContain("Blocked because build failed");
  });

  it("supports dry-run routing without executing stages", async () => {
    await runIntent(repoDir, "Plan a compliance-safe billing migration", {
      entrypoint: "run",
      dryRun: true
    });

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const lineage = JSON.parse(await fs.readFile(path.join(runDir, "stage-lineage.json"), "utf8")) as StageLineage;

    expect(run.workflow).toBe("intent");
    expect(run.status).toBe("completed");
    expect(lineage.stages.every((stage) => stage.status === "skipped")).toBe(true);
    await expect(fs.access(path.join(runDir, "stages", "discover"))).rejects.toThrow();
  });
});
