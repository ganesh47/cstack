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

  it("does not promote a failed candidate benchmark when blocker extraction returns null", async () => {
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
        `cat > "$CSTACK_CANDIDATE_RESULT_PATH" <<'JSON'\n{"status":"failed","summary":"still blocked","primaryBlockerCluster":null}\nJSON`,
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
    expect(iterationRecord.phaseState["branch-push"]).toBe(false);
    await expect(fs.access(releaseLogPath)).rejects.toThrow(/ENOENT/);
  });

  it("ignores preserved dirty tracked files when deciding candidate improvement", async () => {
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
    await fs.mkdir(path.join(repoDir, "scripts"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "test"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "scripts", "program-validate.mjs"), "base\n", "utf8");
    await fs.writeFile(path.join(repoDir, "test", "program-validate.test.ts"), "base\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "tracked files"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "scripts", "program-validate.mjs"), "preserved\n", "utf8");
    await fs.writeFile(path.join(repoDir, "test", "program-validate.test.ts"), "preserved\n", "utf8");

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
        `cat > "$CSTACK_CANDIDATE_RESULT_PATH" <<'JSON'\n{"status":"completed","summary":"candidate improved","primaryBlockerCluster":null,"changedFiles":["scripts/program-validate.mjs","test/program-validate.test.ts"]}\nJSON`,
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
    expect(iterationRecord.candidateResult.changedFiles).toEqual([]);
    await expect(fs.access(releaseLogPath)).rejects.toThrow(/ENOENT/);
  });

  it("extracts a blocker from run artifacts when cstack loop does not print loop artifacts", async () => {
    const noArtifactsCstackPath = path.join(repoDir, "fake-no-artifacts-cstack.mjs");
    const workspaceDir = path.join(repoDir, "benchmark-workspace");
    const intentRunId = "2026-04-01T15-10-23-620Z-intent-artifact-only";
    const deliverRunId = "2026-04-01T15-14-00-759Z-deliver-artifact-only";
    await fs.mkdir(path.join(workspaceDir, ".cstack", "runs", intentRunId), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, ".cstack", "runs", deliverRunId), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, ".cstack", "runs", intentRunId, "final.md"),
      [
        "# Intent Run Summary",
        "",
        "## Stage status",
        `- build: completed (executed) via ${deliverRunId}`,
        "- review: failed (executed) via 2026-04-01T15-14-00-759Z-deliver-artifact-only",
        "  note: Delivery is blocked because validation was blocked by a missing host tool."
      ].join("\n") + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(workspaceDir, ".cstack", "runs", deliverRunId, "final.md"),
      [
        "# Deliver Run Summary",
        "",
        "## Stage status",
        "- build: completed",
        "- validation: failed (blocked-by-validation: Validation blocked by external specialist blocker(s): host-tool-missing.)",
        "",
        "## Validation",
        "- status: blocked",
        "- outcome category: blocked-by-validation",
        "- summary: Validation blocked by external specialist blocker(s): host-tool-missing."
      ].join("\n") + "\n",
      "utf8"
    );
    await fs.writeFile(
      noArtifactsCstackPath,
      [
        "#!/usr/bin/env node",
        "const args = process.argv.slice(2);",
        "if (args[0] === 'update' && args[1] === '--check') { process.stdout.write('Current: v0.1.0\\n'); process.exit(0); }",
        "if (args[0] === '--version') { process.stdout.write('v0.1.0\\n'); process.exit(0); }",
        "if (args[0] !== 'loop') { throw new Error(`Unsupported command: ${args.join(' ')}`); }",
        `process.stdout.write('Loop iteration: 1/1\\nWorkspace: ${workspaceDir}\\nIntent: test intent\\nResult run: ${intentRunId}\\nStatus: failed\\nFinal summary: Intent run finished with downstream workflow failures\\n');`,
        "process.exitCode = 1;"
      ].join("\n"),
      "utf8"
    );
    chmodSync(noArtifactsCstackPath, 0o755);

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
        noArtifactsCstackPath,
        "--start-version",
        "v0.1.0",
        "--fix-command",
        "printf 'fixed\\n'",
        "--validate-command",
        "printf 'validated\\n'",
        "--candidate-command",
        `cat > "$CSTACK_CANDIDATE_RESULT_PATH" <<'JSON'\n{"status":"failed","summary":"still blocked","primaryBlockerCluster":"validation host-tool bootstrap"}\nJSON`
      ],
      {
        cwd: repoDir,
        env: {
          ...process.env
        },
        maxBuffer: 20 * 1024 * 1024
      }
    );

    const programRoot = path.join(repoDir, ".cstack", "programs");
    const programIds = await fs.readdir(programRoot);
    const programDir = path.join(programRoot, programIds[0]!);
    const iterationRecord = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "iteration-record.json"), "utf8"));
    expect(iterationRecord.baselineBenchmark.primaryBlockerCluster).toBe("validation host-tool bootstrap");
    expect(iterationRecord.primaryBlockerCluster).toBe("validation host-tool bootstrap");
  });

  it("waits for loop artifacts to finish when cstack loop returns before benchmark artifacts finalize", async () => {
    const asyncCstackPath = path.join(repoDir, "fake-async-cstack.mjs");
    const workspaceDir = path.join(repoDir, "async-benchmark-workspace");
    const loopDir = path.join(workspaceDir, ".cstack", "loops", "2026-04-04T15-00-00.000Z");
    const intentRunId = "2026-04-04T15-00-01-000Z-intent-artifact-delay";
    const deliverRunId = "2026-04-04T15-00-02-000Z-deliver-artifact-delay";
    await fs.mkdir(path.join(workspaceDir, ".cstack", "runs", intentRunId), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, ".cstack", "runs", deliverRunId), { recursive: true });
    await fs.mkdir(loopDir, { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, ".cstack", "runs", intentRunId, "run.json"),
      `${JSON.stringify({ id: intentRunId, status: "running" }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(loopDir, "benchmark-outcome.json"),
      `${JSON.stringify({ schemaVersion: 1, iterationsRequested: 1, iterationsCompleted: 0, status: "failed", iterations: [] }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      asyncCstackPath,
      [
        "#!/usr/bin/env node",
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const args = process.argv.slice(2);",
        "if (args[0] === 'update' && args[1] === '--check') { process.stdout.write('Current: v0.1.0\\n'); process.exit(0); }",
        "if (args[0] === '--version') { process.stdout.write('v0.1.0\\n'); process.exit(0); }",
        "if (args[0] !== 'loop') { throw new Error(`Unsupported command: ${args.join(' ')}`); }",
        `const workspace = ${JSON.stringify(workspaceDir)};`,
        `const loopDir = ${JSON.stringify(loopDir)};`,
        `const intentRunId = ${JSON.stringify(intentRunId)};`,
        `const deliverRunId = ${JSON.stringify(deliverRunId)};`,
        "setTimeout(() => {",
        "  fs.writeFileSync(path.join(workspace, '.cstack', 'runs', intentRunId, 'final.md'), [",
        "    '# Intent Run Summary',",
        "    '',",
        "    '## Stage status',",
        `    '- build: completed (executed) via ${deliverRunId}',`,
        "    '- review: failed (executed)',",
        "    '  note: Delivery is blocked because validation was blocked by a missing host tool.'",
        "  ].join('\\n') + '\\n');",
        "  fs.writeFileSync(path.join(workspace, '.cstack', 'runs', intentRunId, 'run.json'), JSON.stringify({ id: intentRunId, status: 'failed' }, null, 2) + '\\n');",
        "  fs.writeFileSync(path.join(workspace, '.cstack', 'runs', deliverRunId, 'final.md'), [",
        "    '# Deliver Run Summary',",
        "    '',",
        "    '## Stage status',",
        "    '- validation: failed (blocked-by-validation: Validation blocked by external specialist blocker(s): host-tool-missing.)'",
        "  ].join('\\n') + '\\n');",
        "  fs.writeFileSync(path.join(loopDir, 'benchmark-outcome.json'), JSON.stringify({",
        "    schemaVersion: 1,",
        "    iterationsRequested: 1,",
        "    iterationsCompleted: 1,",
        "    status: 'failed',",
        "    latestRunId: intentRunId,",
        "    latestSummary: 'Intent run finished with downstream workflow failures',",
        "    iterations: [{ iteration: 1, runId: intentRunId, status: 'failed', summary: 'Intent run finished with downstream workflow failures', deferredClusters: [], specialists: [] }]",
        "  }, null, 2) + '\\n');",
        "  fs.writeFileSync(path.join(loopDir, 'cycle-record.json'), JSON.stringify({",
        "    schemaVersion: 1,",
        "    status: 'failed',",
        "    latestSummary: 'Intent run finished with downstream workflow failures',",
        "    primaryBlockerCluster: 'validation host-tool bootstrap'",
        "  }, null, 2) + '\\n');",
        "}, 250);",
        `process.stdout.write('Loop iteration: 1/1\\nWorkspace: ${workspaceDir}\\nIntent: test intent\\nResult run: ${intentRunId}\\nStatus: failed\\nFinal summary: Intent run finished with downstream workflow failures\\nLoop artifacts: ${loopDir}\\n');`,
        "process.exitCode = 1;"
      ].join("\n"),
      "utf8"
    );
    chmodSync(asyncCstackPath, 0o755);

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
        asyncCstackPath,
        "--start-version",
        "v0.1.0",
        "--fix-command",
        "printf 'fixed\\n'",
        "--validate-command",
        "printf 'validated\\n'",
        "--candidate-command",
        `cat > "$CSTACK_CANDIDATE_RESULT_PATH" <<'JSON'\n{"status":"failed","summary":"still blocked","primaryBlockerCluster":"validation host-tool bootstrap"}\nJSON`
      ],
      {
        cwd: repoDir,
        env: {
          ...process.env
        },
        maxBuffer: 20 * 1024 * 1024
      }
    );

    const programRoot = path.join(repoDir, ".cstack", "programs");
    const programIds = await fs.readdir(programRoot);
    const programDir = path.join(programRoot, programIds[0]!);
    const iterationRecord = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "iteration-record.json"), "utf8"));
    expect(iterationRecord.phaseState.baseline).toBe(true);
    expect(iterationRecord.phaseState.finalize).toBe(true);
    expect(iterationRecord.baselineBenchmark.status).toBe("failed");
    expect(iterationRecord.benchmarkVerdict).toBe("failed");
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

  it("finalizes a stale candidate phase from persisted candidate artifacts on resume", async () => {
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
          "--fix-command",
          "printf 'fixed\\n'",
          "--validate-command",
          "printf 'validated\\n'",
          "--candidate-command",
          `cat > "$CSTACK_CANDIDATE_RESULT_PATH" <<'JSON'\n{"status":"failed","summary":"still blocked","primaryBlockerCluster":null}\nJSON\nexit 17`
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
      )
    ).rejects.toThrow();

    const programRoot = path.join(repoDir, ".cstack", "programs");
    const programIds = await fs.readdir(programRoot);
    const programDir = path.join(programRoot, programIds[0]!);
    const interruptedIteration = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "iteration-record.json"), "utf8"));
    expect(interruptedIteration.phaseState.validate).toBe(true);
    expect(interruptedIteration.phaseState.candidate).toBe(false);

    await execFileAsync(process.execPath, [scriptPath, "--resume", programDir], {
      cwd: repoDir,
      env: {
        ...process.env,
        FAKE_SELF_IMPROVEMENT_SCENARIO: scenarioPath,
        FAKE_SELF_IMPROVEMENT_STATE: statePath
      },
      maxBuffer: 20 * 1024 * 1024
    });

    const resumedProgram = JSON.parse(await fs.readFile(path.join(programDir, "program-record.json"), "utf8"));
    const resumedIteration = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "iteration-record.json"), "utf8"));
    expect(resumedProgram.status).toBe("completed");
    expect(resumedIteration.phaseState.candidate).toBe(true);
    expect(resumedIteration.phaseState.finalize).toBe(true);
    expect(resumedIteration.improved).toBe(false);
    expect(resumedIteration.primaryBlockerCluster).toBe("validation blocker");
    expect(resumedIteration.benchmarkVerdict).toBe("failed");
  });

  it("records a pr-checks phase error and excludes tracked program artifacts from the branch commit", async () => {
    const scenarioPath = path.join(repoDir, "scenario.json");
    const statePath = path.join(repoDir, "state.json");
    const bareRemoteDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-program-remote-"));
    const fakeGhPath = path.resolve("test/fixtures/fake-gh.mjs");
    const fakeGhBinDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-fake-gh-bin-"));
    await fs.writeFile(
      path.join(fakeGhBinDir, "gh"),
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeGhPath)} "$@"\n`,
      "utf8"
    );
    chmodSync(path.join(fakeGhBinDir, "gh"), 0o755);
    chmodSync(fakeGhPath, 0o755);

    await execFileAsync("git", ["init", "--bare", bareRemoteDir]);
    await execFileAsync("git", ["remote", "add", "origin", bareRemoteDir], { cwd: repoDir });
    await execFileAsync("git", ["push", "-u", "origin", "main"], { cwd: repoDir });
    await fs.mkdir(path.join(repoDir, ".cstack", "programs", "tracked"), { recursive: true });
    await fs.writeFile(path.join(repoDir, ".cstack", "programs", "tracked", "summary.md"), "tracked\n", "utf8");
    await execFileAsync("git", ["add", ".cstack/programs/tracked/summary.md"], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "track program artifact fixture"], { cwd: repoDir });
    await execFileAsync("git", ["push"], { cwd: repoDir });

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
            PATH: `${fakeGhBinDir}:${process.env.PATH ?? ""}`,
            FAKE_GH_SCENARIO: JSON.stringify({
              prChecksError: "simulated pr checks failure"
            }),
            FAKE_SELF_IMPROVEMENT_SCENARIO: scenarioPath,
            FAKE_SELF_IMPROVEMENT_STATE: statePath,
            CSTACK_PROGRAM_FIX_COMMAND:
              "printf 'code change\\n' >> README.md && printf 'artifact drift\\n' >> .cstack/programs/tracked/summary.md",
            CSTACK_PROGRAM_CANDIDATE_COMMAND:
              `cat > "$CSTACK_CANDIDATE_RESULT_PATH" <<'JSON'\n{"status":"partial","summary":"candidate improved","primaryBlockerCluster":"validation blocker","improved":true}\nJSON`
          },
          maxBuffer: 20 * 1024 * 1024
        }
      )
    ).rejects.toThrow(/simulated pr checks failure/);

    const programRoot = path.join(repoDir, ".cstack", "programs");
    const programIds = await fs.readdir(programRoot);
    const programDir = path.join(programRoot, programIds.find((entry) => entry !== "tracked")!);
    const iterationRecord = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "iteration-record.json"), "utf8"));
    const phaseError = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "phase-error.json"), "utf8"));
    const branchPush = JSON.parse(await fs.readFile(path.join(programDir, "iteration-01", "branch-push.json"), "utf8"));
    const commitFiles = (
      await execFileAsync("git", ["show", "--name-only", "--pretty=format:", iterationRecord.commitSha], { cwd: repoDir })
    ).stdout
      .split(/\r?\n/)
      .filter(Boolean);

    expect(iterationRecord.failedPhase).toBe("pr-checks");
    expect(iterationRecord.phaseErrorSummary).toContain("simulated pr checks failure");
    expect(iterationRecord.recoverable).toBe(true);
    expect(phaseError.failedPhase).toBe("pr-checks");
    expect(branchPush.changedFiles).toContain("README.md");
    expect(branchPush.changedFiles.some((file: string) => file.startsWith(".cstack/"))).toBe(false);
    expect(commitFiles).toContain("README.md");
    expect(commitFiles.some((file) => file.startsWith(".cstack/"))).toBe(false);

    await fs.rm(bareRemoteDir, { recursive: true, force: true });
    await fs.rm(fakeGhBinDir, { recursive: true, force: true });
  });
});
