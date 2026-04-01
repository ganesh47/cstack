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

async function main() {
  const iterationDir = process.env.CSTACK_ITERATION_DIR;
  const releasedTag = process.env.CSTACK_RELEASED_TAG;
  if (!iterationDir || !releasedTag) {
    throw new Error("Missing release context for update validation");
  }

  const customCommand = process.env.CSTACK_PROGRAM_UPDATE_COMMAND;
  let record;
  if (customCommand) {
    const result = await runShell(customCommand, process.cwd(), process.env);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "program update validation hook failed");
    }
    record = {
      schemaVersion: 1,
      releasedTag,
      mode: "custom",
      checkResult: result
    };
  } else {
    record = {
      schemaVersion: 1,
      releasedTag,
      mode: "dry-run",
      summary: `No custom updater hook was provided; recorded ${releasedTag} without performing an isolated install.`
    };
  }

  await fs.writeFile(path.join(iterationDir, "update-validation.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
