#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function runShell(command, cwd, env) {
  const shell = process.env.SHELL || "/bin/sh";
  try {
    const result = await execFileAsync(shell, ["-lc", command], {
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

async function main() {
  const iterationDir = process.env.CSTACK_ITERATION_DIR;
  const diagnosisPath = process.env.CSTACK_DIAGNOSIS_PATH;
  if (!iterationDir || !diagnosisPath) {
    throw new Error("Missing iteration context for program-fix");
  }

  const backlog = (() => {
    try {
      return JSON.parse(process.env.CSTACK_DEFERRED_CLUSTERS ?? "[]");
    } catch {
      return [];
    }
  })();
  const primary = process.env.CSTACK_PRIMARY_BLOCKER_CLUSTER?.trim() || "unclassified blocker";
  const diagnosis = {
    schemaVersion: 1,
    iteration: Number.parseInt(process.env.CSTACK_ITERATION ?? "0", 10) || null,
    primaryBlockerCluster: primary,
    classificationReason: `Selected the highest-priority blocker from the released benchmark: ${primary}.`,
    selectedWriteScope: [path.relative(process.cwd(), path.join(process.cwd(), "scripts"))],
    selectedAgents: ["Harness lead", "Failure analyst", "Implementer", "Release verifier"],
    acceptanceCondition: `Reduce or remove the blocker cluster '${primary}' in the next candidate result.`,
    deferredClusters: backlog,
    blockerClass: classifyBlocker(primary)
  };
  await fs.writeFile(diagnosisPath, `${JSON.stringify(diagnosis, null, 2)}\n`, "utf8");

  const customCommand = process.env.CSTACK_PROGRAM_FIX_COMMAND;
  if (!customCommand) {
    return;
  }

  const result = await runShell(customCommand, process.cwd(), process.env);
  await fs.writeFile(path.join(iterationDir, "fix-worker-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "program fix hook failed");
  }

  const candidatePath = process.env.CSTACK_CANDIDATE_RESULT_PATH;
  if (candidatePath) {
    const existing = await readJson(candidatePath, null);
    if (!existing) {
      const fallback = {
        status: process.env.CSTACK_BASELINE_STATUS ?? "failed",
        summary: `Fix hook completed without producing a candidate delta for ${primary}.`,
        primaryBlockerCluster: primary,
        runId: null,
        changedFiles: [],
        commitSha: null,
        deferredClusters: backlog
      };
      await fs.writeFile(candidatePath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
