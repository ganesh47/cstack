import path from "node:path";
import { promises as fs } from "node:fs";
import { buildEvent, ProgressReporter } from "./progress.js";
import { loadConfig } from "./config.js";
import { runCodexExec } from "./codex.js";
import { buildDiscoverPrompt, buildSpecPrompt, buildSpecialistPrompt, excerpt } from "./prompt.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId, writeRunRecord } from "./run.js";
import type {
  CstackConfig,
  RoutingPlan,
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

const EXECUTABLE_STAGES: StageName[] = ["discover", "spec"];

export interface IntentCommandOptions {
  dryRun: boolean;
  entrypoint: "bare" | "run";
}

interface StageExecutionResult {
  stageDir: string;
  finalPath: string;
  artifactPath: string;
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

function inferStagePlans(intent: string): RoutingStagePlan[] {
  const lower = intent.toLowerCase();
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

  if (/\b(add|build|implement|fix|refactor|migrate|introduce|create|change|update)\b/i.test(lower)) {
    stages.push({
      name: "build",
      rationale: "The intent implies implementation work after planning.",
      status: "planned",
      executed: false
    });
  }

  if (/\b(review|audit|security|compliance|traceability|verify|check)\b/i.test(lower)) {
    stages.push({
      name: "review",
      rationale: "The intent carries explicit review or risk-checking language.",
      status: "planned",
      executed: false
    });
  }

  if (/\b(release|ship|deploy|rollout|pipeline|version)\b/i.test(lower)) {
    stages.push({
      name: "ship",
      rationale: "The intent mentions release or rollout concerns.",
      status: "planned",
      executed: false
    });
  }

  return ensureUniqueStages(stages);
}

function inferSpecialists(intent: string): SpecialistSelection[] {
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
        : null
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
    summary
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
    `Selected specialists: ${
      routingPlan.specialists.filter((specialist) => specialist.selected).map((specialist) => specialist.name).join(", ") || "none"
    }`
  ].join("\n");
}

function createEventRecorder(runId: string, eventsPath: string): {
  emit: (type: "starting" | "activity" | "heartbeat" | "completed" | "failed", message: string) => Promise<void>;
} {
  const reporter = new ProgressReporter("intent", runId);
  const startedAt = Date.now();

  return {
    emit: async (type, message) => {
      const event = buildEvent(type, Date.now() - startedAt, message);
      await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
      reporter.emit(event);
    }
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

function buildFinalSummary(intent: string, routingPlan: RoutingPlan, stageLineage: StageLineage): string {
  const stageLines = stageLineage.stages.map((stage) => `- ${stage.name}: ${stage.status}${stage.executed ? " (executed)" : ""}`);
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

export async function runIntent(cwd: string, intent: string, options: IntentCommandOptions): Promise<void> {
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
      await writeJson(stageLineagePath, stageLineage);
      const finalSummary = buildFinalSummary(resolvedIntent, routingPlan, stageLineage);
      await fs.writeFile(finalPath, finalSummary, "utf8");
      runRecord.status = "completed";
      runRecord.updatedAt = new Date().toISOString();
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
      return;
    }

    let discoverFindings = "";
    let specOutput = "";

    for (const stageName of routingPlan.stages.map((stage) => stage.name)) {
      const lineageStage = stageLineage.stages.find((stage) => stage.name === stageName);
      if (!lineageStage) {
        continue;
      }

      if (!EXECUTABLE_STAGES.includes(stageName)) {
        lineageStage.status = "deferred";
        lineageStage.notes = "Planned by the router, but not executed in this first intent-runner slice.";
        await writeJson(stageLineagePath, stageLineage);
        continue;
      }

      lineageStage.status = "running";
      await writeJson(stageLineagePath, stageLineage);
      await events.emit("activity", `Running ${stageName} stage`);

      if (stageName === "discover") {
        const { prompt, context } = await buildDiscoverPrompt(cwd, resolvedIntent, config);
        const result = await executeStage({
          cwd,
          runId,
          runDir,
          stage: "discover",
          prompt,
          context,
          config,
          artifactName: "findings.md"
        });
        discoverFindings = await fs.readFile(result.artifactPath, "utf8");
        lineageStage.status = "completed";
        lineageStage.executed = true;
        lineageStage.stageDir = result.stageDir;
        lineageStage.artifactPath = result.artifactPath;
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
      await writeJson(stageLineagePath, stageLineage);
    }

    const selectedSpecialists = routingPlan.specialists.filter((specialist) => specialist.selected);
    for (const specialist of selectedSpecialists) {
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
      await writeJson(stageLineagePath, stageLineage);
    }

    const finalSummary = buildFinalSummary(resolvedIntent, routingPlan, stageLineage);
    await fs.writeFile(finalPath, finalSummary, "utf8");
    runRecord.status = "completed";
    runRecord.updatedAt = new Date().toISOString();
    runRecord.lastActivity = "Intent run completed";
    await writeRunRecord(runDir, runRecord);
    await events.emit("completed", "Intent run completed");

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
  } catch (error) {
    runRecord.status = "failed";
    runRecord.updatedAt = new Date().toISOString();
    runRecord.error = error instanceof Error ? error.message : String(error);
    await writeRunRecord(runDir, runRecord);
    await events.emit("failed", runRecord.error);
    throw error;
  }
}
