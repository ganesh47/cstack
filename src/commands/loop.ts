import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { runIntent } from "../intent.js";
import { readRun } from "../run.js";
import type { LoopBacktrackDecisionRecord, LoopCycleRecord, LoopIterationRecord, SpecialistName } from "../types.js";

const execFileAsync = promisify(execFile);

const LOOP_SPECIALIST_ORDER: SpecialistName[] = [
  "security-review",
  "audit-review",
  "release-pipeline-review",
  "devsecops-review",
  "traceability-review"
];

interface RetryGuidance {
  summary: string;
  targetCluster?: string;
  deferredClusters: string[];
  specialists: SpecialistName[];
}

interface LoopCliOptions {
  repo?: string;
  branch?: string;
  iterations: number;
  safe?: boolean;
}

function parseLoopArgs(args: string[]): { intent: string; options: LoopCliOptions } {
  const options: LoopCliOptions = {
    iterations: 3
  };
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--repo") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack loop --repo` requires a git URL.");
      }
      options.repo = value;
      index += 1;
      continue;
    }
    if (arg === "--branch") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack loop --branch` requires a branch name.");
      }
      options.branch = value;
      index += 1;
      continue;
    }
    if (arg === "--iterations") {
      const value = args[index + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error("`cstack loop --iterations` requires a positive integer.");
      }
      options.iterations = Math.max(1, Number.parseInt(value, 10));
      index += 1;
      continue;
    }
    if (arg === "--safe") {
      options.safe = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown loop option: ${arg}`);
    }
    promptParts.push(arg);
  }

  const intent = promptParts.join(" ").trim();
  if (!intent) {
    throw new Error("`cstack loop` requires an intent.");
  }

  return { intent, options };
}

async function cloneIterationRepo(repo: string, branch: string | undefined, iteration: number): Promise<string> {
  const cloneDir = await fs.mkdtemp(path.join(os.tmpdir(), `cstack-loop-${iteration}-`));
  await execFileAsync("git", ["clone", ...(branch ? ["--branch", branch] : []), repo, cloneDir], {
    maxBuffer: 20 * 1024 * 1024
  });
  return cloneDir;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function summarizeBody(body: string): string {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18)
    .join("\n");
}

function inferRetrySpecialists(text: string): SpecialistName[] {
  const lower = text.toLowerCase();
  const selected = LOOP_SPECIALIST_ORDER.filter((name) => {
    switch (name) {
      case "security-review":
        return /\b(auth|security|secret|credential|token|permission|encrypt|vuln|exposure)\b/i.test(lower);
      case "audit-review":
        return /\b(audit|auditability|logging|compliance|evidence|retention)\b/i.test(lower);
      case "release-pipeline-review":
        return /\b(release|ship|pipeline|rollout|rollback|deploy|version)\b/i.test(lower);
      case "devsecops-review":
        return /\b(ci|cd|workflow|github actions|container|docker|image|sbom|runtime|supply chain)\b/i.test(lower);
      case "traceability-review":
        return /\b(traceability|trace|lineage|handoff|migration|regulated)\b/i.test(lower);
    }
  });
  return selected.slice(0, 3);
}

