#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "cstack.js");
const fakeCodexPath = path.join(repoRoot, "test", "fixtures", "fake-codex.mjs");
const fakeGhPath = path.join(repoRoot, "test", "fixtures", "fake-gh.mjs");
const distInspectorPath = path.join(repoRoot, "dist", "inspector.js");

chmodSync(fakeCodexPath, 0o755);
chmodSync(fakeGhPath, 0o755);

function normalizeRunId(runId) {
  return runId.replace(/[:.]/g, "-");
}

async function runCommand(command, args, options) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(options.env ?? {})
    },
    maxBuffer: 20 * 1024 * 1024
  });
}

async function runCli(cwd, args, env) {
  return runCommand(process.execPath, [cliPath, ...args], { cwd, env });
}

async function runGit(cwd, args) {
  return runCommand("git", args, { cwd });
}

async function initGitRepo(repoDir) {
  const remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-ci-e2e-remote-"));
  await runGit(repoDir, ["init", "--bare", remoteDir]);
  await runGit(repoDir, ["init", "-b", "main"]);
  await runGit(repoDir, ["config", "user.name", "cstack ci"]);
  await runGit(repoDir, ["config", "user.email", "cstack-ci@example.com"]);
  await runGit(repoDir, ["config", "commit.gpgSign", "false"]);
  await runGit(repoDir, ["remote", "add", "origin", remoteDir]);
  await runGit(repoDir, ["add", "."]);
  await runGit(repoDir, ["commit", "-m", "fixture repo"]);
  await runGit(repoDir, ["push", "-u", "origin", "main"]);
  return remoteDir;
}

async function readRuns(repoDir) {
  const runsDir = path.join(repoDir, ".cstack", "runs");
  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runPath = path.join(runsDir, entry.name, "run.json");
    try {
      const body = await fs.readFile(runPath, "utf8");
      runs.push(JSON.parse(body));
    } catch (error) {
      if ((error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        continue;
      }
      throw error;
    }
  }
  runs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return runs;
}

async function latestRun(repoDir, workflow, excludeIds = new Set()) {
  const runs = await readRuns(repoDir);
  const matches = runs.filter((run) => run.workflow === workflow && !excludeIds.has(run.id));
  return matches.at(-1) ?? null;
}

async function readRun(repoDir, runId) {
  const runPath = path.join(repoDir, ".cstack", "runs", normalizeRunId(runId), "run.json");
  const body = await fs.readFile(runPath, "utf8");
  return JSON.parse(body);
}

