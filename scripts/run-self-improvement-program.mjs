#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const PHASES = ["baseline", "fix", "validate", "candidate", "release", "update", "released-benchmark", "finalize"];

function parseArgs(argv) {
  const options = {
    iterations: 30,
    benchmarkIterations: 1,
    cstackBin: "cstack",
    programDir: ".cstack/programs",
    branch: null,
    repo: null,
    intent: null,
    startVersion: null,
    resume: null,
    fixCommand: `node ${shellQuote(path.join(scriptDir, "program-fix.mjs"))}`,
    validateCommand: null,
    candidateCommand: `node ${shellQuote(path.join(scriptDir, "program-candidate.mjs"))}`,
    releaseCommand: `node ${shellQuote(path.join(scriptDir, "program-release.mjs"))}`,
    updateCommand: `node ${shellQuote(path.join(scriptDir, "program-update-validate.mjs"))}`
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      index += 1;
      return value;
    };
    switch (token) {
      case "--iterations":
        options.iterations = Number(next());
        break;
      case "--benchmark-iterations":
        options.benchmarkIterations = Number(next());
        break;
      case "--cstack-bin":
        options.cstackBin = next();
        break;
      case "--program-dir":
        options.programDir = next();
        break;
      case "--branch":
        options.branch = next();
        break;
      case "--repo":
        options.repo = next();
        break;
      case "--intent":
        options.intent = next();
        break;
      case "--start-version":
        options.startVersion = next();
        break;
      case "--resume":
        options.resume = next();
        break;
      case "--fix-command":
        options.fixCommand = next();
        break;
      case "--validate-command":
        options.validateCommand = next();
        break;
      case "--candidate-command":
        options.candidateCommand = next();
        break;
      case "--release-command":
        options.releaseCommand = next();
        break;
      case "--update-command":
        options.updateCommand = next();
        break;
      default:
        if (token?.startsWith("--")) {
          throw new Error(`Unknown argument: ${token}`);
        }
        options.intent = [options.intent, token].filter(Boolean).join(" ");
        break;
    }
  }

  if (!options.repo && !options.resume) {
    throw new Error("Missing required argument: --repo");
  }
  if (!options.intent && !options.resume) {
    throw new Error("Missing required argument: --intent");
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1) {
    throw new Error("--iterations must be a positive integer");
  }
  if (!Number.isInteger(options.benchmarkIterations) || options.benchmarkIterations < 1) {
    throw new Error("--benchmark-iterations must be a positive integer");
  }

  return options;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function createProgramId() {
  return new Date().toISOString().replaceAll(":", "-");
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function lastNonEmptyLine(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";
}

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

async function readJsonIfExists(targetPath) {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function detectCurrentVersion(cstackBin, cwd) {
  const updateCheck = await runExec(cstackBin, ["update", "--check"], cwd);
  const combined = `${updateCheck.stdout}\n${updateCheck.stderr}`;
  const explicitCurrent = combined.match(/Current:\s*(v[0-9A-Za-z.-]+)/);
  if (explicitCurrent?.[1]) {
    return explicitCurrent[1];
  }
  const alreadyCurrent = combined.match(/Already current at\s*(v[0-9A-Za-z.-]+)/i);
  if (alreadyCurrent?.[1]) {
    return alreadyCurrent[1];
  }
  const versionResult = await runExec(cstackBin, ["--version"], cwd);
  const version = lastNonEmptyLine(versionResult.stdout || versionResult.stderr);
  return version || "unknown";
}

function parseBenchmarkOutput(stdout, cwd) {
  const lines = stdout.split(/\r?\n/);
  const workspace = lines.find((line) => line.startsWith("Workspace: "))?.slice("Workspace: ".length) ?? null;
  const resultRunId = lines
    .filter((line) => line.startsWith("Result run: "))
    .map((line) => line.slice("Result run: ".length))
    .at(-1) ?? null;
  const status =
    lines
      .filter((line) => line.startsWith("Status: "))
      .map((line) => line.slice("Status: ".length))
      .at(-1) ?? "failed";
  const finalSummary =
    lines
      .filter((line) => line.startsWith("Final summary: "))
      .map((line) => line.slice("Final summary: ".length))
      .at(-1) ?? "";
  const artifactsLine =
    lines
      .filter((line) => line.startsWith("Loop artifacts: "))
      .map((line) => line.slice("Loop artifacts: ".length))
      .at(-1) ?? null;
  const loopArtifactsDir = artifactsLine ? path.resolve(cwd, artifactsLine) : null;
  return {
    workspace,
    resultRunId,
    status,
    finalSummary,
    loopArtifactsDir
  };
}

async function runReleasedBenchmark(options) {
  const args = ["loop", "--repo", options.repo, "--iterations", String(options.benchmarkIterations)];
  if (options.branch) {
    args.splice(2, 0, "--branch", options.branch);
  }
  args.push(options.intent);
  const result = await runExec(options.cstackBin, args, options.cwd, options.env);
  const parsed = parseBenchmarkOutput(result.stdout, options.cwd);
  const cycleRecord = parsed.loopArtifactsDir ? await readJsonIfExists(path.join(parsed.loopArtifactsDir, "cycle-record.json")) : null;
  const benchmarkOutcome = parsed.loopArtifactsDir
    ? await readJsonIfExists(path.join(parsed.loopArtifactsDir, "benchmark-outcome.json"))
    : null;

  return {
    command: [options.cstackBin, ...args].join(" "),
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    workspace: parsed.workspace,
    runId: parsed.resultRunId,
    status: cycleRecord?.status ?? parsed.status,
    summary: cycleRecord?.latestSummary ?? parsed.finalSummary,
    primaryBlockerCluster: cycleRecord?.primaryBlockerCluster ?? null,
    loopArtifactsDir: parsed.loopArtifactsDir,
    benchmarkOutcome
  };
}

function benchmarkProgressScore(result) {
  const statusRank = {
    failed: 0,
    partial: 1,
    completed: 2
  };
  return statusRank[result?.status] ?? 0;
}

function compareBenchmarkResults(baseline, candidate) {
  if (benchmarkProgressScore(candidate) > benchmarkProgressScore(baseline)) {
    return true;
  }
  if (baseline.primaryBlockerCluster && !candidate.primaryBlockerCluster) {
    return true;
  }
  if (baseline.primaryBlockerCluster !== candidate.primaryBlockerCluster && candidate.status !== "failed") {
    return true;
  }
  return false;
}

async function readCandidateResult(candidateResultPath, fallback) {
  const result = await readJsonIfExists(candidateResultPath);
  if (!result) {
    return fallback;
  }
  return {
    status: result.status ?? fallback.status,
    summary: result.summary ?? fallback.summary,
    primaryBlockerCluster:
      Object.prototype.hasOwnProperty.call(result, "primaryBlockerCluster") ? result.primaryBlockerCluster : fallback.primaryBlockerCluster,
    runId: Object.prototype.hasOwnProperty.call(result, "runId") ? result.runId : null,
    changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles : [],
    commitSha: result.commitSha ?? null,
    deferredClusters: Array.isArray(result.deferredClusters) ? result.deferredClusters : [],
    improved: typeof result.improved === "boolean" ? result.improved : null
  };
}

async function currentCommitSha(cwd) {
  const result = await runExec("git", ["rev-parse", "--short", "HEAD"], cwd);
  return result.code === 0 ? lastNonEmptyLine(result.stdout) : null;
}

function iterationKey(iteration) {
  return `iteration-${String(iteration).padStart(2, "0")}`;
}

async function loadOrCreateProgram(options, cwd) {
  if (!options.resume) {
    const id = createProgramId();
    const rootDir = path.resolve(cwd, options.programDir, id);
    const startingRelease = options.startVersion ?? (await detectCurrentVersion(options.cstackBin, cwd));
    const programRecord = {
      schemaVersion: 2,
      programId: id,
      repo: options.repo,
      branch: options.branch,
      intent: options.intent,
      iterationsRequested: options.iterations,
      benchmarkIterations: options.benchmarkIterations,
      cstackBin: options.cstackBin,
      iterationsCompleted: 0,
      startingRelease,
      endingRelease: startingRelease,
      status: "running",
      currentPhase: "baseline",
      lastSuccessfulIteration: 0,
      iterations: []
    };
    await writeJson(path.join(rootDir, "program-record.json"), programRecord);
    return { id, rootDir, programRecord, currentRelease: startingRelease };
  }

  const resumePath = path.isAbsolute(options.resume)
    ? options.resume
    : path.resolve(cwd, options.resume.includes(path.sep) ? options.resume : path.join(options.programDir, options.resume));
  const programRecord = await readJsonIfExists(path.join(resumePath, "program-record.json"));
  if (!programRecord) {
    throw new Error(`Program record not found at ${resumePath}`);
  }
  options.repo = options.repo ?? programRecord.repo;
  options.branch = options.branch ?? programRecord.branch ?? null;
  options.intent = options.intent ?? programRecord.intent;
  options.iterations = programRecord.iterationsRequested;
  options.benchmarkIterations = programRecord.benchmarkIterations ?? options.benchmarkIterations;
  options.cstackBin = programRecord.cstackBin ?? options.cstackBin;
  return {
    id: programRecord.programId,
    rootDir: resumePath,
    programRecord,
    currentRelease: programRecord.endingRelease
  };
}

async function writeProgramSummary(rootDir, programRecord) {
  const summary = [
    "# Self-Improvement Program Summary",
    "",
    `- program: ${programRecord.programId}`,
    `- repo: ${programRecord.repo}`,
    `- intent: ${programRecord.intent}`,
    `- iterations: ${programRecord.iterationsCompleted}/${programRecord.iterationsRequested}`,
    `- start release: ${programRecord.startingRelease}`,
    `- end release: ${programRecord.endingRelease}`,
    `- status: ${programRecord.status}`,
    "",
    "## Iterations",
    ...(programRecord.iterations.length
      ? programRecord.iterations.map(
          (entry) =>
            `- ${entry.iteration}: ${entry.benchmarkVerdict}${entry.improved ? " improved" : " unchanged"}${
              entry.primaryBlockerCluster ? ` (${entry.primaryBlockerCluster})` : ""
            }${entry.releasedTag ? ` -> ${entry.releasedTag}` : ""}`
        )
      : ["- none"])
  ].join("\n");
  await fs.writeFile(path.join(rootDir, "summary.md"), `${summary}\n`, "utf8");
}

async function loadIterationRecord(iterationDir, iteration, currentRelease) {
  const existing = (await readJsonIfExists(path.join(iterationDir, "iteration-record.json"))) ?? {
    schemaVersion: 2,
    iteration,
    startingRelease: currentRelease,
    endingRelease: currentRelease,
    improved: false,
    primaryBlockerCluster: null,
    deferredClusters: [],
    commitSha: null,
    releasedTag: null,
    updaterValidated: false,
    benchmarkVerdict: "failed",
    phaseState: Object.fromEntries(PHASES.map((phase) => [phase, false])),
    baselineBenchmark: null,
    diagnosis: null,
    candidateResult: null,
    releasedBenchmark: null,
    fixCommandResult: null,
    validateCommandResult: null,
    releaseCommandResult: null,
    updateCommandResult: null
  };
  existing.phaseState ??= Object.fromEntries(PHASES.map((phase) => [phase, false]));
  for (const phase of PHASES) {
    if (existing.phaseState[phase] !== true) {
      existing.phaseState[phase] = false;
    }
  }
  return existing;
}

async function persistIteration(rootDir, iterationDir, programRecord, record) {
  const summaryIndex = programRecord.iterations.findIndex((entry) => entry.iteration === record.iteration);
  const summaryEntry = {
    iteration: record.iteration,
    improved: record.improved,
    primaryBlockerCluster: record.primaryBlockerCluster,
    benchmarkVerdict: record.benchmarkVerdict,
    releasedTag: record.releasedTag
  };
  if (summaryIndex >= 0) {
    programRecord.iterations[summaryIndex] = summaryEntry;
  } else {
    programRecord.iterations.push(summaryEntry);
    programRecord.iterations.sort((left, right) => left.iteration - right.iteration);
  }
  await writeJson(path.join(iterationDir, "iteration-record.json"), record);
  await writeJson(path.join(iterationDir, "backlog.json"), {
    deferredClusters: record.deferredClusters
  });
  await writeJson(path.join(rootDir, "program-record.json"), programRecord);
  await writeProgramSummary(rootDir, programRecord);
}

async function runPhase(command, cwd, env, artifactPath) {
  const result = await runShell(command, cwd, env);
  if (artifactPath) {
    await writeJson(artifactPath, result);
  }
  if (result.code !== 0) {
    throw new Error(lastNonEmptyLine(result.stderr) || lastNonEmptyLine(result.stdout) || `Phase command failed: ${command}`);
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const { id, rootDir, programRecord, currentRelease: restoredRelease } = await loadOrCreateProgram(options, cwd);
  let currentRelease = restoredRelease;

  for (let iteration = 1; iteration <= programRecord.iterationsRequested; iteration += 1) {
    const iterationDir = path.join(rootDir, iterationKey(iteration));
    await fs.mkdir(iterationDir, { recursive: true });
    const record = await loadIterationRecord(iterationDir, iteration, currentRelease);

    const candidateResultPath = path.join(iterationDir, "candidate-result.json");
    const releaseResultPath = path.join(iterationDir, "release-result.json");
    const diagnosisPath = path.join(iterationDir, "diagnosis.json");

    const baseEnv = {
      CSTACK_PROGRAM_ID: id,
      CSTACK_PROGRAM_ROOT: rootDir,
      CSTACK_ITERATION: String(iteration),
      CSTACK_ITERATION_DIR: iterationDir,
      CSTACK_BENCHMARK_REPO: options.repo,
      CSTACK_BENCHMARK_INTENT: options.intent,
      CSTACK_STARTING_RELEASE: record.startingRelease,
      CSTACK_CANDIDATE_RESULT_PATH: candidateResultPath,
      CSTACK_RELEASE_RESULT_PATH: releaseResultPath,
      CSTACK_DIAGNOSIS_PATH: diagnosisPath,
      CSTACK_CSTACK_BIN: options.cstackBin,
      CSTACK_BENCHMARK_ITERATIONS: String(options.benchmarkIterations),
      CSTACK_BRANCH: options.branch ?? ""
    };

    if (!record.phaseState.baseline) {
      const baselineBenchmark = await runReleasedBenchmark({
        cstackBin: options.cstackBin,
        repo: options.repo,
        branch: options.branch,
        benchmarkIterations: options.benchmarkIterations,
        intent: options.intent,
        cwd,
        env: {
          ...baseEnv
        }
      });
      record.baselineBenchmark = baselineBenchmark;
      record.primaryBlockerCluster = baselineBenchmark.primaryBlockerCluster;
      record.deferredClusters = baselineBenchmark.benchmarkOutcome?.iterations?.at(-1)?.deferredClusters ?? [];
      record.phaseState.baseline = true;
      programRecord.currentPhase = "fix";
      await writeJson(path.join(iterationDir, "benchmark-record.json"), {
        phase: "baseline",
        ...baselineBenchmark
      });
      await persistIteration(rootDir, iterationDir, programRecord, record);
    }

    const phaseEnv = {
      ...baseEnv,
      CSTACK_BASELINE_RUN_ID: record.baselineBenchmark?.runId ?? "",
      CSTACK_BASELINE_STATUS: record.baselineBenchmark?.status ?? "failed",
      CSTACK_PRIMARY_BLOCKER_CLUSTER: record.primaryBlockerCluster ?? "",
      CSTACK_DEFERRED_CLUSTERS: JSON.stringify(record.deferredClusters ?? [])
    };

    if (!record.phaseState.fix && options.fixCommand) {
      record.fixCommandResult = await runPhase(options.fixCommand, cwd, phaseEnv, path.join(iterationDir, "fix-command.json"));
      record.diagnosis = await readJsonIfExists(diagnosisPath);
      record.phaseState.fix = true;
      programRecord.currentPhase = options.validateCommand ? "validate" : "candidate";
      await persistIteration(rootDir, iterationDir, programRecord, record);
    }

    if (!record.phaseState.validate && options.validateCommand) {
      record.validateCommandResult = await runPhase(
        options.validateCommand,
        cwd,
        phaseEnv,
        path.join(iterationDir, "validate-command.json")
      );
      record.phaseState.validate = true;
      programRecord.currentPhase = "candidate";
      await persistIteration(rootDir, iterationDir, programRecord, record);
    }

    if (!record.phaseState.candidate && options.candidateCommand) {
      await runPhase(options.candidateCommand, cwd, phaseEnv, path.join(iterationDir, "candidate-command.json"));
      record.candidateResult = await readCandidateResult(candidateResultPath, {
        status: record.baselineBenchmark?.status ?? "failed",
        summary: record.baselineBenchmark?.summary ?? "",
        primaryBlockerCluster: record.primaryBlockerCluster,
        runId: null,
        changedFiles: [],
        commitSha: null,
        deferredClusters: record.deferredClusters,
        improved: null
      });
      record.improved = record.candidateResult.improved ?? compareBenchmarkResults(record.baselineBenchmark, record.candidateResult);
      record.commitSha = record.candidateResult.commitSha ?? (await currentCommitSha(cwd));
      if (record.candidateResult.primaryBlockerCluster) {
        record.primaryBlockerCluster = record.candidateResult.primaryBlockerCluster;
      }
      if (record.candidateResult.deferredClusters.length > 0) {
        record.deferredClusters = record.candidateResult.deferredClusters;
      }
      record.phaseState.candidate = true;
      programRecord.currentPhase = record.improved ? "release" : "finalize";
      await persistIteration(rootDir, iterationDir, programRecord, record);
    }

    if (record.improved && !record.phaseState.release && options.releaseCommand) {
      record.releaseCommandResult = await runPhase(
        options.releaseCommand,
        cwd,
        {
          ...phaseEnv,
          CSTACK_CANDIDATE_STATUS: record.candidateResult?.status ?? "",
          CSTACK_CANDIDATE_BLOCKER_CLUSTER: record.candidateResult?.primaryBlockerCluster ?? ""
        },
        path.join(iterationDir, "release-command.json")
      );
      const releaseResult = await readJsonIfExists(releaseResultPath);
      record.releasedTag = releaseResult?.releasedTag ?? (lastNonEmptyLine(record.releaseCommandResult.stdout) || null);
      if (record.releasedTag) {
        currentRelease = record.releasedTag;
        record.endingRelease = currentRelease;
      }
      record.phaseState.release = true;
      programRecord.currentPhase = options.updateCommand ? "update" : "released-benchmark";
      await persistIteration(rootDir, iterationDir, programRecord, record);
    }

    if (record.improved && !record.phaseState.update && options.updateCommand) {
      record.updateCommandResult = await runPhase(
        options.updateCommand,
        cwd,
        {
          ...phaseEnv,
          CSTACK_RELEASED_TAG: record.releasedTag ?? ""
        },
        path.join(iterationDir, "update-command.json")
      );
      record.updaterValidated = true;
      record.phaseState.update = true;
      programRecord.currentPhase = "released-benchmark";
      await persistIteration(rootDir, iterationDir, programRecord, record);
    }

    if (record.improved && !record.phaseState["released-benchmark"] && options.releaseCommand) {
      record.releasedBenchmark = await runReleasedBenchmark({
        cstackBin: options.cstackBin,
        repo: options.repo,
        branch: options.branch,
        benchmarkIterations: options.benchmarkIterations,
        intent: options.intent,
        cwd,
        env: {
          ...phaseEnv,
          CSTACK_RELEASED_TAG: record.releasedTag ?? ""
        }
      });
      record.benchmarkVerdict = record.releasedBenchmark.status;
      record.phaseState["released-benchmark"] = true;
      programRecord.currentPhase = "finalize";
      await writeJson(path.join(iterationDir, "released-benchmark.json"), record.releasedBenchmark);
      await writeJson(path.join(iterationDir, "release-validation.json"), {
        releaseCommandResult: record.releaseCommandResult,
        updateCommandResult: record.updateCommandResult,
        releasedBenchmark: record.releasedBenchmark
      });
      await persistIteration(rootDir, iterationDir, programRecord, record);
    }

    if (!record.improved) {
      record.benchmarkVerdict = record.baselineBenchmark?.status ?? "failed";
    }

    if (!record.phaseState.finalize) {
      record.phaseState.finalize = true;
      programRecord.iterationsCompleted = Math.max(programRecord.iterationsCompleted, iteration);
      programRecord.lastSuccessfulIteration = Math.max(programRecord.lastSuccessfulIteration, iteration);
      programRecord.endingRelease = currentRelease;
      programRecord.currentPhase = iteration === programRecord.iterationsRequested ? "completed" : "baseline";
      if (iteration === programRecord.iterationsRequested) {
        programRecord.status = "completed";
      }
      await persistIteration(rootDir, iterationDir, programRecord, record);
    }
  }

  process.stdout.write(`Program artifacts: ${path.relative(cwd, rootDir)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
