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

function classifyBlocker(cluster) {
  const lower = cluster.toLowerCase();
  if (lower.includes("validation")) {
    return "validation";
  }
  if (lower.includes("release") || lower.includes("update")) {
    return "release-automation";
  }
  if (lower.includes("build")) {
    return "build";
  }
  if (lower.includes("tool") || lower.includes("bootstrap")) {
    return "tooling";
  }
  return "orchestration";
}

function parseDeferredClusters() {
  try {
    return JSON.parse(process.env.CSTACK_DEFERRED_CLUSTERS ?? "[]");
  } catch {
    return [];
  }
}

function buildPrompt(primary, deferredClusters) {
  return [
    "Implement one bounded cstack self-improvement slice.",
    "",
    `Primary blocker cluster: ${primary}`,
    `Deferred blocker clusters: ${deferredClusters.join(", ") || "none"}`,
    `Benchmark repo: ${process.env.CSTACK_BENCHMARK_REPO}`,
    `Benchmark intent: ${process.env.CSTACK_BENCHMARK_INTENT}`,
    "",
    "Constraints:",
    "- Change only cstack, not the benchmark repo.",
    "- Fix only the primary blocker cluster or the narrowest enabling dependency for it.",
    "- Keep the slice bounded and releaseable.",
    "- Add or update tests if the slice changes behavior.",
    "- Do not attempt unrelated cleanup."
  ].join("\n");
}

async function main() {
  const iterationDir = process.env.CSTACK_ITERATION_DIR;
  const diagnosisPath = process.env.CSTACK_DIAGNOSIS_PATH;
  if (!iterationDir || !diagnosisPath) {
    throw new Error("Missing iteration context for program-fix");
  }

  const backlog = parseDeferredClusters();
  const primary = process.env.CSTACK_PRIMARY_BLOCKER_CLUSTER?.trim() || "unclassified blocker";
  const diagnosis = {
    schemaVersion: 1,
    iteration: Number.parseInt(process.env.CSTACK_ITERATION ?? "0", 10) || null,
    primaryBlockerCluster: primary,
    classificationReason: `Selected the highest-priority blocker from the released benchmark: ${primary}.`,
    selectedWriteScope: ["src", "scripts", "test"],
    selectedAgents: ["Harness lead", "Failure analyst", "Implementer", "Release verifier"],
    acceptanceCondition: `Reduce or remove the blocker cluster '${primary}' in the next candidate result.`,
    deferredClusters: backlog,
    blockerClass: classifyBlocker(primary)
  };
  await fs.writeFile(diagnosisPath, `${JSON.stringify(diagnosis, null, 2)}\n`, "utf8");

  const customCommand = process.env.CSTACK_PROGRAM_FIX_COMMAND;
  let result;
  if (customCommand) {
    result = await runShell(customCommand, process.cwd(), process.env);
  } else {
    const prompt = buildPrompt(primary, backlog);
    result = await runExec("node", ["bin/cstack.js", "build", "--exec", "--allow-dirty", prompt], process.cwd(), process.env);
  }

  await fs.writeFile(path.join(iterationDir, "fix-worker-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "program fix hook failed");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
