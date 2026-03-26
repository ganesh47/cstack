import path from "node:path";
import { promises as fs } from "node:fs";
import { buildEvent, ProgressReporter } from "./progress.js";
import { resolveLinkedBuildContext, runBuildExecution, type BuildExecutionResult, type LinkedBuildContext } from "./build.js";
import { runCodexExec } from "./codex.js";
import { collectGitHubDeliveryEvidence, performGitHubDeliverMutations } from "./github.js";
import {
  buildDeliverPrompt,
  buildDeliverReviewLeadPrompt,
  buildDeliverShipPrompt,
  buildDeliverSpecialistPrompt
} from "./prompt.js";
import { inferRoutingPlan } from "./intent.js";
import { runDeliverValidationExecution, type DeliverValidationExecutionResult } from "./validation.js";
import type {
  CstackConfig,
  DeliverTargetMode,
  DeliverReviewVerdict,
  DeliverShipRecord,
  GitHubDeliveryRecord,
  GitHubMutationRecord,
  RoutingStagePlan,
  RunEvent,
  SpecialistExecution,
  SpecialistSelection,
  StageLineage,
  WorkflowMode
} from "./types.js";

export interface DeliverPaths {
  runDir: string;
  promptPath: string;
  contextPath: string;
  finalPath: string;
  deliveryReportPath: string;
  eventsPath: string;
  stdoutPath: string;
  stderrPath: string;
  stageLineagePath: string;
}

export interface DeliverExecutionOptions {
  cwd: string;
  gitBranch: string;
  runId: string;
  input: string;
  config: CstackConfig;
  paths: DeliverPaths;
  requestedMode: WorkflowMode;
  linkedContext?: LinkedBuildContext | undefined;
  verificationCommands: string[];
  deliveryMode: DeliverTargetMode;
  issueNumbers: number[];
  buildTimeoutSeconds?: number;
  reviewTimeoutSeconds?: number;
  shipTimeoutSeconds?: number;
}

export interface DeliverExecutionResult {
  buildExecution: BuildExecutionResult;
  validationExecution: DeliverValidationExecutionResult;
  reviewVerdict: DeliverReviewVerdict;
  shipRecord: DeliverShipRecord;
  githubDeliveryRecord: GitHubDeliveryRecord;
  githubMutationRecord: GitHubMutationRecord;
  stageLineage: StageLineage;
  selectedSpecialists: SpecialistSelection[];
  finalBody: string;
}

function buildDeliverStages(): RoutingStagePlan[] {
  return [
    {
      name: "build",
      rationale: "Implement the approved change and capture verification evidence.",
      status: "planned",
      executed: false
    },
    {
      name: "validation",
      rationale: "Profile the repo, design the validation pyramid, and execute selected validation commands.",
      status: "planned",
      executed: false
    },
    {
      name: "review",
      rationale: "Challenge correctness, security, and release risk using bounded specialist reviews plus validation evidence.",
      status: "planned",
      executed: false
    },
    {
      name: "ship",
      rationale: "Prepare release-readiness artifacts and explicit next actions.",
      status: "planned",
      executed: false
    }
  ];
}

