import path from "node:path";
import { promises as fs } from "node:fs";
import { resolveLinkedBuildContext } from "./build.js";
import { runCodexExec } from "./codex.js";
import { buildDeliverShipPrompt } from "./prompt.js";
import { collectGitHubDeliveryEvidence, performGitHubDeliverMutations } from "./github.js";
import type {
  BuildVerificationRecord,
  CstackConfig,
  DeliverReviewVerdict,
  DeliverShipRecord,
  DeliverTargetMode,
  GitHubDeliveryRecord,
  GitHubMutationRecord,
  StageLineage,
  WorkflowName
} from "./types.js";

export interface LinkedShipContext {
  runId: string;
  workflow: WorkflowName;
  artifactPath: string | null;
  artifactBody: string;
  buildSummary: string;
  verificationRecord: BuildVerificationRecord;
  reviewVerdict: DeliverReviewVerdict;
}

export interface ShipPaths {
  runDir: string;
  promptPath: string;
  contextPath: string;
  finalPath: string;
  eventsPath: string;
  stdoutPath: string;
  stderrPath: string;
  shipSummaryPath: string;
  checklistPath: string;
  unresolvedPath: string;
  shipRecordPath: string;
  githubMutationPath: string;
  githubDeliveryPath: string;
  stageLineagePath: string;
  pullRequestBodyPath: string;
}

export interface ShipExecutionOptions {
  cwd: string;
  gitBranch: string;
  runId: string;
  input: string;
  config: CstackConfig;
  paths: ShipPaths;
  deliveryMode: DeliverTargetMode;
  issueNumbers: number[];
  linkedContext?: LinkedShipContext;
}

