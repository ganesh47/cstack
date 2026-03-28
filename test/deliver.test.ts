import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmodSync } from "node:fs";
import { runDeliver } from "../src/commands/deliver.js";
import { performGitHubDeliverMutations } from "../src/github.js";
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

async function seedInitiativeSpecRun(repoDir: string): Promise<string> {
  const runId = "2026-03-14T10-30-00-spec-initiative-review";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "spec",
    createdAt: "2026-03-14T10:30:00.000Z",
    updatedAt: "2026-03-14T10:30:10.000Z",
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
    summary: "Implement initiative release hardening",
    inputs: {
      userPrompt: "Implement initiative release hardening",
      initiativeId: "initiative-deliver",
      initiativeTitle: "Release resilience"
    }
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Spec\n\nImplement initiative release hardening.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "spec.md"), "# Spec\n\nImplement initiative release hardening.\n", "utf8");

  return runId;
}

async function initGitRepo(repoDir: string): Promise<{ remoteDir: string }> {
  const remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-deliver-remote-"));
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

describe("runDeliver", () => {
  let repoDir: string;
  let remoteDir: string;

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
        "allowDirty = false",
        'verificationCommands = ["node -e \\"process.stdout.write(\'deliver verify ok\')\\""]',
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

    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "build.md"), "# test build prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "deliver.md"), "# test deliver prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# repo spec\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"), "# repo research\n", "utf8");
    const initialized = await initGitRepo(repoDir);
    remoteDir = initialized.remoteDir;
  });

  afterEach(async () => {
    delete process.env.FAKE_CODEX_FAIL_BUILD;
    delete process.env.FAKE_CODEX_DELAY_MS;
    delete process.env.FAKE_CODEX_VALIDATION_COMMAND;
    delete process.env.FAKE_CODEX_VALIDATION_STATUS;
    delete process.env.CSTACK_FORCE_CLONE_FALLBACK;
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.rm(remoteDir, { recursive: true, force: true });
  });

  async function writeGitHubFixture(fixture: unknown): Promise<void> {
    await fs.writeFile(path.join(repoDir, ".cstack", "test-gh.json"), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }

  it("creates a merge-ready deliver run with GitHub delivery evidence", async () => {
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
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
    await fs.writeFile(path.join(repoDir, "src-change.txt"), "deliver change\n", "utf8");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runDeliver(repoDir, ["Implement SSO with audit logging and release pipeline hardening for #123"]);

      const runs = await listRuns(repoDir);
      expect(runs).toHaveLength(1);

      const run = await readRun(repoDir, runs[0]!.id);
      const runDir = path.dirname(run.finalPath);
      const executionContext = JSON.parse(await fs.readFile(path.join(runDir, "execution-context.json"), "utf8")) as {
        source: { dirtyFiles: string[]; localChangesIgnored: boolean; cwd: string };
        execution: { kind: string; cwd: string };
      };
      const lineage = JSON.parse(await fs.readFile(path.join(runDir, "stage-lineage.json"), "utf8")) as StageLineage;
      const reviewVerdict = JSON.parse(await fs.readFile(path.join(runDir, "stages", "review", "artifacts", "verdict.json"), "utf8")) as {
        status: string;
      };
      const validationPlan = JSON.parse(await fs.readFile(path.join(runDir, "stages", "validation", "validation-plan.json"), "utf8")) as {
        status: string;
        outcomeCategory: string;
        ciValidation: { jobs: Array<{ name: string }> };
      };
      const localValidation = JSON.parse(
        await fs.readFile(path.join(runDir, "stages", "validation", "artifacts", "local-validation.json"), "utf8")
      ) as { status: string };
      const shipRecord = JSON.parse(await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "ship-record.json"), "utf8")) as {
        readiness: string;
      };
      const session = JSON.parse(await fs.readFile(path.join(runDir, "stages", "build", "session.json"), "utf8")) as {
        mode: string;
      };
      const verification = JSON.parse(
        await fs.readFile(path.join(runDir, "stages", "build", "artifacts", "verification.json"), "utf8")
      ) as { status: string };
      const githubMutation = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-mutation.json"), "utf8")) as {
        branch: { current: string; created: boolean; pushed: boolean };
        commit: { created: boolean; sha?: string; changedFiles: string[] };
        pullRequest: { created: boolean; url?: string; number?: number };
        checks: { watched: boolean; completed: boolean };
      };
      const githubDelivery = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-delivery.json"), "utf8")) as {
        pullRequest: { status: string; required: boolean };
        issues: { status: string; required: boolean };
        checks: { status: string; required: boolean; observed: Array<{ name: string; conclusion: string }> };
        actions: { status: string; required: boolean };
        security: { status: string; required: boolean };
        overall: { status: string };
        issueReferences: number[];
      };
      const postShipEvidence = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "post-ship-evidence.json"), "utf8")) as {
        status: string;
        followUpRequired: boolean;
      };
      const postShipEvidenceStage = JSON.parse(
        await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "post-ship-evidence.json"), "utf8")
      ) as { status: string };
      const followUpLineage = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "follow-up-lineage.json"), "utf8")) as {
        status: string;
        recommendedDrafts: Array<{ title: string }>;
      };
      const finalBody = await fs.readFile(run.finalPath, "utf8");
      const deliveryReport = await fs.readFile(path.join(runDir, "artifacts", "delivery-report.md"), "utf8");
      const mutationArtifact = await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "github-mutation.json"), "utf8");
      const checksArtifact = await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "checks.json"), "utf8");
      const actionsArtifact = await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "actions.json"), "utf8");
      const postShipSummary = await fs.readFile(path.join(runDir, "artifacts", "post-ship-summary.md"), "utf8");
      const postShipDraft = await fs.readFile(path.join(runDir, "artifacts", "follow-up-draft.md"), "utf8");
      const postShipFollowUp = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "follow-up-lineage.json"), "utf8")) as {
        status: string;
      };
      const remoteHeads = await execFileAsync("git", ["--git-dir", remoteDir, "for-each-ref", "--format=%(refname:short)", "refs/heads"]);
      const consoleOutput = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(run.workflow).toBe("deliver");
      expect(run.status).toBe("completed");
      expect(run.inputs.requestedMode).toBe("interactive");
      expect(run.inputs.observedMode).toBe("exec");
      expect(executionContext.execution.kind).toBe("git-worktree");
      expect(executionContext.source.cwd).toBe(repoDir);
      expect(executionContext.execution.cwd).not.toBe(repoDir);
      expect(executionContext.source.dirtyFiles).toContain("src-change.txt");
      expect(executionContext.source.localChangesIgnored).toBe(true);
      expect(run.inputs.selectedSpecialists?.length).toBeGreaterThan(0);
      expect(lineage.stages.map((stage) => stage.name)).toEqual(["build", "validation", "review", "ship"]);
      expect(lineage.stages.every((stage) => stage.executed)).toBe(true);
      expect(validationPlan.status).toBe("ready");
      expect(validationPlan.outcomeCategory).toBe("ready");
      expect(localValidation.status).toBe("passed");
      expect(validationPlan.ciValidation.jobs.map((job) => job.name)).toContain("validation");
      expect(reviewVerdict.status).toBe("ready");
      expect(shipRecord.readiness).toBe("ready");
      expect(session.mode).toBe("exec");
      expect(verification.status).toBe("passed");
      expect(githubMutation.branch.created).toBe(true);
      expect(githubMutation.branch.pushed).toBe(true);
      expect(githubMutation.branch.current).toContain("cstack/");
      expect(githubMutation.commit.created).toBe(true);
      expect(githubMutation.commit.sha).toBeTruthy();
      expect(postShipEvidence.status).toBe("stable");
      expect(postShipEvidence.followUpRequired).toBe(false);
      expect(postShipEvidenceStage.status).toBe("stable");
      expect(followUpLineage.status).toBe("none");
      expect(followUpLineage.recommendedDrafts).toHaveLength(0);
      expect(githubMutation.commit.changedFiles).toContain("codex-generated-change.txt");
      expect(githubMutation.commit.changedFiles).not.toContain("src-change.txt");
      expect(githubMutation.pullRequest.created).toBe(true);
      expect(githubMutation.pullRequest.url).toContain("/pull/");
      expect(githubMutation.checks.watched).toBe(true);
      expect(githubDelivery.overall.status).toBe("ready");
      expect(githubDelivery.pullRequest).toMatchObject({ status: "ready", required: true });
      expect(githubDelivery.issues).toMatchObject({ status: "ready", required: true });
      expect(githubDelivery.checks.status).toBe("ready");
      expect(githubDelivery.checks.observed.map((check) => check.name)).toEqual(["deliver/test", "deliver/typecheck"]);
      expect(githubDelivery.actions).toMatchObject({ status: "ready", required: true });
      expect(githubDelivery.security).toMatchObject({ status: "ready", required: true });
      expect(githubDelivery.issueReferences).toEqual([123]);
      expect(mutationArtifact).toContain("\"created\": true");
      expect(checksArtifact).toContain("\"status\": \"ready\"");
      expect(actionsArtifact).toContain("\"workflowName\": \"Release\"");
      expect(remoteHeads.stdout).toContain(githubMutation.branch.current);
      expect(finalBody).toContain("# Deliver Run Summary");
      expect(deliveryReport).toContain("# Deliver Run Summary");
      expect(postShipSummary).toContain("Post-Ship Summary");
      expect(postShipEvidence.status).toBe("stable");
      expect(postShipFollowUp.status).toBe("none");
      expect(postShipDraft).toContain("No follow-up draft is required");
      expect(consoleOutput).toContain("Workflow: deliver");
      expect(consoleOutput).toContain("Execution checkout: git-worktree @");
      expect(consoleOutput).toContain("Validation: ready (ready)");
      expect(consoleOutput).toContain("GitHub mutation:");
    expect(consoleOutput).toContain("Review verdict: ready");
    } finally {
      stdoutSpy.mockRestore();
    }
  }, 15_000);

  it("does not mark deliver complete when validation is partial", async () => {
    process.env.FAKE_CODEX_VALIDATION_STATUS = "partial";
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      createdPullRequest: {
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN"
      },
      issues: [],
      prChecks: [
        { name: "deliver/test", bucket: "pass", state: "completed", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/20" },
        { name: "deliver/typecheck", bucket: "pass", state: "completed", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/21" }
      ],
      actions: [
        { databaseId: 4, workflowName: "Release", status: "completed", conclusion: "success", url: "https://github.com/ganesh47/cstack/actions/runs/4" }
      ],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });

    await runDeliver(repoDir, ["Deliver a bounded slice with partial validation"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const lineage = JSON.parse(await fs.readFile(path.join(runDir, "stage-lineage.json"), "utf8")) as StageLineage;
    const validationPlan = JSON.parse(await fs.readFile(path.join(runDir, "stages", "validation", "validation-plan.json"), "utf8")) as {
      status: string;
      outcomeCategory: string;
    };

    expect(run.workflow).toBe("deliver");
    expect(run.status).toBe("failed");
    expect(validationPlan.status).toBe("partial");
    expect(validationPlan.outcomeCategory).toBe("partial");
    expect(lineage.stages.find((stage) => stage.name === "validation")?.status).toBe("deferred");
  }, 20_000);

  it("classifies registry blockers from local validation commands", async () => {
    process.env.FAKE_CODEX_VALIDATION_COMMAND =
      "node -e \"process.stderr.write('npm ERR! request to https://registry.npmjs.org failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org\\n'); process.exit(1)\"";
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      createdPullRequest: {
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN"
      },
      issues: [
        {
          number: 321,
          title: "Validation registry issue",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/321",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [],
      actions: [],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });

    await runDeliver(repoDir, ["Implement release hardening for #321"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const localValidation = JSON.parse(
      await fs.readFile(path.join(runDir, "stages", "validation", "artifacts", "local-validation.json"), "utf8")
    ) as { blockerCategories?: string[] };
    const coverageSummary = JSON.parse(
      await fs.readFile(path.join(runDir, "stages", "validation", "artifacts", "coverage-summary.json"), "utf8")
    ) as { gaps: string[]; outcomeCategory: string };

    expect(run.status).toBe("failed");
    expect(localValidation.blockerCategories).toContain("registry-unreachable");
    expect(coverageSummary.outcomeCategory).toBe("blocked-by-validation");
    expect(coverageSummary.gaps.join("\n")).toContain("registry-unreachable");
  }, 20_000);

  it("classifies repo test failures from local validation commands separately from environment blockers", async () => {
    process.env.FAKE_CODEX_VALIDATION_COMMAND =
      "node -e \"process.stderr.write('AssertionError: expected response status 200\\n'); process.exit(1)\" # test";
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      createdPullRequest: {
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN"
      },
      issues: [
        {
          number: 322,
          title: "Validation repo failure",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/322",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [],
      actions: [],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });

    await runDeliver(repoDir, ["Implement release hardening for #322"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const localValidation = JSON.parse(
      await fs.readFile(path.join(runDir, "stages", "validation", "artifacts", "local-validation.json"), "utf8")
    ) as { blockerCategories?: string[] };
    const validationPlan = JSON.parse(
      await fs.readFile(path.join(runDir, "stages", "validation", "validation-plan.json"), "utf8")
    ) as { outcomeCategory: string };

    expect(run.status).toBe("failed");
    expect(localValidation.blockerCategories).toContain("repo-test-failure");
    expect(localValidation.blockerCategories).not.toContain("registry-unreachable");
    expect(validationPlan.outcomeCategory).toBe("blocked-by-validation");
  }, 20_000);

  it("creates a release-bearing deliver run when release evidence exists", async () => {
    const upstreamRunId = await seedSpecRun(repoDir);
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
        { databaseId: 2, workflowName: "Release", status: "completed", conclusion: "success", url: "https://github.com/ganesh47/cstack/actions/runs/2" }
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
    const githubMutation = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-mutation.json"), "utf8")) as {
      pullRequest: { created: boolean; updated: boolean; url?: string };
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
    expect(githubMutation.pullRequest.updated).toBe(true);
    expect(githubMutation.pullRequest.url).toContain("/pull/");
    expect(githubDelivery.mode).toBe("release");
    expect(githubDelivery.release).toMatchObject({ status: "ready", required: true });
    expect(githubDelivery.release.observed?.tagName).toBe("v1.2.3");
    expect(githubDelivery.actions.status).toBe("ready");
    expect(releaseArtifact).toContain("\"tagName\": \"v1.2.3\"");
    expect(promptBody).toContain("review specialists");
  }, 15_000);

  it("inherits and overrides initiative metadata", async () => {
    const upstreamRunId = await seedInitiativeSpecRun(repoDir);
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      createdPullRequest: {
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN"
      },
      issues: [
        {
          number: 789,
          title: "Review initiative issue",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/789",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [
        { name: "deliver/test", bucket: "pass", state: "completed", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/40" },
        { name: "deliver/typecheck", bucket: "pass", state: "completed", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/41" }
      ],
      actions: [
        { databaseId: 7, workflowName: "Release", status: "completed", conclusion: "success", url: "https://github.com/ganesh47/cstack/actions/runs/7" }
      ],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });

    const inheritedRunId = await runDeliver(repoDir, ["--from-run", upstreamRunId, "Run deliver with inherited initiative"]);
    const inheritedRun = await readRun(repoDir, inheritedRunId);
    expect(inheritedRun.inputs.initiativeId).toBe("initiative-deliver");
    expect(inheritedRun.inputs.initiativeTitle).toBe("Release resilience");

    const overrideRunId = await runDeliver(repoDir, [
      "--from-run",
      upstreamRunId,
      "--initiative",
      "initiative-deliver-override",
      "--initiative-title",
      "Override deliver initiative",
      "Run deliver with initiative override"
    ]);
    const overrideRun = await readRun(repoDir, overrideRunId);

    expect(overrideRun.inputs.initiativeId).toBe("initiative-deliver-override");
    expect(overrideRun.inputs.initiativeTitle).toBe("Override deliver initiative");
    expect(inheritedRun.id).not.toBe(overrideRun.id);
  }, 20_000);

  it("fails deliver when required GitHub security or checks are blocked", async () => {
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      createdPullRequest: {
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN"
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
        { databaseId: 3, workflowName: "Release", status: "completed", conclusion: "success", url: "https://github.com/ganesh47/cstack/actions/runs/3" }
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
    const readinessPolicy = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "readiness-policy.json"), "utf8")) as {
      classifiedBlockers: Array<{ category: string; requirement: string }>;
      postReadinessSummary: { headline: string; blockers: string[] };
    };
    const deploymentEvidence = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "deployment-evidence.json"), "utf8")) as {
      status: string;
      blockers: string[];
    };
    const githubMutation = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-mutation.json"), "utf8")) as {
      pullRequest: { created: boolean; url?: string };
    };
    const securityArtifact = await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "security.json"), "utf8");

    expect(run.status).toBe("failed");
    expect(githubMutation.pullRequest.created).toBe(true);
    expect(githubMutation.pullRequest.url).toContain("/pull/");
    expect(shipRecord.readiness).toBe("blocked");
    expect(githubDelivery.checks.status).toBe("blocked");
    expect(githubDelivery.security.status).toBe("blocked");
    expect(githubDelivery.checks.blockers.join("\n")).toContain("Required check deliver/test");
    expect(githubDelivery.security.blockers.join("\n")).toContain("Dependabot alert");
    expect(githubDelivery.overall.status).toBe("blocked");
    expect(githubDelivery.overall.blockers.join("\n")).toContain("Dependabot alert");
    expect(githubDelivery.overall.blockers.join("\n")).toContain("Required check deliver/test");
    expect(shipRecord.unresolved.join("\n")).toContain("Dependabot alert");
    expect(readinessPolicy.classifiedBlockers.map((entry) => entry.category)).toContain("github-delivery");
    expect(readinessPolicy.postReadinessSummary.headline).toContain("blocked");
    expect(readinessPolicy.postReadinessSummary.blockers.join("\n")).toContain("github-delivery:");
    expect(deploymentEvidence.status).toBe("recorded");
    expect(securityArtifact).toContain("\"severity\": \"high\"");
  }, 15_000);

  it("stops after a failed build and marks downstream stages as deferred", async () => {
    process.env.FAKE_CODEX_FAIL_BUILD = "1";

    await runDeliver(repoDir, ["Deliver a build failure fixture"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const lineage = JSON.parse(await fs.readFile(path.join(runDir, "stage-lineage.json"), "utf8")) as StageLineage;
    const validationPlan = JSON.parse(await fs.readFile(path.join(runDir, "stages", "validation", "validation-plan.json"), "utf8")) as {
      status: string;
      outcomeCategory: string;
      summary: string;
    };
    const reviewVerdict = JSON.parse(await fs.readFile(path.join(runDir, "stages", "review", "artifacts", "verdict.json"), "utf8")) as {
      status: string;
      summary: string;
    };
    const postShipEvidence = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "post-ship-evidence.json"), "utf8")) as {
      status: string;
      followUpRequired: boolean;
      inferredRecommendations: string[];
    };
    const followUpLineage = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "follow-up-lineage.json"), "utf8")) as {
      status: string;
      recommendedDrafts: Array<{ title: string }>;
    };
    const shipRecord = JSON.parse(await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "ship-record.json"), "utf8")) as {
      readiness: string;
      summary: string;
    };
    const diagnosis = JSON.parse(await fs.readFile(path.join(runDir, "stages", "build", "artifacts", "failure-diagnosis.json"), "utf8")) as {
      summary: string;
      category: string;
    };

    expect(run.status).toBe("failed");
    expect(run.error).toContain("Build failed after Codex started work");
    expect(run.lastActivity).toContain("Build failed after Codex started work");
    expect(lineage.stages.find((stage) => stage.name === "build")).toMatchObject({ status: "failed", executed: true });
    expect(lineage.stages.find((stage) => stage.name === "validation")).toMatchObject({ status: "deferred", executed: false });
    expect(lineage.stages.find((stage) => stage.name === "review")).toMatchObject({ status: "deferred", executed: false });
    expect(lineage.stages.find((stage) => stage.name === "ship")).toMatchObject({ status: "deferred", executed: false });
    expect(validationPlan.status).toBe("blocked");
    expect(validationPlan.outcomeCategory).toBe("blocked-by-build");
    expect(validationPlan.summary).toContain("Build failed after Codex started work");
    expect(reviewVerdict.status).toBe("blocked");
    expect(reviewVerdict.summary).toContain("Build failed after Codex started work");
    expect(postShipEvidence.status).toBe("follow-up-required");
    expect(postShipEvidence.followUpRequired).toBe(true);
    expect(postShipEvidence.inferredRecommendations.length).toBeGreaterThan(0);
    expect(followUpLineage.status).toBe("recommended");
    expect(followUpLineage.recommendedDrafts.length).toBeGreaterThan(0);
    expect(shipRecord.readiness).toBe("blocked");
    expect(shipRecord.summary).toContain("Build failed after Codex started work");
    expect(diagnosis.category).toBe("build-script-failure");
  }, 15_000);

  it("times out the build stage and blocks downstream stages", async () => {
    process.env.FAKE_CODEX_DELAY_MS = "1500";
    const configPath = path.join(repoDir, ".cstack", "config.toml");
    const configBody = await fs.readFile(configPath, "utf8");
    await fs.writeFile(
      configPath,
      configBody.replace(
        '[workflows.build]\nmode = "interactive"',
        '[workflows.build]\nmode = "interactive"\ntimeoutSeconds = 1'
      ) + '\n[workflows.deliver.stageTimeoutSeconds]\nbuild = 1\n',
      "utf8"
    );

    await runDeliver(repoDir, ["Deliver a timed out build fixture"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const session = JSON.parse(await fs.readFile(path.join(runDir, "stages", "build", "session.json"), "utf8")) as {
      observability: { timedOut?: boolean; timeoutSeconds?: number };
    };
    const lineage = JSON.parse(await fs.readFile(path.join(runDir, "stage-lineage.json"), "utf8")) as StageLineage;

    expect(run.status).toBe("failed");
    expect(run.error).toContain("timed out after 1s");
    expect(session.observability.timedOut).toBe(true);
    expect(session.observability.timeoutSeconds).toBe(1);
    expect(lineage.stages.find((stage) => stage.name === "build")?.status).toBe("failed");
    expect(lineage.stages.find((stage) => stage.name === "validation")?.status).toBe("deferred");
  }, 15_000);

  it("fails deliver when pull request creation fails", async () => {
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      prCreateError: "simulated PR create failure",
      issues: [
        {
          number: 901,
          title: "PR failure issue",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/901",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [],
      actions: [],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });
    await runDeliver(repoDir, ["Deliver a fix that will fail PR creation for #901"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const githubMutation = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-mutation.json"), "utf8")) as {
      pullRequest: { created: boolean; updated: boolean };
      blockers: string[];
      summary: string;
    };
    const githubDelivery = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-delivery.json"), "utf8")) as {
      overall: { status: string; blockers: string[] };
      pullRequest: { status: string };
    };

    expect(run.status).toBe("failed");
    expect(githubMutation.pullRequest.created).toBe(false);
    expect(githubMutation.pullRequest.updated).toBe(false);
    expect(githubMutation.summary).toContain("GitHub failed while creating or updating the pull request.");
    expect(githubMutation.blockers.join("\n")).toContain("simulated PR create failure");
    expect(githubDelivery.pullRequest.status).toBe("blocked");
    expect(githubDelivery.overall.status).toBe("blocked");
    expect(githubDelivery.overall.blockers.join("\n")).toContain("GitHub failed while creating or updating the pull request.");
    expect(githubDelivery.overall.blockers.join("\n")).toContain("simulated PR create failure");
  }, 15_000);

  it("classifies GitHub authentication failures during pull request creation", async () => {
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      prCreateError: "HTTP 401: authentication required. Run gh auth login.",
      issues: [
        {
          number: 902,
          title: "Auth failure issue",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/902",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [],
      actions: [],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });

    await runDeliver(repoDir, ["Deliver a fix that will hit GitHub auth failure for #902"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const githubMutation = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-mutation.json"), "utf8")) as {
      blockers: string[];
      summary: string;
    };

    expect(run.status).toBe("failed");
    expect(githubMutation.summary).toContain("GitHub authentication failed while creating or updating the pull request.");
    expect(githubMutation.blockers.join("\n")).toContain("Run gh auth login");
  }, 15_000);

  it("classifies GitHub connectivity failures during required check inspection", async () => {
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      createdPullRequest: {
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN"
      },
      issues: [
        {
          number: 903,
          title: "Checks connectivity issue",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/903",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecksError: "network timeout contacting api.github.com",
      actions: [
        { databaseId: 1, workflowName: "Release", status: "completed", conclusion: "success", url: "https://github.com/ganesh47/cstack/actions/runs/1" }
      ],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });

    await runDeliver(repoDir, ["Deliver a fix that will hit required-check network failure for #903"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const githubDelivery = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-delivery.json"), "utf8")) as {
      checks: { status: string; summary: string; error?: string };
      overall: { status: string; blockers: string[] };
    };

    expect(run.status).toBe("failed");
    expect(githubDelivery.checks.status).toBe("blocked");
    expect(githubDelivery.checks.summary).toContain("GitHub connectivity failed while inspecting required checks.");
    expect(githubDelivery.checks.error).toContain("network timeout contacting api.github.com");
    expect(githubDelivery.overall.status).toBe("blocked");
    expect(githubDelivery.overall.blockers.join("\n")).toContain("GitHub connectivity failed while inspecting required checks.");
  }, 15_000);

  it("classifies git push rejection during deliver mutations", async () => {
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      createdPullRequest: {
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN"
      },
      issues: [
        {
          number: 904,
          title: "Push rejection issue",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/904",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [],
      actions: [],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });

    const hookPath = path.join(remoteDir, "hooks", "pre-receive");
    await fs.writeFile(
      hookPath,
      "#!/bin/sh\n" +
        "echo 'remote rejected: protected branch hook declined' >&2\n" +
        "exit 1\n",
      "utf8"
    );
    chmodSync(hookPath, 0o755);

    await runDeliver(repoDir, ["Deliver a fix that will hit git push rejection for #904"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const githubMutation = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-mutation.json"), "utf8")) as {
      summary: string;
      blockers: string[];
      branch: { pushed: boolean };
    };

    expect(run.status).toBe("failed");
    expect(githubMutation.branch.pushed).toBe(false);
    expect(githubMutation.summary).toContain("Git rejected the push while pushing branch");
    expect(githubMutation.blockers.join("\n")).toContain("protected branch hook declined");
  }, 15_000);

  it("classifies GitHub pull request update conflicts", async () => {
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      pullRequest: {
        number: 44,
        title: "Existing PR",
        state: "OPEN",
        isDraft: false,
        reviewDecision: "APPROVED",
        url: "https://github.com/ganesh47/cstack/pull/44",
        headRefName: "cstack/existing-branch",
        baseRefName: "main",
        mergeStateStatus: "CLEAN"
      },
      prEditError: "GraphQL: Update failed because the pull request was modified concurrently",
      issues: [
        {
          number: 905,
          title: "PR conflict issue",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/905",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [],
      actions: [],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });

    await runDeliver(repoDir, ["Deliver a fix that will hit PR update conflict for #905"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const githubMutation = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-mutation.json"), "utf8")) as {
      summary: string;
      blockers: string[];
    };

    expect(run.status).toBe("failed");
    expect(githubMutation.summary).toContain("GitHub failed while creating or updating the pull request.");
    expect(githubMutation.blockers.join("\n")).toContain("modified concurrently");
  }, 15_000);

  it("fails closed when the default branch cannot be resolved for PR mutation", async () => {
    await writeGitHubFixture({
      repoApiError: "HTTP 403: resource not accessible while resolving default branch",
      issues: [
        {
          number: 906,
          title: "Default branch discovery issue",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/906",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [],
      actions: [],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });

    await fs.writeFile(path.join(repoDir, "delivery-change.txt"), "deliver change\n", "utf8");

    const result = await performGitHubDeliverMutations({
      cwd: repoDir,
      gitBranch: "main",
      runId: "test-default-branch",
      input: "Deliver a fix that will hit default branch discovery failure for #906",
      issueNumbers: [906],
      policy: {
        enabled: true,
        command: path.resolve("test/fixtures/fake-gh.mjs"),
        repository: "ganesh47/cstack",
        pushBranch: true,
        branchPrefix: "cstack",
        commitChanges: true,
        createPullRequest: true,
        updatePullRequest: true,
        watchChecks: true,
        checkWatchTimeoutSeconds: 1,
        checkWatchPollSeconds: 0
      },
      buildSummary: "Build completed.",
      reviewVerdict: {
        mode: "readiness",
        status: "ready",
        summary: "Ready",
        findings: [],
        recommendedActions: [],
        acceptedSpecialists: [],
        reportMarkdown: "# Review\n"
      },
      verificationRecord: {},
      pullRequestBodyPath: path.join(repoDir, ".cstack", "pr-body.md")
    });

    expect(result.record.summary).toContain("GitHub authentication failed while resolving the repository default branch.");
    expect(result.record.blockers.join("\n")).toContain("resource not accessible");
    expect(result.record.branch.created).toBe(true);
    expect(result.record.pullRequest.created).toBe(false);
  }, 15_000);

  it("surfaces required-check watch timeouts as GitHub mutation blockers", async () => {
    await writeGitHubFixture({
      repoView: {
        nameWithOwner: "ganesh47/cstack",
        defaultBranchRef: { name: "main" }
      },
      createdPullRequest: {
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN"
      },
      issues: [
        {
          number: 907,
          title: "Checks timeout issue",
          state: "CLOSED",
          url: "https://github.com/ganesh47/cstack/issues/907",
          closedAt: "2026-03-14T00:00:00.000Z"
        }
      ],
      prChecks: [
        { name: "deliver/test", bucket: "pending", state: "queued", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/10" },
        { name: "deliver/typecheck", bucket: "pending", state: "in_progress", workflow: "CI", link: "https://github.com/ganesh47/cstack/actions/runs/11" }
      ],
      actions: [
        { databaseId: 1, workflowName: "Release", status: "completed", conclusion: "success", url: "https://github.com/ganesh47/cstack/actions/runs/1" }
      ],
      security: {
        dependabot: [],
        codeScanning: []
      }
    });

    await runDeliver(repoDir, ["Deliver a fix that will hit required-check watch timeout for #907"]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const githubMutation = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "github-mutation.json"), "utf8")) as {
      summary: string;
      blockers: string[];
      checks: { watched: boolean; completed: boolean; summary: string };
    };

    expect(run.status).toBe("failed");
    expect(githubMutation.checks.watched).toBe(true);
    expect(githubMutation.checks.completed).toBe(false);
    expect(githubMutation.checks.summary).toContain("Timed out while waiting for required checks.");
    expect(githubMutation.summary).toContain("Timed out while waiting for required checks.");
    expect(githubMutation.blockers.join("\n")).toContain("Waiting for 2 required checks.");
  }, 15_000);
});
