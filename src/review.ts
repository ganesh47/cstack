import path from "node:path";
import { promises as fs } from "node:fs";
import { runCodexExec } from "./codex.js";
import { resolveLinkedBuildContext } from "./build.js";
import { buildDeliverReviewLeadPrompt, buildDeliverSpecialistPrompt } from "./prompt.js";
import { inferRoutingPlan } from "./intent.js";
import type {
  BuildVerificationRecord,
  CstackConfig,
  DeliverValidationLocalRecord,
  DeliverValidationPlan,
  DeliverReviewVerdict,
  SpecialistExecution,
  SpecialistSelection,
  StageLineage,
  WorkflowName
} from "./types.js";

export interface LinkedReviewContext {
  runId: string;
  workflow: WorkflowName;
  artifactPath: string | null;
  artifactBody: string;
  buildSummary: string;
  verificationRecord: BuildVerificationRecord;
  validationPlan?: DeliverValidationPlan;
  validationLocalRecord?: DeliverValidationLocalRecord;
}

export interface ReviewPaths {
  runDir: string;
  promptPath: string;
  contextPath: string;
  finalPath: string;
  eventsPath: string;
  stdoutPath: string;
  stderrPath: string;
  findingsPath: string;
  findingsJsonPath: string;
  verdictPath: string;
  stageLineagePath: string;
}

export interface ReviewExecutionOptions {
  cwd: string;
  runId: string;
  input: string;
  config: CstackConfig;
  paths: ReviewPaths;
  linkedContext?: LinkedReviewContext;
}

export interface ReviewExecutionResult {
  reviewVerdict: DeliverReviewVerdict;
  selectedSpecialists: SpecialistSelection[];
  stageLineage: StageLineage;
  finalBody: string;
  executionSucceeded: boolean;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`${context} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function selectedSpecialistsForInput(input: string): SpecialistSelection[] {
  return inferRoutingPlan(input, "run").specialists.filter((specialist) => specialist.selected).slice(0, 3);
}

async function runReviewSpecialist(options: {
  cwd: string;
  runId: string;
  runDir: string;
  input: string;
  specialist: SpecialistSelection;
  config: CstackConfig;
  buildSummary: string;
  verificationRecord: BuildVerificationRecord;
}): Promise<{ execution: SpecialistExecution; finalBody: string }> {
  const delegateDir = path.join(options.runDir, "delegates", options.specialist.name);
  await fs.mkdir(path.join(delegateDir, "artifacts"), { recursive: true });

  const requestPath = path.join(delegateDir, "request.md");
  const promptPath = path.join(delegateDir, "prompt.md");
  const contextPath = path.join(delegateDir, "context.md");
  const finalPath = path.join(delegateDir, "final.md");
  const eventsPath = path.join(delegateDir, "events.jsonl");
  const stdoutPath = path.join(delegateDir, "stdout.log");
  const stderrPath = path.join(delegateDir, "stderr.log");
  const artifactPath = path.join(delegateDir, "artifacts", `${options.specialist.name}.md`);

  await fs.writeFile(
    requestPath,
    [`# ${options.specialist.name}`, "", `Reason: ${options.specialist.reason}`, "", `Review request: ${options.input}`].join("\n"),
    "utf8"
  );

  const { prompt, context } = await buildDeliverSpecialistPrompt({
    cwd: options.cwd,
    input: options.input,
    name: options.specialist.name,
    reason: options.specialist.reason,
    buildSummary: options.buildSummary,
    verificationRecord: options.verificationRecord
  });

  await fs.writeFile(promptPath, prompt, "utf8");
  await fs.writeFile(contextPath, `${context}\n`, "utf8");

  try {
    const result = await runCodexExec({
      cwd: options.cwd,
      workflow: "review",
      runId: `${options.runId}-${options.specialist.name}`,
      prompt,
      finalPath,
      eventsPath,
      stdoutPath,
      stderrPath,
      config: options.config
    });
    const finalBody = await fs.readFile(finalPath, "utf8");
    await fs.writeFile(artifactPath, finalBody, "utf8");

    return {
      execution: {
        name: options.specialist.name,
        reason: options.specialist.reason,
        status: result.code === 0 ? "completed" : "failed",
        disposition: result.code === 0 ? "accepted" : "discarded",
        specialistDir: delegateDir,
        artifactPath,
        notes: result.code === 0 ? "Accepted provisionally until the review lead synthesizes the final verdict." : `Exited with code ${result.code}.`
      },
      finalBody
    };
  } catch (error) {
    return {
      execution: {
        name: options.specialist.name,
        reason: options.specialist.reason,
        status: "failed",
        disposition: "discarded",
        specialistDir: delegateDir,
        notes: error instanceof Error ? error.message : String(error)
      },
      finalBody: ""
    };
  }
}