export interface ShipExecutionResult {
  shipRecord: DeliverShipRecord;
  githubMutationRecord: GitHubMutationRecord;
  githubDeliveryRecord: GitHubDeliveryRecord;
  stageLineage: StageLineage;
  finalBody: string;
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

function renderChecklistMarkdown(record: DeliverShipRecord): string {
  return [
    "# Release Checklist",
    "",
    ...record.checklist.map((item) => `- [${item.status === "complete" ? "x" : " "}] ${item.item}${item.notes ? `: ${item.notes}` : ""}`)
  ].join("\n") + "\n";
}

function renderUnresolvedMarkdown(record: DeliverShipRecord): string {
  return ["# Unresolved", "", ...(record.unresolved.length > 0 ? record.unresolved.map((item) => `- ${item}`) : ["- none"])].join("\n") + "\n";
}

function mergeUniqueLines(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function notRunVerificationRecord(): BuildVerificationRecord {
  return {
    status: "not-run",
    requestedCommands: [],
    results: [],
    notes: "No verification record was linked to this ship run."
  };
}

function blockedReviewVerdict(summary: string): DeliverReviewVerdict {
  return {
    status: "blocked",
    summary,
    findings: [
      {
        severity: "high",
        title: "Review evidence missing",
        detail: summary
      }
    ],
    recommendedActions: ["Run `cstack review --from-run <run-id>` before shipping."],
    acceptedSpecialists: [],
    reportMarkdown: `# Review Findings\n\n- ${summary}\n`
  };
}

async function resolveBuildContextFromRun(cwd: string, runId: string): Promise<{
  buildSummary: string;
  verificationRecord: BuildVerificationRecord;
}> {
  const linked = await resolveLinkedBuildContext(cwd, runId);
  const runDir = path.dirname(linked.run.finalPath);
  if (linked.run.workflow === "build") {
    return {
      buildSummary: linked.artifactBody,
      verificationRecord: (await readJsonFile<BuildVerificationRecord>(path.join(runDir, "artifacts", "verification.json"))) ?? notRunVerificationRecord()
    };
  }
  if (linked.run.workflow === "deliver") {
    return {
      buildSummary: (await fs.readFile(path.join(runDir, "stages", "build", "artifacts", "change-summary.md"), "utf8").catch(() => linked.artifactBody)) || linked.artifactBody,
      verificationRecord:
        (await readJsonFile<BuildVerificationRecord>(path.join(runDir, "stages", "build", "artifacts", "verification.json"))) ??
        notRunVerificationRecord()
    };
  }
  return {
    buildSummary: linked.artifactBody,
    verificationRecord: notRunVerificationRecord()
  };
}

export async function resolveLinkedShipContext(cwd: string, runId: string): Promise<LinkedShipContext> {
  const linked = await resolveLinkedBuildContext(cwd, runId);
  const runDir = path.dirname(linked.run.finalPath);

  if (linked.run.workflow === "deliver") {
    return {
      runId: linked.run.id,
      workflow: linked.run.workflow,
      artifactPath: linked.artifactPath,
      artifactBody: linked.artifactBody,
      buildSummary: (await fs.readFile(path.join(runDir, "stages", "build", "artifacts", "change-summary.md"), "utf8").catch(() => linked.artifactBody)) || linked.artifactBody,
      verificationRecord:
        (await readJsonFile<BuildVerificationRecord>(path.join(runDir, "stages", "build", "artifacts", "verification.json"))) ??
        notRunVerificationRecord(),
      reviewVerdict:
        (await readJsonFile<DeliverReviewVerdict>(path.join(runDir, "stages", "review", "artifacts", "verdict.json"))) ??
        blockedReviewVerdict("Linked deliver run did not contain a review verdict artifact.")
    };
  }

  if (linked.run.workflow === "review") {
    const verdict = (await readJsonFile<DeliverReviewVerdict>(path.join(runDir, "artifacts", "verdict.json"))) ?? blockedReviewVerdict("Linked review run did not contain a verdict artifact.");
    const upstreamRunId = linked.run.inputs.linkedRunId;
    const upstream =
      upstreamRunId ? await resolveBuildContextFromRun(cwd, upstreamRunId) : { buildSummary: linked.artifactBody, verificationRecord: notRunVerificationRecord() };
    return {
      runId: linked.run.id,
      workflow: linked.run.workflow,
      artifactPath: linked.artifactPath,
      artifactBody: linked.artifactBody,
      buildSummary: upstream.buildSummary,
      verificationRecord: upstream.verificationRecord,
      reviewVerdict: verdict
    };
  }

  if (linked.run.workflow === "build") {
    return {
      runId: linked.run.id,
      workflow: linked.run.workflow,
      artifactPath: linked.artifactPath,
      artifactBody: linked.artifactBody,
      buildSummary: linked.artifactBody,
      verificationRecord: (await readJsonFile<BuildVerificationRecord>(path.join(runDir, "artifacts", "verification.json"))) ?? notRunVerificationRecord(),
      reviewVerdict: blockedReviewVerdict("Ship requires review evidence, but the linked build run has not been reviewed yet.")
    };
  }

  return {
    runId: linked.run.id,
    workflow: linked.run.workflow,
    artifactPath: linked.artifactPath,
    artifactBody: linked.artifactBody,
    buildSummary: linked.artifactBody,
    verificationRecord: notRunVerificationRecord(),
    reviewVerdict: blockedReviewVerdict("Ship requires linked review evidence.")
  };
}

function buildFinalSummary(options: {
  input: string;
  linkedContext?: LinkedShipContext;
  stageLineage: StageLineage;
  shipRecord: DeliverShipRecord;
  githubMutationRecord: GitHubMutationRecord;
  githubDeliveryRecord: GitHubDeliveryRecord;
}): string {
  return [
    "# Ship Run Summary",
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
    "## Ship readiness",
    `- readiness: ${options.shipRecord.readiness}`,
    `- summary: ${options.shipRecord.summary}`,
    ...options.shipRecord.nextActions.map((action) => `- next: ${action}`),
    "",
    "## GitHub mutations",
    `- summary: ${options.githubMutationRecord.summary}`,
    ...(options.githubMutationRecord.pullRequest.url ? [`- pull request: ${options.githubMutationRecord.pullRequest.url}`] : []),
    ...options.githubMutationRecord.blockers.map((blocker) => `- mutation blocker: ${blocker}`),
    "",
    "## GitHub delivery",
    `- status: ${options.githubDeliveryRecord.overall.status}`,
    `- summary: ${options.githubDeliveryRecord.overall.summary}`,
    ...options.githubDeliveryRecord.overall.blockers.map((blocker) => `- blocker: ${blocker}`)
  ].join("\n") + "\n";
}

export async function runShipExecution(options: ShipExecutionOptions): Promise<ShipExecutionResult> {
  const policy = options.config.workflows.ship.github ?? options.config.workflows.deliver.github ?? {};
  const linkedContext = options.linkedContext;
  const buildSummary = linkedContext?.buildSummary ?? linkedContext?.artifactBody ?? options.input;
  const verificationRecord = linkedContext?.verificationRecord ?? notRunVerificationRecord();
  const reviewVerdict = linkedContext?.reviewVerdict ?? blockedReviewVerdict("Ship requires review evidence.");

  const stageLineage: StageLineage = {
    intent: options.input,
    stages: [
      {
        name: "ship",
        rationale: "Prepare handoff or release artifacts and evaluate GitHub delivery policy.",
        status: "running",
        executed: false
      }
    ],
    specialists: []
  };
  await writeJson(options.paths.stageLineagePath, stageLineage);

  const githubMutation = await performGitHubDeliverMutations({
    cwd: options.cwd,
    gitBranch: options.gitBranch,
    runId: options.runId,
    input: options.input,
    issueNumbers: options.issueNumbers,
    policy,
    buildSummary,
    reviewVerdict,
    verificationRecord,
    ...(linkedContext ? { linkedRunId: linkedContext.runId } : {}),
    pullRequestBodyPath: options.paths.pullRequestBodyPath
  });
  const githubEvidence = await collectGitHubDeliveryEvidence({
    cwd: options.cwd,
    gitBranch: githubMutation.branch,
    deliveryMode: options.deliveryMode,
    issueNumbers: options.issueNumbers,
    policy,
    input: options.input,
    mutationRecord: githubMutation.record,
    ...(linkedContext?.artifactBody ? { linkedArtifactBody: linkedContext.artifactBody } : {})
  });
  const githubDeliveryRecord = githubEvidence.record;

  const shipPrompt = await buildDeliverShipPrompt({
    cwd: options.cwd,
    input: options.input,
    buildSummary,
    reviewVerdict,
    verificationRecord,
    githubMutationRecord: githubMutation.record,
    githubDeliveryRecord
  });
  await fs.writeFile(options.paths.promptPath, shipPrompt.prompt, "utf8");
  await fs.writeFile(options.paths.contextPath, `${shipPrompt.context}\n`, "utf8");

  const shipResult = await runCodexExec({
    cwd: options.cwd,
    workflow: "ship",
    runId: options.runId,
    prompt: shipPrompt.prompt,
    finalPath: options.paths.finalPath,
    eventsPath: options.paths.eventsPath,
    stdoutPath: options.paths.stdoutPath,
    stderrPath: options.paths.stderrPath,
    config: options.config
  });
  const shipRaw = await fs.readFile(options.paths.finalPath, "utf8");
  let shipRecord = parseJson<DeliverShipRecord>(shipRaw, "Ship lead");

  if (reviewVerdict.status !== "ready") {
    shipRecord = {
      ...shipRecord,
      readiness: "blocked",
      summary: `${shipRecord.summary} Review evidence is blocked.`,
      unresolved: mergeUniqueLines([...shipRecord.unresolved, reviewVerdict.summary]),
      nextActions: mergeUniqueLines([...shipRecord.nextActions, ...reviewVerdict.recommendedActions]),
      checklist: [
        ...shipRecord.checklist,
        {
          item: "Review verdict",
          status: "blocked",
          notes: reviewVerdict.summary
        }
      ]
    };
  }

  if (githubDeliveryRecord.overall.status === "blocked") {
    shipRecord = {
      ...shipRecord,
      readiness: "blocked",
      summary: `${shipRecord.summary} GitHub delivery is blocked.`,
      unresolved: mergeUniqueLines([...shipRecord.unresolved, ...githubDeliveryRecord.overall.blockers]),
      nextActions: mergeUniqueLines([...shipRecord.nextActions, ...githubDeliveryRecord.overall.blockers]),
      checklist: [
        ...shipRecord.checklist,
        {
          item: "GitHub delivery policy",
          status: "blocked",
          notes: githubDeliveryRecord.overall.blockers.join("; ")
        }
      ],
      reportMarkdown: `${shipRecord.reportMarkdown.trimEnd()}\n\n## GitHub delivery\n\nStatus: blocked\n`
    };
  } else {
    shipRecord = {
      ...shipRecord,
      checklist: [
        ...shipRecord.checklist,
        {
          item: "GitHub delivery policy",
          status: "complete",
          notes: githubDeliveryRecord.overall.summary
        }
      ],
      reportMarkdown: `${shipRecord.reportMarkdown.trimEnd()}\n\n## GitHub delivery\n\nStatus: ready\n`
    };
  }

  await fs.writeFile(options.paths.shipSummaryPath, shipRecord.reportMarkdown, "utf8");
  await fs.writeFile(options.paths.checklistPath, renderChecklistMarkdown(shipRecord), "utf8");
  await fs.writeFile(options.paths.unresolvedPath, renderUnresolvedMarkdown(shipRecord), "utf8");
  await writeJson(options.paths.shipRecordPath, shipRecord);
  await writeJson(path.join(options.paths.runDir, "artifacts", "github-state.json"), githubEvidence.artifacts.githubState);
  await writeJson(path.join(options.paths.runDir, "artifacts", "pull-request.json"), githubEvidence.artifacts.pullRequest);
  await writeJson(path.join(options.paths.runDir, "artifacts", "issues.json"), githubEvidence.artifacts.issues);
  await writeJson(path.join(options.paths.runDir, "artifacts", "checks.json"), githubEvidence.artifacts.checks);
  await writeJson(path.join(options.paths.runDir, "artifacts", "actions.json"), githubEvidence.artifacts.actions);
  await writeJson(path.join(options.paths.runDir, "artifacts", "security.json"), githubEvidence.artifacts.security);
  await writeJson(path.join(options.paths.runDir, "artifacts", "release.json"), githubEvidence.artifacts.release);
  await writeJson(options.paths.githubMutationPath, githubMutation.record);
  await writeJson(options.paths.githubDeliveryPath, githubDeliveryRecord);

  stageLineage.stages[0] = {
    ...stageLineage.stages[0]!,
    status:
      shipResult.code === 0 && githubMutation.record.blockers.length === 0 && shipRecord.readiness === "ready" && githubDeliveryRecord.overall.status === "ready"
        ? "completed"
        : "failed",
    executed: true,
    stageDir: options.paths.runDir,
    artifactPath: options.paths.shipSummaryPath,
    notes: shipRecord.summary
  };
  await writeJson(options.paths.stageLineagePath, stageLineage);

  const finalBody = buildFinalSummary({
    input: options.input,
    stageLineage,
    shipRecord,
    githubMutationRecord: githubMutation.record,
    githubDeliveryRecord,
    ...(linkedContext ? { linkedContext } : {})
  });
  await fs.writeFile(options.paths.finalPath, finalBody, "utf8");

  return {
    shipRecord,
    githubMutationRecord: githubMutation.record,
    githubDeliveryRecord,
    stageLineage,
    finalBody
  };
}