async function extractRetryGuidance(cwd: string, runId: string, previousFinalBody: string): Promise<RetryGuidance> {
  const run = await readRun(cwd, runId);
  const runDir = path.dirname(run.finalPath);
  const stageLineage = await readJsonFile<{
    stages?: Array<{ status?: string; childRunId?: string }>;
  }>(path.join(runDir, "stage-lineage.json"));
  const childRunId =
    stageLineage?.stages?.find((stage) => stage.status === "failed" && stage.childRunId)?.childRunId ??
    stageLineage?.stages?.find((stage) => stage.childRunId)?.childRunId;

  const baseSummary = summarizeBody(previousFinalBody);
  if (!childRunId) {
    return {
      summary: baseSummary || "No prior summary was available.",
      deferredClusters: [],
      specialists: inferRetrySpecialists(baseSummary)
    };
  }

  const childRun = await readRun(cwd, childRunId).catch(() => null);
  if (!childRun) {
    return {
      summary: baseSummary || "No prior summary was available.",
      deferredClusters: [],
      specialists: inferRetrySpecialists(baseSummary)
    };
  }

  const childRunDir = path.dirname(childRun.finalPath);
  const reviewVerdict = await readJsonFile<{
    gapClusters?: Array<{ title?: string }>;
    recommendedNextSlices?: string[];
    summary?: string;
  }>(path.join(childRunDir, "stages", "review", "artifacts", "verdict.json"));
  const buildFailureDiagnosis = await readJsonFile<{
    summary?: string;
    recommendedActions?: string[];
  }>(path.join(childRunDir, "stages", "build", "artifacts", "failure-diagnosis.json"));
  const validationPlan = await readJsonFile<{
    summary?: string;
    classificationReason?: string;
    selectedScope?: string[];
    deferredScope?: string[];
    coverage?: { gaps?: string[] };
  }>(path.join(childRunDir, "stages", "validation", "validation-plan.json"));
  const buildStderr = await fs
    .readFile(path.join(childRunDir, "stages", "build", "stderr.log"), "utf8")
    .catch(() => "");

  const patchHintSummary = [
    /apply_patch verification failed/i.test(buildStderr) ? "Build retry note: prior attempt hit apply_patch verification failures." : "",
    /failed to find expected lines/i.test(buildStderr)
      ? "Build retry note: previous patch context did not match the target file."
      : "",
    /\bmixed line endings\b|\bcrlf\b/i.test(buildStderr)
      ? "Build retry note: a target file had mixed line endings."
      : ""
  ]
    .filter(Boolean)
    .join(" ");

  const targetCluster =
    validationPlan?.classificationReason === "validation drift detected"
      ? "validation drift detected"
      : validationPlan?.deferredScope?.[0] ??
    reviewVerdict?.recommendedNextSlices?.[0] ??
    reviewVerdict?.gapClusters?.[0]?.title ??
    buildFailureDiagnosis?.recommendedActions?.[0] ??
    validationPlan?.coverage?.gaps?.[0];
  const deferredClusters = [
    ...(validationPlan?.deferredScope ?? []),
    ...(reviewVerdict?.recommendedNextSlices ?? []),
    ...(reviewVerdict?.gapClusters?.map((cluster) => cluster.title ?? "").filter(Boolean) ?? []),
    ...(validationPlan?.coverage?.gaps ?? [])
  ].filter((cluster, index, values) => Boolean(cluster) && cluster !== targetCluster && values.indexOf(cluster) === index);
  const guidanceSummary =
    validationPlan?.classificationReason === "validation drift detected"
      ? "Previous retry failed because validation drifted into repo mutations instead of staying read-only and bounded."
      : undefined;
  const resolvedSummary =
    guidanceSummary ??
    reviewVerdict?.summary ??
    validationPlan?.summary ??
    buildFailureDiagnosis?.summary ??
    childRun.lastActivity ??
    baseSummary ??
    "No prior summary was available.";
  const specialists = inferRetrySpecialists([targetCluster, resolvedSummary].filter(Boolean).join("\n"));

  return {
    summary: [resolvedSummary, patchHintSummary].filter(Boolean).join("\n"),
    ...(targetCluster ? { targetCluster } : {}),
    deferredClusters,
    specialists
  };
}

