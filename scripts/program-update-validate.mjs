#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
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

async function ghRepo(cwd) {
  const result = await runExec("gh", ["repo", "view", "--json", "nameWithOwner"], cwd);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "failed to resolve GitHub repository");
  }
  return JSON.parse(result.stdout).nameWithOwner;
}

async function main() {
  const iterationDir = process.env.CSTACK_ITERATION_DIR;
  const releasedTag = process.env.CSTACK_RELEASED_TAG;
  const startingRelease = process.env.CSTACK_STARTING_RELEASE;
  if (!iterationDir || !releasedTag || !startingRelease) {
    throw new Error("Missing release context for update validation");
  }

  const customCommand = process.env.CSTACK_PROGRAM_UPDATE_COMMAND;
  if (customCommand) {
    const result = await runShell(customCommand, process.cwd(), process.env);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "program update validation hook failed");
    }
    await fs.writeFile(
      path.join(iterationDir, "update-validation.json"),
      `${JSON.stringify({ schemaVersion: 1, releasedTag, mode: "custom", checkResult: result }, null, 2)}\n`,
      "utf8"
    );
    return;
  }

  const repo = await ghRepo(process.cwd());
  const installRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-program-update-"));
  const prefix = path.join(installRoot, "prefix");
  const previousUrl = `https://github.com/${repo}/releases/download/${startingRelease}/cstack-latest.tgz`;
  const env = {
    ...process.env,
    npm_config_prefix: prefix,
    PATH: `${path.join(prefix, "bin")}:${process.env.PATH ?? ""}`
  };

  const install = await runExec("npm", ["install", "-g", previousUrl, "--prefix", prefix], process.cwd(), env);
  if (install.code !== 0) {
    throw new Error(install.stderr.trim() || install.stdout.trim() || "failed to install previous cstack release");
  }

  const binary = path.join(prefix, "bin", "cstack");
  const checkBefore = await runExec(binary, ["update", "--check"], process.cwd(), env);
  if (checkBefore.code !== 0) {
    throw new Error(checkBefore.stderr.trim() || checkBefore.stdout.trim() || "update --check failed before upgrade");
  }

  const update = await runExec(binary, ["update", "--yes"], process.cwd(), env);
  if (update.code !== 0) {
    throw new Error(update.stderr.trim() || update.stdout.trim() || "cstack update --yes failed");
  }

  const checkAfter = await runExec(binary, ["update", "--check"], process.cwd(), env);
  if (checkAfter.code !== 0) {
    throw new Error(checkAfter.stderr.trim() || checkAfter.stdout.trim() || "update --check failed after upgrade");
  }

  const versionAfter = await runExec(binary, ["--version"], process.cwd(), env);
  const record = {
    schemaVersion: 1,
    releasedTag,
    startingRelease,
    mode: "isolated-prefix",
    prefix,
    binary,
    install,
    checkBefore,
    update,
    checkAfter,
    versionAfter
  };
  await fs.writeFile(path.join(iterationDir, "update-validation.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
