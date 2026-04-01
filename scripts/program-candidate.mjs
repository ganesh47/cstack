#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
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

async function currentCommitSha(cwd) {
  const result = await runShell("git rev-parse --short HEAD", cwd, process.env);
  return result.code === 0 ? result.stdout.trim() : null;
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
  }

  const existing = await readJson(candidatePath, null);
  if (existing) {
    return;
  }

  const deferredClusters = (() => {
    try {
      return JSON.parse(process.env.CSTACK_DEFERRED_CLUSTERS ?? "[]");
    } catch {
      return [];
    }
  })();
  const fallback = {
    status: process.env.CSTACK_BASELINE_STATUS ?? "failed",
    summary: "Candidate benchmark hook did not produce a new result; keeping the baseline verdict.",
    primaryBlockerCluster: process.env.CSTACK_PRIMARY_BLOCKER_CLUSTER || null,
    runId: null,
    changedFiles: [],
    commitSha: await currentCommitSha(process.cwd()),
    deferredClusters,
    improved: false
  };
  await fs.writeFile(candidatePath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
