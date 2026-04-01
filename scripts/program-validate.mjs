#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_SCRIPT_CHECKS = [
  { script: "typecheck", command: "npm run typecheck", reason: "Compile-time validation for the wrapper and prompts." },
  { script: "test", command: "npm test", reason: "Primary unit and integration coverage." },
  { script: "build", command: "npm run build", reason: "Packaging and build integrity." },
  { script: "ci:e2e", command: "npm run ci:e2e", reason: "Deterministic end-to-end workflow coverage." }
];

async function runShell(command, cwd, env = {}) {
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

async function readPackageScripts(cwd) {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
    return packageJson && typeof packageJson === "object" && packageJson.scripts && typeof packageJson.scripts === "object"
      ? packageJson.scripts
      : {};
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeValidationArtifact(iterationDir, value) {
  await fs.writeFile(path.join(iterationDir, "validate-worker-result.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function resolveValidationPlan(cwd) {
  const scripts = await readPackageScripts(cwd);
  const selectedChecks = DEFAULT_SCRIPT_CHECKS.filter((entry) => Object.prototype.hasOwnProperty.call(scripts, entry.script));
  const skippedChecks = DEFAULT_SCRIPT_CHECKS.filter((entry) => !Object.prototype.hasOwnProperty.call(scripts, entry.script)).map((entry) => ({
    script: entry.script,
    command: entry.command,
    reason: `Skipped because package.json does not define the '${entry.script}' script.`
  }));

  if (selectedChecks.length === 0) {
    throw new Error(
      "Default program validation could not find any supported package.json scripts. Define one of: typecheck, test, build, ci:e2e, or set CSTACK_PROGRAM_VALIDATE_COMMAND."
    );
  }

  return {
    mode: "package-scripts",
    command: selectedChecks.map((entry) => entry.command).join(" && "),
    selectedChecks: selectedChecks.map((entry) => ({
      script: entry.script,
      command: entry.command,
      reason: entry.reason
    })),
    skippedChecks
  };
}

async function main() {
  const iterationDir = process.env.CSTACK_ITERATION_DIR;
  if (!iterationDir) {
    throw new Error("Missing iteration directory for program validation");
  }

  let plan;
  try {
    if (process.env.CSTACK_PROGRAM_VALIDATE_COMMAND) {
      plan = {
        mode: "custom",
        command: process.env.CSTACK_PROGRAM_VALIDATE_COMMAND,
        selectedChecks: [
          {
            script: "custom",
            command: process.env.CSTACK_PROGRAM_VALIDATE_COMMAND,
            reason: "Used the explicit program validation override."
          }
        ],
        skippedChecks: []
      };
    } else {
      plan = await resolveValidationPlan(process.cwd());
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeValidationArtifact(iterationDir, {
      schemaVersion: 1,
      mode: "discovery-error",
      command: null,
      selectedChecks: [],
      skippedChecks: DEFAULT_SCRIPT_CHECKS.map((entry) => ({
        script: entry.script,
        command: entry.command,
        reason: `Unavailable while resolving the default validation plan. ${entry.reason}`
      })),
      code: 1,
      stdout: "",
      stderr: message
    });
    throw error;
  }

  const result = await runShell(plan.command, process.cwd(), process.env);
  await writeValidationArtifact(iterationDir, {
    schemaVersion: 1,
    ...plan,
    ...result
  });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "program validation hook failed");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
