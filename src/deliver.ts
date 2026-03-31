import path from "node:path";
import { promises as fs } from "node:fs";
import { buildEvent, ProgressReporter } from "./progress.js";
import { resolveLinkedBuildContext, runBuildExecution, type BuildExecutionResult, type LinkedBuildContext } from "./build.js";
import { readCodexFinalOutput, runCodexExec } from "./codex.js";
import { collectGitHubDeliveryEvidence, performGitHubDeliverMutations } from "./github.js";
import { buildPostShipArtifacts } from "./post-ship.js";
import { buildDeploymentEvidenceRecord, buildReadinessPolicyRecord } from "./ship.js";
import {
  buildDeliverPrompt,
  buildDeliverReviewLeadPrompt,
  buildDeliverShipPrompt,
  buildDeliverSpecialistPrompt
} from "./prompt.js";
import { inferRoutingPlan } from "./intent.js";
import { runDeliverValidationExecution, type DeliverValidationExecutionResult } from "./validation.js";
import { WorkflowController } from "./workflow-machine.js";
import type {
  CstackConfig,
  DeliverGitHubConfig,
  DeliveryReadinessPolicyRecord,
  DeploymentEvidenceRecord,
  DeliverTargetMode,
  DeliverReviewVerdict,
  DeliverShipRecord,
  GitHubDeliveryRecord,
  GitHubMutationRecord,
  RunEvent,
  SpecialistExecution,
  SpecialistSelection,
  StageLineage,
  WorkflowMode
} from "./types.js";
import type { PerformGitHubMutationResult } from "./github.js";

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
  controller: WorkflowController;
  requestedMode: WorkflowMode;
  linkedContext?: LinkedBuildContext | undefined;
  verificationCommands: string[];
  deliveryMode: DeliverTargetMode;
  issueNumbers: number[];
  buildTimeoutSeconds?: number;
  validationTimeoutSeconds?: number;
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

    const finalBody = await readCodexFinalOutput({
      context: `Deliver specialist ${options.specialist.name}`,
      finalPath,
      stdoutPath,
      stderrPath,
      result,
      acceptSynthesizedFinalArtifact: true
    });
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

function createEmptyGitHubMutationRecord(initialBranch = ""): GitHubMutationRecord {
  return {
    enabled: false,
    branch: {
      initial: initialBranch,
      current: initialBranch,
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
      summary: ""
    },
    release: {
      requested: false,
      created: false,
      pushed: false,
      uploadedFiles: [],
      summary: ""
    },
    blockers: [],
    summary: ""
  };
}

function buildStageSyncPolicy(policy: DeliverGitHubConfig): DeliverGitHubConfig {
  return {
    ...policy,
    createRelease: false,
    releasePushTag: false,
    releaseFiles: [],
    watchChecks: false
  };
}

function createStageSyncReviewVerdict(stageName: "build" | "validation"): DeliverReviewVerdict {
  return {
    mode: "readiness",
    status: "completed",
    summary:
      stageName === "build"
        ? "Stage sync after build: repository changes were prepared for review."
        : "Stage sync after validation: repository changes were prepared for review.",
    findings: [],
    recommendedActions: [],
    acceptedSpecialists: [],
    reportMarkdown:
      stageName === "build"
        ? "# Review Findings\n\nStage sync after build. Formal review has not run yet.\n"
        : "# Review Findings\n\nStage sync after validation. Formal review has not run yet.\n"
  };
}

function mergeGitHubMutationRecords(current: GitHubMutationRecord, next: GitHubMutationRecord): GitHubMutationRecord {
  const currentRelease = current.release;
  const nextRelease = next.release;
  const mergedCommit: GitHubMutationRecord["commit"] = {
    created: current.commit.created || next.commit.created,
    changedFiles: mergeUniqueLines([...current.commit.changedFiles, ...next.commit.changedFiles])
  };
  const mergedCommitSha = next.commit.sha ?? current.commit.sha;
  if (mergedCommitSha) {
    mergedCommit.sha = mergedCommitSha;
  }
  const mergedCommitMessage = next.commit.message ?? current.commit.message;
  if (mergedCommitMessage) {
    mergedCommit.message = mergedCommitMessage;
  }

  const mergedPullRequest: GitHubMutationRecord["pullRequest"] = {
    created: current.pullRequest.created || next.pullRequest.created,
    updated: current.pullRequest.updated || next.pullRequest.updated
  };
  const mergedPullRequestNumber = next.pullRequest.number ?? current.pullRequest.number;
  if (mergedPullRequestNumber !== undefined) {
    mergedPullRequest.number = mergedPullRequestNumber;
  }
  const mergedPullRequestUrl = next.pullRequest.url ?? current.pullRequest.url;
  if (mergedPullRequestUrl) {
    mergedPullRequest.url = mergedPullRequestUrl;
  }
  const mergedPullRequestTitle = next.pullRequest.title ?? current.pullRequest.title;
  if (mergedPullRequestTitle) {
    mergedPullRequest.title = mergedPullRequestTitle;
  }
  const mergedBaseRefName = next.pullRequest.baseRefName ?? current.pullRequest.baseRefName;
  if (mergedBaseRefName) {
    mergedPullRequest.baseRefName = mergedBaseRefName;
  }
  const mergedHeadRefName = next.pullRequest.headRefName ?? current.pullRequest.headRefName;
  if (mergedHeadRefName) {
    mergedPullRequest.headRefName = mergedHeadRefName;
  }
  const mergedDraft = next.pullRequest.draft ?? current.pullRequest.draft;
  if (mergedDraft !== undefined) {
    mergedPullRequest.draft = mergedDraft;
  }

  let mergedRelease: GitHubMutationRecord["release"] | undefined;
  if (currentRelease || nextRelease) {
    mergedRelease = {
      requested: Boolean(currentRelease?.requested || nextRelease?.requested),
      created: Boolean(currentRelease?.created || nextRelease?.created),
      pushed: Boolean(currentRelease?.pushed || nextRelease?.pushed),
      uploadedFiles: mergeUniqueLines([...(currentRelease?.uploadedFiles ?? []), ...(nextRelease?.uploadedFiles ?? [])]),
      summary: nextRelease?.summary || currentRelease?.summary || ""
    };
    const mergedTagName = nextRelease?.tagName ?? currentRelease?.tagName;
    if (mergedTagName) {
      mergedRelease.tagName = mergedTagName;
    }
    const mergedVersion = nextRelease?.version ?? currentRelease?.version;
    if (mergedVersion !== undefined) {
      mergedRelease.version = mergedVersion;
    }
    const mergedReleaseUrl = nextRelease?.url ?? currentRelease?.url;
    if (mergedReleaseUrl) {
      mergedRelease.url = mergedReleaseUrl;
    }
    const mergedReleaseName = nextRelease?.name ?? currentRelease?.name;
    if (mergedReleaseName !== undefined) {
      mergedRelease.name = mergedReleaseName;
    }
  }

  return {
    enabled: current.enabled || next.enabled,
    branch: {
      initial: next.branch.initial || current.branch.initial,
      current: next.branch.current || current.branch.current,
      created: current.branch.created || next.branch.created,
      pushed: current.branch.pushed || next.branch.pushed,
      remote: next.branch.remote ?? current.branch.remote ?? null
    },
    commit: mergedCommit,
    pullRequest: mergedPullRequest,
    checks: {
      watched: current.checks.watched || next.checks.watched,
      polls: Math.max(current.checks.polls, next.checks.polls),
      completed: current.checks.completed || next.checks.completed,
      summary: next.checks.summary || current.checks.summary
    },
    ...(mergedRelease ? { release: mergedRelease } : {}),
    blockers: mergeUniqueLines([...current.blockers, ...next.blockers]),
    summary: next.summary || current.summary
  };
}