function buildRetryIntent(baseIntent: string, guidance: RetryGuidance): string {
  const summary = summarizeBody(guidance.summary);
  const specialistOverride =
    guidance.specialists.length > 0 ? `__retry_specialists__: ${guidance.specialists.join(", ")}` : undefined;

  return [
    baseIntent,
    "",
    "Use the previous failed run as context.",
    "Backtrack from the failure, choose one different bounded option if needed, and continue instead of quitting on the first blocked path.",
    "For this retry, pick exactly one blocker cluster and defer the rest explicitly after closing that slice.",
    specialistOverride,
    ...(guidance.targetCluster
      ? [
          "",
          "## Retry target (single cluster)",
          guidance.targetCluster,
          "",
          "Out of scope for this retry: every other cluster from the previous run."
        ]
      : []),
    ...(guidance.deferredClusters.length > 0
      ? [
          "",
          "## Deferred clusters",
          ...guidance.deferredClusters.map((cluster) => `- ${cluster}`)
        ]
      : []),
    "",
    "## Prior run summary",
    summary || "No prior summary was available."
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function summarizeRetryDecision(guidance: RetryGuidance): string {
  return [
    guidance.targetCluster ? `Target cluster: ${guidance.targetCluster}` : "",
    guidance.deferredClusters.length > 0 ? `Deferred: ${guidance.deferredClusters.join("; ")}` : "",
    guidance.specialists.length > 0 ? `Specialists: ${guidance.specialists.join(", ")}` : "",
    summarizeBody(guidance.summary)
  ]
    .filter(Boolean)
    .join("\n");
}

async function writeLoopArtifacts(options: {
  loopDir: string;
  trace: LoopCycleRecord;
  latestGuidance?: RetryGuidance;
  latestIteration?: LoopIterationRecord;
}): Promise<void> {
  await writeJsonFile(path.join(options.loopDir, "benchmark-outcome.json"), options.trace);
  const cycleRecord: LoopCycleRecord = {
    schemaVersion: 1,
    loopId: options.trace.loopId,
    repo: options.trace.repo,
    branch: options.trace.branch,
    intent: options.trace.intent,
    workspace: options.trace.workspace,
    status: options.trace.status,
    iterationsRequested: options.trace.iterationsRequested,
    iterationsCompleted: options.trace.iterationsCompleted,
    ...(options.trace.latestRunId ? { latestRunId: options.trace.latestRunId } : {}),
    ...(options.trace.latestSummary ? { latestSummary: options.trace.latestSummary } : {}),
    primaryBlockerCluster: options.latestGuidance?.targetCluster ?? options.latestIteration?.targetCluster ?? null,
    iterations: options.trace.iterations
  };
  await writeJsonFile(path.join(options.loopDir, "cycle-record.json"), cycleRecord);
  if (options.latestGuidance) {
    const backtrackDecision: LoopBacktrackDecisionRecord = {
      schemaVersion: 1,
      loopId: options.trace.loopId,
      targetCluster: options.latestGuidance.targetCluster ?? null,
      deferredClusters: options.latestGuidance.deferredClusters,
      specialists: options.latestGuidance.specialists,
      summary: summarizeRetryDecision(options.latestGuidance)
    };
    await writeJsonFile(path.join(options.loopDir, "backtrack-decision.json"), backtrackDecision);
  }
  const summaryMarkdown = [
    "# Loop Summary",
    "",
    `- status: ${options.trace.status}`,
    `- intent: ${options.trace.intent}`,
    `- workspace: ${options.trace.workspace}`,
    `- iterations: ${options.trace.iterationsCompleted}/${options.trace.iterationsRequested}`,
    `- latest run: ${options.trace.latestRunId ?? "none"}`,
    ...(options.latestGuidance?.targetCluster ? [`- retry target: ${options.latestGuidance.targetCluster}`] : []),
    ...(options.latestGuidance?.deferredClusters.length ? [`- deferred: ${options.latestGuidance.deferredClusters.join("; ")}`] : []),
    "",
    "## Iterations",
    ...options.trace.iterations.map((iteration) =>
      `- ${iteration.iteration}: ${iteration.status} ${iteration.runId} ${iteration.targetCluster ? `(${iteration.targetCluster})` : ""}`.trim()
    )
  ].join("\n");
  await fs.writeFile(path.join(options.loopDir, "summary.md"), `${summaryMarkdown}\n`, "utf8");
}

export async function runLoop(cwd: string, args: string[] = []): Promise<void> {
  const parsed = parseLoopArgs(args);
  const loopId = new Date().toISOString().replaceAll(":", "-");
  let priorFinalBody = "";
  let priorRunId = "";
  let succeeded = false;
  let loopWorkspace = cwd;
  let latestGuidance: RetryGuidance | undefined;
  const iterations: LoopIterationRecord[] = [];
  const previousNoInspect = process.env.CSTACK_NO_POSTRUN_INSPECT;
  const previousAutomatedLoop = process.env.CSTACK_AUTOMATED_LOOP;
  process.env.CSTACK_NO_POSTRUN_INSPECT = "1";
  process.env.CSTACK_AUTOMATED_LOOP = "1";

  try {
    if (parsed.options.repo) {
      loopWorkspace = await cloneIterationRepo(parsed.options.repo, parsed.options.branch, 1);
    }
    const loopDir = path.join(loopWorkspace, ".cstack", "loops", loopId);
    const trace: LoopCycleRecord = {
      schemaVersion: 1,
      loopId,
      repo: parsed.options.repo ?? null,
      branch: parsed.options.branch ?? null,
      intent: parsed.intent,
      workspace: loopWorkspace,
      iterationsRequested: parsed.options.iterations,
      iterationsCompleted: 0,
      status: "failed",
      iterations
    };
    await writeLoopArtifacts({ loopDir, trace });
    for (let iteration = 1; iteration <= parsed.options.iterations; iteration += 1) {
      latestGuidance =
        iteration === 1 || !priorFinalBody || !priorRunId
          ? undefined
          : await extractRetryGuidance(loopWorkspace, priorRunId, priorFinalBody);
      const intent =
        iteration === 1 || !priorFinalBody || !priorRunId || !latestGuidance
          ? parsed.intent
          : buildRetryIntent(parsed.intent, latestGuidance);

      process.stdout.write(
        [
          `Loop iteration: ${iteration}/${parsed.options.iterations}`,
          `Workspace: ${loopWorkspace}`,
          `Intent: ${intent.split("\n")[0]}`
        ].join("\n") + "\n"
      );

      const runId = await runIntent(loopWorkspace, intent, {
        dryRun: false,
        entrypoint: "run",
        ...(parsed.options.safe ? { safe: true } : {})
      });
      const run = await readRun(loopWorkspace, runId);
      priorFinalBody = await fs.readFile(run.finalPath, "utf8").catch(() => "");
      priorRunId = runId;
      const iterationRecord: LoopIterationRecord = {
        iteration,
        runId,
        status: run.status,
        summary: run.lastActivity ?? run.error ?? "completed",
        ...(latestGuidance?.targetCluster ? { targetCluster: latestGuidance.targetCluster } : {}),
        deferredClusters: latestGuidance?.deferredClusters ?? [],
        specialists: latestGuidance?.specialists ?? []
      };
      iterations.push(iterationRecord);
      trace.iterationsCompleted = iteration;
      trace.latestRunId = runId;
      trace.latestSummary = iterationRecord.summary;
      trace.status = run.status === "completed" ? "completed" : "failed";
      await writeLoopArtifacts({
        loopDir,
        trace,
        ...(latestGuidance ? { latestGuidance } : {}),
        latestIteration: iterationRecord
      });

      process.stdout.write(
        [
          `Result run: ${runId}`,
          `Status: ${run.status}`,
          `Final summary: ${run.lastActivity ?? run.error ?? "completed"}`
        ].join("\n") + "\n"
      );

      if (run.status === "completed") {
        succeeded = true;
        break;
      }
    }
    process.stdout.write(`Loop artifacts: ${path.relative(cwd, path.join(loopWorkspace, ".cstack", "loops", loopId))}\n`);
  } finally {
    if (previousNoInspect === undefined) {
      delete process.env.CSTACK_NO_POSTRUN_INSPECT;
    } else {
      process.env.CSTACK_NO_POSTRUN_INSPECT = previousNoInspect;
    }
    if (previousAutomatedLoop === undefined) {
      delete process.env.CSTACK_AUTOMATED_LOOP;
    } else {
      process.env.CSTACK_AUTOMATED_LOOP = previousAutomatedLoop;
    }
  }

  if (!succeeded) {
    throw new Error(`cstack loop did not reach a successful completed intent run within ${parsed.options.iterations} iteration(s).`);
  }
}
