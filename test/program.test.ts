import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("self-improvement program script", () => {
  let repoDir: string;
  let fakeCstackPath: string;
  let scriptPath: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-program-"));
    fakeCstackPath = path.resolve("test/fixtures/fake-self-improvement-cstack.mjs");
    scriptPath = path.resolve("scripts/run-self-improvement-program.mjs");
    chmodSync(fakeCstackPath, 0o755);
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "cstack test"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "cstack-test@example.com"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "README.md"), "# fixture\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: repoDir });
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("writes a full iteration ledger and promotes only after candidate improvement", async () => {
    const scenarioPath = path.join(repoDir, "scenario.json");
    const statePath = path.join(repoDir, "state.json");
    const releaseLogPath = path.join(repoDir, "release.log");
    const updateLogPath = path.join(repoDir, "update.log");

    await fs.writeFile(
      scenarioPath,
      `${JSON.stringify(
        {
          benchmarks: [
            {
              runId: "intent-baseline",
              status: "failed",
              summary: "blocked by validation",
              primaryBlockerCluster: "validation blocker"
            },
            {
              runId: "intent-released",
              status: "completed",
              summary: "intent run completed",
              primaryBlockerCluster: null
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--iterations",
        "1",
        "--repo",
        repoDir,
        "--intent",
        "What are the gaps in this project? Can you work on closing the gaps?",
        "--cstack-bin",
        fakeCstackPath,
        "--start-version",
        "v0.1.0",
        "--fix-command",
        "printf 'fixed\\n'",
        "--validate-command",
        "printf 'validated\\n'",
        "--candidate-command",
        `cat > "$CSTACK_CANDIDATE_RESULT_PATH" <<'JSON'\n{"status":"completed","summary":"candidate improved","primaryBlockerCluster":null}\nJSON`,
        "--release-command",
        `printf '{"releasedTag":"v0.1.1"}\n' > "$CSTACK_RELEASE_RESULT_PATH" && printf 'v0.1.1\\n' | tee "${releaseLogPath}"`,
        "--update-command",
        `printf 'updated\\n' > "${updateLogPath}"`
      ],
      {
        cwd: repoDir,
        env: {
          ...process.env,
          FAKE_SELF_IMPROVEMENT_SCENARIO: scenarioPath,
          FAKE_SELF_IMPROVEMENT_STATE: statePath
        },
        maxBuffer: 20 * 1024 * 1024
      }
    );

    expect(result.stdout).toContain("Program artifacts:");
    const programRoot = path.join(repoDir, ".cstack", "programs");
    const programIds = await fs.readdir(programRoot);
    const programDir = path.join(programRoot, programIds[0]!);
    const programRecord = JSON.parse(await fs.readFile(path.join(programDir, "program-record.json"), "utf8"));
    const iterationRecord = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "iteration-record.json"), "utf8"));
    const releaseValidation = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "release-validation.json"), "utf8"));

    expect(programRecord.iterationsCompleted).toBe(1);
    expect(programRecord.endingRelease).toBe("v0.1.1");
    expect(iterationRecord.improved).toBe(true);
    expect(iterationRecord.releasedTag).toBe("v0.1.1");
    expect(iterationRecord.benchmarkVerdict).toBe("completed");
    expect(releaseValidation.releasedBenchmark.status).toBe("completed");
    await expect(fs.readFile(releaseLogPath, "utf8")).resolves.toContain("v0.1.1");
    await expect(fs.readFile(updateLogPath, "utf8")).resolves.toContain("updated");
  });

  it("records unchanged iterations without dispatching release hooks", async () => {
    const scenarioPath = path.join(repoDir, "scenario.json");
    const statePath = path.join(repoDir, "state.json");
    const releaseLogPath = path.join(repoDir, "release.log");

    await fs.writeFile(
      scenarioPath,
      `${JSON.stringify(
        {
          benchmarks: [
            {
              runId: "intent-baseline",
              status: "failed",
              summary: "blocked by validation",
              primaryBlockerCluster: "validation blocker"
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--iterations",
        "1",
        "--repo",
        repoDir,
        "--intent",
        "What are the gaps in this project? Can you work on closing the gaps?",
        "--cstack-bin",
        fakeCstackPath,
        "--start-version",
        "v0.1.0",
        "--fix-command",
        "printf 'fixed\\n'",
        "--validate-command",
        "printf 'validated\\n'",
        "--candidate-command",
        `cat > "$CSTACK_CANDIDATE_RESULT_PATH" <<'JSON'\n{"status":"failed","summary":"still blocked","primaryBlockerCluster":"validation blocker"}\nJSON`,
        "--release-command",
        `printf 'v0.1.1\\n' > "${releaseLogPath}"`
      ],
      {
        cwd: repoDir,
        env: {
          ...process.env,
          FAKE_SELF_IMPROVEMENT_SCENARIO: scenarioPath,
          FAKE_SELF_IMPROVEMENT_STATE: statePath
        },
        maxBuffer: 20 * 1024 * 1024
      }
    );

    const programRoot = path.join(repoDir, ".cstack", "programs");
    const programIds = await fs.readdir(programRoot);
    const programDir = path.join(programRoot, programIds[0]!);
    const iterationRecord = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "iteration-record.json"), "utf8"));

    expect(iterationRecord.improved).toBe(false);
    expect(iterationRecord.releasedTag).toBeNull();
    await expect(fs.access(releaseLogPath)).rejects.toThrow(/ENOENT/);
  });

  it("uses the default hook scripts and records diagnosis plus update validation artifacts", async () => {
    const scenarioPath = path.join(repoDir, "scenario.json");
    const statePath = path.join(repoDir, "state.json");

    await fs.writeFile(
      scenarioPath,
      `${JSON.stringify(
        {
          benchmarks: [
            {
              runId: "intent-baseline",
              status: "failed",
              summary: "blocked by build",
              primaryBlockerCluster: "build blocker",
              deferredClusters: ["validation blocker"]
            },
            {
              runId: "intent-released",
              status: "partial",
              summary: "candidate moved the blocker",
              primaryBlockerCluster: "validation blocker"
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--iterations",
        "1",
        "--repo",
        repoDir,
        "--intent",
        "What are the gaps in this project? Can you work on closing the gaps?",
        "--cstack-bin",
        fakeCstackPath,
        "--start-version",
        "v0.1.0",
        "--validate-command",
        "printf 'validated\\n'"
      ],
      {
        cwd: repoDir,
        env: {
          ...process.env,
          FAKE_SELF_IMPROVEMENT_SCENARIO: scenarioPath,
          FAKE_SELF_IMPROVEMENT_STATE: statePath,
          CSTACK_PROGRAM_FIX_COMMAND: "printf 'fixed via default hook\\n'",
          CSTACK_PROGRAM_CANDIDATE_COMMAND:
            `cat > "$CSTACK_CANDIDATE_RESULT_PATH" <<'JSON'\n{"status":"partial","summary":"candidate moved the blocker","primaryBlockerCluster":"validation blocker","deferredClusters":["release blocker"],"improved":true}\nJSON`,
          CSTACK_PROGRAM_RELEASE_COMMAND:
            `cat > "$CSTACK_RELEASE_RESULT_PATH" <<'JSON'\n{"releasedTag":"v0.1.1","status":"simulated"}\nJSON`,
          CSTACK_PROGRAM_UPDATE_COMMAND: "printf 'updated via default hook\\n'"
        },
        maxBuffer: 20 * 1024 * 1024
      }
    );

    const programRoot = path.join(repoDir, ".cstack", "programs");
    const programIds = await fs.readdir(programRoot);
    const programDir = path.join(programRoot, programIds[0]!);
    const diagnosis = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "diagnosis.json"), "utf8"));
    const updateValidation = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "update-validation.json"), "utf8"));
    const iterationRecord = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "iteration-record.json"), "utf8"));

    expect(diagnosis.primaryBlockerCluster).toBe("build blocker");
    expect(diagnosis.deferredClusters).toEqual(["validation blocker"]);
    expect(updateValidation.releasedTag).toBe("v0.1.1");
    expect(iterationRecord.improved).toBe(true);
    expect(iterationRecord.releasedTag).toBe("v0.1.1");
    expect(iterationRecord.deferredClusters).toEqual(["release blocker"]);
  });

  it("resumes from the first incomplete phase after an interrupted run", async () => {
    const scenarioPath = path.join(repoDir, "scenario.json");
    const statePath = path.join(repoDir, "state.json");
    const failMarker = path.join(repoDir, "fail-once.marker");

    await fs.writeFile(
      scenarioPath,
      `${JSON.stringify(
        {
          benchmarks: [
            {
              runId: "intent-baseline",
              status: "failed",
              summary: "blocked by validation",
              primaryBlockerCluster: "validation blocker"
            },
            {
              runId: "intent-released",
              status: "completed",
              summary: "completed after resume",
              primaryBlockerCluster: null
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await fs.writeFile(failMarker, "fail\n", "utf8");

    await expect(
      execFileAsync(
        process.execPath,
        [
          scriptPath,
          "--iterations",
          "1",
          "--repo",
          repoDir,
          "--intent",
          "What are the gaps in this project? Can you work on closing the gaps?",
          "--cstack-bin",
          fakeCstackPath,
          "--start-version",
          "v0.1.0",
          "--validate-command",
          "printf 'validated\\n'"
        ],
        {
          cwd: repoDir,
          env: {
            ...process.env,
            FAKE_SELF_IMPROVEMENT_SCENARIO: scenarioPath,
            FAKE_SELF_IMPROVEMENT_STATE: statePath,
            CSTACK_PROGRAM_FIX_COMMAND: `if [ -f "${failMarker}" ]; then rm "${failMarker}"; echo 'first failure' >&2; exit 12; fi`,
            CSTACK_PROGRAM_CANDIDATE_COMMAND:
              `cat > "$CSTACK_CANDIDATE_RESULT_PATH" <<'JSON'\n{"status":"completed","summary":"completed after resume","primaryBlockerCluster":null,"improved":true}\nJSON`,
            CSTACK_PROGRAM_RELEASE_COMMAND:
              `cat > "$CSTACK_RELEASE_RESULT_PATH" <<'JSON'\n{"releasedTag":"v0.1.1","status":"simulated"}\nJSON`,
            CSTACK_PROGRAM_UPDATE_COMMAND: "printf 'updated\\n'"
          },
          maxBuffer: 20 * 1024 * 1024
        }
      )
    ).rejects.toThrow();

    const programRoot = path.join(repoDir, ".cstack", "programs");
    const programIds = await fs.readdir(programRoot);
    const programDir = path.join(programRoot, programIds[0]!);
    const interruptedRecord = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "iteration-record.json"), "utf8"));
    expect(interruptedRecord.phaseState.baseline).toBe(true);
    expect(interruptedRecord.phaseState.fix).toBe(false);

    await execFileAsync(
      process.execPath,
      [scriptPath, "--resume", programDir],
      {
        cwd: repoDir,
        env: {
          ...process.env,
          FAKE_SELF_IMPROVEMENT_SCENARIO: scenarioPath,
          FAKE_SELF_IMPROVEMENT_STATE: statePath,
          CSTACK_PROGRAM_FIX_COMMAND: "printf 'resume succeeded\\n'",
          CSTACK_PROGRAM_CANDIDATE_COMMAND:
            `cat > "$CSTACK_CANDIDATE_RESULT_PATH" <<'JSON'\n{"status":"completed","summary":"completed after resume","primaryBlockerCluster":null,"improved":true}\nJSON`,
          CSTACK_PROGRAM_RELEASE_COMMAND:
            `cat > "$CSTACK_RELEASE_RESULT_PATH" <<'JSON'\n{"releasedTag":"v0.1.1","status":"simulated"}\nJSON`,
          CSTACK_PROGRAM_UPDATE_COMMAND: "printf 'updated\\n'"
        },
        maxBuffer: 20 * 1024 * 1024
      }
    );

    const resumedProgram = JSON.parse(await fs.readFile(path.join(programDir, "program-record.json"), "utf8"));
    const resumedIteration = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "iteration-record.json"), "utf8"));
    expect(resumedProgram.iterationsCompleted).toBe(1);
    expect(resumedProgram.status).toBe("completed");
    expect(resumedIteration.phaseState.finalize).toBe(true);
    expect(resumedIteration.releasedTag).toBe("v0.1.1");
    expect(resumedIteration.benchmarkVerdict).toBe("completed");
  });
});