async function syncStageChangesToGitHub(options: {
  cwd: string;
  gitBranch: string;
  runId: string;
  input: string;
  issueNumbers: number[];
  policy: DeliverGitHubConfig;
  buildSummary: string;
  verificationRecord: object;
  stageName: "build" | "validation";
  pullRequestBodyPath: string;
  linkedRunId?: string;
}): Promise<PerformGitHubMutationResult | null> {
  if (!options.policy.enabled) {
    return null;
  }
  return performGitHubDeliverMutations({
    cwd: options.cwd,
    gitBranch: options.gitBranch,
    runId: `${options.runId}-${options.stageName}`,
    input: options.input,
    issueNumbers: options.issueNumbers,
    policy: buildStageSyncPolicy(options.policy),
    buildSummary: options.buildSummary,
    reviewVerdict: createStageSyncReviewVerdict(options.stageName),
    verificationRecord: options.verificationRecord,
    ...(options.linkedRunId ? { linkedRunId: options.linkedRunId } : {}),
    pullRequestBodyPath: options.pullRequestBodyPath
  });
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
      outcomeCategory: "blocked-by-build",
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
      outcomeCategory: "blocked-by-build",
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
    release: {
      requested: false,
      created: false,
      pushed: false,
      uploadedFiles: [],
      summary: "Release mutation was skipped because build failed first."
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
  readinessPolicyRecord: DeliveryReadinessPolicyRecord;
  deploymentEvidenceRecord: DeploymentEvidenceRecord;
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
  await writeJson(path.join(options.shipStageDir, "artifacts", "readiness-policy.json"), options.readinessPolicyRecord);
  await writeJson(path.join(options.shipStageDir, "artifacts", "deployment-evidence.json"), options.deploymentEvidenceRecord);
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
  readinessPolicyRecord: DeliveryReadinessPolicyRecord;
}): string {
  const postReadinessSummary = options.readinessPolicyRecord?.postReadinessSummary;
  const postReadinessHeadline = postReadinessSummary?.headline ?? "Post-readiness summary unavailable";
  const postReadinessHighlights = postReadinessSummary?.highlights ?? [];
  const postReadinessBlockers = postReadinessSummary?.blockers ?? [];

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
    `- outcome category: ${options.validationExecution.validationPlan.outcomeCategory}`,
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
    "## Post-readiness summary",
    `- headline: ${postReadinessHeadline}`,
    ...postReadinessHighlights.map((highlight) => `- highlight: ${highlight}`),
    ...(postReadinessBlockers.length > 0
      ? postReadinessBlockers.map((blocker) => `- blocker class: ${blocker}`)
      : ["- blocker class: none"]),
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
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(
      details.includes("did not write final output") ? `${context} did not write final output` : `${context} did not return valid JSON: ${details}`
    );
  }
}