async function ensureFixtureRepo(repoDir) {
  await fs.mkdir(path.join(repoDir, ".cstack", "prompts"), { recursive: true });
  await fs.mkdir(path.join(repoDir, ".cstack", "runs"), { recursive: true });
  await fs.mkdir(path.join(repoDir, "docs", "specs"), { recursive: true });
  await fs.mkdir(path.join(repoDir, "docs", "research"), { recursive: true });
  await fs.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fs.mkdir(path.join(repoDir, "docs"), { recursive: true });

  await fs.writeFile(
    path.join(repoDir, ".gitignore"),
    [".cstack/runs/", ".cstack/test-gh-state.json", "node_modules/", ""].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(repoDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cstack-e2e-fixture",
        version: "1.2.3",
        private: true
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await fs.writeFile(path.join(repoDir, "README.md"), "# Fixture Repo\n\nUsed for cstack deterministic CI.\n", "utf8");
  await fs.writeFile(path.join(repoDir, "src", "index.ts"), "export const fixture = true;\n", "utf8");
  await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# fixture spec\n", "utf8");
  await fs.writeFile(path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"), "# fixture research\n", "utf8");
  await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "build.md"), "# build prompt asset\n", "utf8");
  await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "deliver.md"), "# deliver prompt asset\n", "utf8");
  await fs.writeFile(
    path.join(repoDir, ".cstack", "test-gh.json"),
    `${JSON.stringify(
      {
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
          {
            name: "deliver/test",
            bucket: "pass",
            state: "completed",
            workflow: "CI",
            link: "https://github.com/ganesh47/cstack/actions/runs/10"
          },
          {
            name: "deliver/typecheck",
            bucket: "pass",
            state: "completed",
            workflow: "CI",
            link: "https://github.com/ganesh47/cstack/actions/runs/11"
          }
        ],
        actions: [
          {
            databaseId: 1,
            workflowName: "CI",
            status: "completed",
            conclusion: "success",
            url: "https://github.com/ganesh47/cstack/actions/runs/1"
          }
        ],
        security: {
          dependabot: [],
          codeScanning: []
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await fs.writeFile(
    path.join(repoDir, ".cstack", "config.toml"),
    [
      "[codex]",
      `command = "${fakeCodexPath.replaceAll("\\", "\\\\")}"`,
      'sandbox = "workspace-write"',
      "",
      "[workflows.build]",
      'mode = "interactive"',
      'verificationCommands = ["node -e \\"process.stdout.write(\'build verify ok\')\\""]',
      "",
      "[workflows.review]",
      'verificationCommands = ["node -e \\"process.stdout.write(\'review verify ok\')\\""]',
      "",
      "[workflows.ship]",
      "allowDirty = true",
      "",
      "[workflows.deliver]",
      'mode = "interactive"',
      "allowDirty = true",
      'verificationCommands = ["node -e \\"process.stdout.write(\'deliver verify ok\')\\""]',
      "",
      "[workflows.deliver.github]",
      "enabled = true",
      `command = "${fakeGhPath.replaceAll("\\", "\\\\")}"`,
      'repository = "ganesh47/cstack"',
      "pushBranch = true",
      'branchPrefix = "cstack"',
      "commitChanges = true",
      "createPullRequest = true",
      "updatePullRequest = true",
      'pullRequestBase = "main"',
      "watchChecks = true",
      "checkWatchTimeoutSeconds = 1",
      "checkWatchPollSeconds = 0",
      "prRequired = true",
      "requireApprovedReview = true",
      "linkedIssuesRequired = true",
      'requiredIssueState = "closed"',
      'requiredChecks = ["deliver/test", "deliver/typecheck"]',
      'requiredWorkflows = ["CI"]',
      "",
      "[workflows.deliver.github.security]",
      "requireDependabot = true",
      "requireCodeScanning = true",
      'blockSeverities = ["high", "critical"]',
      ""
    ].join("\n"),
    "utf8"
  );
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-ci-e2e-"));
  const repoDir = path.join(tempRoot, "fixture");
  await fs.mkdir(repoDir, { recursive: true });
  let remoteDir = null;

  try {
    await ensureFixtureRepo(repoDir);
    remoteDir = await initGitRepo(repoDir);

    const summary = {
      tempRoot,
      repoDir,
      runs: {},
      outputs: {}
    };

    await runCli(repoDir, ["discover", "Map the fixture repo command and artifact surface."]);
    const discoverRun = await latestRun(repoDir, "discover");
    assert(discoverRun, "discover run was not created");
    assert.equal(discoverRun.status, "completed");
    summary.runs.discover = discoverRun.id;

    await runCli(repoDir, ["spec", "--from-run", discoverRun.id]);
    const specRun = await latestRun(repoDir, "spec");
    assert(specRun, "spec run was not created");
    assert.equal(specRun.status, "completed");
    summary.runs.spec = specRun.id;

    await runCli(repoDir, ["build", "--from-run", specRun.id, "--exec"]);
    const buildRun = await latestRun(repoDir, "build");
    assert(buildRun, "build run was not created");
    assert.equal(buildRun.status, "completed");
    summary.runs.build = buildRun.id;

    const resumeResult = await runCli(repoDir, ["resume", buildRun.id]);
    assert.match(resumeResult.stdout, /resumed session fake-session-123/);
    summary.outputs.resume = resumeResult.stdout.trim();

    const forkResult = await runCli(repoDir, ["fork", buildRun.id, "--workflow", "build"]);
    assert.match(forkResult.stdout, /forked session fake-session-123/);
    summary.outputs.fork = forkResult.stdout.trim();

    await runCli(repoDir, ["review", "--from-run", buildRun.id, "Review the fixture repo build output."]);
    const reviewRun = await latestRun(repoDir, "review");
    assert(reviewRun, "review run was not created");
    assert.equal(reviewRun.status, "completed");
    summary.runs.review = reviewRun.id;

    await fs.writeFile(path.join(repoDir, "ship-change.txt"), "ship change\n", "utf8");
    await runCli(repoDir, ["ship", "--from-run", reviewRun.id, "--issue", "123", "--allow-dirty", "Ship the fixture repo change."]);
    const shipRun = await latestRun(repoDir, "ship");
    assert(shipRun, "ship run was not created");
    assert.equal(shipRun.status, "completed");
    summary.runs.ship = shipRun.id;

    await fs.writeFile(path.join(repoDir, "deliver-change.txt"), "deliver change\n", "utf8");
    await runCli(repoDir, ["deliver", "--from-run", specRun.id, "--issue", "123", "--allow-dirty"]);
    const deliverRun = await latestRun(repoDir, "deliver");
    assert(deliverRun, "deliver run was not created");
    assert.equal(deliverRun.status, "completed");
    summary.runs.deliver = deliverRun.id;
    const deliverRunDir = path.join(repoDir, ".cstack", "runs", normalizeRunId(deliverRun.id));
    const deliverMutationArtifact = JSON.parse(
      await fs.readFile(path.join(deliverRunDir, "artifacts", "github-mutation.json"), "utf8")
    );
    assert.equal(deliverMutationArtifact.branch.pushed, true);
    assert.equal(deliverMutationArtifact.commit.created, true);
    assert.equal(
      Boolean(deliverMutationArtifact.pullRequest.created || deliverMutationArtifact.pullRequest.updated),
      true
    );
    assert.match(deliverMutationArtifact.pullRequest.url, /\/pull\//);
    const remoteHeads = await runGit(remoteDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
    assert.match(remoteHeads.stdout, new RegExp(deliverMutationArtifact.branch.current.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const intentReviewIds = new Set((await readRuns(repoDir)).filter((run) => run.workflow === "review").map((run) => run.id));
    await runCli(repoDir, ["What are the gaps in the current project?"]);
    const intentReviewRun = await latestRun(repoDir, "intent");
    assert(intentReviewRun, "intent review run was not created");
    assert.equal(intentReviewRun.status, "completed");
    const downstreamReviewRun = await latestRun(repoDir, "review", intentReviewIds);
    assert(downstreamReviewRun, "downstream review child run was not created");
    summary.runs.intentReview = intentReviewRun.id;

    await fs.mkdir(path.join(repoDir, ".cstack", "runs", "local-dirty"), { recursive: true });
    await fs.writeFile(path.join(repoDir, ".cstack", "runs", "local-dirty", "payload.json"), "{}\n", "utf8");
    const { loadRunInspection, executeInspectorCommand } = await import(distInspectorPath);
    const reviewInspection = await loadRunInspection(repoDir, downstreamReviewRun.id);
    const mitigationResponse = await executeInspectorCommand(repoDir, reviewInspection, "mitigate 1");
    assert.match(mitigationResponse.output, /Started mitigation workflow: build/);
    assert.ok(mitigationResponse.switchToRunId, "mitigation did not create a follow-on run");
    const mitigationRun = await readRun(repoDir, mitigationResponse.switchToRunId);
    assert.equal(mitigationRun.workflow, "build");
    assert.equal(mitigationRun.status, "completed");
    assert.equal(mitigationRun.inputs.linkedRunId, downstreamReviewRun.id);
    assert.equal(mitigationRun.inputs.allowDirty, true);
    summary.runs.mitigation = mitigationRun.id;

    await fs.writeFile(path.join(repoDir, "intent-deliver-change.txt"), "intent deliver change\n", "utf8");
    const intentDeliverIds = new Set((await readRuns(repoDir)).filter((run) => run.workflow === "deliver").map((run) => run.id));
    await runCli(repoDir, ["Close the main gaps in this project and prepare delivery for #123"]);
    const intentDeliverRun = await latestRun(repoDir, "intent", new Set([intentReviewRun.id]));
    assert(intentDeliverRun, "intent deliver run was not created");
    assert.equal(intentDeliverRun.status, "completed");
    const downstreamDeliverRun = await latestRun(repoDir, "deliver", intentDeliverIds);
    assert(downstreamDeliverRun, "downstream deliver child run was not created");
    summary.runs.intentDeliver = intentDeliverRun.id;

    await runCli(repoDir, ["rerun", buildRun.id]);
    const buildRuns = (await readRuns(repoDir)).filter((run) => run.workflow === "build");
    assert(buildRuns.length >= 2, "rerun did not create a new build run");
    summary.runs.rerun = buildRuns.at(-1).id;

    const runsResult = await runCli(repoDir, ["runs", "--json"]);
    const runsPayload = JSON.parse(runsResult.stdout);
    assert(Array.isArray(runsPayload) && runsPayload.length >= 9, "runs --json did not return the expected ledger");
    summary.outputs.runsCount = runsPayload.length;

    const inspectResult = await runCli(repoDir, ["inspect", deliverRun.id]);
    assert.match(inspectResult.stdout, /workflow deliver/i);
    assert.match(inspectResult.stdout, /github delivery/i);
    summary.outputs.inspect = inspectResult.stdout.split("\n").slice(0, 8).join("\n");

    const deliverGitHubArtifact = JSON.parse(
      await fs.readFile(path.join(deliverRunDir, "artifacts", "github-delivery.json"), "utf8")
    );
    assert.equal(deliverGitHubArtifact.overall.status, "ready");

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    if (remoteDir) {
      await fs.rm(remoteDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
