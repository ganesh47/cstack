#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runExec(command, args, cwd, env = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      maxBuffer: 50 * 1024 * 1024
    });
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const execError = error;
    return {
      code: typeof execError.code === "number" ? execError.code : 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? execError.message ?? String(error)
    };
  }
}

async function runShell(command, cwd, env = {}) {
  const shell = process.env.SHELL || "/bin/sh";
  return runExec(shell, ["-lc", command], cwd, env);
}

async function currentCommitSha(cwd) {
  const result = await runExec("git", ["rev-parse", "--short", "HEAD"], cwd);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function changedFiles(cwd) {
  const result = await runExec("git", ["status", "--short"], cwd);
  if (result.code !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter((file) => !file.startsWith(".cstack/"))
    .filter(Boolean);
}

async function readJsonIfExists(targetPath) {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readTextIfExists(targetPath) {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function parseMarkdownStatus(markdown, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`- ${escapedHeading}: ([^\\n]+)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function parseDeliverRunId(intentFinalBody) {
  const match = intentFinalBody.match(/via ([0-9T:-]+Z-deliver-[^\s)]+)/);
  return match?.[1] ?? null;
}

function classifyBenchmarkBlockerFromText(text) {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) {
    return null;
  }
  if (normalized.includes("host-tool-missing")) {
    return "validation host-tool bootstrap";
  }
  if (normalized.includes("blocked-by-validation-drift") || normalized.includes("validation drift")) {
    return "validation drift";
  }
  if (normalized.includes("blocked-by-validation") || normalized.includes("validation blocked")) {
    return "validation blocker";
  }
  if (normalized.includes("build failed")) {
    return "build blocker";
  }
  if (normalized.includes("ship readiness is blocked") || normalized.includes("release readiness is blocked")) {
    return "ship readiness blocker";
  }
  return null;
}

async function enrichBenchmarkFromArtifacts(parsed, cwd) {
  if (!parsed.runId) {
    return {
      status: parsed.status,
      summary: parsed.summary,
      primaryBlockerCluster: null
    };
  }

  const workspaceLine =
    parsed.rawLines
      .find((line) => line.startsWith("Workspace: "))
      ?.slice("Workspace: ".length) ?? cwd;
  const intentFinalBody = await readTextIfExists(path.join(workspaceLine, ".cstack", "runs", parsed.runId, "final.md"));
  const deliverRunId = parseDeliverRunId(intentFinalBody);
  const deliverFinalBody = deliverRunId
    ? await readTextIfExists(path.join(workspaceLine, ".cstack", "runs", deliverRunId, "final.md"))
    : "";
  const combined = [deliverFinalBody, intentFinalBody, parsed.summary].filter(Boolean).join("\n");
  const deliverValidationStatus = parseMarkdownStatus(deliverFinalBody, "validation");
  return {
    status:
      deliverValidationStatus?.startsWith("partial")
        ? "partial"
        : deliverValidationStatus?.startsWith("failed") || deliverValidationStatus?.startsWith("blocked")
          ? "failed"
          : parsed.status,
    summary:
      parseMarkdownStatus(deliverFinalBody, "summary") ??
      parseMarkdownStatus(intentFinalBody, "review") ??
      parsed.summary,
    primaryBlockerCluster: classifyBenchmarkBlockerFromText(combined)
  };
}

function parseBenchmarkOutput(stdout, cwd) {
  const lines = stdout.split(/\r?\n/);
  const runId =
    lines
      .filter((line) => line.startsWith("Result run: "))
      .map((line) => line.slice("Result run: ".length))
      .at(-1) ?? null;
  const status =
    lines
      .filter((line) => line.startsWith("Status: "))
      .map((line) => line.slice("Status: ".length))
      .at(-1) ?? "failed";
  const summary =
    lines
      .filter((line) => line.startsWith("Final summary: "))
      .map((line) => line.slice("Final summary: ".length))
      .at(-1) ?? "";
  const artifactsLine =
    lines
      .filter((line) => line.startsWith("Loop artifacts: "))
      .map((line) => line.slice("Loop artifacts: ".length))
      .at(-1) ?? null;
  return {
    runId,
    status,
    summary,
    loopArtifactsDir: artifactsLine ? path.resolve(cwd, artifactsLine) : null,
    rawLines: lines
  };
}

async function main() {
  const candidatePath = process.env.CSTACK_CANDIDATE_RESULT_PATH;
  if (!candidatePath) {
    throw new Error("Missing CSTACK_CANDIDATE_RESULT_PATH");
  }

  const customCommand = process.env.CSTACK_PROGRAM_CANDIDATE_COMMAND;
  if (customCommand) {
    const result = await runShell(customCommand, process.cwd(), process.env);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "program candidate hook failed");
    }
    return;
  }

  const args = ["bin/cstack.js", "loop", "--repo", process.env.CSTACK_BENCHMARK_REPO, "--iterations", process.env.CSTACK_BENCHMARK_ITERATIONS ?? "1"];
  if (process.env.CSTACK_BRANCH) {
    args.push("--branch", process.env.CSTACK_BRANCH);
  }
  args.push(process.env.CSTACK_BENCHMARK_INTENT);

  const benchmark = await runExec("node", args, process.cwd(), process.env);
  const parsed = parseBenchmarkOutput(benchmark.stdout, process.cwd());
  const cycleRecord = parsed.loopArtifactsDir ? await readJsonIfExists(path.join(parsed.loopArtifactsDir, "cycle-record.json")) : null;
  const artifactFallback = await enrichBenchmarkFromArtifacts(parsed, process.cwd());
  const deferredClusters = (() => {
    try {
      return JSON.parse(process.env.CSTACK_DEFERRED_CLUSTERS ?? "[]");
    } catch {
      return [];
    }
  })();
  const result = {
    status: cycleRecord?.status ?? artifactFallback.status,
    summary: cycleRecord?.latestSummary ?? artifactFallback.summary,
    primaryBlockerCluster:
      Object.prototype.hasOwnProperty.call(cycleRecord ?? {}, "primaryBlockerCluster")
        ? cycleRecord.primaryBlockerCluster
        : artifactFallback.primaryBlockerCluster ?? process.env.CSTACK_PRIMARY_BLOCKER_CLUSTER || null,
    runId: parsed.runId,
    changedFiles: await changedFiles(process.cwd()),
    commitSha: await currentCommitSha(process.cwd()),
    deferredClusters,
    improved: null,
    benchmarkCommand: ["node", ...args].join(" ")
  };
  await fs.writeFile(candidatePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(process.env.CSTACK_ITERATION_DIR, "candidate-benchmark.json"),
    `${JSON.stringify({ benchmark, parsed }, null, 2)}\n`,
    "utf8"
  );
  if (benchmark.code !== 0 && result.status === "failed") {
    process.exitCode = 0;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