function summarizeOrThrow(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createFailedValidationExecution(error: string): DeliverValidationExecutionResult {
  const summary = `Validation stage failed: ${error}`;
  return {
    repoProfile: {
      detectedAt: new Date().toISOString(),
      languages: ["typescript"],
      buildSystems: [],
      surfaces: ["cli"],
      packageManagers: [],
      ciSystems: [],
      runnerConstraints: [],
      manifests: [],
      workflowFiles: [],
      existingTests: [],
      packageScripts: [],
      detectedTools: [],
      workspaceTargets: [],
      limitations: [summary]
    },
    toolResearch: {
      generatedAt: new Date().toISOString(),
      summary,
      candidates: [],
      selectedTools: [],
      limitations: [summary]
    },
    validationPlan: {
      status: "blocked",
      outcomeCategory: "blocked-by-validation",
      summary,
      profileSummary: summary,
      layers: [],
      selectedSpecialists: [],
      localValidation: {
        commands: [],
        prerequisites: [],
        notes: [summary]
      },
      ciValidation: {
        workflowFiles: [],
        jobs: [],
        notes: [summary]
      },
      coverage: {
        confidence: "low",
        summary,
        signals: [],
        gaps: [summary]
      },
      recommendedChanges: ["Re-run deliver after resolving the validation-stage failure."],
      unsupported: [summary],
      pyramidMarkdown: "# Test Pyramid\n\nValidation stage failed before test layers could be planned.\n",
      reportMarkdown: `# Validation Summary\n\n${summary}\n`,
      githubActionsPlanMarkdown: "# GitHub Actions Validation Plan\n\nValidation could not be planned due to an execution failure.\n"
    },
    localValidationRecord: {
      status: "not-run",
      requestedCommands: [],
      results: [],
      notes: summary
    },
    coverageSummary: {
      status: "blocked",
      outcomeCategory: "blocked-by-validation",
      confidence: "low",
      summary,
      signals: [],
      gaps: [summary],
      localValidationStatus: "not-run"
    },
    selectedSpecialists: [],
    specialistExecutions: [],
    finalBody: `# Validation Summary\n\n${summary}\n`
  };
}

function createFailedReviewVerdict(error: string): DeliverReviewVerdict {
  return {
    mode: "readiness",
    status: "blocked",
    summary: `Review stage failed: ${error}`,
    findings: [
      {
        severity: "high",
        title: "Review stage failed",
        detail: error
      }
    ],
    recommendedActions: ["Inspect the review stage error details and rerun deliver."],
    acceptedSpecialists: [],
    reportMarkdown: `# Review Findings\n\n${error}\n`
  };
}

function createFailedShipRecord(error: string, readynessMessage: string): DeliverShipRecord {
  return {
    readiness: "blocked",
    summary: `Ship stage failed: ${error}`,
    checklist: [
      {
        item: readynessMessage,
        status: "blocked",
        notes: error
      }
    ],
    unresolved: [`${readynessMessage}: ${error}`],
    nextActions: ["Inspect the ship-stage error details and rerun deliver once fixed."],
    reportMarkdown: `# Ship Summary\n\nShip stage failed: ${error}\n`
  };
}

async function writeValidationArtifacts({
  validationStageDir,
  validationExecution
}: {
  validationStageDir: string;
  validationExecution: DeliverValidationExecutionResult;
}): Promise<void> {
  await fs.mkdir(path.join(validationStageDir, "artifacts"), { recursive: true });
  await fs.writeFile(path.join(validationStageDir, "final.md"), validationExecution.finalBody, "utf8");
  await writeJson(path.join(validationStageDir, "repo-profile.json"), validationExecution.repoProfile);
  await writeJson(path.join(validationStageDir, "tool-research.json"), validationExecution.toolResearch);
  await writeJson(path.join(validationStageDir, "validation-plan.json"), validationExecution.validationPlan);
  await fs.writeFile(path.join(validationStageDir, "artifacts", "test-pyramid.md"), validationExecution.validationPlan.pyramidMarkdown, "utf8");
  await writeJson(path.join(validationStageDir, "artifacts", "coverage-summary.json"), validationExecution.coverageSummary);
  await fs.writeFile(
    path.join(validationStageDir, "artifacts", "coverage-gaps.md"),
    `# Coverage Gaps\n\n- ${validationExecution.coverageSummary.gaps.join("\n- ") || "No data was collected."}\n`,
    "utf8"
  );
  await writeJson(path.join(validationStageDir, "artifacts", "local-validation.json"), validationExecution.localValidationRecord);
  await writeJson(
    path.join(validationStageDir, "artifacts", "ci-validation.json"),
    validationExecution.validationPlan.ciValidation
  );
  await fs.writeFile(
    path.join(validationStageDir, "artifacts", "github-actions-plan.md"),
    validationExecution.validationPlan.githubActionsPlanMarkdown,
    "utf8"
  );
  await writeJson(path.join(validationStageDir, "artifacts", "test-inventory.json"), { status: "blocked", tests: [] });
}

async function writeReviewArtifacts({
  reviewStageDir,
  reviewVerdict
}: {
  reviewStageDir: string;
  reviewVerdict: DeliverReviewVerdict;
}): Promise<void> {
  await fs.mkdir(path.join(reviewStageDir, "artifacts"), { recursive: true });
  await writeJson(path.join(reviewStageDir, "artifacts", "findings.json"), {
    findings: reviewVerdict.findings,
    recommendedActions: reviewVerdict.recommendedActions,
    acceptedSpecialists: reviewVerdict.acceptedSpecialists
  });
  await fs.writeFile(path.join(reviewStageDir, "artifacts", "verdict.json"), `${JSON.stringify(reviewVerdict, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(reviewStageDir, "final.md"), `${JSON.stringify(reviewVerdict, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(reviewStageDir, "artifacts", "findings.md"), reviewVerdict.reportMarkdown, "utf8");
}

async function writeShipArtifacts({
  shipStageDir,
  shipRecord,
  githubDeliveryRecord,
  readinessPolicyRecord,
  deploymentEvidenceRecord
}: {
  shipStageDir: string;
  shipRecord: DeliverShipRecord;
  githubDeliveryRecord: GitHubDeliveryRecord;
  readinessPolicyRecord: DeliveryReadinessPolicyRecord;
  deploymentEvidenceRecord: DeploymentEvidenceRecord;
}): Promise<void> {
  await fs.mkdir(path.join(shipStageDir, "artifacts"), { recursive: true });
  await fs.writeFile(path.join(shipStageDir, "final.md"), `${JSON.stringify(shipRecord, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(shipStageDir, "artifacts", "ship-summary.md"), shipRecord.reportMarkdown, "utf8");
  await fs.writeFile(path.join(shipStageDir, "artifacts", "release-checklist.md"), renderChecklistMarkdown(shipRecord), "utf8");
  await fs.writeFile(path.join(shipStageDir, "artifacts", "unresolved.md"), renderUnresolvedMarkdown(shipRecord), "utf8");
  await writeJson(path.join(shipStageDir, "artifacts", "ship-record.json"), shipRecord);
  await writeJson(path.join(shipStageDir, "artifacts", "readiness-policy.json"), readinessPolicyRecord);
  await writeJson(path.join(shipStageDir, "artifacts", "deployment-evidence.json"), deploymentEvidenceRecord);
  await writeJson(path.join(shipStageDir, "artifacts", "github-state.json"), { status: "blocked", summary: githubDeliveryRecord.overall.summary });
  await writeJson(path.join(shipStageDir, "artifacts", "pull-request.json"), githubDeliveryRecord.pullRequest);
  await writeJson(path.join(shipStageDir, "artifacts", "issues.json"), githubDeliveryRecord.issues);
  await writeJson(path.join(shipStageDir, "artifacts", "checks.json"), githubDeliveryRecord.checks);
  await writeJson(path.join(shipStageDir, "artifacts", "actions.json"), githubDeliveryRecord.actions);
  await writeJson(path.join(shipStageDir, "artifacts", "security.json"), githubDeliveryRecord.security);
  await writeJson(path.join(shipStageDir, "artifacts", "release.json"), githubDeliveryRecord.release);
}

async function writePostShipArtifacts(options: {
  artifactsDir: string;
  summaryMarkdown: string;
  evidenceRecord: object;
  followUpDraftMarkdown: string;
  followUpRecord: object;
}): Promise<void> {
  await fs.mkdir(options.artifactsDir, { recursive: true });
  await fs.writeFile(path.join(options.artifactsDir, "post-ship-summary.md"), options.summaryMarkdown, "utf8");
  await writeJson(path.join(options.artifactsDir, "post-ship-evidence.json"), options.evidenceRecord);
  await fs.writeFile(path.join(options.artifactsDir, "follow-up-draft.md"), options.followUpDraftMarkdown, "utf8");
  await writeJson(path.join(options.artifactsDir, "follow-up-lineage.json"), options.followUpRecord);
}

function summarizeFailureStageError(error: unknown): string {
  return summarizeOrThrow(error);
}

function createBlockedDeploymentEvidenceRecord(deliveryMode: DeliverTargetMode, summary: string): DeploymentEvidenceRecord {
  return {
    mode: deliveryMode,
    generatedAt: new Date().toISOString(),
    summary,
    blockers: [summary],
    references: [],
    status: "missing"
  };
}

function createBlockedReadinessPolicyRecord(options: {
  deliveryMode: DeliverTargetMode;
  shipRecord: DeliverShipRecord;
  githubDeliveryRecord: GitHubDeliveryRecord;
  summary: string;
}): DeliveryReadinessPolicyRecord {
  return {
    mode: options.deliveryMode,
    readiness: options.shipRecord.readiness,
    generatedAt: new Date().toISOString(),
    summary: options.summary,
    blockers: [options.summary],
    requirements: [
      {
        name: "ship-readiness",
        required: true,
        status: "blocked",
        summary: options.shipRecord.summary,
        evidence: [options.shipRecord.summary]
      },
      {
        name: "github-delivery",
        required: true,
        status: options.githubDeliveryRecord.overall.status === "ready" ? "satisfied" : "blocked",
        summary: options.githubDeliveryRecord.overall.summary,
        evidence: [...options.githubDeliveryRecord.overall.blockers]
      },
      {
        name: "deployment-evidence",
        required: options.deliveryMode === "release",
        status: options.deliveryMode === "release" ? "missing" : "not-applicable",
        summary: options.summary,
        evidence: []
      }
    ],
    classifiedBlockers: [
      {
        category: "ship-output",
        requirement: "ship-readiness",
        status: "blocked",
        summary: options.shipRecord.summary,
        evidence: [options.shipRecord.summary]
      },
      ...(options.githubDeliveryRecord.overall.status === "ready"
        ? []
        : [
            {
              category: "github-delivery" as const,
              requirement: "github-delivery" as const,
              status: "blocked" as const,
              summary: options.githubDeliveryRecord.overall.summary,
              evidence: [...options.githubDeliveryRecord.overall.blockers]
            }
          ]),
      ...(options.deliveryMode === "release"
        ? [
            {
              category: "deployment-evidence" as const,
              requirement: "deployment-evidence" as const,
              status: "missing" as const,
              summary: options.summary,
              evidence: []
            }
          ]
        : [])
    ],
    postReadinessSummary: {
      status: options.shipRecord.readiness,
      headline: options.summary,
      highlights: [`Ship readiness: ${options.shipRecord.readiness}`],
      blockers: [
        `ship-output: ${options.shipRecord.summary}`,
        ...(options.githubDeliveryRecord.overall.status === "ready"
          ? []
          : [`github-delivery: ${options.githubDeliveryRecord.overall.summary}`]),
        ...(options.deliveryMode === "release" ? [`deployment-evidence: ${options.summary}`] : [])
      ],
      nextActions: options.shipRecord.nextActions.slice(0, 8)
    }
  };
}

export async function runDeliverExecution(options: DeliverExecutionOptions): Promise<DeliverExecutionResult> {
  const selectedSpecialists = selectDeliverSpecialists(options.input);
  const githubPolicy = options.config.workflows.deliver.github ?? {};
  let currentGitBranch = options.gitBranch;
  let cumulativeGitHubMutation = createEmptyGitHubMutationRecord(options.gitBranch);
  let stageLineage = options.controller.currentStageLineage;
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
  await options.controller.send({
    type: "SET_ACTIVE_SPECIALISTS",
    names: selectedSpecialists.map((specialist) => specialist.name)
  });
  await options.controller.send({
    type: "SET_CONTEXT",
    patch: {
      selectedSpecialists: selectedSpecialists.map((specialist) => specialist.name)
    }
  });

  const events = createDeliverEventRecorder(options.runId, options.paths.eventsPath);
  events.setSpecialists(selectedSpecialists.map((specialist) => specialist.name));
  await events.emit("starting", "Running deliver workflow across build -> validation -> review -> ship");
  const buildStageDir = deliverStageDir(options.paths.runDir, "build");
  const validationStageDir = deliverStageDir(options.paths.runDir, "validation");
  const reviewStageDir = deliverStageDir(options.paths.runDir, "review");
  const shipStageDir = deliverStageDir(options.paths.runDir, "ship");
  await fs.mkdir(path.join(buildStageDir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(validationStageDir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(reviewStageDir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(shipStageDir, "artifacts"), { recursive: true });
  try {
  await options.controller.send({
    type: "SET_STAGE_STATUS",
    stageName: "build",
    status: "running",
    executed: false,
    stageDir: buildStageDir,
    artifactPath: path.join(buildStageDir, "artifacts", "change-summary.md")
  });
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

  await options.controller.send({
    type: "SET_STAGE_STATUS",
    stageName: "build",
    status: buildExecution.result.code === 0 ? "completed" : "failed",
    executed: true,
    stageDir: buildStageDir,
    artifactPath: path.join(buildStageDir, "artifacts", "change-summary.md"),
    notes: buildExecution.result.code !== 0 ? summarizeBuildFailure(buildExecution) : undefined
  });
  events.markStage("build", buildExecution.result.code === 0 ? "completed" : "failed");

  if (buildExecution.result.code !== 0) {
    const buildFailureSummary = summarizeBuildFailure(buildExecution);
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
    const deploymentEvidenceRecord = createBlockedDeploymentEvidenceRecord(
      options.deliveryMode,
      "Deployment evidence was not collected because build failed before ship readiness evaluation."
    );
    const readinessPolicyRecord = createBlockedReadinessPolicyRecord({
      deliveryMode: options.deliveryMode,
      shipRecord,
      githubDeliveryRecord,
      summary: "Readiness policy evaluation was blocked because build failed before ship readiness evaluation."
    });
    const postShipArtifacts = buildPostShipArtifacts({
      runId: options.runId,
      workflow: "deliver",
      shipRecord,
      githubDeliveryRecord
    });

    await options.controller.send({
      type: "SET_STAGE_STATUS",
      stageName: "validation",
      status: "deferred",
      executed: false,
      stageDir: validationStageDir,
      artifactPath: path.join(validationStageDir, "artifacts", "test-pyramid.md"),
      notes: `Blocked because build failed. ${buildFailureSummary}`
    });
    await options.controller.send({
      type: "SET_STAGE_STATUS",
      stageName: "review",
      status: "deferred",
      executed: false,
      stageDir: reviewStageDir,
      artifactPath: path.join(reviewStageDir, "artifacts", "findings.md"),
      notes: `Blocked because build failed. ${buildFailureSummary}`
    });
    await options.controller.send({
      type: "SET_STAGE_STATUS",
      stageName: "ship",
      status: "deferred",
      executed: false,
      stageDir: shipStageDir,
      artifactPath: path.join(shipStageDir, "artifacts", "ship-summary.md"),
      notes: `Blocked because build failed. ${buildFailureSummary}`
    });

    events.markStage("validation", "deferred");
    events.markStage("review", "deferred");
    events.markStage("ship", "deferred");

    await writeBlockedDeliverStageArtifacts({
      validationStageDir,
      reviewStageDir,
      shipStageDir,
      validationExecution,
      reviewVerdict,
      shipRecord,
      readinessPolicyRecord,
      deploymentEvidenceRecord,
      githubMutationRecord,
      githubDeliveryRecord
    });
    await writeJson(path.join(options.paths.runDir, "artifacts", "github-mutation.json"), githubMutationRecord);
    await writeJson(path.join(options.paths.runDir, "artifacts", "github-delivery.json"), githubDeliveryRecord);
    await writeJson(path.join(options.paths.runDir, "artifacts", "readiness-policy.json"), readinessPolicyRecord);
    await writeJson(path.join(options.paths.runDir, "artifacts", "deployment-evidence.json"), deploymentEvidenceRecord);
    await writePostShipArtifacts({
      artifactsDir: path.join(shipStageDir, "artifacts"),
      summaryMarkdown: postShipArtifacts.summaryMarkdown,
      evidenceRecord: postShipArtifacts.evidenceRecord,
      followUpDraftMarkdown: postShipArtifacts.followUpDraftMarkdown,
      followUpRecord: postShipArtifacts.followUpRecord
    });
    await writePostShipArtifacts({
      artifactsDir: path.join(options.paths.runDir, "artifacts"),
      summaryMarkdown: postShipArtifacts.summaryMarkdown,
      evidenceRecord: postShipArtifacts.evidenceRecord,
      followUpDraftMarkdown: postShipArtifacts.followUpDraftMarkdown,
      followUpRecord: postShipArtifacts.followUpRecord
    });
    await events.emit("failed", `Build failed; downstream stages blocked. ${buildFailureSummary}`);
    await options.controller.send({
      type: "DELIVER_FINALIZED",
      buildSucceeded: false,
      validationStatus: validationExecution.validationPlan.status,
      reviewStatus: reviewVerdict.status,
      shipReadiness: shipRecord.readiness,
      githubDeliveryStatus: githubDeliveryRecord.overall.status,
      summary: `${buildFailureSummary}; downstream stages blocked`
    });
    stageLineage = options.controller.currentStageLineage;

    const finalBody = buildDeliverFinalSummary({
      input: options.input,
      stageLineage,
      validationExecution,
      reviewVerdict,
      shipRecord,
      githubMutationRecord,
      githubDeliveryRecord,
      readinessPolicyRecord,
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
  await options.controller.send({
    type: "SET_STAGE_STATUS",
    stageName: "validation",
    status: "running",
    stageDir: validationStageDir,
    artifactPath: path.join(validationStageDir, "artifacts", "test-pyramid.md")
  });
  events.markStage("validation", "running");

  let validationExecution = createFailedValidationExecution("Validation stage did not run.");
  try {
    validationExecution = await runDeliverValidationExecution({
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
      buildVerificationRecord: buildExecution.verificationRecord,
      ...(typeof options.validationTimeoutSeconds === "number" ? { timeoutSeconds: options.validationTimeoutSeconds } : {})
    });
  } catch (error) {
    const message = summarizeFailureStageError(error);
    validationExecution = createFailedValidationExecution(message);
    await events.emit("failed", `Validation stage failed. ${message}`);
  }

  const validationStatus =
    validationExecution.validationPlan.status === "ready"
      ? "completed"
      : validationExecution.validationPlan.status === "partial"
        ? "deferred"
        : "failed";
  await options.controller.send({
    type: "SET_STAGE_STATUS",
    stageName: "validation",
    status: validationStatus,
    executed: true,
    stageDir: validationStageDir,
    artifactPath: path.join(validationStageDir, "artifacts", "test-pyramid.md"),
    notes: `${validationExecution.validationPlan.outcomeCategory}: ${validationExecution.validationPlan.summary}`
  });
  for (const execution of validationExecution.specialistExecutions) {
    await options.controller.send({
      type: "UPSERT_SPECIALIST",
      specialist: execution
    });
  }
  events.markStage(
    "validation",
    validationStatus === "completed" ? "completed" : validationStatus === "deferred" ? "deferred" : "failed"
  );
  await writeValidationArtifacts({ validationStageDir, validationExecution });
  if (buildExecution.result.code === 0) {
    const buildStageSyncResult = await syncStageChangesToGitHub({
      cwd: options.cwd,
      gitBranch: currentGitBranch,
      runId: options.runId,
      input: options.input,
      issueNumbers: options.issueNumbers,
      policy: githubPolicy,
      buildSummary: buildExecution.finalBody,
      verificationRecord: buildExecution.verificationRecord,
      stageName: "build",
      ...(options.linkedContext?.run.id ? { linkedRunId: options.linkedContext.run.id } : {}),
      pullRequestBodyPath: path.join(buildStageDir, "artifacts", "pull-request-body.md")
    });
    if (buildStageSyncResult?.record.branch.current) {
      currentGitBranch = buildStageSyncResult.record.branch.current;
      cumulativeGitHubMutation = mergeGitHubMutationRecords(cumulativeGitHubMutation, buildStageSyncResult.record);
    }
  }
  if (validationExecution.validationPlan.status !== "blocked") {
    const validationStageSyncResult = await syncStageChangesToGitHub({
      cwd: options.cwd,
      gitBranch: currentGitBranch,
      runId: options.runId,
      input: options.input,
      issueNumbers: options.issueNumbers,
      policy: githubPolicy,
      buildSummary: buildExecution.finalBody,
      verificationRecord: buildExecution.verificationRecord,
      stageName: "validation",
      ...(options.linkedContext?.run.id ? { linkedRunId: options.linkedContext.run.id } : {}),
      pullRequestBodyPath: path.join(validationStageDir, "artifacts", "pull-request-body.md")
    });
    if (validationStageSyncResult?.record.branch.current) {
      currentGitBranch = validationStageSyncResult.record.branch.current;
      cumulativeGitHubMutation = mergeGitHubMutationRecords(cumulativeGitHubMutation, validationStageSyncResult.record);
    }
  }
  await events.emit("activity", "Validation stage finished, starting review synthesis");
  await options.controller.send({
    type: "SET_STAGE_STATUS",
    stageName: "review",
    status: "running",
    stageDir: reviewStageDir,
    artifactPath: path.join(reviewStageDir, "artifacts", "findings.md")
  });
  events.markStage("review", "running");

  const specialistResults: Array<{ name: SpecialistSelection["name"]; reason: string; finalBody: string }> = [];
  let reviewVerdict = createFailedReviewVerdict("Review stage did not run.");
  try {
    for (const specialist of selectedSpecialists) {
      await options.controller.send({
        type: "SET_ACTIVE_SPECIALISTS",
        names: [specialist.name]
      });
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
      await options.controller.send({
        type: "UPSERT_SPECIALIST",
        specialist: result.execution
      });
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
    const reviewRaw = await readCodexFinalOutput({
      context: "Review lead",
      finalPath: path.join(reviewStageDir, "final.md"),
      stdoutPath: path.join(reviewStageDir, "stdout.log"),
      stderrPath: path.join(reviewStageDir, "stderr.log"),
      result: reviewResult
    });
    reviewVerdict = parseJson<DeliverReviewVerdict>(reviewRaw, "Review lead");

    const acceptedByName = new Map(reviewVerdict.acceptedSpecialists.map((entry) => [entry.name, entry]));
    for (const execution of options.controller.currentStageLineage.specialists) {
      const accepted = acceptedByName.get(execution.name);
      await options.controller.send({
        type: "UPDATE_SPECIALIST",
        name: execution.name,
        patch: accepted
          ? {
              disposition: accepted.disposition,
              notes: accepted.reason
            }
          : {
              disposition: "discarded",
              notes: execution.notes ?? "The review lead did not rely on this specialist output."
            }
      });
    }
  } catch (error) {
    reviewVerdict = createFailedReviewVerdict(summarizeFailureStageError(error));
    await events.emit("failed", `Review stage failed. ${reviewVerdict.summary}`);
  }
  await options.controller.send({
    type: "SET_ACTIVE_SPECIALISTS",
    names: []
  });
  const reviewStageStatus = reviewVerdict.status === "ready" ? "completed" : "failed";
  await options.controller.send({
    type: "SET_STAGE_STATUS",
    stageName: "review",
    status: reviewStageStatus,
    executed: true,
    stageDir: reviewStageDir,
    artifactPath: path.join(reviewStageDir, "artifacts", "findings.md"),
    notes: reviewVerdict.summary
  });
  await writeReviewArtifacts({ reviewStageDir, reviewVerdict });
  events.markStage("review", reviewStageStatus === "completed" ? "completed" : "failed");
  await events.emit("activity", "Review stage finished, preparing ship readiness artifacts");
  await options.controller.send({
    type: "SET_STAGE_STATUS",
    stageName: "ship",
    status: "running",
    stageDir: shipStageDir,
    artifactPath: path.join(shipStageDir, "artifacts", "ship-summary.md")
  });
  events.markStage("ship", "running");

  let githubMutation = cumulativeGitHubMutation;
  let githubMutationResult: PerformGitHubMutationResult = {
    branch: currentGitBranch,
    record: githubMutation
  };
  let githubDeliveryRecord = createBlockedGitHubDeliveryRecord({
    gitBranch: currentGitBranch,
    deliveryMode: options.deliveryMode,
    issueNumbers: options.issueNumbers,
    config: options.config,
    githubMutationRecord: githubMutation
  });
  let deploymentEvidenceRecord = createBlockedDeploymentEvidenceRecord(
    options.deliveryMode,
    "Deployment evidence was not collected because ship readiness did not run."
  );
  let shipRecord = createFailedShipRecord("Ship stage did not run.", "Deliver artifacts were not generated.");
  let readinessPolicyRecord = createBlockedReadinessPolicyRecord({
    deliveryMode: options.deliveryMode,
    shipRecord,
    githubDeliveryRecord,
    summary: "Readiness policy evaluation did not run."
  });

  try {
    githubMutationResult = await performGitHubDeliverMutations({
      cwd: options.cwd,
      gitBranch: currentGitBranch,
      runId: options.runId,
      input: options.input,
      issueNumbers: options.issueNumbers,
      policy: githubPolicy,
      buildSummary: buildExecution.finalBody,
      reviewVerdict,
      verificationRecord: buildExecution.verificationRecord,
      ...(options.linkedContext?.run.id ? { linkedRunId: options.linkedContext.run.id } : {}),
      pullRequestBodyPath: path.join(shipStageDir, "artifacts", "pull-request-body.md")
    });
    githubMutationResult = {
      ...githubMutationResult,
      record: mergeGitHubMutationRecords(cumulativeGitHubMutation, githubMutationResult.record)
    };

    const githubEvidence = await collectGitHubDeliveryEvidence({
      cwd: options.cwd,
      gitBranch: githubMutationResult.record.branch.current,
      deliveryMode: options.deliveryMode,
      issueNumbers: options.issueNumbers,
      policy: githubPolicy,
      input: options.input,
      mutationRecord: githubMutationResult.record,
      ...(options.linkedContext?.artifactBody ? { linkedArtifactBody: options.linkedContext.artifactBody } : {})
    });
    githubDeliveryRecord = githubEvidence.record;
    deploymentEvidenceRecord = buildDeploymentEvidenceRecord({
      deliveryMode: options.deliveryMode,
      githubDeliveryRecord
    });

    const shipPrompt = await buildDeliverShipPrompt({
      cwd: options.cwd,
      input: options.input,
      buildSummary: buildExecution.finalBody,
      validationPlan: validationExecution.validationPlan,
      validationLocalRecord: validationExecution.localValidationRecord,
      reviewVerdict,
      verificationRecord: buildExecution.verificationRecord,
      githubMutationRecord: githubMutationResult.record,
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
    const shipRaw = await readCodexFinalOutput({
      context: "Ship lead",
      finalPath: path.join(shipStageDir, "final.md"),
      stdoutPath: path.join(shipStageDir, "stdout.log"),
      stderrPath: path.join(shipStageDir, "stderr.log"),
      result: shipResult
    });
    let parsedShipRecord = parseJson<DeliverShipRecord>(shipRaw, "Ship lead");

    if (githubDeliveryRecord.overall.status === "blocked") {
      parsedShipRecord = {
        ...parsedShipRecord,
        readiness: "blocked",
        summary: `${parsedShipRecord.summary} GitHub delivery is blocked.`,
        unresolved: mergeUniqueLines([...parsedShipRecord.unresolved, ...githubDeliveryRecord.overall.blockers]),
        nextActions: mergeUniqueLines([...parsedShipRecord.nextActions, ...githubDeliveryRecord.overall.blockers]),
        checklist: [
          ...parsedShipRecord.checklist,
          {
            item: "GitHub delivery policy",
            status: "blocked",
            notes: githubDeliveryRecord.overall.blockers.join("; ")
          }
        ],
        reportMarkdown: `${parsedShipRecord.reportMarkdown.trimEnd()}\n\n## GitHub delivery\n\nStatus: blocked\n`
      };
    } else {
      parsedShipRecord = {
        ...parsedShipRecord,
        checklist: [
          ...parsedShipRecord.checklist,
          {
            item: "GitHub delivery policy",
            status: "complete",
            notes: githubDeliveryRecord.overall.summary
          }
        ],
        reportMarkdown: `${parsedShipRecord.reportMarkdown.trimEnd()}\n\n## GitHub delivery\n\nStatus: ready\n`
      };
    }
    shipRecord = parsedShipRecord;

    await writeJson(path.join(shipStageDir, "artifacts", "github-state.json"), githubEvidence.artifacts.githubState);
    await writeJson(path.join(shipStageDir, "artifacts", "pull-request.json"), githubEvidence.artifacts.pullRequest);
    await writeJson(path.join(shipStageDir, "artifacts", "issues.json"), githubEvidence.artifacts.issues);
    await writeJson(path.join(shipStageDir, "artifacts", "checks.json"), githubEvidence.artifacts.checks);
    await writeJson(path.join(shipStageDir, "artifacts", "actions.json"), githubEvidence.artifacts.actions);
    await writeJson(path.join(shipStageDir, "artifacts", "security.json"), githubEvidence.artifacts.security);
    await writeJson(path.join(shipStageDir, "artifacts", "release.json"), githubEvidence.artifacts.release);
    await writeJson(path.join(shipStageDir, "artifacts", "github-mutation.json"), githubMutationResult.record);
    await writeJson(path.join(options.paths.runDir, "artifacts", "github-mutation.json"), githubMutationResult.record);
    await writeJson(path.join(options.paths.runDir, "artifacts", "github-delivery.json"), githubDeliveryRecord);

    if (shipResult.code !== 0) {
      shipRecord = {
        ...shipRecord,
        readiness: "blocked",
        summary: `${shipRecord.summary} Ship lead command exited with code ${shipResult.code}.`,
        unresolved: mergeUniqueLines([...shipRecord.unresolved, `Ship lead command exited with code ${shipResult.code}.`]),
        nextActions: mergeUniqueLines([...shipRecord.nextActions, `Re-run ship stage and inspect ship lead output.`]),
        checklist: [
          ...shipRecord.checklist,
          {
            item: "Ship lead command",
            status: "blocked",
            notes: `Command exit code ${shipResult.code}.`
          }
        ],
        reportMarkdown: `${shipRecord.reportMarkdown.trimEnd()}\n\n## Ship lead command\n\nStatus: blocked\n`
      };
    }
    readinessPolicyRecord = buildReadinessPolicyRecord({
      deliveryMode: options.deliveryMode,
      reviewVerdict,
      shipRecord,
      githubDeliveryRecord,
      deploymentEvidenceRecord
    });
  } catch (error) {
    shipRecord = createFailedShipRecord(summarizeFailureStageError(error), "Ship lead command");
    githubMutation = createBlockedGitHubMutationRecord();
    githubMutation.summary = `Ship stage failed: ${shipRecord.summary}`;
    githubMutation.branch = {
      initial: "",
      current: "",
      created: false,
      pushed: false,
      remote: null
    };
    githubMutation.pullRequest = {
      created: false,
      updated: false
    };
    githubMutation.blockers = [shipRecord.summary];
    githubMutationResult = {
      branch: githubMutation.branch.current,
      record: githubMutation
    };
    githubDeliveryRecord = createBlockedGitHubDeliveryRecord({
      gitBranch: currentGitBranch,
      deliveryMode: options.deliveryMode,
      issueNumbers: options.issueNumbers,
      config: options.config,
      githubMutationRecord: githubMutation
    });
    deploymentEvidenceRecord = createBlockedDeploymentEvidenceRecord(
      options.deliveryMode,
      "Deployment evidence was not collected because the ship stage failed before GitHub delivery evidence could be finalized."
    );
    readinessPolicyRecord = createBlockedReadinessPolicyRecord({
      deliveryMode: options.deliveryMode,
      shipRecord,
      githubDeliveryRecord,
      summary: "Readiness policy evaluation was blocked because the ship stage failed."
    });
    await events.emit("failed", `Ship stage failed. ${shipRecord.summary}`);
  }

  const postShipArtifacts = buildPostShipArtifacts({
    runId: options.runId,
    workflow: "deliver",
    shipRecord,
    githubDeliveryRecord
  });

  await writeShipArtifacts({
    shipStageDir,
    shipRecord,
    githubDeliveryRecord,
    readinessPolicyRecord,
    deploymentEvidenceRecord
  });
  await writeJson(path.join(options.paths.runDir, "artifacts", "github-delivery.json"), githubDeliveryRecord);
  await writeJson(path.join(options.paths.runDir, "artifacts", "github-mutation.json"), githubMutationResult.record);
  await writeJson(path.join(options.paths.runDir, "artifacts", "readiness-policy.json"), readinessPolicyRecord);
  await writeJson(path.join(options.paths.runDir, "artifacts", "deployment-evidence.json"), deploymentEvidenceRecord);
  await writePostShipArtifacts({
    artifactsDir: path.join(shipStageDir, "artifacts"),
    summaryMarkdown: postShipArtifacts.summaryMarkdown,
    evidenceRecord: postShipArtifacts.evidenceRecord,
    followUpDraftMarkdown: postShipArtifacts.followUpDraftMarkdown,
    followUpRecord: postShipArtifacts.followUpRecord
  });
  await writePostShipArtifacts({
    artifactsDir: path.join(options.paths.runDir, "artifacts"),
    summaryMarkdown: postShipArtifacts.summaryMarkdown,
    evidenceRecord: postShipArtifacts.evidenceRecord,
    followUpDraftMarkdown: postShipArtifacts.followUpDraftMarkdown,
    followUpRecord: postShipArtifacts.followUpRecord
  });
  const shipStageStatus =
    shipRecord.readiness === "ready" && githubMutationResult.record.blockers.length === 0 && githubDeliveryRecord.overall.status === "ready"
      ? "completed"
      : "failed";
  await options.controller.send({
    type: "SET_STAGE_STATUS",
    stageName: "ship",
    status: shipStageStatus,
    executed: true,
    stageDir: shipStageDir,
    artifactPath: path.join(shipStageDir, "artifacts", "ship-summary.md"),
    notes: shipRecord.summary
  });
  await options.controller.send({
    type: "DELIVER_FINALIZED",
    buildSucceeded: buildExecution.result.code === 0,
    validationStatus: validationExecution.validationPlan.status,
    reviewStatus: reviewVerdict.status,
    shipReadiness: shipRecord.readiness,
    githubDeliveryStatus: githubDeliveryRecord.overall.status,
    summary:
      buildExecution.result.code !== 0
        ? `${summarizeBuildFailure(buildExecution)}; downstream stages blocked`
        : `Validation: ${validationExecution.validationPlan.status} (${validationExecution.validationPlan.outcomeCategory}); Ship readiness: ${shipRecord.readiness}; GitHub delivery: ${githubDeliveryRecord.overall.status}`
  });
  stageLineage = options.controller.currentStageLineage;
  events.markStage("ship", shipStageStatus === "completed" ? "completed" : "failed");

  const finalBody = buildDeliverFinalSummary({
    input: options.input,
    stageLineage,
    validationExecution,
    reviewVerdict,
    shipRecord,
    githubMutationRecord: githubMutationResult.record,
    githubDeliveryRecord,
    readinessPolicyRecord,
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
    githubMutationRecord: githubMutationResult.record,
    stageLineage,
    selectedSpecialists,
    finalBody
  };
  } finally {
    events.close();
  }
}

export { resolveLinkedBuildContext };
