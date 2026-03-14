import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmodSync } from "node:fs";
import { runDeliver } from "../src/commands/deliver.js";
import { listRuns, readRun } from "../src/run.js";
import type { RunRecord, StageLineage } from "../src/types.js";

const execFileAsync = promisify(execFile);

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

async function initGitRepo(repoDir: string): Promise<string> {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  await execFileAsync("git", ["config", "commit.gpgSign", "false"], { cwd: repoDir });
  await execFileAsync("git", ["add", "."], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", "test repo"], { cwd: repoDir });
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
  return stdout.trim();
}

describe("runDeliver", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-deliver-"));
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
        "[workflows.build]",
        'mode = "interactive"',
        "",
        "[workflows.deliver]",
        'mode = "interactive"',
        'verificationCommands = ["node -e \\"process.stdout.write(\'deliver verify ok\')\\""]',
        "",
        "[workflows.deliver.github]",
        'enabled = true',
        `command = "${fakeGhPath.replaceAll("\\", "\\\\")}"`,
        'repository = "ganesh47/cstack"',
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

    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "build.md"), "# test build prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "deliver.md"), "# test deliver prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# repo spec\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"), "# repo research\n", "utf8");
    await initGitRepo(repoDir);
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  async function writeGitHubFixture(fixture: unknown): Promise<void> {
    await fs.writeFile(path.join(repoDir, ".cstack", "test-gh.json"), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }

  it("creates a merge-ready deliver run with GitHub delivery evidence", async () => {
    const { stdout: headShaOut } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    const headSha = headShaOut.trim();
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      pullRequest: {
        number: 42,
        title: "Implement SSO with audit logging",
        state: "OPEN",
        isDraft: false,
        reviewDecision: "APPROVED",
        url: "https://github.com/ganesh47/cstack/pull/42",
        headRefName: "main",
        baseRefName: "main",
        mergeStateStatus: "CLEAN",
        closingIssuesReferences: [{ number: 123 }]
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
        { databaseId: 1, workflowName: "Release", status: "completed", conclusion: "success", url: "https://github.com/ganesh47/cstack/actions/runs/1", headSha, headBranch: "main" }
      ],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runDeliver(repoDir, ["Implement SSO with audit logging and release pipeline hardening for #123"]);

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
      const githubDelivery = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-delivery.json"), "utf8")) as {
        pullRequest: { status: string; required: boolean };
        issues: { status: string; required: boolean };
        checks: { status: string; required: boolean; observed: Array<{ name: string; conclusion: string }> };
        actions: { status: string; required: boolean };
        security: { status: string; required: boolean };
        overall: { status: string };
        issueReferences: number[];
      };
      const finalBody = await fs.readFile(run.finalPath, "utf8");
      const deliveryReport = await fs.readFile(path.join(runDir, "artifacts", "delivery-report.md"), "utf8");
      const checksArtifact = await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "checks.json"), "utf8");
      const actionsArtifact = await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "actions.json"), "utf8");
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
      expect(githubDelivery.overall.status).toBe("ready");
      expect(githubDelivery.pullRequest).toMatchObject({ status: "ready", required: true });
      expect(githubDelivery.issues).toMatchObject({ status: "ready", required: true });
      expect(githubDelivery.checks.status).toBe("ready");
      expect(githubDelivery.checks.observed.map((check) => check.name)).toEqual(["deliver/test", "deliver/typecheck"]);
      expect(githubDelivery.actions).toMatchObject({ status: "ready", required: true });
      expect(githubDelivery.security).toMatchObject({ status: "ready", required: true });
      expect(githubDelivery.issueReferences).toEqual([123]);
      expect(checksArtifact).toContain("\"status\": \"ready\"");
      expect(actionsArtifact).toContain("\"workflowName\": \"Release\"");
      expect(finalBody).toContain("# Deliver Run Summary");
      expect(deliveryReport).toContain("# Deliver Run Summary");
      expect(consoleOutput).toContain("Workflow: deliver");
      expect(consoleOutput).toContain("Review verdict: ready");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("creates a release-bearing deliver run when release evidence exists", async () => {
    const upstreamRunId = await seedSpecRun(repoDir);
    const { stdout: headShaOut } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    const headSha = headShaOut.trim();
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      pullRequest: {
        number: 43,
        title: "Release prep",
        state: "OPEN",
        isDraft: false,
        reviewDecision: "APPROVED",
        url: "https://github.com/ganesh47/cstack/pull/43",
        headRefName: "main",
        baseRefName: "main",
        mergeStateStatus: "CLEAN",
        closingIssuesReferences: [{ number: 456 }]
      },
      issues: [
        {
          number: 456,
          title: "Release issue",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/456",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [
        { name: "deliver/test", bucket: "pass", state: "completed", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/12" },
        { name: "deliver/typecheck", bucket: "pass", state: "completed", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/13" }
      ],
      actions: [
        { databaseId: 2, workflowName: "Release", status: "completed", conclusion: "success", url: "https://github.com/ganesh47/cstack/actions/runs/2", headSha, headBranch: "main" }
      ],
      release: {
        tagName: "v1.2.3",
        name: "cstack v1.2.3",
        url: "https://github.com/ganesh47/cstack/releases/tag/v1.2.3",
        publishedAt: "2026-03-14T00:00:00.000Z"
      },
      tags: ["v1.2.3"],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });
    const configPath = path.join(repoDir, ".cstack", "config.toml");
    const configBody = await fs.readFile(configPath, "utf8");
    await fs.writeFile(
      configPath,
      configBody.replace('requiredWorkflows = ["Release"]', 'requiredWorkflows = ["Release"]\nrequireTag = true\nrequireRelease = true'),
      "utf8"
    );
    await execFileAsync("git", ["tag", "v1.2.3"], { cwd: repoDir });

    await runDeliver(repoDir, ["--from-run", upstreamRunId, "--exec", "--release", "--issue", "456"]);

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
    const githubDelivery = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-delivery.json"), "utf8")) as {
      mode: string;
      release: { status: string; required: boolean; observed: { tagName: string } | null };
      actions: { status: string };
    };
    const releaseArtifact = await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "release.json"), "utf8");
    const promptBody = await fs.readFile(run.promptPath, "utf8");

    expect(run.inputs.linkedRunId).toBe(upstreamRunId);
    expect(run.inputs.requestedMode).toBe("exec");
    expect(run.inputs.observedMode).toBe("exec");
    expect(run.inputs.deliveryMode).toBe("release");
    expect(buildSession.linkedRunId).toBe(upstreamRunId);
    expect(buildSession.linkedRunWorkflow).toBe("spec");
    expect(buildSession.linkedArtifactPath).toContain("artifacts/spec.md");
    expect(githubDelivery.mode).toBe("release");
    expect(githubDelivery.release).toMatchObject({ status: "ready", required: true });
    expect(githubDelivery.release.observed?.tagName).toBe("v1.2.3");
    expect(githubDelivery.actions.status).toBe("ready");
    expect(releaseArtifact).toContain("\"tagName\": \"v1.2.3\"");
    expect(promptBody).toContain("review specialists");
  });

  it("fails deliver when required GitHub security or checks are blocked", async () => {
    const { stdout: headShaOut } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    const headSha = headShaOut.trim();
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      pullRequest: {
        number: 44,
        title: "Blocked delivery",
        state: "OPEN",
        isDraft: false,
        reviewDecision: "APPROVED",
        url: "https://github.com/ganesh47/cstack/pull/44",
        headRefName: "main",
        baseRefName: "main",
        mergeStateStatus: "CLEAN",
        closingIssuesReferences: [{ number: 789 }]
      },
      issues: [
        {
          number: 789,
          title: "Blocked issue",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/789",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [
        { name: "deliver/test", bucket: "fail", state: "completed", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/14" },
        { name: "deliver/typecheck", bucket: "pass", state: "completed", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/15" }
      ],
      actions: [
        { databaseId: 3, workflowName: "Release", status: "completed", conclusion: "success", url: "https://github.com/ganesh47/cstack/actions/runs/3", headSha, headBranch: "main" }
      ],
      security: {
        dependabot: [
          {
            number: 7,
            state: "open",
            security_advisory: { severity: "high" },
            dependency: { package: { name: "lodash" } }
          }
        ],
        codeScanning: []
      }
    });

    await runDeliver(repoDir, ["Deliver a blocked change for #789"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const shipRecord = JSON.parse(await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "ship-record.json"), "utf8")) as {
      readiness: string;
      unresolved: string[];
    };
    const githubDelivery = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-delivery.json"), "utf8")) as {
      checks: { status: string; blockers: string[] };
      security: { status: string; blockers: string[] };
      overall: { status: string; blockers: string[] };
    };
    const securityArtifact = await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "security.json"), "utf8");

    expect(run.status).toBe("failed");
    expect(shipRecord.readiness).toBe("blocked");
    expect(githubDelivery.checks.status).toBe("blocked");
    expect(githubDelivery.security.status).toBe("blocked");
    expect(githubDelivery.checks.blockers.join("\n")).toContain("Required check deliver/test");
    expect(githubDelivery.security.blockers.join("\n")).toContain("Dependabot alert");
    expect(githubDelivery.overall.status).toBe("blocked");
    expect(githubDelivery.overall.blockers.join("\n")).toContain("Dependabot alert");
    expect(githubDelivery.overall.blockers.join("\n")).toContain("Required check deliver/test");
    expect(shipRecord.unresolved.join("\n")).toContain("Dependabot alert");
    expect(securityArtifact).toContain("\"severity\": \"high\"");
  });
});
