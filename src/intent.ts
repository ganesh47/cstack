import path from "node:path";
import { promises as fs } from "node:fs";
import { buildEvent, ProgressReporter } from "./progress.js";
import { loadConfig } from "./config.js";
import { runCodexExec } from "./codex.js";
import { runDiscoverExecution } from "./discover.js";
import { maybeOfferInteractiveInspect } from "./inspector.js";
import { buildSpecPrompt, buildSpecialistPrompt, excerpt } from "./prompt.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId, readRun, writeRunRecord } from "./run.js";
import type {
  CstackConfig,
  RoutingDecision,
  RoutingPlan,
  RoutingSignal,
  RunRecord,
  SpecialistDisposition,
  SpecialistExecution,
  SpecialistName,
  SpecialistSelection,
  StageLineage,
  StageName,
  RoutingStagePlan
} from "./types.js";

const SPECIALIST_ORDER: SpecialistName[] = [
  "security-review",
  "audit-review",
  "release-pipeline-review",
  "devsecops-review",
  "traceability-review"
];

const DIRECT_EXECUTABLE_STAGES: StageName[] = ["discover", "spec"];

export interface IntentCommandOptions {
  dryRun: boolean;
  entrypoint: "bare" | "run";
}

interface StageExecutionResult {
  stageDir: string;
  finalPath: string;
  artifactPath: string;
}

interface AutoWorkflowHooks {
  onRunCreated?: (run: RunRecord) => Promise<void> | void;
  suppressInteractiveInspect?: boolean;
}

function summarizeChildRunOutcome(childRun: RunRecord): string {
  return childRun.error ?? childRun.lastActivity ?? `${childRun.workflow} ${childRun.status}`;
}

function ensureUniqueStages(stages: RoutingStagePlan[]): RoutingStagePlan[] {
  const seen = new Set<StageName>();
  return stages.filter((stage) => {
    if (seen.has(stage.name)) {
      return false;
    }
    seen.add(stage.name);
    return true;
  });
}

function hasImplementationIntent(lower: string): boolean {
  return (
    /\b(add|build|implement|fix|refactor|migrate|introduce|create|change|update|close|closing|resolve|address|remediate)\b/i.test(
      lower
    ) || /\bwork on\b/i.test(lower)
  );
}

function hasReviewIntent(lower: string): boolean {
  return /\b(review|audit|security|compliance|traceability|verify|check|gap|gaps|missing|assess|assessment|evaluate|evaluation)\b/i.test(lower);
}

function hasReleaseIntent(lower: string): boolean {
  return /\b(release|ship|deploy|rollout|pipeline|version)\b/i.test(lower);
}

function isBroadAnalysisPrompt(lower: string): boolean {
  return (
    /\b(what are the gaps|gaps in (this|the current) project|what is missing|what's missing|assess (the )?current state|evaluate (the )?current state|key risks)\b/i.test(
      lower
    ) &&
    !hasImplementationIntent(lower) &&
    !hasReleaseIntent(lower)
  );
}