function buildFinalSummary(options: {
  input: string;
  linkedContext?: LinkedReviewContext;
  stageLineage: StageLineage;
  reviewVerdict: DeliverReviewVerdict;
}): string {
  return [
    "# Review Run Summary",
    "",
    "## Request",
    options.input,
    "",
    "## Linked upstream run",
    options.linkedContext ? `- ${options.linkedContext.runId} (${options.linkedContext.workflow})` : "- none",
    "",
    "## Stage status",
    ...options.stageLineage.stages.map((stage) => `- ${stage.name}: ${stage.status}${stage.notes ? ` (${stage.notes})` : ""}`),
    "",
    "## Specialist status",
    ...(options.stageLineage.specialists.length > 0
      ? options.stageLineage.specialists.map(
          (specialist) => `- ${specialist.name}: ${specialist.status}, disposition=${specialist.disposition}`
        )
      : ["- none"]),
    "",
    "## Verdict",
    `- status: ${options.reviewVerdict.status}`,
    `- summary: ${options.reviewVerdict.summary}`,
    ...options.reviewVerdict.recommendedActions.map((action) => `- action: ${action}`)
  ].join("\n") + "\n";
}

function notRunVerificationRecord(): BuildVerificationRecord {
  return {
    status: "not-run",
    requestedCommands: [],
    results: [],
    notes: "No verification record was linked to this review run."
  };
}

export async function resolveLinkedReviewContext(cwd: string, runId: string): Promise<LinkedReviewContext> {
  const linked = await resolveLinkedBuildContext(cwd, runId);
  const runDir = path.dirname(linked.run.finalPath);

  if (linked.run.workflow === "build") {
    return {
      runId: linked.run.id,
      workflow: linked.run.workflow,
      artifactPath: linked.artifactPath,
      artifactBody: linked.artifactBody,
      buildSummary: linked.artifactBody,
      verificationRecord: (await readJsonFile<BuildVerificationRecord>(path.join(runDir, "artifacts", "verification.json"))) ?? notRunVerificationRecord()
    };
  }

  if (linked.run.workflow === "deliver") {
    const buildSummaryPath = path.join(runDir, "stages", "build", "artifacts", "change-summary.md");
    const verificationPath = path.join(runDir, "stages", "build", "artifacts", "verification.json");
    const validationPlanPath = path.join(runDir, "stages", "validation", "validation-plan.json");
    const validationLocalPath = path.join(runDir, "stages", "validation", "artifacts", "local-validation.json");
    const buildSummary = (await fs.readFile(buildSummaryPath, "utf8").catch(() => linked.artifactBody)) || linked.artifactBody;
    const validationPlan = await readJsonFile<DeliverValidationPlan>(validationPlanPath);
    const validationLocalRecord = await readJsonFile<DeliverValidationLocalRecord>(validationLocalPath);
    return {
      runId: linked.run.id,
      workflow: linked.run.workflow,
      artifactPath: buildSummaryPath,
      artifactBody: buildSummary,
      buildSummary,
      verificationRecord: (await readJsonFile<BuildVerificationRecord>(verificationPath)) ?? notRunVerificationRecord(),
      ...(validationPlan ? { validationPlan } : {}),
      ...(validationLocalRecord ? { validationLocalRecord } : {})
    };
  }

  return {
    runId: linked.run.id,
    workflow: linked.run.workflow,
    artifactPath: linked.artifactPath,
    artifactBody: linked.artifactBody,
    buildSummary: linked.artifactBody,
    verificationRecord: notRunVerificationRecord()
  };
}

