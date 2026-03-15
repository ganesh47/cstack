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
const fakeGhPath = path.join(repoRoot, "test", "fixtures", "fake-gh.mjs");
const smokeRepository = process.env.CSTACK_SMOKE_REPO ?? "https://github.com/ganesh47/sqlite-metadata-proposal.git";

chmodSync(fakeGhPath, 0o755);

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

async function readRuns(repoDir) {
  const runsDir = path.join(repoDir, ".cstack", "runs");
  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const body = await fs.readFile(path.join(runsDir, entry.name, "run.json"), "utf8");
    runs.push(JSON.parse(body));
  }
  runs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return runs;
}

async function latestRun(repoDir, workflow) {
  const runs = await readRuns(repoDir);
  return runs.filter((run) => run.workflow === workflow).at(-1) ?? null;
}

async function cloneSmokeRepo(tempRoot) {
  const repoDir = path.join(tempRoot, "sqlite-metadata-proposal");
  await runCommand("git", ["clone", smokeRepository, repoDir], { cwd: tempRoot });
  await runGit(repoDir, ["config", "user.name", "cstack smoke"]);
  await runGit(repoDir, ["config", "user.email", "cstack-smoke@example.com"]);
  await runGit(repoDir, ["config", "commit.gpgSign", "false"]);
  const branch = (await runGit(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim() || "main";
  const remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-live-smoke-remote-"));
  await runGit(repoDir, ["remote", "rename", "origin", "upstream"]);
  await runGit(repoDir, ["init", "--bare", remoteDir]);
  await runGit(repoDir, ["remote", "add", "origin", remoteDir]);
  await runGit(repoDir, ["push", "-u", "origin", branch]);
  return { repoDir, branch, remoteDir };
}

async function configureSmokeRepo(repoDir) {
  await fs.mkdir(path.join(repoDir, ".cstack", "prompts"), { recursive: true });
  await fs.mkdir(path.join(repoDir, "docs", "specs"), { recursive: true });
  await fs.mkdir(path.join(repoDir, "docs", "research"), { recursive: true });

  const gitignorePath = path.join(repoDir, ".gitignore");
  let gitignoreBody = "";
  try {
    gitignoreBody = await fs.readFile(gitignorePath, "utf8");
  } catch {}
  const gitignoreLines = new Set(gitignoreBody.split(/\r?\n/).filter(Boolean));
  gitignoreLines.add(".cstack/runs/");
  gitignoreLines.add(".cstack/test-gh-state.json");
  await fs.writeFile(gitignorePath, `${[...gitignoreLines].join("\n")}\n`, "utf8");

  await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "build.md"), "# smoke build prompt asset\n", "utf8");
  await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "deliver.md"), "# smoke deliver prompt asset\n", "utf8");
  await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# smoke spec context\n", "utf8");
  await fs.writeFile(path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"), "# smoke research\n", "utf8");
  await fs.writeFile(
    path.join(repoDir, ".cstack", "test-gh.json"),
    `${JSON.stringify(
      {
        repoView: {
          nameWithOwner: "ganesh47/sqlite-metadata-proposal",
          defaultBranchRef: { name: "main" }
        },
        createdPullRequest: {
          reviewDecision: "APPROVED",
          mergeStateStatus: "CLEAN"
        },
        issues: [
          {
            number: 123,
            title: "Smoke issue",
            state: "CLOSED",
            url: "https://github.com/ganesh47/sqlite-metadata-proposal/issues/123",
            closedAt: "2026-03-15T00:00:00.000Z"
          }
        ],
        prChecks: [
          {
            name: "deliver/test",
            bucket: "pass",
            state: "completed",
            workflow: "CI",
            link: "https://github.com/ganesh47/sqlite-metadata-proposal/actions/runs/10"
          }
        ],
        actions: [
          {
            databaseId: 1,
            workflowName: "CI",
            status: "completed",
            conclusion: "success",
            url: "https://github.com/ganesh47/sqlite-metadata-proposal/actions/runs/1"
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
      'command = "codex"',
      'sandbox = "workspace-write"',
      "",
      "[workflows.build]",
      'mode = "exec"',
      'verificationCommands = ["node -e \\"process.stdout.write(\'live smoke build verify ok\')\\""]',
      "",
      "[workflows.ship]",
      "allowDirty = true",
      "",
      "[workflows.deliver]",
      'mode = "exec"',
      "allowDirty = true",
      'verificationCommands = ["node -e \\"process.stdout.write(\'live smoke deliver verify ok\')\\""]',
      "",
      "[workflows.deliver.github]",
      "enabled = true",
      `command = "${fakeGhPath.replaceAll("\\", "\\\\")}"`,
      'repository = "ganesh47/sqlite-metadata-proposal"',
      "pushBranch = true",
      'branchPrefix = "cstack-smoke"',
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
      'requiredChecks = ["deliver/test"]',
      'requiredWorkflows = ["CI"]',
      ""
    ].join("\n"),
    "utf8"
  );

  await runGit(repoDir, ["add", ".gitignore", ".cstack", "docs"]);
  await runGit(repoDir, ["commit", "-m", "smoke harness"]);
  await runGit(repoDir, ["push", "origin", "HEAD"]);
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-live-codex-smoke-"));
  let remoteDir = null;

  try {
    const clone = await cloneSmokeRepo(tempRoot);
    remoteDir = clone.remoteDir;
    await configureSmokeRepo(clone.repoDir);

    await runCommand("codex", ["--version"], { cwd: clone.repoDir });

    const summary = {
      smokeRepository,
      repoDir: clone.repoDir,
      runs: {},
      outputs: {}
    };

    await runCli(clone.repoDir, ["discover", "Summarize the current gaps in this repository without changing files."]);
    const discoverRun = await latestRun(clone.repoDir, "discover");
    assert(discoverRun?.status === "completed");
    summary.runs.discover = discoverRun.id;

    await runCli(clone.repoDir, ["spec", "--from-run", discoverRun.id]);
    const specRun = await latestRun(clone.repoDir, "spec");
    assert(specRun?.status === "completed");
    summary.runs.spec = specRun.id;

    await runCli(clone.repoDir, [
      "build",
      "Add docs/cstack-smoke-note.md with a short note that this file was created by the cstack live Codex smoke run. Keep the change minimal.",
      "--exec"
    ]);
    const buildRun = await latestRun(clone.repoDir, "build");
    assert(buildRun?.status === "completed");
    summary.runs.build = buildRun.id;

    await runCli(clone.repoDir, ["review", "--from-run", buildRun.id, "Review the smoke-run documentation change."]);
    const reviewRun = await latestRun(clone.repoDir, "review");
    assert(reviewRun?.status === "completed");
    summary.runs.review = reviewRun.id;

    await runCli(clone.repoDir, [
      "deliver",
      "Add docs/cstack-deliver-smoke.md with a short note that this file was created by the cstack deliver smoke run. Keep the change minimal and self-contained.",
      "--exec",
      "--issue",
      "123",
      "--allow-dirty"
    ]);
    const deliverRun = await latestRun(clone.repoDir, "deliver");
    assert(deliverRun?.status === "completed");
    summary.runs.deliver = deliverRun.id;

    const inspectResult = await runCli(clone.repoDir, ["inspect", deliverRun.id]);
    assert.match(inspectResult.stdout, /workflow deliver/i);
    summary.outputs.inspect = inspectResult.stdout.split("\n").slice(0, 8).join("\n");

    const runsResult = await runCli(clone.repoDir, ["runs", "--json"]);
    const runsPayload = JSON.parse(runsResult.stdout);
    assert(Array.isArray(runsPayload) && runsPayload.length >= 5);
    summary.outputs.runsCount = runsPayload.length;

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
