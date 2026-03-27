import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runShip } from "../src/commands/ship.js";
import { listRuns, readRun } from "../src/run.js";
import type { DeliverReviewVerdict, RunRecord } from "../src/types.js";

const execFileAsync = promisify(execFile);

async function initGitRepo(repoDir: string): Promise<{ remoteDir: string }> {
  const remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-ship-remote-"));
  await execFileAsync("git", ["init", "--bare", remoteDir]);
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  await execFileAsync("git", ["config", "commit.gpgSign", "false"], { cwd: repoDir });
  await execFileAsync("git", ["remote", "add", "origin", remoteDir], { cwd: repoDir });
  await execFileAsync("git", ["add", "."], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", "test repo"], { cwd: repoDir });
  await execFileAsync("git", ["push", "-u", "origin", "main"], { cwd: repoDir });
  return { remoteDir };
}

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

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Build Summary\n\nImplemented billing cleanup.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "change-summary.md"), "# Build Summary\n\nImplemented billing cleanup.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "verification.json"), `${JSON.stringify({
    status: "passed",
    requestedCommands: ["npm test"],
    results: []
  }, null, 2)}\n`, "utf8");

  return runId;
}

async function seedReviewRun(repoDir: string, buildRunId: string): Promise<string> {
  const runId = "2026-03-14T11-30-00-review-billing-cleanup";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "review",
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
    summary: "Review billing cleanup",
    inputs: {
      userPrompt: "Review billing cleanup",
      linkedRunId: buildRunId
    }
  };

  const verdict: DeliverReviewVerdict = {
    mode: "readiness",
    status: "ready",
    summary: "Review passed.",
    findings: [],
    recommendedActions: [],
    acceptedSpecialists: [],
    reportMarkdown: "# Review Findings\n\nReview passed.\n"
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Review Run Summary\n\nReady.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "findings.md"), verdict.reportMarkdown, "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "findings.json"), `${JSON.stringify({ findings: [], recommendedActions: [], acceptedSpecialists: [] }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`, "utf8");

  return runId;
}

describe("runShip", () => {
  let repoDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-ship-"));
    const fakeCodexPath = path.resolve("test/fixtures/fake-codex.mjs");
    const fakeGhPath = path.resolve("test/fixtures/fake-gh.mjs");
    chmodSync(fakeCodexPath, 0o755);
    chmodSync(fakeGhPath, 0o755);

    await fs.mkdir(path.join(repoDir, ".cstack", "prompts"), { recursive: true });
    await fs.mkdir(path.join(repoDir, ".cstack", "runs"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "specs"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "research"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "package.json"), JSON.stringify({ name: "cstack", version: "1.2.3" }, null, 2), "utf8");
    await fs.writeFile(path.join(repoDir, "README.md"), "# fixture\n\nRelease note for 1.2.3\n", "utf8");

    await fs.writeFile(
      path.join(repoDir, ".cstack", "config.toml"),
      [
        "[codex]",
        `command = "${fakeCodexPath.replaceAll("\\", "\\\\")}"`,
        'sandbox = "workspace-write"',
        "",
        "[workflows.ship]",
        "allowDirty = true",
        "",
        "[workflows.deliver.github]",
        'enabled = true',
        `command = "${fakeGhPath.replaceAll("\\", "\\\\")}"`,
        'repository = "ganesh47/cstack"',
        'pushBranch = true',
        'branchPrefix = "cstack"',
        'commitChanges = true',
        'createPullRequest = true',
        'updatePullRequest = true',
        'pullRequestBase = "main"',
        'watchChecks = true',
        'checkWatchTimeoutSeconds = 1',
        'checkWatchPollSeconds = 0',
        'prRequired = true',
        'requireApprovedReview = true',
        'linkedIssuesRequired = true',
        'requiredIssueState = "closed"',
        'requiredChecks = ["deliver/test", "deliver/typecheck"]',
        'requiredWorkflows = ["Release"]',
        "",
        "[workflows.deliver.github.security]",
        'requireDependabot = true',
        'requireCodeScanning = true',
        'blockSeverities = ["high", "critical"]',
        ""
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# repo spec\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"), "# repo research\n", "utf8");
    remoteDir = (await initGitRepo(repoDir)).remoteDir;
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.rm(remoteDir, { recursive: true, force: true });
  });

  async function writeGitHubFixture(fixture: unknown): Promise<void> {
    await fs.writeFile(path.join(repoDir, ".cstack", "test-gh.json"), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }

  it("creates a standalone ship run from a linked review run", async () => {
    const buildRunId = await seedBuildRun(repoDir);
    const reviewRunId = await seedReviewRun(repoDir, buildRunId);
    await writeGitHubFixture({
      createdPullRequest: {
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN"
      },
      issues: [
        {
          number: 123,
          title: "Track delivery",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/123",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [
        { name: "deliver/test", bucket: "pass", state: "completed", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/10" },
        { name: "deliver/typecheck", bucket: "pass", state: "completed", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/11" }
      ],
      actions: [
        { databaseId: 1, workflowName: "Release", status: "completed", conclusion: "success", url: "https://github.com/ganesh47/cstack/actions/runs/1" }
      ],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });

    await fs.writeFile(path.join(repoDir, "ship-change.txt"), "ship change\n", "utf8");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await runShip(repoDir, ["--from-run", reviewRunId, "--issue", "123", "Ship billing cleanup"]);

      const runs = await listRuns(repoDir);
      const shipRun = runs.find((run) => run.workflow === "ship");
      expect(shipRun).toBeTruthy();

      const run = await readRun(repoDir, shipRun!.id);
      const runDir = path.dirname(run.finalPath);
      const shipRecord = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "ship-record.json"), "utf8")) as {
        readiness: string;
      };
      const githubMutation = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-mutation.json"), "utf8")) as {
        branch: { current: string };
        pullRequest: { created: boolean };
      };
      const githubDelivery = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-delivery.json"), "utf8")) as {
        overall: { status: string };
      };

      expect(run.status).toBe("completed");
      expect(run.inputs.linkedRunId).toBe(reviewRunId);
      expect(shipRecord.readiness).toBe("ready");
      expect(githubMutation.branch.current).toContain("cstack/");
      expect(githubMutation.pullRequest.created).toBe(true);
      expect(githubDelivery.overall.status).toBe("ready");
      expect(stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("Workflow: ship");
    } finally {
      stdoutSpy.mockRestore();
    }
  }, 15_000);
});