export async function runReviewExecution(options: ReviewExecutionOptions): Promise<ReviewExecutionResult> {
  const selectedSpecialists = selectedSpecialistsForInput(options.input);
  const linkedContext = options.linkedContext;
  const stageLineage: StageLineage = {
    intent: options.input,
    stages: [
      {
        name: "review",
        rationale: "Critique the current change, risks, and next actions.",
        status: "running",
        executed: false
      }
    ],
    specialists: []
  };
  await writeJson(options.paths.stageLineagePath, stageLineage);

  const buildSummary = linkedContext?.buildSummary ?? linkedContext?.artifactBody ?? options.input;
  const verificationRecord = linkedContext?.verificationRecord ?? notRunVerificationRecord();
  const specialistResults: Array<{ name: SpecialistSelection["name"]; reason: string; finalBody: string }> = [];

  for (const specialist of selectedSpecialists) {
    const result = await runReviewSpecialist({
      cwd: options.cwd,
      runId: options.runId,
      runDir: options.paths.runDir,
      input: options.input,
      specialist,
      config: options.config,
      buildSummary,
      verificationRecord
    });
    stageLineage.specialists.push(result.execution);
    specialistResults.push({
      name: specialist.name,
      reason: specialist.reason,
      finalBody: result.finalBody
    });
  }

  const reviewPrompt = await buildDeliverReviewLeadPrompt({
    cwd: options.cwd,
    input: options.input,
    buildSummary,
    verificationRecord,
    ...(linkedContext?.validationPlan ? { validationPlan: linkedContext.validationPlan } : {}),
    ...(linkedContext?.validationLocalRecord ? { validationLocalRecord: linkedContext.validationLocalRecord } : {}),
    specialistResults
  });
  await fs.writeFile(options.paths.promptPath, reviewPrompt.prompt, "utf8");
  await fs.writeFile(options.paths.contextPath, `${reviewPrompt.context}\n`, "utf8");

  const reviewResult = await runCodexExec({
    cwd: options.cwd,
    workflow: "review",
    runId: options.runId,
    prompt: reviewPrompt.prompt,
    finalPath: options.paths.finalPath,
    eventsPath: options.paths.eventsPath,
    stdoutPath: options.paths.stdoutPath,
    stderrPath: options.paths.stderrPath,
    config: options.config
  });
  const reviewRaw = await fs.readFile(options.paths.finalPath, "utf8");
  const reviewVerdict = parseJson<DeliverReviewVerdict>(reviewRaw, "Review lead");

  await fs.writeFile(options.paths.findingsPath, reviewVerdict.reportMarkdown, "utf8");
  await writeJson(options.paths.findingsJsonPath, {
    findings: reviewVerdict.findings,
    recommendedActions: reviewVerdict.recommendedActions,
    acceptedSpecialists: reviewVerdict.acceptedSpecialists
  });
  await writeJson(options.paths.verdictPath, reviewVerdict);

  const acceptedByName = new Map(reviewVerdict.acceptedSpecialists.map((entry) => [entry.name, entry]));
  stageLineage.specialists = stageLineage.specialists.map((execution) => {
    const accepted = acceptedByName.get(execution.name);
    return accepted
      ? {
          ...execution,
          disposition: accepted.disposition,
          notes: accepted.reason
        }
      : {
          ...execution,
          disposition: "discarded",
          notes: execution.notes ?? "The review lead did not rely on this specialist output."
        };
  });

  stageLineage.stages[0] = {
    ...stageLineage.stages[0]!,
    status: reviewResult.code === 0 ? "completed" : "failed",
    executed: true,
    stageDir: options.paths.runDir,
    artifactPath: options.paths.findingsPath,
    notes: reviewVerdict.summary
  };
  await writeJson(options.paths.stageLineagePath, stageLineage);

  const finalBody = buildFinalSummary({
    input: options.input,
    stageLineage,
    reviewVerdict,
    ...(linkedContext ? { linkedContext } : {})
  });
  await fs.writeFile(options.paths.finalPath, finalBody, "utf8");

  return {
    reviewVerdict,
    selectedSpecialists,
    stageLineage,
    finalBody,
    executionSucceeded: reviewResult.code === 0
  };
}
