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

function stripLeadingV(version) {
  return version.startsWith("v") ? version.slice(1) : version;
}

function bumpPatch(version) {
  const clean = stripLeadingV(version || "0.0.0");
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) {
    throw new Error(`Cannot derive next patch version from ${version}`);
  }
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  const suffix = match[4] ?? "";
  return `${major}.${minor}.${patch + 1}${suffix}`;
}

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

async function main() {
  const resultPath = process.env.CSTACK_RELEASE_RESULT_PATH;
  if (!resultPath) {
    throw new Error("Missing CSTACK_RELEASE_RESULT_PATH");
  }

  const customCommand = process.env.CSTACK_PROGRAM_RELEASE_COMMAND;
  if (customCommand) {
    const result = await runShell(customCommand, process.cwd(), process.env);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "program release hook failed");
    }
    const existing = await readJson(resultPath, null);
    if (existing?.releasedTag) {
      process.stdout.write(`${existing.releasedTag}\n`);
      return;
    }
  }

  const startingRelease = process.env.CSTACK_STARTING_RELEASE ?? "v0.0.0";
  const nextVersion = process.env.CSTACK_NEXT_VERSION ?? bumpPatch(startingRelease);
  const releasedTag = `v${stripLeadingV(nextVersion)}`;
  const mode = process.env.CSTACK_PROGRAM_RELEASE_MODE ?? "dry-run";

  const record = {
    schemaVersion: 1,
    mode,
    startingRelease,
    releasedTag,
    prepareReleaseWorkflow: "prepare-release.yml",
    releaseWorkflow: "release.yml",
    status: mode === "dry-run" ? "simulated" : "pending"
  };

  if (mode === "gh") {
    const dispatch = await runExec("gh", ["workflow", "run", "prepare-release.yml", "-f", `version=${stripLeadingV(nextVersion)}`], process.cwd(), process.env);
    if (dispatch.code !== 0) {
      throw new Error(dispatch.stderr.trim() || dispatch.stdout.trim() || "failed to dispatch prepare-release workflow");
    }
    record.status = "dispatched";
    record.dispatch = dispatch;
  }

  await fs.writeFile(resultPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(`${releasedTag}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