function selectDeliverSpecialists(input: string): SpecialistSelection[] {
  return inferRoutingPlan(input, "run").specialists.filter((specialist) => specialist.selected).slice(0, 3);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createDeliverEventRecorder(runId: string, eventsPath: string) {
  const reporter = new ProgressReporter("deliver", runId);
  const startedAt = Date.now();
  reporter.setStages(["build", "validation", "review", "ship"]);

  return {
    async emit(type: RunEvent["type"], message: string): Promise<void> {
      const event = buildEvent(type, Date.now() - startedAt, message);
      await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
      reporter.emit(event);
    },
    markStage(name: "build" | "validation" | "review" | "ship", status: "pending" | "running" | "completed" | "failed" | "deferred" | "skipped") {
      reporter.markStage(name, status);
    },
    setSpecialists(names: string[]) {
      reporter.setSpecialists(names);
    },
    markSpecialist(name: string, status: "pending" | "running" | "completed" | "failed" | "deferred" | "skipped") {
      reporter.markSpecialist(name, status);
    },
    close() {
      reporter.close();
    }
  };
}

function deliverStageDir(runDir: string, stage: "build" | "validation" | "review" | "ship"): string {
  return path.join(runDir, "stages", stage);
}

async function runDeliverSpecialist(options: {
  cwd: string;
  runId: string;
  stageDir: string;
  input: string;
  specialist: SpecialistSelection;
  config: CstackConfig;
  buildSummary: string;
  verificationRecord: object;
}): Promise<{ execution: SpecialistExecution; finalBody: string }> {
  const delegateDir = path.join(options.stageDir, "delegates", options.specialist.name);
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
    [`# ${options.specialist.name}`, "", `Reason: ${options.specialist.reason}`, "", `Deliver request: ${options.input}`].join("\n"),
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
      workflow: "deliver",
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

function summarizeBuildFailure(buildExecution: BuildExecutionResult): string {
  if (buildExecution.failureDiagnosis?.summary) {
    return buildExecution.failureDiagnosis.summary;
  }
  if (buildExecution.result.timedOut && buildExecution.result.timeoutSeconds) {
    return `Build timed out after ${buildExecution.result.timeoutSeconds}s.`;
  }
  return `Build exited with code ${buildExecution.result.code}${buildExecution.result.signal ? ` (${buildExecution.result.signal})` : ""}.`;
}

function createBlockedValidationExecution(buildExecution: BuildExecutionResult): DeliverValidationExecutionResult {
  const summary = `Validation was blocked because the build stage did not complete successfully. ${summarizeBuildFailure(buildExecution)}`;
  return {
    repoProfile: {
      detectedAt: new Date().toISOString(),
      languages: [],
      buildSystems: [],
      surfaces: [],
      packageManagers: [],
      ciSystems: [],
      runnerConstraints: [],
      manifests: [],
      workflowFiles: [],
      existingTests: [],
      packageScripts: [],
      detectedTools: [],
      workspaceTargets: [],
      limitations: ["Validation profiling was skipped because build failed first."]
    },
    toolResearch: {
      generatedAt: new Date().toISOString(),
      summary,
      candidates: [],
      selectedTools: [],
      limitations: ["Tool research was skipped because build failed first."]
    },
    validationPlan: {
      status: "blocked",
      summary,
      profileSummary: "Validation profiling was skipped because build failed first.",
      layers: [],
      selectedSpecialists: [],
      localValidation: {
        commands: [],
        prerequisites: [],
        notes: ["Local validation was skipped because build failed first."]
      },
      ciValidation: {
        workflowFiles: [],
        jobs: [],
        notes: ["CI validation planning was skipped because build failed first."]
      },
      coverage: {
        confidence: "low",
        summary: "No validation evidence was collected because build failed first.",
        signals: [],
        gaps: ["Build failed before validation could run."]
      },
      recommendedChanges: ["Fix the build failure before rerunning deliver."],
      unsupported: [],
      pyramidMarkdown: "# Test Pyramid\n\nBlocked because build failed before validation could run.\n",
      reportMarkdown: "# Validation Summary\n\nBlocked because build failed before validation could run.\n",
      githubActionsPlanMarkdown: "# GitHub Actions Validation Plan\n\nBlocked because build failed before validation could run.\n"
    },
    localValidationRecord: {
      status: "not-run",
      requestedCommands: [],
      results: [],
      notes: "Local validation was skipped because build failed first."
    },
    coverageSummary: {
      status: "blocked",
      confidence: "low",
      summary: "No validation evidence was collected because build failed first.",
      signals: [],
      gaps: ["Build failed before validation could run."],
      localValidationStatus: "not-run"
    },
    selectedSpecialists: [],
    specialistExecutions: [],
    finalBody: "# Validation Summary\n\nBlocked because build failed before validation could run.\n"
  };
}

function createBlockedReviewVerdict(buildExecution: BuildExecutionResult): DeliverReviewVerdict {
  const summary = `Deliver review was blocked because build failed first. ${summarizeBuildFailure(buildExecution)}`;
  return {
    mode: "readiness",
    status: "blocked",
    summary,
    findings: [
      {
        severity: "high",
        title: "Build failed",
        detail: summary
      }
    ],
    recommendedActions: ["Fix the build failure before rerunning deliver review."],
    acceptedSpecialists: [],
    reportMarkdown: "# Review Findings\n\nBlocked because build failed before deliver review could run.\n"
  };
}

function createBlockedShipRecord(buildExecution: BuildExecutionResult): DeliverShipRecord {
  const summary = `Ship readiness is blocked because build failed first. ${summarizeBuildFailure(buildExecution)}`;
  return {
    readiness: "blocked",
    summary,
    checklist: [
      {
        item: "Build completed successfully",
        status: "blocked",
        notes: summarizeBuildFailure(buildExecution)
      }
    ],
    unresolved: ["Fix the build failure before release-readiness evaluation can continue."],
    nextActions: ["Fix the build failure and rerun `cstack deliver`."],
    reportMarkdown: "# Ship Summary\n\nBlocked because build failed before ship readiness could run.\n"
  };
}

function createBlockedGitHubMutationRecord(): GitHubMutationRecord {
  return {
    enabled: false,
    branch: {
      initial: "",
      current: "",
      created: false,
      pushed: false,
      remote: null
    },
    commit: {
      created: false,
      changedFiles: []
    },
    pullRequest: {
      created: false,
      updated: false
    },
    checks: {
      watched: false,
      polls: 0,
      completed: false,
      summary: "GitHub mutation was skipped because build failed first."
    },
    blockers: ["Build failed before GitHub mutation could run."],
    summary: "GitHub mutation skipped because build failed first."
  };
}

function createBlockedGitHubDeliveryRecord(options: {
  gitBranch: string;
  deliveryMode: DeliverTargetMode;
  issueNumbers: number[];
  config: CstackConfig;
  githubMutationRecord: GitHubMutationRecord;
}): GitHubDeliveryRecord {
  const observedAt = new Date().toISOString();
  const summary = "GitHub delivery was not evaluated because build failed first.";
  const blocked = {
    required: false,
    status: "blocked" as const,
    summary,
    blockers: ["Build failed before GitHub delivery evaluation could run."],
    observedAt,
    source: "none" as const,
    observed: null
  };

  return {
    repository: options.config.workflows.deliver.github?.repository ?? null,
    mode: options.deliveryMode,
    branch: {
      name: options.gitBranch,
      headSha: "",
      defaultBranch: null
    },
    requestedPolicy: options.config.workflows.deliver.github ?? {},
    issueReferences: options.issueNumbers,
    branchState: {
      ...blocked,
      observed: {
        current: options.gitBranch,
        headSha: "",
        defaultBranch: null
      }
    },
    pullRequest: blocked,
    issues: {
      ...blocked,
      observed: []
    },
    checks: {
      ...blocked,
      observed: []
    },
    actions: {
      ...blocked,
      observed: []
    },
    release: blocked,
    security: {
      ...blocked,
      observed: {
        dependabot: [],
        codeScanning: []
      }
    },
    mutation: options.githubMutationRecord,
    overall: {
      status: "blocked",
      summary,
      blockers: ["Build failed before GitHub delivery evaluation could run."],
      observedAt
    },
    limitations: ["GitHub delivery evaluation was skipped because build failed first."]
  };
}

async function writeBlockedDeliverStageArtifacts(options: {
  validationStageDir: string;
  reviewStageDir: string;
  shipStageDir: string;
  validationExecution: DeliverValidationExecutionResult;
  reviewVerdict: DeliverReviewVerdict;
  shipRecord: DeliverShipRecord;
  githubMutationRecord: GitHubMutationRecord;
  githubDeliveryRecord: GitHubDeliveryRecord;
}): Promise<void> {
  await fs.mkdir(path.join(options.validationStageDir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(options.reviewStageDir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(options.shipStageDir, "artifacts"), { recursive: true });

  await fs.writeFile(path.join(options.validationStageDir, "final.md"), options.validationExecution.finalBody, "utf8");
  await writeJson(path.join(options.validationStageDir, "repo-profile.json"), options.validationExecution.repoProfile);
  await writeJson(path.join(options.validationStageDir, "tool-research.json"), options.validationExecution.toolResearch);
  await writeJson(path.join(options.validationStageDir, "validation-plan.json"), options.validationExecution.validationPlan);
  await fs.writeFile(path.join(options.validationStageDir, "artifacts", "test-pyramid.md"), options.validationExecution.validationPlan.pyramidMarkdown, "utf8");
  await writeJson(path.join(options.validationStageDir, "artifacts", "coverage-summary.json"), options.validationExecution.coverageSummary);
  await fs.writeFile(
    path.join(options.validationStageDir, "artifacts", "coverage-gaps.md"),
    `# Coverage Gaps\n\n- ${options.validationExecution.coverageSummary.gaps.join("\n- ") || "Build failed before validation could run."}\n`,
    "utf8"
  );
  await writeJson(path.join(options.validationStageDir, "artifacts", "local-validation.json"), options.validationExecution.localValidationRecord);
  await writeJson(
    path.join(options.validationStageDir, "artifacts", "ci-validation.json"),
    options.validationExecution.validationPlan.ciValidation
  );
  await fs.writeFile(
    path.join(options.validationStageDir, "artifacts", "github-actions-plan.md"),
    options.validationExecution.validationPlan.githubActionsPlanMarkdown,
    "utf8"
  );
  await writeJson(path.join(options.validationStageDir, "artifacts", "test-inventory.json"), { status: "blocked", tests: [] });

  await fs.writeFile(path.join(options.reviewStageDir, "final.md"), `${JSON.stringify(options.reviewVerdict, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(options.reviewStageDir, "artifacts", "findings.md"), options.reviewVerdict.reportMarkdown, "utf8");
  await writeJson(path.join(options.reviewStageDir, "artifacts", "findings.json"), {
    findings: options.reviewVerdict.findings,
    recommendedActions: options.reviewVerdict.recommendedActions,
    acceptedSpecialists: options.reviewVerdict.acceptedSpecialists
  });
  await writeJson(path.join(options.reviewStageDir, "artifacts", "verdict.json"), options.reviewVerdict);

  await fs.writeFile(path.join(options.shipStageDir, "final.md"), `${JSON.stringify(options.shipRecord, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(options.shipStageDir, "artifacts", "ship-summary.md"), options.shipRecord.reportMarkdown, "utf8");
  await fs.writeFile(path.join(options.shipStageDir, "artifacts", "release-checklist.md"), renderChecklistMarkdown(options.shipRecord), "utf8");
  await fs.writeFile(path.join(options.shipStageDir, "artifacts", "unresolved.md"), renderUnresolvedMarkdown(options.shipRecord), "utf8");
  await writeJson(path.join(options.shipStageDir, "artifacts", "ship-record.json"), options.shipRecord);
  await writeJson(path.join(options.shipStageDir, "artifacts", "github-state.json"), { status: "blocked", summary: options.githubDeliveryRecord.overall.summary });
  await writeJson(path.join(options.shipStageDir, "artifacts", "pull-request.json"), options.githubDeliveryRecord.pullRequest);
  await writeJson(path.join(options.shipStageDir, "artifacts", "issues.json"), options.githubDeliveryRecord.issues);
  await writeJson(path.join(options.shipStageDir, "artifacts", "checks.json"), options.githubDeliveryRecord.checks);
  await writeJson(path.join(options.shipStageDir, "artifacts", "actions.json"), options.githubDeliveryRecord.actions);
  await writeJson(path.join(options.shipStageDir, "artifacts", "security.json"), options.githubDeliveryRecord.security);
  await writeJson(path.join(options.shipStageDir, "artifacts", "release.json"), options.githubDeliveryRecord.release);
  await writeJson(path.join(options.shipStageDir, "artifacts", "github-mutation.json"), options.githubMutationRecord);
}

function buildDeliverFinalSummary(options: {
  input: string;
  linkedContext?: LinkedBuildContext;
  stageLineage: StageLineage;
  validationExecution: DeliverValidationExecutionResult;
  reviewVerdict: DeliverReviewVerdict;
  shipRecord: DeliverShipRecord;
  githubDeliveryRecord: GitHubDeliveryRecord;
  githubMutationRecord: GitHubMutationRecord;
}): string {
  return [
    "# Deliver Run Summary",
    "",
    "## Request",
    options.input,
    "",
    "## Linked upstream run",
    options.linkedContext ? `- ${options.linkedContext.run.id} (${options.linkedContext.run.workflow})` : "- none",
    "",
    "## Stage status",
    ...options.stageLineage.stages.map((stage) => `- ${stage.name}: ${stage.status}${stage.notes ? ` (${stage.notes})` : ""}`),
    "",
    "## Validation",
    `- status: ${options.validationExecution.validationPlan.status}`,
    `- summary: ${options.validationExecution.validationPlan.summary}`,
    `- local validation: ${options.validationExecution.localValidationRecord.status}`,
    ...options.validationExecution.coverageSummary.gaps.map((gap) => `- gap: ${gap}`),
    "",
    "## Review verdict",
    `- status: ${options.reviewVerdict.status}`,
    `- summary: ${options.reviewVerdict.summary}`,
    ...(options.reviewVerdict.recommendedActions.map((action) => `- action: ${action}`) || []),
    "",
    "## Ship readiness",
    `- readiness: ${options.shipRecord.readiness}`,
    `- summary: ${options.shipRecord.summary}`,
    ...options.shipRecord.nextActions.map((action) => `- next: ${action}`),
    "",
    "## GitHub mutations",
    `- summary: ${options.githubMutationRecord.summary}`,
    `- branch: ${options.githubMutationRecord.branch.current}`,
    ...(options.githubMutationRecord.pullRequest.url ? [`- pull request: ${options.githubMutationRecord.pullRequest.url}`] : []),
    ...options.githubMutationRecord.blockers.map((blocker) => `- mutation blocker: ${blocker}`),
    "",
    "## GitHub delivery",
    `- status: ${options.githubDeliveryRecord.overall.status}`,
    `- summary: ${options.githubDeliveryRecord.overall.summary}`,
    ...options.githubDeliveryRecord.overall.blockers.map((blocker) => `- blocker: ${blocker}`)
  ].join("\n") + "\n";
}

function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`${context} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runDeliverExecution(options: DeliverExecutionOptions): Promise<DeliverExecutionResult> {
  const selectedSpecialists = selectDeliverSpecialists(options.input);
  const { prompt, context } = await buildDeliverPrompt({
    cwd: options.cwd,
    input: options.input,
    config: options.config,
    requestedMode: options.requestedMode,
    verificationCommands: options.verificationCommands,
    selectedSpecialists: selectedSpecialists.map((specialist) => specialist.name),
    ...(options.linkedContext?.artifactPath ? { linkedArtifactPath: options.linkedContext.artifactPath } : {}),
    ...(options.linkedContext?.artifactBody ? { linkedArtifactBody: options.linkedContext.artifactBody } : {}),
    ...(options.linkedContext?.run.id ? { linkedRunId: options.linkedContext.run.id } : {}),
    ...(options.linkedContext?.run.workflow ? { linkedWorkflow: options.linkedContext.run.workflow } : {})
  });

  await fs.writeFile(options.paths.promptPath, prompt, "utf8");
  await fs.writeFile(options.paths.contextPath, `${context}\n`, "utf8");
  await fs.writeFile(options.paths.stdoutPath, "", "utf8");
  await fs.writeFile(options.paths.stderrPath, "", "utf8");
  await fs.writeFile(options.paths.eventsPath, "", "utf8");

  const stageLineage: StageLineage = {
    intent: options.input,
    stages: buildDeliverStages(),
    specialists: []
  };
  await writeJson(options.paths.stageLineagePath, stageLineage);

  const events = createDeliverEventRecorder(options.runId, options.paths.eventsPath);
  events.setSpecialists(selectedSpecialists.map((specialist) => specialist.name));
  await events.emit("starting", "Running deliver workflow across build -> validation -> review -> ship");

  const buildStageDir = deliverStageDir(options.paths.runDir, "build");
  await fs.mkdir(path.join(buildStageDir, "artifacts"), { recursive: true });
  const buildStage = stageLineage.stages.find((stage) => stage.name === "build")!;
  buildStage.status = "running";
  await writeJson(options.paths.stageLineagePath, stageLineage);
  events.markStage("build", "running");

  const buildExecution = await runBuildExecution({
    cwd: options.cwd,
    runId: `${options.runId}-build`,
    input: options.input,
    config: options.config,
    requestedMode: options.requestedMode,
    verificationCommands: options.verificationCommands,
    linkedContext: options.linkedContext,
    paths: {
      runDir: buildStageDir,
      promptPath: path.join(buildStageDir, "prompt.md"),
      contextPath: path.join(buildStageDir, "context.md"),
      finalPath: path.join(buildStageDir, "final.md"),
      eventsPath: path.join(buildStageDir, "events.jsonl"),
      stdoutPath: path.join(buildStageDir, "stdout.log"),
      stderrPath: path.join(buildStageDir, "stderr.log"),
      sessionPath: path.join(buildStageDir, "session.json"),
      transcriptPath: path.join(buildStageDir, "artifacts", "build-transcript.log"),
      changeSummaryPath: path.join(buildStageDir, "artifacts", "change-summary.md"),
      verificationPath: path.join(buildStageDir, "artifacts", "verification.json"),
      recoveryAttemptsPath: path.join(buildStageDir, "artifacts", "recovery-attempts.json"),
      recoverySummaryPath: path.join(buildStageDir, "artifacts", "recovery-summary.md"),
      failureDiagnosisPath: path.join(buildStageDir, "artifacts", "failure-diagnosis.json")
    },
    ...(typeof options.buildTimeoutSeconds === "number" ? { timeoutSeconds: options.buildTimeoutSeconds } : {})
  });

  buildStage.status = buildExecution.result.code === 0 ? "completed" : "failed";
  buildStage.executed = true;
  buildStage.stageDir = buildStageDir;
  buildStage.artifactPath = path.join(buildStageDir, "artifacts", "change-summary.md");
  if (buildExecution.result.code !== 0) {
    buildStage.notes = summarizeBuildFailure(buildExecution);
  } else {
    delete buildStage.notes;
  }
  await writeJson(options.paths.stageLineagePath, stageLineage);
  events.markStage("build", buildExecution.result.code === 0 ? "completed" : "failed");
  if (buildExecution.result.code !== 0) {
    const buildFailureSummary = summarizeBuildFailure(buildExecution);
    const validationStageDir = deliverStageDir(options.paths.runDir, "validation");
    const reviewStageDir = deliverStageDir(options.paths.runDir, "review");
    const shipStageDir = deliverStageDir(options.paths.runDir, "ship");
    const validationExecution = createBlockedValidationExecution(buildExecution);
    const reviewVerdict = createBlockedReviewVerdict(buildExecution);
    const shipRecord = createBlockedShipRecord(buildExecution);
    const githubMutationRecord = createBlockedGitHubMutationRecord();
    const githubDeliveryRecord = createBlockedGitHubDeliveryRecord({
      gitBranch: options.gitBranch,
      deliveryMode: options.deliveryMode,
      issueNumbers: options.issueNumbers,
      config: options.config,
      githubMutationRecord
    });

    const validationStage = stageLineage.stages.find((stage) => stage.name === "validation")!;
    validationStage.status = "deferred";
    validationStage.executed = false;
    validationStage.stageDir = validationStageDir;
    validationStage.artifactPath = path.join(validationStageDir, "artifacts", "test-pyramid.md");
    validationStage.notes = `Blocked because build failed. ${buildFailureSummary}`;
    events.markStage("validation", "deferred");

    const reviewStage = stageLineage.stages.find((stage) => stage.name === "review")!;
    reviewStage.status = "deferred";
    reviewStage.executed = false;
    reviewStage.stageDir = reviewStageDir;
    reviewStage.artifactPath = path.join(reviewStageDir, "artifacts", "findings.md");
    reviewStage.notes = `Blocked because build failed. ${buildFailureSummary}`;
    events.markStage("review", "deferred");

    const shipStage = stageLineage.stages.find((stage) => stage.name === "ship")!;
    shipStage.status = "deferred";
    shipStage.executed = false;
    shipStage.stageDir = shipStageDir;
    shipStage.artifactPath = path.join(shipStageDir, "artifacts", "ship-summary.md");
    shipStage.notes = `Blocked because build failed. ${buildFailureSummary}`;
    events.markStage("ship", "deferred");

    await writeBlockedDeliverStageArtifacts({
      validationStageDir,
      reviewStageDir,
      shipStageDir,
      validationExecution,
      reviewVerdict,
      shipRecord,
      githubMutationRecord,
      githubDeliveryRecord
    });
    await writeJson(path.join(options.paths.runDir, "artifacts", "github-mutation.json"), githubMutationRecord);
    await writeJson(path.join(options.paths.runDir, "artifacts", "github-delivery.json"), githubDeliveryRecord);
    await writeJson(options.paths.stageLineagePath, stageLineage);
    await events.emit("failed", `Build failed; downstream stages blocked. ${buildFailureSummary}`);
    events.close();

    const finalBody = buildDeliverFinalSummary({
      input: options.input,
      stageLineage,
      validationExecution,
      reviewVerdict,
      shipRecord,
      githubMutationRecord,
      githubDeliveryRecord,
      ...(options.linkedContext ? { linkedContext: options.linkedContext } : {})
    });
    await fs.writeFile(options.paths.finalPath, finalBody, "utf8");
    await fs.writeFile(options.paths.deliveryReportPath, finalBody, "utf8");

    return {
      buildExecution,
      validationExecution,
      reviewVerdict,
      shipRecord,
      githubDeliveryRecord,
      githubMutationRecord,
      stageLineage,
      selectedSpecialists,
      finalBody
    };
  }
  await events.emit("activity", "Build stage finished, starting validation synthesis");

  const validationStageDir = deliverStageDir(options.paths.runDir, "validation");
  await fs.mkdir(path.join(validationStageDir, "artifacts"), { recursive: true });
  const validationStage = stageLineage.stages.find((stage) => stage.name === "validation")!;
  validationStage.status = "running";
  await writeJson(options.paths.stageLineagePath, stageLineage);
  events.markStage("validation", "running");

  const validationExecution = await runDeliverValidationExecution({
    cwd: options.cwd,
    runId: options.runId,
    input: options.input,
    config: options.config,
    paths: {
      stageDir: validationStageDir,
      promptPath: path.join(validationStageDir, "prompt.md"),
      contextPath: path.join(validationStageDir, "context.md"),
      finalPath: path.join(validationStageDir, "final.md"),
      eventsPath: path.join(validationStageDir, "events.jsonl"),
      stdoutPath: path.join(validationStageDir, "stdout.log"),
      stderrPath: path.join(validationStageDir, "stderr.log"),
      repoProfilePath: path.join(validationStageDir, "repo-profile.json"),
      validationPlanPath: path.join(validationStageDir, "validation-plan.json"),
      toolResearchPath: path.join(validationStageDir, "tool-research.json"),
      testPyramidPath: path.join(validationStageDir, "artifacts", "test-pyramid.md"),
      coverageSummaryPath: path.join(validationStageDir, "artifacts", "coverage-summary.json"),
      coverageGapsPath: path.join(validationStageDir, "artifacts", "coverage-gaps.md"),
      localValidationPath: path.join(validationStageDir, "artifacts", "local-validation.json"),
      ciValidationPath: path.join(validationStageDir, "artifacts", "ci-validation.json"),
      githubActionsPlanPath: path.join(validationStageDir, "artifacts", "github-actions-plan.md"),
      testInventoryPath: path.join(validationStageDir, "artifacts", "test-inventory.json")
    },
    buildSummary: buildExecution.finalBody,
    buildVerificationRecord: buildExecution.verificationRecord
  });

  stageLineage.specialists.push(...validationExecution.specialistExecutions);
  validationStage.status =
    validationExecution.validationPlan.status === "ready"
      ? "completed"
      : validationExecution.validationPlan.status === "partial"
        ? "deferred"
        : "failed";
  validationStage.executed = true;
  validationStage.stageDir = validationStageDir;
  validationStage.artifactPath = path.join(validationStageDir, "artifacts", "test-pyramid.md");
  validationStage.notes = validationExecution.validationPlan.summary;
  await writeJson(options.paths.stageLineagePath, stageLineage);
  events.markStage(
    "validation",
    validationStage.status === "completed" ? "completed" : validationStage.status === "deferred" ? "deferred" : "failed"
  );
  await events.emit("activity", "Validation stage finished, starting review synthesis");

  const reviewStageDir = deliverStageDir(options.paths.runDir, "review");
  await fs.mkdir(path.join(reviewStageDir, "artifacts"), { recursive: true });
  const reviewStage = stageLineage.stages.find((stage) => stage.name === "review")!;
  reviewStage.status = "running";
  await writeJson(options.paths.stageLineagePath, stageLineage);
  events.markStage("review", "running");

  const specialistResults: Array<{ name: SpecialistSelection["name"]; reason: string; finalBody: string }> = [];
  for (const specialist of selectedSpecialists) {
    events.markSpecialist(specialist.name, "running");
    const result = await runDeliverSpecialist({
      cwd: options.cwd,
      runId: options.runId,
      stageDir: reviewStageDir,
      input: options.input,
      specialist,
      config: options.config,
      buildSummary: buildExecution.finalBody,
      verificationRecord: buildExecution.verificationRecord
    });
    stageLineage.specialists.push(result.execution);
    specialistResults.push({
      name: specialist.name,
      reason: specialist.reason,
      finalBody: result.finalBody
    });
    events.markSpecialist(specialist.name, result.execution.status === "completed" ? "completed" : "failed");
  }

  const reviewLeadPrompt = await buildDeliverReviewLeadPrompt({
    cwd: options.cwd,
    input: options.input,
    mode: "readiness",
    buildSummary: buildExecution.finalBody,
    verificationRecord: buildExecution.verificationRecord,
    validationPlan: validationExecution.validationPlan,
    validationLocalRecord: validationExecution.localValidationRecord,
    specialistResults
  });
  await fs.writeFile(path.join(reviewStageDir, "prompt.md"), reviewLeadPrompt.prompt, "utf8");
  await fs.writeFile(path.join(reviewStageDir, "context.md"), `${reviewLeadPrompt.context}\n`, "utf8");

  const reviewResult = await runCodexExec({
    cwd: options.cwd,
    workflow: "deliver",
    runId: `${options.runId}-review`,
    prompt: reviewLeadPrompt.prompt,
    finalPath: path.join(reviewStageDir, "final.md"),
    eventsPath: path.join(reviewStageDir, "events.jsonl"),
    stdoutPath: path.join(reviewStageDir, "stdout.log"),
    stderrPath: path.join(reviewStageDir, "stderr.log"),
    config: options.config,
    ...(typeof options.reviewTimeoutSeconds === "number" ? { timeoutSeconds: options.reviewTimeoutSeconds } : {})
  });
  const reviewRaw = await fs.readFile(path.join(reviewStageDir, "final.md"), "utf8");
  const reviewVerdict = parseJson<DeliverReviewVerdict>(reviewRaw, "Review lead");
  await fs.writeFile(path.join(reviewStageDir, "artifacts", "findings.md"), reviewVerdict.reportMarkdown, "utf8");
  await writeJson(path.join(reviewStageDir, "artifacts", "findings.json"), {
    findings: reviewVerdict.findings,
    recommendedActions: reviewVerdict.recommendedActions,
    acceptedSpecialists: reviewVerdict.acceptedSpecialists
  });
  await writeJson(path.join(reviewStageDir, "artifacts", "verdict.json"), reviewVerdict);

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
  reviewStage.status = reviewResult.code === 0 ? "completed" : "failed";
  reviewStage.executed = true;
  reviewStage.stageDir = reviewStageDir;
  reviewStage.artifactPath = path.join(reviewStageDir, "artifacts", "findings.md");
  reviewStage.notes = reviewVerdict.summary;
  await writeJson(options.paths.stageLineagePath, stageLineage);
  events.markStage("review", reviewResult.code === 0 ? "completed" : "failed");
  await events.emit("activity", "Review stage finished, preparing ship readiness artifacts");

  const shipStageDir = deliverStageDir(options.paths.runDir, "ship");
  await fs.mkdir(path.join(shipStageDir, "artifacts"), { recursive: true });
  const shipStage = stageLineage.stages.find((stage) => stage.name === "ship")!;
  shipStage.status = "running";
  await writeJson(options.paths.stageLineagePath, stageLineage);
  events.markStage("ship", "running");

  const githubMutation = await performGitHubDeliverMutations({
    cwd: options.cwd,
    gitBranch: options.gitBranch,
    runId: options.runId,
    input: options.input,
    issueNumbers: options.issueNumbers,
    policy: options.config.workflows.deliver.github ?? {},
    buildSummary: buildExecution.finalBody,
    reviewVerdict,
    verificationRecord: buildExecution.verificationRecord,
    ...(options.linkedContext?.run.id ? { linkedRunId: options.linkedContext.run.id } : {}),
    pullRequestBodyPath: path.join(shipStageDir, "artifacts", "pull-request-body.md")
  });

  const githubEvidence = await collectGitHubDeliveryEvidence({
    cwd: options.cwd,
    gitBranch: githubMutation.branch,
    deliveryMode: options.deliveryMode,
    issueNumbers: options.issueNumbers,
    policy: options.config.workflows.deliver.github ?? {},
    input: options.input,
    mutationRecord: githubMutation.record,
    ...(options.linkedContext?.artifactBody ? { linkedArtifactBody: options.linkedContext.artifactBody } : {})
  });
  const githubDeliveryRecord = githubEvidence.record;
  const shipPrompt = await buildDeliverShipPrompt({
    cwd: options.cwd,
    input: options.input,
    buildSummary: buildExecution.finalBody,
    validationPlan: validationExecution.validationPlan,
    validationLocalRecord: validationExecution.localValidationRecord,
    reviewVerdict,
    verificationRecord: buildExecution.verificationRecord,
    githubMutationRecord: githubMutation.record,
    githubDeliveryRecord
  });
  await fs.writeFile(path.join(shipStageDir, "prompt.md"), shipPrompt.prompt, "utf8");
  await fs.writeFile(path.join(shipStageDir, "context.md"), `${shipPrompt.context}\n`, "utf8");
  const shipResult = await runCodexExec({
    cwd: options.cwd,
    workflow: "deliver",
    runId: `${options.runId}-ship`,
    prompt: shipPrompt.prompt,
    finalPath: path.join(shipStageDir, "final.md"),
    eventsPath: path.join(shipStageDir, "events.jsonl"),
    stdoutPath: path.join(shipStageDir, "stdout.log"),
    stderrPath: path.join(shipStageDir, "stderr.log"),
    config: options.config,
    ...(typeof options.shipTimeoutSeconds === "number" ? { timeoutSeconds: options.shipTimeoutSeconds } : {})
  });
  const shipRaw = await fs.readFile(path.join(shipStageDir, "final.md"), "utf8");
  let shipRecord = parseJson<DeliverShipRecord>(shipRaw, "Ship lead");
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
  await fs.writeFile(path.join(shipStageDir, "artifacts", "ship-summary.md"), shipRecord.reportMarkdown, "utf8");
  await fs.writeFile(path.join(shipStageDir, "artifacts", "release-checklist.md"), renderChecklistMarkdown(shipRecord), "utf8");
  await fs.writeFile(path.join(shipStageDir, "artifacts", "unresolved.md"), renderUnresolvedMarkdown(shipRecord), "utf8");
  await writeJson(path.join(shipStageDir, "artifacts", "ship-record.json"), shipRecord);
  await writeJson(path.join(shipStageDir, "artifacts", "github-state.json"), githubEvidence.artifacts.githubState);
  await writeJson(path.join(shipStageDir, "artifacts", "pull-request.json"), githubEvidence.artifacts.pullRequest);
  await writeJson(path.join(shipStageDir, "artifacts", "issues.json"), githubEvidence.artifacts.issues);
  await writeJson(path.join(shipStageDir, "artifacts", "checks.json"), githubEvidence.artifacts.checks);
  await writeJson(path.join(shipStageDir, "artifacts", "actions.json"), githubEvidence.artifacts.actions);
  await writeJson(path.join(shipStageDir, "artifacts", "security.json"), githubEvidence.artifacts.security);
  await writeJson(path.join(shipStageDir, "artifacts", "release.json"), githubEvidence.artifacts.release);
  await writeJson(path.join(shipStageDir, "artifacts", "github-mutation.json"), githubMutation.record);
  await writeJson(path.join(options.paths.runDir, "artifacts", "github-mutation.json"), githubMutation.record);
  await writeJson(path.join(options.paths.runDir, "artifacts", "github-delivery.json"), githubDeliveryRecord);

  shipStage.status =
    shipResult.code === 0 && githubMutation.record.blockers.length === 0 && githubDeliveryRecord.overall.status === "ready"
      ? "completed"
      : "failed";
  shipStage.executed = true;
  shipStage.stageDir = shipStageDir;
  shipStage.artifactPath = path.join(shipStageDir, "artifacts", "ship-summary.md");
  shipStage.notes = shipRecord.summary;
  await writeJson(options.paths.stageLineagePath, stageLineage);
  events.markStage("ship", shipStage.status === "completed" ? "completed" : "failed");
  await events.emit("completed", "Deliver workflow completed");
  events.close();

  const finalBody = buildDeliverFinalSummary({
    input: options.input,
    stageLineage,
    validationExecution,
    reviewVerdict,
    shipRecord,
    githubMutationRecord: githubMutation.record,
    githubDeliveryRecord,
    ...(options.linkedContext ? { linkedContext: options.linkedContext } : {})
  });
  await fs.writeFile(options.paths.finalPath, finalBody, "utf8");
  await fs.writeFile(options.paths.deliveryReportPath, finalBody, "utf8");

  return {
    buildExecution,
    validationExecution,
    reviewVerdict,
    shipRecord,
    githubDeliveryRecord,
    githubMutationRecord: githubMutation.record,
    stageLineage,
    selectedSpecialists,
    finalBody
  };
}

export { resolveLinkedBuildContext };