function collectRoutingSignals(intent: string): RoutingSignal[] {
  const lower = intent.toLowerCase();
  const analysisEvidence = [...intent.matchAll(
    /\b(what are the gaps|gaps in (?:this|the current) project|what is missing|what's missing|assess(?: the)? current state|evaluate(?: the)? current state|key risks)\b/gi
  )].map((match) => match[0]);
  const implementationEvidence = [...intent.matchAll(
    /\b(add|build|implement|fix|refactor|migrate|introduce|create|change|update|close|closing|resolve|address|remediate|work on)\b/gi
  )].map((match) => match[0]);
  const reviewEvidence = [...intent.matchAll(
    /\b(review|audit|security|compliance|traceability|verify|check|gap|gaps|missing|assess|assessment|evaluate|evaluation)\b/gi
  )].map((match) => match[0]);
  const releaseEvidence = [...intent.matchAll(/\b(release|ship|deploy|rollout|pipeline|version)\b/gi)].map((match) => match[0]);

  return [
    { name: "analysis", matched: analysisEvidence.length > 0, evidence: analysisEvidence },
    { name: "implementation", matched: implementationEvidence.length > 0, evidence: implementationEvidence },
    { name: "review", matched: reviewEvidence.length > 0, evidence: reviewEvidence },
    { name: "release", matched: releaseEvidence.length > 0, evidence: releaseEvidence }
  ];
}

function inferRoutingDecision(stages: RoutingStagePlan[], signals: RoutingSignal[]): RoutingDecision {
  const implementationSignal = signals.find((signal) => signal.name === "implementation");
  const analysisSignal = signals.find((signal) => signal.name === "analysis");
  const releaseSignal = signals.find((signal) => signal.name === "release");
  const winningSignals = signals.filter((signal) => signal.matched).map((signal) => signal.name);

  if (stages.length === 1 && stages[0]?.name === "review") {
    return {
      classification: "analysis",
      reason: "Broad gap-analysis language matched without remediation or release intent, so the router skipped planning overhead and went straight to analytical review.",
      winningSignals
    };
  }

  if (implementationSignal?.matched && analysisSignal?.matched) {
    return {
      classification: "mixed",
      reason:
        "The prompt mixes gap-analysis language with explicit remediation intent, so the router stayed on the implementation path and carried the run through planning and downstream delivery stages.",
      winningSignals
    };
  }

  if (implementationSignal?.matched || releaseSignal?.matched) {
    return {
      classification: "implementation",
      reason:
        "Implementation or release language outweighed pure analysis intent, so the router kept deterministic planning and downstream delivery stages in the plan.",
      winningSignals
    };
  }

  return {
    classification: "mixed",
    reason: "The router kept the deterministic planning path because the prompt was broader than a pure gap-analysis request.",
    winningSignals
  };
}

function inferStagePlans(intent: string): RoutingStagePlan[] {
  const lower = intent.toLowerCase();

  if (isBroadAnalysisPrompt(lower)) {
    return [
      {
        name: "review",
        rationale: "The intent is broad gap analysis, so route directly to analytical review instead of paying planning overhead first.",
        status: "planned",
        executed: false
      }
    ];
  }

  const stages: RoutingStagePlan[] = [
    {
      name: "discover",
      rationale: "Gather repo context and constraints before planning downstream work.",
      status: "planned",
      executed: false
    },
    {
      name: "spec",
      rationale: "Turn the inferred task into an implementation-ready plan and artifact set.",
      status: "planned",
      executed: false
    }
  ];

  if (hasImplementationIntent(lower)) {
    stages.push({
      name: "build",
      rationale: "The intent implies implementation work after planning.",
      status: "planned",
      executed: false
    });
    stages.push({
      name: "review",
      rationale: "Implementation work should be critiqued before it is treated as complete.",
      status: "planned",
      executed: false
    });
    stages.push({
      name: "ship",
      rationale: "Implementation work should carry through to explicit engineering delivery.",
      status: "planned",
      executed: false
    });
  }

  if (hasReviewIntent(lower)) {
    stages.push({
      name: "review",
      rationale: "The intent carries explicit review or risk-checking language.",
      status: "planned",
      executed: false
    });
  }

  if (hasReleaseIntent(lower)) {
    stages.push({
      name: "ship",
      rationale: "The intent mentions release or rollout concerns.",
      status: "planned",
      executed: false
    });
  }

  return ensureUniqueStages(stages);
}

type IntentAutoWorkflow = "review" | "ship" | "deliver";

function hasPlannedStage(routingPlan: RoutingPlan, stageName: StageName): boolean {
  return routingPlan.stages.some((stage) => stage.name === stageName);
}

function selectAutoWorkflow(routingPlan: RoutingPlan): IntentAutoWorkflow | null {
  if (hasPlannedStage(routingPlan, "build")) {
    return "deliver";
  }
  if (hasPlannedStage(routingPlan, "ship")) {
    return "ship";
  }
  if (hasPlannedStage(routingPlan, "review")) {
    return "review";
  }
  return null;
}

function inferReleaseMode(intent: string): boolean {
  return /\b(release|publish|tag|version bump|version|cut a release)\b/i.test(intent);
}

function extractIssueNumbers(intent: string): number[] {
  return [...intent.matchAll(/(?:^|\s)#(\d+)\b/g)].map((match) => Number.parseInt(match[1]!, 10));
}

export function inferSpecialists(intent: string): SpecialistSelection[] {
  const lower = intent.toLowerCase();
  const candidates: Record<SpecialistName, string | null> = {
    "security-review":
      /\b(auth|security|secret|credential|token|permission|encrypt|sso|vuln|vulnerability)\b/i.test(lower)
        ? "The intent suggests auth, secret, or exposure risk."
        : null,
    "devsecops-review":
      /\b(ci|cd|pipeline|container|docker|image|supply chain|sbom|runtime|kubernetes|deploy)\b/i.test(lower)
        ? "The intent suggests CI/CD, runtime, or supply-chain risk."
        : null,
    "traceability-review":
      /\b(traceability|trace|migration|handoff|regulated|evidence|lineage)\b/i.test(lower)
        ? "The intent suggests cross-stage traceability risk."
        : null,
    "audit-review":
      /\b(audit|auditability|logging|compliance|evidence|sox|retention)\b/i.test(lower)
        ? "The intent suggests audit or compliance-facing requirements."
        : null,
    "release-pipeline-review":
      /\b(release|ship|pipeline|rollout|rollback|deploy|version)\b/i.test(lower)
        ? "The intent suggests release-path or rollback risk."
        : null,
    "mobile-validation-specialist": null,
    "container-validation-specialist": null,
    "browser-e2e-specialist": null,
    "api-contract-specialist": null,
    "workflow-security-specialist": null
  };

  const selected = new Set<SpecialistName>(
    SPECIALIST_ORDER.filter((name) => candidates[name]).slice(0, 3)
  );

  return SPECIALIST_ORDER.map((name) => ({
    name,
    reason: candidates[name] ?? "Not strongly implied by the current intent.",
    selected: selected.has(name)
  }));
}

export function inferRoutingPlan(intent: string, entrypoint: "bare" | "run"): RoutingPlan {
  const stages = inferStagePlans(intent);
  const specialists = inferSpecialists(intent);
  const signals = collectRoutingSignals(intent);
  const decision = inferRoutingDecision(stages, signals);
  const selectedSpecialists = specialists.filter((specialist) => specialist.selected).map((specialist) => specialist.name);
  const summary =
    selectedSpecialists.length > 0
      ? `Infer ${stages.map((stage) => stage.name).join(" -> ")} with specialists: ${selectedSpecialists.join(", ")}`
      : `Infer ${stages.map((stage) => stage.name).join(" -> ")} with no specialist reviews selected`;

  return {
    intent,
    inferredAt: new Date().toISOString(),
    entrypoint,
    stages,
    specialists,
    summary,
    decision,
    signals
  };
}

function specialistArtifactName(name: SpecialistName): string {
  switch (name) {
    case "security-review":
      return "security-findings.md";
    case "devsecops-review":
      return "devsecops-findings.md";
    case "traceability-review":
      return "traceability-findings.md";
    case "audit-review":
      return "audit-findings.md";
    case "release-pipeline-review":
      return "release-review.md";
    case "mobile-validation-specialist":
      return "mobile-validation-findings.md";
    case "container-validation-specialist":
      return "container-validation-findings.md";
    case "browser-e2e-specialist":
      return "browser-e2e-findings.md";
    case "api-contract-specialist":
      return "api-contract-findings.md";
    case "workflow-security-specialist":
      return "workflow-security-findings.md";
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildIntentPrompt(intent: string, routingPlan: RoutingPlan): string {
  return [
    "# cstack intent orchestration",
    "",
    "## Intent",
    intent,
    "",
    "## Inferred routing plan",
    JSON.stringify(routingPlan, null, 2)
  ].join("\n");
}

function buildIntentContext(routingPlan: RoutingPlan): string {
  return [
    `Entry point: ${routingPlan.entrypoint}`,
    `Stages: ${routingPlan.stages.map((stage) => stage.name).join(", ")}`,
    `Decision: ${routingPlan.decision?.classification ?? "unknown"} (${routingPlan.decision?.winningSignals.join(", ") || "no matched signals"})`,
    `Selected specialists: ${
      routingPlan.specialists.filter((specialist) => specialist.selected).map((specialist) => specialist.name).join(", ") || "none"
    }`
  ].join("\n");
}

function createEventRecorder(runId: string, eventsPath: string): {
  emit: (type: "starting" | "activity" | "heartbeat" | "completed" | "failed", message: string) => Promise<void>;
  setStages: (names: string[]) => void;
  setSpecialists: (names: string[]) => void;
  markStage: (name: string, status: "pending" | "running" | "completed" | "failed" | "deferred" | "skipped") => void;
  markSpecialist: (name: string, status: "pending" | "running" | "completed" | "failed" | "deferred" | "skipped") => void;
} {
  const reporter = new ProgressReporter("intent", runId);
  const startedAt = Date.now();

  return {
    emit: async (type, message) => {
      const event = buildEvent(type, Date.now() - startedAt, message);
      await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
      reporter.emit(event);
    },
    setStages: (names) => reporter.setStages(names),
    setSpecialists: (names) => reporter.setSpecialists(names),
    markStage: (name, status) => reporter.markStage(name, status),
    markSpecialist: (name, status) => reporter.markSpecialist(name, status)
  };
}

async function executeStage(options: {
  cwd: string;
  runId: string;
  runDir: string;
  stage: Extract<StageName, "discover" | "spec">;
  prompt: string;
  context: string;
  config: CstackConfig;
  artifactName: string;
}): Promise<StageExecutionResult> {
  const stageDir = path.join(options.runDir, "stages", options.stage);
  await fs.mkdir(path.join(stageDir, "artifacts"), { recursive: true });

  const promptPath = path.join(stageDir, "prompt.md");
  const contextPath = path.join(stageDir, "context.md");
  const finalPath = path.join(stageDir, "final.md");
  const eventsPath = path.join(stageDir, "events.jsonl");
  const stdoutPath = path.join(stageDir, "stdout.log");
  const stderrPath = path.join(stageDir, "stderr.log");
  const artifactPath = path.join(stageDir, "artifacts", options.artifactName);

  await fs.writeFile(promptPath, options.prompt, "utf8");
  await fs.writeFile(contextPath, `${options.context}\n`, "utf8");

  const result = await runCodexExec({
    cwd: options.cwd,
    workflow: options.stage,
    runId: `${options.runId}-${options.stage}`,
    prompt: options.prompt,
    finalPath,
    eventsPath,
    stdoutPath,
    stderrPath,
    config: options.config
  });

  if (result.code !== 0) {
    throw new Error(`Stage ${options.stage} failed with code ${result.code}${result.signal ? ` (${result.signal})` : ""}`);
  }

  const finalBody = await fs.readFile(finalPath, "utf8");
  await fs.writeFile(artifactPath, finalBody, "utf8");

  return {
    stageDir,
    finalPath,
    artifactPath
  };
}

async function executeSpecialist(options: {
  cwd: string;
  runId: string;
  runDir: string;
  intent: string;
  config: CstackConfig;
  routingPlan: RoutingPlan;
  specialist: SpecialistSelection;
  discoverFindings?: string;
  specOutput?: string;
}): Promise<SpecialistExecution> {
  const specialistDir = path.join(options.runDir, "delegates", options.specialist.name);
  await fs.mkdir(path.join(specialistDir, "artifacts"), { recursive: true });

  const requestPath = path.join(specialistDir, "request.md");
  const promptPath = path.join(specialistDir, "prompt.md");
  const contextPath = path.join(specialistDir, "context.md");
  const finalPath = path.join(specialistDir, "final.md");
  const eventsPath = path.join(specialistDir, "events.jsonl");
  const stdoutPath = path.join(specialistDir, "stdout.log");
  const stderrPath = path.join(specialistDir, "stderr.log");
  const artifactPath = path.join(specialistDir, "artifacts", specialistArtifactName(options.specialist.name));

  await fs.writeFile(
    requestPath,
    [
      `# ${options.specialist.name}`,
      "",
      `Reason: ${options.specialist.reason}`,
      "",
      `Intent: ${options.intent}`
    ].join("\n"),
    "utf8"
  );

  const specialistPromptOptions = {
    cwd: options.cwd,
    intent: options.intent,
    name: options.specialist.name,
    reason: options.specialist.reason,
    routingPlan: options.routingPlan,
    ...(options.discoverFindings ? { discoverFindings: options.discoverFindings } : {}),
    ...(options.specOutput ? { specOutput: options.specOutput } : {})
  };
  const { prompt, context } = await buildSpecialistPrompt(specialistPromptOptions);

  await fs.writeFile(promptPath, prompt, "utf8");
  await fs.writeFile(contextPath, `${context}\n`, "utf8");

  try {
    const result = await runCodexExec({
      cwd: options.cwd,
      workflow: "intent",
      runId: `${options.runId}-${options.specialist.name}`,
      prompt,
      finalPath,
      eventsPath,
      stdoutPath,
      stderrPath,
      config: options.config
    });

    if (result.code !== 0) {
      throw new Error(`Specialist ${options.specialist.name} failed with code ${result.code}`);
    }

    const finalBody = await fs.readFile(finalPath, "utf8");
    await fs.writeFile(artifactPath, finalBody, "utf8");

    const execution: SpecialistExecution = {
      name: options.specialist.name,
      reason: options.specialist.reason,
      status: "completed",
      disposition: "accepted",
      specialistDir,
      artifactPath,
      notes: "Accepted by default because the specialist run completed successfully."
    };

    await writeJson(path.join(specialistDir, "result.json"), execution);
    return execution;
  } catch (error) {
    const execution: SpecialistExecution = {
      name: options.specialist.name,
      reason: options.specialist.reason,
      status: "failed",
      disposition: "discarded",
      specialistDir,
      notes: error instanceof Error ? error.message : String(error)
    };
    await writeJson(path.join(specialistDir, "result.json"), execution);
    return execution;
  }
}

function buildWorkflowArgs(intent: string, fromRunId: string, workflow: IntentAutoWorkflow): string[] {
  const args = ["--from-run", fromRunId];
  if ((workflow === "ship" || workflow === "deliver") && inferReleaseMode(intent)) {
    args.push("--release");
  }
  for (const issueNumber of extractIssueNumbers(intent)) {
    if (workflow === "ship" || workflow === "deliver") {
      args.push("--issue", String(issueNumber));
    }
  }
  args.push(intent);
  return args;
}

async function loadStageLineageForRun(cwd: string, runId: string): Promise<StageLineage | null> {
  const run = await readRun(cwd, runId);
  const runDir = path.dirname(run.finalPath);
  try {
    const body = await fs.readFile(path.join(runDir, "stage-lineage.json"), "utf8");
    return JSON.parse(body) as StageLineage;
  } catch {
    return null;
  }
}

function updateLineageStage(stageLineage: StageLineage, stageName: StageName, update: Partial<RoutingStagePlan>): void {
  const stage = stageLineage.stages.find((entry) => entry.name === stageName);
  if (!stage) {
    return;
  }
  Object.assign(stage, update);
}

async function executeAutoWorkflow(options: {
  cwd: string;
  intent: string;
  runId: string;
  workflow: IntentAutoWorkflow;
  stageLineage: StageLineage;
  hooks?: AutoWorkflowHooks;
}): Promise<string> {
  const args = buildWorkflowArgs(options.intent, options.runId, options.workflow);
  switch (options.workflow) {
    case "deliver": {
      const { runDeliver } = await import("./commands/deliver.js");
      const childRunId = await runDeliver(options.cwd, args, options.hooks);
      const childRun = await readRun(options.cwd, childRunId);
      const childStageLineage = await loadStageLineageForRun(options.cwd, childRunId);
      const childRunDir = path.dirname(childRun.finalPath);
      for (const stageName of ["build", "review", "ship"] as const) {
        const childStage = childStageLineage?.stages.find((entry) => entry.name === stageName);
        updateLineageStage(options.stageLineage, stageName, {
          status: childStage?.status ?? (childRun.status === "completed" ? "completed" : "failed"),
          executed: childStage?.executed ?? stageName === "build",
          childRunId,
          stageDir: path.join(childRunDir, "stages", stageName),
          artifactPath:
            stageName === "build"
              ? path.join(childRunDir, "stages", "build", "artifacts", "change-summary.md")
              : stageName === "review"
                ? path.join(childRunDir, "stages", "review", "artifacts", "verdict.json")
                : path.join(childRunDir, "stages", "ship", "artifacts", "ship-summary.md"),
          notes: `Executed through downstream deliver run ${childRunId}. ${childStage?.notes ?? summarizeChildRunOutcome(childRun)}`
        });
      }
      return childRunId;
    }
    case "review": {
      const { runReview } = await import("./commands/review.js");
      const childRunId = await runReview(options.cwd, args, options.hooks);
      const childRun = await readRun(options.cwd, childRunId);
      const childRunDir = path.dirname(childRun.finalPath);
      updateLineageStage(options.stageLineage, "review", {
        status: childRun.status === "completed" ? "completed" : "failed",
        executed: true,
        childRunId,
        stageDir: childRunDir,
        artifactPath: path.join(childRunDir, "artifacts", "verdict.json"),
        notes: `Executed through downstream review run ${childRunId}. ${summarizeChildRunOutcome(childRun)}`
      });
      return childRunId;
    }
    case "ship": {
      const { runShip } = await import("./commands/ship.js");
      const childRunId = await runShip(options.cwd, args, options.hooks);
      const childRun = await readRun(options.cwd, childRunId);
      const childRunDir = path.dirname(childRun.finalPath);
      updateLineageStage(options.stageLineage, "ship", {
        status: childRun.status === "completed" ? "completed" : "failed",
        executed: true,
        childRunId,
        stageDir: childRunDir,
        artifactPath: path.join(childRunDir, "artifacts", "ship-summary.md"),
        notes: `Executed through downstream ship run ${childRunId}. ${summarizeChildRunOutcome(childRun)}`
      });
      return childRunId;
    }
  }
}

function startChildRunTracker(options: {
  cwd: string;
  workflow: IntentAutoWorkflow;
  childRunId: string;
  runDir: string;
  runRecord: RunRecord;
  stageLineage: StageLineage;
  stageLineagePath: string;
  events: ReturnType<typeof createEventRecorder>;
}): () => void {
  const progressStage: StageName = options.workflow === "deliver" ? "build" : options.workflow;
  let stopped = false;
  let syncing = false;
  let lastMirroredActivity = "";
  let lastMirroredStage = "";
  let lastMirroredSessionId = "";
  let lastMirroredSpecialists = "";

  const sync = async () => {
    if (stopped || syncing) {
      return;
    }

    syncing = true;
    try {
      const childRun = await readRun(options.cwd, options.childRunId).catch(() => null);
      if (!childRun) {
        return;
      }

      let runRecordChanged = false;
      let lineageChanged = false;

      if (childRun.sessionId && childRun.sessionId !== lastMirroredSessionId) {
        options.runRecord.sessionId = childRun.sessionId;
        lastMirroredSessionId = childRun.sessionId;
        runRecordChanged = true;
      }

      const childCurrentStage = childRun.currentStage ?? options.workflow;
      if (childCurrentStage !== lastMirroredStage) {
        lastMirroredStage = childCurrentStage;
        options.runRecord.currentStage = childCurrentStage;
        runRecordChanged = true;
        await options.events.emit("activity", `Downstream ${options.workflow} stage: ${childCurrentStage}`);
      }

      const childSpecialists = (childRun.activeSpecialists ?? []).join(",");
      if (childSpecialists !== lastMirroredSpecialists) {
        lastMirroredSpecialists = childSpecialists;
        options.runRecord.activeSpecialists = childRun.activeSpecialists ?? [];
        runRecordChanged = true;
      }

      if (childRun.lastActivity && childRun.lastActivity !== lastMirroredActivity) {
        lastMirroredActivity = childRun.lastActivity;
        await options.events.emit("activity", `Downstream ${options.workflow}: ${childRun.lastActivity}`);
      }

      const childStageLineage = await loadStageLineageForRun(options.cwd, options.childRunId);
      if (childStageLineage) {
        if (options.workflow === "deliver") {
          for (const stageName of ["build", "review", "ship"] as const) {
            const childStage = childStageLineage.stages.find((entry) => entry.name === stageName);
            if (!childStage) {
              continue;
            }
            const stageUpdate: Partial<RoutingStagePlan> = {
              status: childStage.status,
              executed: childStage.executed,
              childRunId: options.childRunId,
              notes: `Executing through downstream deliver run ${options.childRunId}.`
            };
            if (childStage.stageDir) {
              stageUpdate.stageDir = childStage.stageDir;
            }
            if (childStage.artifactPath) {
              stageUpdate.artifactPath = childStage.artifactPath;
            }
            updateLineageStage(options.stageLineage, stageName, stageUpdate);
            lineageChanged = true;
            options.events.markStage(stageName, childStage.status === "planned" ? "pending" : childStage.status);
          }
        } else {
          const childStage = childStageLineage.stages.find((entry) => entry.name === options.workflow);
          if (childStage) {
            const stageUpdate: Partial<RoutingStagePlan> = {
              status: childStage.status,
              executed: childStage.executed,
              childRunId: options.childRunId,
              notes: `Executing through downstream ${options.workflow} run ${options.childRunId}.`
            };
            if (childStage.stageDir) {
              stageUpdate.stageDir = childStage.stageDir;
            }
            if (childStage.artifactPath) {
              stageUpdate.artifactPath = childStage.artifactPath;
            }
            updateLineageStage(options.stageLineage, options.workflow, stageUpdate);
            lineageChanged = true;
            options.events.markStage(options.workflow, childStage.status === "planned" ? "pending" : childStage.status);
          }
        }
      } else {
        updateLineageStage(options.stageLineage, progressStage, {
          status: childRun.status === "running" ? "running" : childRun.status === "completed" ? "completed" : "failed",
          executed: true,
          childRunId: options.childRunId,
          notes: `Executing through downstream ${options.workflow} run ${options.childRunId}.`
        });
        lineageChanged = true;
        options.events.markStage(progressStage, childRun.status === "completed" ? "completed" : childRun.status === "failed" ? "failed" : "running");
      }

      if (lineageChanged) {
        await writeJson(options.stageLineagePath, options.stageLineage);
      }

      if (runRecordChanged) {
        options.runRecord.updatedAt = new Date().toISOString();
        await writeRunRecord(options.runDir, options.runRecord);
      }
    } finally {
      syncing = false;
    }
  };

  const interval = setInterval(() => {
    void sync();
  }, 1_500);
  interval.unref?.();
  void sync();

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

function buildFinalSummary(intent: string, routingPlan: RoutingPlan, stageLineage: StageLineage): string {
  const stageLines = stageLineage.stages.map(
    (stage) =>
      `- ${stage.name}: ${stage.status}${stage.executed ? " (executed)" : ""}${stage.childRunId ? ` via ${stage.childRunId}` : ""}${
        stage.notes ? `\n  note: ${stage.notes}` : ""
      }`
  );
  const executedSpecialistLines =
    stageLineage.specialists.length > 0
      ? stageLineage.specialists.map(
          (specialist) => `- ${specialist.name}: ${specialist.status}, disposition=${specialist.disposition}`
        )
      : [];
  const plannedSpecialistLines = routingPlan.specialists
    .filter((specialist) => specialist.selected)
    .map((specialist) => `- ${specialist.name}: ${specialist.reason}`);

  return [
    "# Intent Run Summary",
    "",
    "## Intent",
    intent,
    "",
    "## Routing summary",
    routingPlan.summary,
    "",
    "## Stage status",
    ...stageLines,
    "",
    "## Planned specialists",
    ...(plannedSpecialistLines.length > 0 ? plannedSpecialistLines : ["- none selected"]),
    "",
    "## Specialist status",
    ...(executedSpecialistLines.length > 0 ? executedSpecialistLines : ["- none executed"])
  ].join("\n") + "\n";
}

export async function runIntent(cwd: string, intent: string, options: IntentCommandOptions): Promise<string> {
  const resolvedIntent = intent.trim();
  if (!resolvedIntent) {
    throw new Error("`cstack <intent>` requires a task description.");
  }

  const { config, sources } = await loadConfig(cwd);
  const runId = makeRunId("intent", resolvedIntent);
  const runDir = await ensureRunDir(cwd, runId);
  const promptPath = path.join(runDir, "prompt.md");
  const contextPath = path.join(runDir, "context.md");
  const finalPath = path.join(runDir, "final.md");
  const eventsPath = path.join(runDir, "events.jsonl");
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const routingPlanPath = path.join(runDir, "routing-plan.json");
  const stageLineagePath = path.join(runDir, "stage-lineage.json");
  const [gitBranch, codexVersion] = await Promise.all([
    detectGitBranch(cwd),
    detectCodexVersion(cwd, config.codex.command)
  ]);

  const routingPlan = inferRoutingPlan(resolvedIntent, options.entrypoint);
  const stageLineage: StageLineage = {
    intent: resolvedIntent,
    stages: structuredClone(routingPlan.stages),
    specialists: []
  };

  await fs.writeFile(promptPath, buildIntentPrompt(resolvedIntent, routingPlan), "utf8");
  await fs.writeFile(contextPath, `${buildIntentContext(routingPlan)}\n`, "utf8");
  await fs.writeFile(stdoutPath, "", "utf8");
  await fs.writeFile(stderrPath, "", "utf8");
  await writeJson(routingPlanPath, routingPlan);
  await writeJson(stageLineagePath, stageLineage);

  const createdAt = new Date().toISOString();
  const runRecord: RunRecord = {
    id: runId,
    workflow: "intent",
    createdAt,
    updatedAt: createdAt,
    status: "running",
    cwd,
    gitBranch,
    codexVersion,
    codexCommand: [],
    promptPath,
    finalPath,
    contextPath,
    eventsPath,
    stdoutPath,
    stderrPath,
    configSources: sources,
    currentStage: "routing",
    activeSpecialists: [],
    summary: resolvedIntent,
    inputs: {
      userPrompt: resolvedIntent,
      entrypoint: "intent",
      plannedStages: routingPlan.stages.map((stage) => stage.name),
      selectedSpecialists: routingPlan.specialists.filter((specialist) => specialist.selected).map((specialist) => specialist.name),
      dryRun: options.dryRun
    }
  };

  await writeRunRecord(runDir, runRecord);
  const events = createEventRecorder(runId, eventsPath);
  events.setStages(routingPlan.stages.map((stage) => stage.name));
  events.setSpecialists(routingPlan.specialists.filter((specialist) => specialist.selected).map((specialist) => specialist.name));

  try {
    await events.emit("starting", `Routing intent across ${routingPlan.stages.map((stage) => stage.name).join(" -> ")}`);
    process.stdout.write(
      [
        `Intent run: ${runId}`,
        `Inferred stages: ${routingPlan.stages.map((stage) => stage.name).join(" -> ")}`,
        `Selected specialists: ${
          routingPlan.specialists.filter((specialist) => specialist.selected).map((specialist) => specialist.name).join(", ") || "none"
        }`
      ].join("\n") + "\n"
    );

    if (options.dryRun) {
      stageLineage.stages = stageLineage.stages.map((stage) => ({
        ...stage,
        status: "skipped",
        notes: "Dry run: no stage execution performed."
      }));
      for (const stage of stageLineage.stages) {
        events.markStage(stage.name, "skipped");
      }
      for (const specialist of routingPlan.specialists.filter((entry) => entry.selected)) {
        events.markSpecialist(specialist.name, "skipped");
      }
      await writeJson(stageLineagePath, stageLineage);
      const finalSummary = buildFinalSummary(resolvedIntent, routingPlan, stageLineage);
      await fs.writeFile(finalPath, finalSummary, "utf8");
      runRecord.status = "completed";
      runRecord.updatedAt = new Date().toISOString();
      delete runRecord.currentStage;
      runRecord.lastActivity = "Dry run completed";
      await writeRunRecord(runDir, runRecord);
      await events.emit("completed", "Dry run completed");
      process.stdout.write(
        [
          `Run: ${runId}`,
          `Workflow: intent`,
          `Status: completed`,
          `Artifacts:`,
          `  ${path.relative(cwd, routingPlanPath)}`,
          `  ${path.relative(cwd, stageLineagePath)}`,
          `  ${path.relative(cwd, finalPath)}`,
          `  ${path.relative(cwd, path.join(runDir, "run.json"))}`
        ].join("\n") + "\n"
      );
      await maybeOfferInteractiveInspect(cwd, runId);
      return runId;
    }

    let discoverFindings = "";
    let specOutput = "";

    for (const stageName of routingPlan.stages.map((stage) => stage.name)) {
      const lineageStage = stageLineage.stages.find((stage) => stage.name === stageName);
      if (!lineageStage) {
        continue;
      }

      if (!DIRECT_EXECUTABLE_STAGES.includes(stageName)) {
        continue;
      }

      lineageStage.status = "running";
      events.markStage(stageName, "running");
      runRecord.currentStage = stageName;
      runRecord.updatedAt = new Date().toISOString();
      await writeRunRecord(runDir, runRecord);
      await writeJson(stageLineagePath, stageLineage);
      await events.emit("activity", `Running ${stageName} stage`);

      if (stageName === "discover") {
        const stageDir = path.join(runDir, "stages", "discover");
        await fs.mkdir(path.join(stageDir, "artifacts"), { recursive: true });
        const discoverResult = await runDiscoverExecution({
          cwd,
          runId: `${runId}-discover`,
          input: resolvedIntent,
          config,
          paths: {
            runDir,
            stageDir,
            promptPath: path.join(stageDir, "prompt.md"),
            contextPath: path.join(stageDir, "context.md"),
            finalPath: path.join(stageDir, "final.md"),
            eventsPath: path.join(stageDir, "events.jsonl"),
            stdoutPath: path.join(stageDir, "stdout.log"),
            stderrPath: path.join(stageDir, "stderr.log"),
            artifactPath: path.join(stageDir, "artifacts", "findings.md")
          }
        });
        discoverFindings = discoverResult.finalBody;
        if (discoverResult.status === "failed") {
          throw new Error(discoverResult.notes[0] ?? `Discover failed closed with exit code ${discoverResult.leadResult.code}`);
        }
        lineageStage.status = "completed";
        lineageStage.executed = true;
        lineageStage.stageDir = stageDir;
        lineageStage.artifactPath = path.join(stageDir, "artifacts", "findings.md");
        if (discoverResult.status === "partial") {
          lineageStage.notes = discoverResult.notes[0] ?? "Discover recovered a partial artifact after a non-zero lead exit.";
        }
        events.markStage(stageName, "completed");
        await writeJson(stageLineagePath, stageLineage);
        continue;
      }

      const specInput = discoverFindings
        ? `${resolvedIntent}\n\n## Linked discover findings\n${excerpt(discoverFindings, 40)}`
        : resolvedIntent;
      const { prompt, context } = await buildSpecPrompt(cwd, specInput, config);
      const result = await executeStage({
        cwd,
        runId,
        runDir,
        stage: "spec",
        prompt,
        context,
        config,
        artifactName: "spec.md"
      });
      specOutput = await fs.readFile(result.artifactPath, "utf8");
      lineageStage.status = "completed";
      lineageStage.executed = true;
      lineageStage.stageDir = result.stageDir;
      lineageStage.artifactPath = result.artifactPath;
      events.markStage(stageName, "completed");
      await writeJson(stageLineagePath, stageLineage);
    }

    const autoWorkflow = selectAutoWorkflow(routingPlan);
    if (autoWorkflow) {
      const autoProgressStage: StageName = autoWorkflow === "deliver" ? "build" : autoWorkflow;
      updateLineageStage(stageLineage, autoProgressStage, {
        status: "running",
        executed: true,
        notes: `Starting downstream ${autoWorkflow} workflow.`
      });
      events.markStage(autoProgressStage, "running");
      runRecord.currentStage = autoProgressStage;
      runRecord.activeSpecialists = [];
      runRecord.updatedAt = new Date().toISOString();
      await writeRunRecord(runDir, runRecord);
      await writeJson(stageLineagePath, stageLineage);
      await events.emit("activity", `Running downstream ${autoWorkflow} workflow from intent`);
      let stopTracking: (() => void) | undefined;
      try {
        await executeAutoWorkflow({
          cwd,
          intent: resolvedIntent,
          runId,
          workflow: autoWorkflow,
          stageLineage,
          hooks: {
            suppressInteractiveInspect: true,
            onRunCreated: async (childRun) => {
              updateLineageStage(stageLineage, autoProgressStage, {
                status: "running",
                executed: true,
                childRunId: childRun.id,
                notes: `Executing through downstream ${autoWorkflow} run ${childRun.id}.`
              });
              runRecord.currentStage = childRun.currentStage ?? autoProgressStage;
              runRecord.activeSpecialists = childRun.activeSpecialists ?? [];
              if (childRun.sessionId) {
                runRecord.sessionId = childRun.sessionId;
              }
              runRecord.updatedAt = new Date().toISOString();
              runRecord.lastActivity = `Downstream ${autoWorkflow} run ${childRun.id} started`;
              await writeRunRecord(runDir, runRecord);
              await writeJson(stageLineagePath, stageLineage);
              await events.emit("activity", `Downstream ${autoWorkflow} run ${childRun.id} started`);
              stopTracking = startChildRunTracker({
                cwd,
                workflow: autoWorkflow,
                childRunId: childRun.id,
                runDir,
                runRecord,
                stageLineage,
                stageLineagePath,
                events
              });
            }
          }
        });
      } finally {
        stopTracking?.();
      }
      await writeJson(stageLineagePath, stageLineage);
      for (const stage of stageLineage.stages) {
        if (stage.executed) {
          events.markStage(stage.name, stage.status === "completed" ? "completed" : "failed");
        }
      }
      for (const specialist of routingPlan.specialists.filter((entry) => entry.selected)) {
        events.markSpecialist(specialist.name, "skipped");
      }
    } else {
      const selectedSpecialists = routingPlan.specialists.filter((specialist) => specialist.selected);
      for (const specialist of selectedSpecialists) {
        runRecord.currentStage = `specialist:${specialist.name}`;
        runRecord.activeSpecialists = [specialist.name];
        runRecord.updatedAt = new Date().toISOString();
        await writeRunRecord(runDir, runRecord);
        events.markSpecialist(specialist.name, "running");
        await events.emit("activity", `Running specialist ${specialist.name}`);
        const result = await executeSpecialist({
          cwd,
          runId,
          runDir,
          intent: resolvedIntent,
          config,
          routingPlan,
          specialist,
          discoverFindings,
          specOutput
        });
        stageLineage.specialists.push(result);
        events.markSpecialist(specialist.name, result.status === "completed" ? "completed" : "failed");
        await writeJson(stageLineagePath, stageLineage);
      }
    }

    const finalSummary = buildFinalSummary(resolvedIntent, routingPlan, stageLineage);
    await fs.writeFile(finalPath, finalSummary, "utf8");
    runRecord.status = stageLineage.stages.some((stage) => stage.status === "failed") ? "failed" : "completed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.activeSpecialists = [];
    runRecord.lastActivity =
      runRecord.status === "completed" ? "Intent run completed" : "Intent run finished with downstream workflow failures";
    if (runRecord.status === "failed") {
      runRecord.error = stageLineage.stages
        .filter((stage) => stage.status === "failed")
        .map((stage) => `${stage.name} failed${stage.childRunId ? ` via ${stage.childRunId}` : ""}`)
        .join("; ");
    } else {
      delete runRecord.error;
    }
    await writeRunRecord(runDir, runRecord);
    await events.emit(runRecord.status === "completed" ? "completed" : "failed", runRecord.lastActivity);

    process.stdout.write(
      [
        `Run: ${runId}`,
        `Workflow: intent`,
        `Status: ${runRecord.status}`,
        `Artifacts:`,
        `  ${path.relative(cwd, routingPlanPath)}`,
        `  ${path.relative(cwd, stageLineagePath)}`,
        `  ${path.relative(cwd, finalPath)}`,
        `  ${path.relative(cwd, path.join(runDir, "run.json"))}`
      ].join("\n") + "\n"
    );
    await maybeOfferInteractiveInspect(cwd, runId);
    return runId;
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : String(error);
    const failedStage = runRecord.currentStage;
    if (failedStage) {
      if (failedStage.startsWith("specialist:")) {
        const specialistName = failedStage.slice("specialist:".length);
        const lineageSpecialist = stageLineage.specialists.find((specialist) => specialist.name === specialistName);
        if (lineageSpecialist) {
          lineageSpecialist.status = "failed";
          lineageSpecialist.notes = failureMessage;
        }
      } else {
        const lineageStage = stageLineage.stages.find((stage) => stage.name === failedStage);
        if (lineageStage) {
          lineageStage.status = "failed";
          lineageStage.executed = true;
          lineageStage.notes = failureMessage;
        }
      }
      await writeJson(stageLineagePath, stageLineage);
    }
    runRecord.status = "failed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.activeSpecialists = [];
    runRecord.error = failureMessage;
    await writeRunRecord(runDir, runRecord);
    await events.emit("failed", runRecord.error);
    throw error;
  }
}
