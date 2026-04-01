import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("program validation hook", () => {
  let repoDir: string;
  let iterationDir: string;
  let scriptPath: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-program-validate-"));
    iterationDir = path.join(repoDir, ".cstack", "programs", "test", "iteration-01");
    scriptPath = path.resolve("scripts/program-validate.mjs");
    await fs.mkdir(iterationDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("runs only the default package scripts that exist and records skipped checks", async () => {
    await fs.writeFile(
      path.join(repoDir, "package.json"),
      `${JSON.stringify(
        {
          name: "fixture",
          private: true,
          scripts: {
            typecheck: "node -e \"require('node:fs').appendFileSync('validation.log', 'typecheck\\n')\"",
            test: "node -e \"require('node:fs').appendFileSync('validation.log', 'test\\n')\"",
            build: "node -e \"require('node:fs').appendFileSync('validation.log', 'build\\n')\""
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await execFileAsync(process.execPath, [scriptPath], {
      cwd: repoDir,
      env: {
        ...process.env,
        CSTACK_ITERATION_DIR: iterationDir
      },
      maxBuffer: 20 * 1024 * 1024
    });

    const artifact = JSON.parse(await fs.readFile(path.join(iterationDir, "validate-worker-result.json"), "utf8"));
    const validationLog = await fs.readFile(path.join(repoDir, "validation.log"), "utf8");

    expect(artifact.mode).toBe("package-scripts");
    expect(artifact.code).toBe(0);
    expect(artifact.selectedChecks.map((entry: { script: string }) => entry.script)).toEqual(["typecheck", "test", "build"]);
    expect(artifact.skippedChecks.map((entry: { script: string }) => entry.script)).toEqual(["ci:e2e"]);
    expect(validationLog).toBe("typecheck\ntest\nbuild\n");
  });

  it("records discovery failures when no supported default validation scripts exist", async () => {
    await fs.writeFile(
      path.join(repoDir, "package.json"),
      `${JSON.stringify(
        {
          name: "fixture",
          private: true,
          scripts: {
            lint: "echo lint"
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await expect(
      execFileAsync(process.execPath, [scriptPath], {
        cwd: repoDir,
        env: {
          ...process.env,
          CSTACK_ITERATION_DIR: iterationDir
        },
        maxBuffer: 20 * 1024 * 1024
      })
    ).rejects.toThrow();

    const artifact = JSON.parse(await fs.readFile(path.join(iterationDir, "validate-worker-result.json"), "utf8"));
    expect(artifact.mode).toBe("discovery-error");
    expect(artifact.code).toBe(1);
    expect(artifact.stderr).toMatch(/could not find any supported package\.json scripts/i);
    expect(artifact.stderr).toMatch(/set CSTACK_PROGRAM_VALIDATE_COMMAND/i);
  });
});
