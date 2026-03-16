import path from "node:path";
import { promises as fs } from "node:fs";
import readline from "node:readline/promises";
import type {
  ArtifactEntry,
  ChildRunInspection,
  BuildSessionRecord,
  BuildVerificationRecord,
  DeliverValidationLocalRecord,
  DeliverValidationPlan,
  DeliverReviewVerdict,
  DeliverShipRecord,
  DiscoverDelegateResult,
  DiscoverResearchPlan,
  GitHubGateEvaluation,
  GitHubDeliveryRecord,
  GitHubMutationRecord,
  RoutingPlan,
  RunEvent,
  RunInspection,
  RunLedgerEntry,
  StageLineage,
  ValidationRepoProfile,
  ValidationToolResearch
} from "./types.js";
import { listRunLedger, listRuns, readRun, runDirForId } from "./run.js";
import type { WorkflowName } from "./types.js";

interface InspectorCommandResponse {
  output?: string | null;
  switchToRunId?: string;
  exit?: boolean;
}

interface InspectorCompletionContext {
  commands: string[];
  showTargets: string[];
  stageNames: string[];
  specialistNames: string[];
  delegateTracks: string[];
  artifactPaths: string[];
  childStages: string[];
}

async function readRecentEvents(eventsPath?: string): Promise<RunEvent[]> {
  if (!eventsPath) {
    return [];
  }

  try {
    const body = await fs.readFile(eventsPath, "utf8");
    return body
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-8)
      .map((line) => JSON.parse(line) as RunEvent);
  } catch {
    return [];
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const body = await fs.readFile(filePath, "utf8");
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function summarizeChildFailure(child: ChildRunInspection): string {
  return child.run.error ?? child.run.lastActivity ?? `${child.run.workflow} ${child.run.status}`;
}

async function loadChildRuns(cwd: string, stageLineage: StageLineage | null): Promise<ChildRunInspection[]> {
  if (!stageLineage) {
    return [];
  }

  const childStages = stageLineage.stages.filter((stage) => stage.childRunId);
  const loaded = await Promise.all(
    childStages.map(async (stage) => {
      const childRunId = stage.childRunId;
      if (!childRunId) {
        return null;
      }
      try {
        const run = await readRun(cwd, childRunId);
        const runDir = runDirForId(cwd, childRunId);
        const [finalBody, recentEvents, artifacts] = await Promise.all([
          fs.readFile(run.finalPath, "utf8").catch(() => ""),
          readRecentEvents(run.eventsPath),
          walkArtifacts(runDir)
        ]);
        return {
          stageName: stage.name,
          run,
          runDir,
          finalBody,
          artifacts: artifacts
            .filter((artifact) => artifact.path !== "context.md" && artifact.path !== "events.jsonl")
            .slice(0, 8),
          recentEvents
        } satisfies ChildRunInspection;
      } catch {
        return null;
      }
    })
  );

  return loaded.filter((entry): entry is ChildRunInspection => Boolean(entry));
}

function badge(name: string, status: string): string {
  return `[${name}:${status}]`;
}

function renderStageStrip(inspection: RunInspection): string {
  if (inspection.stageLineage) {
    return inspection.stageLineage.stages.map((stage) => badge(stage.name, stage.status)).join(" ");
  }
  if (inspection.routingPlan) {
    return inspection.routingPlan.stages.map((stage) => badge(stage.name, "plan")).join(" ");
  }
  return "[none]";
}

function renderSpecialistStrip(inspection: RunInspection): string {
  if (inspection.stageLineage?.specialists.length) {
    return inspection.stageLineage.specialists.map((specialist) => badge(specialist.name, specialist.status)).join(" ");
  }
  const planned = inspection.routingPlan?.specialists.filter((specialist) => specialist.selected) ?? [];
  return planned.length > 0 ? planned.map((specialist) => badge(specialist.name, "plan")).join(" ") : "[none]";
}

function reviewMode(verdict: DeliverReviewVerdict | null): "analysis" | "readiness" {
  if (verdict?.mode === "analysis") {
    return "analysis";
  }
  return "readiness";
}

function renderReviewHeadline(verdict: DeliverReviewVerdict | null): string | undefined {
  if (!verdict) {
    return undefined;
  }
  return reviewMode(verdict) === "analysis" ? `- review mode: analysis (${verdict.status})` : `- review verdict: ${verdict.status}`;
}

function renderAnalysisReviewLines(verdict: DeliverReviewVerdict): string[] {
  return [
    `- analysis summary: ${verdict.summary}`,
    ...(verdict.confidence ? [`- confidence: ${verdict.confidence}`] : []),
    ...((verdict.gapClusters ?? []).slice(0, 4).map((cluster) => `- gap: ${cluster.title} [${cluster.severity}] ${cluster.summary}`)),
    ...((verdict.recommendedNextSlices ?? []).slice(0, 3).map((slice) => `- next slice: ${slice}`))
  ];
}

function renderReadinessReviewLines(verdict: DeliverReviewVerdict): string[] {
  return [
    `- review summary: ${verdict.summary}`,
    ...verdict.recommendedActions.slice(0, 3).map((action) => `- action: ${action}`)
  ];
}

function renderSuggestedActions(inspection: RunInspection): string[] {
  const lines: string[] = [];
  const deferredStages = inspection.stageLineage?.stages.filter((stage) => stage.status === "deferred" || stage.status === "skipped") ?? [];

  if (inspection.run.workflow === "build" || inspection.run.workflow === "deliver") {
    lines.push(
      inspection.run.workflow === "deliver"
        ? "- review change summary with `show artifact stages/build/artifacts/change-summary.md`"
        : "- review change summary with `show artifact artifacts/change-summary.md`"
    );
    lines.push("- inspect verification with `show verification`");
    if (inspection.run.workflow === "deliver") {
      lines.push("- inspect validation planning with `show validation`");
      lines.push("- inspect the test pyramid with `show pyramid`");
      lines.push("- inspect CI validation with `show ci-validation`");
      lines.push("- inspect the review verdict with `show review`");
      lines.push("- inspect ship readiness with `show ship`");
      if (inspection.githubMutationRecord) {
        lines.push("- inspect GitHub mutation state with `show mutation`");
      }
      if (inspection.githubDeliveryRecord) {
        lines.push("- inspect GitHub delivery evidence with `show github`");
        for (const gate of githubBlockingGates(inspection.githubDeliveryRecord).slice(0, 3)) {
          const command =
            gate === "pr" ? "show pr" : gate === "branch" ? "show branch" : `show ${gate}`;
          lines.push(`- inspect blocked GitHub ${gate} gate with \`${command}\``);
        }
      }
    }
  }
  if (inspection.run.workflow === "review") {
    lines.push("- inspect the review verdict with `show review`");
    if (reviewMode(inspection.deliverReviewVerdict) === "analysis") {
      lines.push("- inspect the main gap clusters with `gaps`");
    }
    if (hasMitigationActions(inspection)) {
      lines.push("- review mitigation options with `show mitigations`");
      lines.push("- start the default mitigation workflow with `mitigate`");
    }
  }
  if (inspection.run.workflow === "ship") {
    lines.push("- inspect ship readiness with `show ship`");
    if (inspection.githubMutationRecord) {
      lines.push("- inspect GitHub mutation state with `show mutation`");
    }
    if (inspection.githubDeliveryRecord) {
      lines.push("- inspect GitHub delivery evidence with `show github`");
    }
    if (hasMitigationActions(inspection)) {
      lines.push("- review mitigation options with `show mitigations`");
      lines.push("- start the default mitigation workflow with `mitigate`");
    }
  }
  if (inspection.run.workflow === "deliver" && hasMitigationActions(inspection)) {
    lines.push("- review mitigation options with `show mitigations`");
    lines.push("- start the default mitigation workflow with `mitigate`");
  }
  for (const stage of deferredStages.slice(0, 2)) {
    lines.push(`- inspect why ${stage.name} is ${stage.status}`);
  }
  if (inspection.run.sessionId) {
    lines.push(`- resume with cstack resume ${inspection.run.id}`);
  }
  if (inspection.artifacts.some((artifact) => artifact.path === "routing-plan.json")) {
    lines.push("- review routing with `show routing`");
  }
  if (inspection.childRuns.length > 0) {
    lines.push(`- inspect linked child runs with \`show child ${inspection.childRuns[0]!.stageName}\``);
  }

  return lines.length > 0 ? lines : ["- no obvious follow-up recorded"];
}

function classifyArtifact(relativePath: string): ArtifactEntry["kind"] {
  if (relativePath.includes("/delegates/") || relativePath.startsWith("delegates/")) {
    return "delegate";
  }
  if (relativePath.startsWith("artifacts/")) {
    return "artifact";
  }
  if (relativePath.startsWith("stages/")) {
    return "stage";
  }
  if (relativePath.endsWith(".log") || relativePath.endsWith(".jsonl")) {
    return "log";
  }
  if (relativePath.endsWith(".json") || relativePath.endsWith(".md")) {
    return "metadata";
  }
  return "artifact";
}

async function walkArtifacts(root: string, current = root): Promise<ArtifactEntry[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const artifacts: ArtifactEntry[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...(await walkArtifacts(root, absolutePath)));
      continue;
    }
    artifacts.push({
      path: path.relative(root, absolutePath),
      kind: classifyArtifact(path.relative(root, absolutePath))
    });
  }

  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

async function loadDiscoverDelegates(runDir: string): Promise<DiscoverDelegateResult[]> {
  const delegatesRoot = path.join(runDir, "stages", "discover", "delegates");
  try {
    const entries = await fs.readdir(delegatesRoot, { withFileTypes: true });
    const delegates: DiscoverDelegateResult[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const result = await readJsonFile<DiscoverDelegateResult>(path.join(delegatesRoot, entry.name, "result.json"));
      if (result) {
        delegates.push(result);
      }
    }
    return delegates.sort((left, right) => left.track.localeCompare(right.track));
  } catch {
    return [];
  }
}

function renderVerificationSummary(record: BuildVerificationRecord | null): string {
  if (!record) {
    return "not recorded";
  }
  if (record.status === "not-run" && record.notes) {
    return `${record.status} (${record.notes})`;
  }
  return record.status;
}

function githubBlockingGates(record: GitHubDeliveryRecord): string[] {
  const gates: Array<{ name: string; status: string }> = [
    { name: "branch", status: record.branchState.status },
    { name: "pr", status: record.pullRequest.status },
    { name: "issues", status: record.issues.status },
    { name: "checks", status: record.checks.status },
    { name: "actions", status: record.actions.status },
    { name: "security", status: record.security.status },
    { name: "release", status: record.release.status }
  ];

  return gates.filter((gate) => gate.status === "blocked").map((gate) => gate.name);
}

function renderGitHubSummary(record: GitHubDeliveryRecord | null): string {
  if (!record) {
    return "not recorded";
  }
  const blockingGates = githubBlockingGates(record);
  if (blockingGates.length === 0) {
    return record.overall.status;
  }
  return `${record.overall.status} (${blockingGates.join(", ")})`;
}

function uniqueLines(values: string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const value of values.map((entry) => entry.trim()).filter(Boolean)) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    lines.push(value);
  }
  return lines;
}

function collectMitigationActions(inspection: RunInspection): string[] {
  return uniqueLines([
    ...(inspection.deliverReviewVerdict?.recommendedActions ?? []),
    ...(inspection.deliverShipRecord?.nextActions ?? []),
    ...(inspection.deliverShipRecord?.unresolved ?? []),
    ...(inspection.githubMutationRecord?.blockers ?? []),
    ...(inspection.githubDeliveryRecord?.overall.blockers ?? []),
    inspection.deliverReviewVerdict?.summary ?? "",
    inspection.deliverShipRecord?.summary ?? "",
    inspection.run.error ?? "",
    inspection.run.lastActivity ?? ""
  ]);
}

function defaultMitigationWorkflow(inspection: RunInspection): WorkflowName | null {
  switch (inspection.run.workflow) {
    case "review":
      return "build";
    case "ship":
    case "deliver":
      return "deliver";
    default:
      return null;
  }
}

function hasMitigationActions(inspection: RunInspection): boolean {
  return defaultMitigationWorkflow(inspection) !== null && collectMitigationActions(inspection).length > 0;
}

function renderMitigations(inspection: RunInspection): string {
  const actions = collectMitigationActions(inspection);
  const defaultWorkflow = defaultMitigationWorkflow(inspection);
  if (!defaultWorkflow || actions.length === 0) {
    return "No mitigation actions are recorded for this run.";
  }

  return [
    "Mitigation options:",
    `- default workflow: ${defaultWorkflow}`,
    `- source run: ${inspection.run.id}`,
    "",
    "Recorded actions:",
    ...actions.map((action, index) => `- ${index + 1}: ${action}`),
    "",
    "Commands:",
    "- mitigate",
    "- mitigate <n>",
    `- mitigate ${defaultWorkflow}`,
    `- mitigate ${defaultWorkflow} <n>`
  ].join("\n");
}

function buildMitigationPrompt(inspection: RunInspection, workflow: WorkflowName, actions: string[]): string {
  const focus = actions.length > 0 ? actions.join(" ") : inspection.run.summary ?? inspection.run.inputs.userPrompt;
  switch (workflow) {
    case "build":
      return `Implement changes to mitigate the findings from ${inspection.run.workflow} run ${inspection.run.id}. Focus on: ${focus}`;
    case "deliver":
      return `Mitigate the blockers from ${inspection.run.workflow} run ${inspection.run.id} and carry the work through delivery. Focus on: ${focus}`;
    case "review":
      return `Re-review the mitigations for ${inspection.run.workflow} run ${inspection.run.id}. Focus on: ${focus}`;
    case "ship":
      return `Retry ship readiness for ${inspection.run.workflow} run ${inspection.run.id}. Focus on: ${focus}`;
    case "spec":
      return `Turn the findings from ${inspection.run.workflow} run ${inspection.run.id} into an executable plan. Focus on: ${focus}`;
    default:
      return `Mitigate the findings from ${inspection.run.workflow} run ${inspection.run.id}. Focus on: ${focus}`;
  }
}

function parseMitigationCommand(trimmed: string): { workflow?: WorkflowName; actionIndex?: number } | null {
  if (!trimmed.startsWith("mitigate")) {
    return null;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens[0] !== "mitigate") {
    return null;
  }

  let workflow: WorkflowName | null = null;
  let actionIndex: number | undefined;

  for (const token of tokens.slice(1)) {
    if (/^\d+$/.test(token)) {
      actionIndex = Number.parseInt(token, 10);
      continue;
    }
    if (["spec", "build", "review", "ship", "deliver"].includes(token)) {
      workflow = token as WorkflowName;
      continue;
    }
    return null;
  }

  return {
    ...(workflow ? { workflow } : {}),
    ...(typeof actionIndex === "number" ? { actionIndex } : {})
  };
}

async function runWorkflowFromInspector(cwd: string, workflow: WorkflowName, args: string[]): Promise<string> {
  const previous = process.env.CSTACK_NO_POSTRUN_INSPECT;
  process.env.CSTACK_NO_POSTRUN_INSPECT = "1";

  try {
    switch (workflow) {
      case "build": {
        const { runBuild } = await import("./commands/build.js");
        return await runBuild(cwd, args);
      }
      case "deliver": {
        const { runDeliver } = await import("./commands/deliver.js");
        return await runDeliver(cwd, args);
      }
      case "review": {
        const { runReview } = await import("./commands/review.js");
        return await runReview(cwd, args);
      }
      case "ship": {
        const { runShip } = await import("./commands/ship.js");
        return await runShip(cwd, args);
      }
      case "spec": {
        const { runSpec } = await import("./commands/spec.js");
        return await runSpec(cwd, args);
      }
      default:
        throw new Error(`Unsupported mitigation workflow: ${workflow}`);
    }
  } finally {
    if (typeof previous === "string") {
      process.env.CSTACK_NO_POSTRUN_INSPECT = previous;
    } else {
      delete process.env.CSTACK_NO_POSTRUN_INSPECT;
    }
  }
}

async function startMitigationWorkflow(cwd: string, inspection: RunInspection, trimmed: string): Promise<InspectorCommandResponse> {
  const parsed = parseMitigationCommand(trimmed);
  const defaultWorkflow = defaultMitigationWorkflow(inspection);
  if (!parsed || !defaultWorkflow) {
    return { output: "This run does not expose mitigation actions." };
  }

  const workflow = parsed.workflow ?? defaultWorkflow;
  const actions = collectMitigationActions(inspection);
  if (actions.length === 0) {
    return { output: "No mitigation actions are recorded for this run." };
  }

  const selectedActions =
    typeof parsed.actionIndex === "number"
      ? (() => {
          const action = actions[parsed.actionIndex - 1];
          if (!action) {
            throw new Error(`Mitigation action ${parsed.actionIndex} is not available. Use \`show mitigations\` to inspect choices.`);
          }
          return [action];
        })()
      : actions;

  const prompt = buildMitigationPrompt(inspection, workflow, selectedActions);
  const args: string[] = ["--from-run", inspection.run.id];
  if (workflow === "build" || workflow === "ship" || workflow === "deliver") {
    args.push("--allow-dirty");
  }
  if ((workflow === "deliver" || workflow === "ship") && inspection.run.inputs.deliveryMode === "release") {
    args.push("--release");
  }
  if ((workflow === "deliver" || workflow === "ship") && inspection.run.inputs.issueNumbers?.length) {
    for (const issueNumber of inspection.run.inputs.issueNumbers) {
      args.push("--issue", String(issueNumber));
    }
  }
  if ((workflow === "build" || workflow === "deliver") && inspection.run.inputs.observedMode === "exec") {
    args.push("--exec");
  }
  args.push(prompt);

  const runId = await runWorkflowFromInspector(cwd, workflow, args);
  return {
    output: [
      `Started mitigation workflow: ${workflow}`,
      `Run: ${runId}`,
      `Focus: ${selectedActions.join(" | ")}`
    ].join("\n"),
    switchToRunId: runId
  };
}

function renderGitHubGate<T>(label: string, gate: GitHubGateEvaluation<T>): string {
  return [
    `${label}: ${gate.status}`,
    `- required: ${gate.required ? "yes" : "no"}`,
    `- source: ${gate.source}`,
    `- observed at: ${gate.observedAt}`,
    `- summary: ${gate.summary}`,
    ...(gate.blockers.length > 0 ? gate.blockers.map((blocker) => `- blocker: ${blocker}`) : ["- blockers: none"]),
    gate.error ? `- error: ${gate.error}` : undefined,
    "",
    JSON.stringify(gate.observed, null, 2)
  ]
    .filter(Boolean)
    .join("\n");
}

export async function loadRunInspection(cwd: string, runId?: string): Promise<RunInspection> {
  const targetId = runId ?? (await listRuns(cwd))[0]?.id;
  if (!targetId) {
    throw new Error("No runs found to inspect.");
  }

  const run = await readRun(cwd, targetId);
  const runDir = runDirForId(cwd, targetId);
  const sessionPath = path.join(runDir, "session.json");
  const verificationPath = path.join(runDir, "artifacts", "verification.json");
  const deliverBuildSessionPath = path.join(runDir, "stages", "build", "session.json");
  const deliverBuildVerificationPath = path.join(runDir, "stages", "build", "artifacts", "verification.json");
  const deliverValidationProfilePath = path.join(runDir, "stages", "validation", "repo-profile.json");
  const deliverValidationPlanPath = path.join(runDir, "stages", "validation", "validation-plan.json");
  const deliverValidationToolResearchPath = path.join(runDir, "stages", "validation", "tool-research.json");
  const deliverValidationLocalPath = path.join(runDir, "stages", "validation", "artifacts", "local-validation.json");
  const deliverReviewVerdictPath = path.join(runDir, "stages", "review", "artifacts", "verdict.json");
  const deliverShipRecordPath = path.join(runDir, "stages", "ship", "artifacts", "ship-record.json");
  const reviewVerdictPath = path.join(runDir, "artifacts", "verdict.json");
  const shipRecordPath = path.join(runDir, "artifacts", "ship-record.json");
  const githubDeliveryPath = path.join(runDir, "artifacts", "github-delivery.json");
  const githubMutationPath = path.join(runDir, "artifacts", "github-mutation.json");
  const [
    recentEvents,
    routingPlan,
    stageLineage,
    discoverResearchPlan,
    discoverDelegates,
    sessionRecord,
    verificationRecord,
    validationRepoProfile,
    validationPlan,
    validationToolResearch,
    validationLocalRecord,
    deliverReviewVerdict,
    deliverShipRecord,
    githubDeliveryRecord,
    githubMutationRecord,
    artifacts
  ] = await Promise.all([
    readRecentEvents(run.eventsPath),
    readJsonFile<RoutingPlan>(path.join(runDir, "routing-plan.json")),
    readJsonFile<StageLineage>(path.join(runDir, "stage-lineage.json")),
    readJsonFile<DiscoverResearchPlan>(path.join(runDir, "stages", "discover", "research-plan.json")),
    loadDiscoverDelegates(runDir),
    readJsonFile<BuildSessionRecord>(run.workflow === "deliver" ? deliverBuildSessionPath : run.workflow === "build" ? sessionPath : ""),
    readJsonFile<BuildVerificationRecord>(run.workflow === "deliver" ? deliverBuildVerificationPath : run.workflow === "build" ? verificationPath : ""),
    readJsonFile<ValidationRepoProfile>(deliverValidationProfilePath),
    readJsonFile<DeliverValidationPlan>(deliverValidationPlanPath),
    readJsonFile<ValidationToolResearch>(deliverValidationToolResearchPath),
    readJsonFile<DeliverValidationLocalRecord>(deliverValidationLocalPath),
    readJsonFile<DeliverReviewVerdict>(run.workflow === "deliver" ? deliverReviewVerdictPath : run.workflow === "review" ? reviewVerdictPath : ""),
    readJsonFile<DeliverShipRecord>(run.workflow === "deliver" ? deliverShipRecordPath : run.workflow === "ship" ? shipRecordPath : ""),
    readJsonFile<GitHubDeliveryRecord>(githubDeliveryPath),
    readJsonFile<GitHubMutationRecord>(githubMutationPath),
    walkArtifacts(runDir)
  ]);
  const childRuns = await loadChildRuns(cwd, stageLineage);

  let finalBody = "";
  try {
    finalBody = await fs.readFile(run.finalPath, "utf8");
  } catch {}

  return {
    run,
    runDir,
    routingPlan,
    stageLineage,
    discoverResearchPlan,
    discoverDelegates,
    sessionRecord,
    verificationRecord,
    validationRepoProfile,
    validationPlan,
    validationToolResearch,
    validationLocalRecord,
    deliverReviewVerdict,
    deliverShipRecord,
    githubDeliveryRecord,
    githubMutationRecord,
    recentEvents,
    finalBody,
    artifacts,
    childRuns
  };
}

function renderResearchSection(inspection: RunInspection): string[] {
  const { discoverResearchPlan } = inspection;
  if (!discoverResearchPlan) {
    return [];
  }

  const sourceCount = inspection.discoverDelegates.reduce((count, delegate) => count + delegate.sources.length, 0);

  return [
    "",
    "Research",
    `- mode: ${discoverResearchPlan.mode}`,
    `- web research allowed: ${discoverResearchPlan.webResearchAllowed ? "yes" : "no"}`,
    `- selected tracks: ${
      discoverResearchPlan.tracks.filter((track) => track.selected).map((track) => track.name).join(", ") || "none"
    }`,
    `- cited sources: ${sourceCount}`,
    ...inspection.discoverDelegates.map(
      (delegate) => `- ${delegate.track}: ${delegate.status}, disposition=${delegate.leaderDisposition}`
    ),
    ...discoverResearchPlan.limitations.map((limitation) => `- limitation: ${limitation}`)
  ];
}

function renderRoutingSection(inspection: RunInspection): string[] {
  const { routingPlan } = inspection;
  if (!routingPlan) {
    return [];
  }

  return [
    "",
    `Routing plan: ${path.relative(inspection.run.cwd, path.join(inspection.runDir, "routing-plan.json"))}`,
    "Planned stages:",
    ...routingPlan.stages.map((stage) => `  - ${stage.name}: ${stage.status} (${stage.rationale})`),
    "",
    "Selected specialists:",
    ...(routingPlan.specialists.some((specialist) => specialist.selected)
      ? routingPlan.specialists
          .filter((specialist) => specialist.selected)
          .map((specialist) => `  - ${specialist.name}: ${specialist.reason}`)
      : ["  - none"])
  ];
}

function renderLineageSection(inspection: RunInspection): string[] {
  const { stageLineage } = inspection;
  if (!stageLineage) {
    return [];
  }

  return [
    "",
    "Stage lineage:",
    ...stageLineage.stages.map((stage) => `  - ${stage.name}: ${stage.status}${stage.executed ? " (executed)" : ""}`),
    "",
    "Specialists:",
    ...(stageLineage.specialists.length > 0
      ? stageLineage.specialists.map(
          (specialist) =>
            `  - ${specialist.name}: ${specialist.status}, disposition=${specialist.disposition}, reason=${specialist.reason}`
        )
      : ["  - none"])
  ];
}

export function renderInspectionSummary(cwd: string, inspection: RunInspection): string {
  const { run, recentEvents, finalBody } = inspection;
  const failedChildRuns = inspection.childRuns.filter((child) => child.run.status === "failed");
  const reviewDetails =
    inspection.deliverReviewVerdict && reviewMode(inspection.deliverReviewVerdict) === "analysis"
      ? renderAnalysisReviewLines(inspection.deliverReviewVerdict)
      : inspection.deliverReviewVerdict
        ? renderReadinessReviewLines(inspection.deliverReviewVerdict)
        : [];

  return (
    [
      `cstack inspect  ${run.id}`,
      `workflow ${run.workflow}  |  status ${run.status}  |  updated ${run.updatedAt}`,
      "",
      "Observed",
      `- summary: ${run.summary ?? run.inputs.userPrompt}`,
      `- branch: ${run.gitBranch}`,
      run.currentStage ? `- current stage: ${run.currentStage}` : undefined,
      run.activeSpecialists && run.activeSpecialists.length > 0 ? `- active specialists: ${run.activeSpecialists.join(", ")}` : undefined,
      `- final: ${path.relative(cwd, run.finalPath)}`,
      run.eventsPath ? `- events: ${path.relative(cwd, run.eventsPath)}` : undefined,
      run.sessionId ? `- session: ${run.sessionId}` : undefined,
      run.lastActivity ? `- last activity: ${run.lastActivity}` : undefined,
      inspection.sessionRecord ? `- mode: requested ${inspection.sessionRecord.requestedMode}, observed ${inspection.sessionRecord.mode}` : undefined,
      inspection.sessionRecord?.linkedRunId ? `- linked run: ${inspection.sessionRecord.linkedRunId}` : undefined,
      inspection.verificationRecord ? `- verification: ${renderVerificationSummary(inspection.verificationRecord)}` : undefined,
      inspection.validationPlan ? `- validation: ${inspection.validationPlan.status}` : undefined,
      inspection.validationLocalRecord ? `- local validation: ${inspection.validationLocalRecord.status}` : undefined,
      renderReviewHeadline(inspection.deliverReviewVerdict),
      ...reviewDetails,
      inspection.deliverShipRecord ? `- ship readiness: ${inspection.deliverShipRecord.readiness}` : undefined,
      inspection.githubMutationRecord ? `- github mutation: ${inspection.githubMutationRecord.summary}` : undefined,
      inspection.githubDeliveryRecord ? `- github delivery: ${renderGitHubSummary(inspection.githubDeliveryRecord)}` : undefined,
      ...failedChildRuns.flatMap((child) => [
        `- downstream ${child.stageName} failed: ${summarizeChildFailure(child)}`,
        `- inspect child run: cstack inspect ${child.run.id}`
      ]),
      "",
      "Plan",
      `- stages: ${renderStageStrip(inspection)}`,
      `- specialists: ${renderSpecialistStrip(inspection)}`,
      ...renderResearchSection(inspection),
      ...renderRoutingSection(inspection),
      ...renderLineageSection(inspection),
      "",
      "Suggested next actions",
      ...renderSuggestedActions(inspection),
      recentEvents.length > 0 ? "" : undefined,
      recentEvents.length > 0 ? "Recent activity" : undefined,
      ...recentEvents.map((event) => `  [${event.type}] +${Math.floor(event.elapsedMs / 1000)}s ${event.message}`),
      "",
      "Shortcuts",
      "- 1 summary  2 stages  3 specialists  4 artifacts  f final  r routing  g gaps  q exit",
      "",
      "Final output",
      finalBody || "(missing)"
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
}

function renderArtifacts(inspection: RunInspection): string {
  const artifactLines = inspection.artifacts.map((artifact) => `- ${artifact.path} (${artifact.kind})`);
  const childLines = inspection.childRuns.flatMap((child) => [
    `- child ${child.stageName}: ${child.run.id} (${child.run.status})`,
    `  final: ${path.relative(inspection.run.cwd, child.run.finalPath)}`,
    ...child.artifacts.slice(0, 4).map((artifact) => `  artifact: ${path.relative(inspection.run.cwd, path.join(child.runDir, artifact.path))}`)
  ]);
  return [
    "Artifacts:",
    ...(artifactLines.length > 0 ? artifactLines : ["- none found"]),
    ...(childLines.length > 0 ? ["", "Linked child runs:", ...childLines] : [])
  ].join("\n");
}

function renderSession(inspection: RunInspection): string {
  if (!inspection.sessionRecord) {
    return "No build session record was recorded for this run.";
  }

  return `${JSON.stringify(inspection.sessionRecord, null, 2)}\n`;
}

function renderVerification(inspection: RunInspection): string {
  if (!inspection.verificationRecord) {
    return "No verification record was recorded for this run.";
  }

  return `${JSON.stringify(inspection.verificationRecord, null, 2)}\n`;
}

function renderValidation(inspection: RunInspection): string {
  if (!inspection.validationPlan) {
    return "No validation plan was recorded for this run.";
  }

  return [
    JSON.stringify(inspection.validationPlan, null, 2),
    "",
    inspection.validationLocalRecord ? JSON.stringify(inspection.validationLocalRecord, null, 2) : "No local validation record was recorded for this run."
  ].join("\n");
}

async function renderValidationPyramid(inspection: RunInspection): Promise<string> {
  return readRelativeArtifact(inspection, "stages/validation/artifacts/test-pyramid.md");
}

async function renderValidationCoverage(inspection: RunInspection): Promise<string> {
  return readRelativeArtifact(inspection, "stages/validation/artifacts/coverage-summary.json");
}

async function renderValidationCi(inspection: RunInspection): Promise<string> {
  return readRelativeArtifact(inspection, "stages/validation/artifacts/ci-validation.json");
}

async function renderValidationToolResearch(inspection: RunInspection): Promise<string> {
  return readRelativeArtifact(inspection, "stages/validation/tool-research.json");
}

function renderDeliverReview(inspection: RunInspection): string {
  if (!inspection.deliverReviewVerdict) {
    return "No deliver review verdict was recorded for this run.";
  }

  if (reviewMode(inspection.deliverReviewVerdict) === "analysis") {
    return [
      "Analysis review:",
      `- status: ${inspection.deliverReviewVerdict.status}`,
      `- summary: ${inspection.deliverReviewVerdict.summary}`,
      ...(inspection.deliverReviewVerdict.confidence ? [`- confidence: ${inspection.deliverReviewVerdict.confidence}`] : []),
      "",
      "Gap clusters:",
      ...((inspection.deliverReviewVerdict.gapClusters ?? []).length > 0
        ? (inspection.deliverReviewVerdict.gapClusters ?? []).map(
            (cluster) => `- ${cluster.title} [${cluster.severity}]: ${cluster.summary}`
          )
        : ["- none recorded"]),
      "",
      "Likely root causes:",
      ...((inspection.deliverReviewVerdict.likelyRootCauses ?? []).length > 0
        ? (inspection.deliverReviewVerdict.likelyRootCauses ?? []).map((cause) => `- ${cause}`)
        : ["- none recorded"]),
      "",
      "Recommended next slices:",
      ...((inspection.deliverReviewVerdict.recommendedNextSlices ?? []).length > 0
        ? (inspection.deliverReviewVerdict.recommendedNextSlices ?? []).map((slice) => `- ${slice}`)
        : ["- none recorded"]),
      "",
      "Recommended actions:",
      ...(inspection.deliverReviewVerdict.recommendedActions.length > 0
        ? inspection.deliverReviewVerdict.recommendedActions.map((action) => `- ${action}`)
        : ["- none recorded"])
    ].join("\n");
  }

  return `${JSON.stringify(inspection.deliverReviewVerdict, null, 2)}\n`;
}

function renderDeliverShip(inspection: RunInspection): string {
  if (!inspection.deliverShipRecord) {
    return "No deliver ship record was recorded for this run.";
  }

  return `${JSON.stringify(inspection.deliverShipRecord, null, 2)}\n`;
}

function renderGitHub(inspection: RunInspection): string {
  if (!inspection.githubDeliveryRecord) {
    return "No GitHub delivery record was recorded for this run.";
  }

  return `${JSON.stringify(inspection.githubDeliveryRecord, null, 2)}\n`;
}

function renderGitHubMutation(inspection: RunInspection): string {
  if (!inspection.githubMutationRecord) {
    return "No GitHub mutation record was recorded for this run.";
  }

  return `${JSON.stringify(inspection.githubMutationRecord, null, 2)}\n`;
}

function renderGitHubBranch(inspection: RunInspection): string {
  if (!inspection.githubDeliveryRecord) {
    return "No GitHub delivery record was recorded for this run.";
  }

  return `${renderGitHubGate("GitHub branch gate", inspection.githubDeliveryRecord.branchState)}\n`;
}

function renderGitHubPullRequest(inspection: RunInspection): string {
  if (!inspection.githubDeliveryRecord) {
    return "No GitHub delivery record was recorded for this run.";
  }

  return `${renderGitHubGate("GitHub pull request gate", inspection.githubDeliveryRecord.pullRequest)}\n`;
}

function renderGitHubIssues(inspection: RunInspection): string {
  if (!inspection.githubDeliveryRecord) {
    return "No GitHub delivery record was recorded for this run.";
  }

  return `${renderGitHubGate("GitHub issues gate", inspection.githubDeliveryRecord.issues)}\n`;
}

function renderGitHubChecks(inspection: RunInspection): string {
  if (!inspection.githubDeliveryRecord) {
    return "No GitHub delivery record was recorded for this run.";
  }

  return `${renderGitHubGate("GitHub checks gate", inspection.githubDeliveryRecord.checks)}\n`;
}

function renderGitHubActions(inspection: RunInspection): string {
  if (!inspection.githubDeliveryRecord) {
    return "No GitHub delivery record was recorded for this run.";
  }

  return `${renderGitHubGate("GitHub actions gate", inspection.githubDeliveryRecord.actions)}\n`;
}

function renderGitHubSecurity(inspection: RunInspection): string {
  if (!inspection.githubDeliveryRecord) {
    return "No GitHub delivery record was recorded for this run.";
  }

  return `${renderGitHubGate("GitHub security gate", inspection.githubDeliveryRecord.security)}\n`;
}

function renderGitHubRelease(inspection: RunInspection): string {
  if (!inspection.githubDeliveryRecord) {
    return "No GitHub delivery record was recorded for this run.";
  }

  return `${renderGitHubGate("GitHub release gate", inspection.githubDeliveryRecord.release)}\n`;
}

function renderStages(inspection: RunInspection): string {
  if (!inspection.stageLineage) {
    return "No stage lineage recorded for this run.";
  }

  return [
    "Stages:",
    ...inspection.stageLineage.stages.map((stage) => {
      const details: string[] = [stage.status];
      if (stage.executed) {
        details.push("executed");
      }
      const child = stage.childRunId ? inspection.childRuns.find((entry) => entry.run.id === stage.childRunId) : undefined;
      if (child) {
        details.push(`child ${child.run.workflow}=${child.run.status}`);
        if (child.run.status === "failed") {
          details.push(summarizeChildFailure(child));
        }
      }
      if (stage.notes) {
        details.push(stage.notes);
      }
      return `- ${stage.name}: ${details.join(" | ")}`;
    })
  ].join("\n");
}

function renderSpecialists(inspection: RunInspection): string {
  const planned = inspection.routingPlan?.specialists.filter((specialist) => specialist.selected) ?? [];
  const executed = inspection.stageLineage?.specialists ?? [];

  return [
    "Planned specialists:",
    ...(planned.length > 0 ? planned.map((specialist) => `- ${specialist.name}: ${specialist.reason}`) : ["- none"]),
    "",
    "Executed specialists:",
    ...(executed.length > 0
      ? executed.map((specialist) => `- ${specialist.name}: ${specialist.status}, disposition=${specialist.disposition}`)
      : ["- none"])
  ].join("\n");
}

function renderDiscoverDelegates(inspection: RunInspection): string {
  if (!inspection.discoverResearchPlan) {
    return "No discover research plan was recorded for this run.";
  }

  const planned = inspection.discoverResearchPlan.tracks.filter((track) => track.selected);
  return [
    "Planned discover tracks:",
    ...(planned.length > 0 ? planned.map((track) => `- ${track.name}: ${track.reason}`) : ["- none"]),
    "",
    "Executed discover tracks:",
    ...(inspection.discoverDelegates.length > 0
      ? inspection.discoverDelegates.map(
          (delegate) =>
            `- ${delegate.track}: ${delegate.status}, disposition=${delegate.leaderDisposition}, sources=${delegate.sources.length}`
        )
      : ["- none"])
  ].join("\n");
}

function renderWhatRemains(inspection: RunInspection): string {
  const outstandingStages = inspection.stageLineage?.stages.filter((stage) => stage.status !== "completed") ?? [];
  const skippedSpecialists =
    inspection.routingPlan?.specialists.filter(
      (specialist) => specialist.selected && !(inspection.stageLineage?.specialists.some((entry) => entry.name === specialist.name) ?? false)
    ) ?? [];

  const lines = ["Remaining work:"];
  const appendGitHubBlockers = () => {
    if (inspection.githubMutationRecord?.blockers.length) {
      for (const blocker of inspection.githubMutationRecord.blockers) {
        lines.push(`- github mutation: ${blocker}`);
      }
    }
    if (inspection.githubDeliveryRecord) {
      const githubLines = [
        inspection.githubDeliveryRecord.branchState.status === "blocked"
          ? `- github branch: ${inspection.githubDeliveryRecord.branchState.summary}`
          : undefined,
        inspection.githubDeliveryRecord.pullRequest.status === "blocked"
          ? `- github pr: ${inspection.githubDeliveryRecord.pullRequest.summary}`
          : undefined,
        inspection.githubDeliveryRecord.issues.status === "blocked"
          ? `- github issues: ${inspection.githubDeliveryRecord.issues.summary}`
          : undefined,
        inspection.githubDeliveryRecord.checks.status === "blocked"
          ? `- github checks: ${inspection.githubDeliveryRecord.checks.summary}`
          : undefined,
        inspection.githubDeliveryRecord.actions.status === "blocked"
          ? `- github actions: ${inspection.githubDeliveryRecord.actions.summary}`
          : undefined,
        inspection.githubDeliveryRecord.security.status === "blocked"
          ? `- github security: ${inspection.githubDeliveryRecord.security.summary}`
          : undefined,
        inspection.githubDeliveryRecord.release.status === "blocked"
          ? `- github release: ${inspection.githubDeliveryRecord.release.summary}`
          : undefined
      ].filter((line): line is string => Boolean(line));
      if (githubLines.length > 0) {
        lines.push(...githubLines);
      }
    }
  };

  if (outstandingStages.length === 0 && skippedSpecialists.length === 0) {
    appendGitHubBlockers();
    if (lines.length > 1) {
      return lines.join("\n");
    }
    lines.push("- no deferred or missing work recorded");
    return lines.join("\n");
  }

  for (const stage of outstandingStages) {
    lines.push(`- stage ${stage.name}: ${stage.status}${stage.notes ? ` (${stage.notes})` : ""}`);
    const child = stage.childRunId ? inspection.childRuns.find((entry) => entry.run.id === stage.childRunId) : undefined;
    if (child) {
      lines.push(`- child ${child.run.workflow} run ${child.run.id}: ${child.run.status}`);
      lines.push(`- child summary: ${summarizeChildFailure(child)}`);
      lines.push(`- inspect child with: cstack inspect ${child.run.id}`);
    }
  }
  for (const specialist of skippedSpecialists) {
    lines.push(`- specialist ${specialist.name}: planned but not executed`);
  }
  appendGitHubBlockers();
  return lines.join("\n");
}

function renderGapClusters(inspection: RunInspection): string {
  if (!inspection.deliverReviewVerdict) {
    return "No review verdict was recorded for this run.";
  }
  if (reviewMode(inspection.deliverReviewVerdict) !== "analysis") {
    return "Gap clusters are only recorded for analysis-mode review runs.";
  }

  return [
    "Gap clusters:",
    ...((inspection.deliverReviewVerdict.gapClusters ?? []).length > 0
      ? (inspection.deliverReviewVerdict.gapClusters ?? []).map(
          (cluster) => `- ${cluster.title} [${cluster.severity}]: ${cluster.summary}`
        )
      : ["- none recorded"]),
    "",
    "Recommended next slices:",
    ...((inspection.deliverReviewVerdict.recommendedNextSlices ?? []).length > 0
      ? (inspection.deliverReviewVerdict.recommendedNextSlices ?? []).map((slice) => `- ${slice}`)
      : ["- none recorded"])
  ].join("\n");
}

function renderWhyDeferred(inspection: RunInspection, stageName: string): string {
  const stage = inspection.stageLineage?.stages.find((entry) => entry.name === stageName);
  if (!stage) {
    return `No stage named \`${stageName}\` was recorded for this run.`;
  }
  if (stage.status !== "deferred" && stage.status !== "skipped") {
    return `Stage \`${stageName}\` was not deferred. Current status: ${stage.status}.`;
  }
  return `Stage \`${stageName}\` is ${stage.status}: ${stage.notes ?? "No additional explanation was recorded."}`;
}

async function readRelativeArtifact(inspection: RunInspection, relativePath: string): Promise<string> {
  const normalized = relativePath.replaceAll("\\", "/");
  const artifact = inspection.artifacts.find((entry) => entry.path === normalized);
  if (!artifact) {
    return `Artifact \`${relativePath}\` was not found in this run.`;
  }

  try {
    return await fs.readFile(path.join(inspection.runDir, artifact.path), "utf8");
  } catch {
    return `Artifact \`${relativePath}\` could not be read as text.`;
  }
}

function buildInspectorCompletionContext(inspection: RunInspection): InspectorCompletionContext {
  const commands = [
    "summary",
    "stages",
    "specialists",
    "artifacts",
    "gaps",
    "show final",
    "show routing",
    "show research",
    "show session",
    "show verification",
    "show validation",
    "show pyramid",
    "show coverage",
    "show ci-validation",
    "show tool-research",
    "show review",
    "show mitigations",
    "show ship",
    "show mutation",
    "show github",
    "show branch",
    "show pr",
    "show issues",
    "show checks",
    "show actions",
    "show security",
    "show release",
    "show child",
    "show delegate",
    "show sources",
    "show stage",
    "show specialist",
    "show artifact",
    "why deferred",
    "what remains",
    "mitigate",
    "resume",
    "fork",
    "help",
    "exit",
    "quit"
  ];
  const showTargets = [
    "final",
    "routing",
    "research",
    "session",
    "verification",
    "validation",
    "pyramid",
    "coverage",
    "ci-validation",
    "tool-research",
    "review",
    "mitigations",
    "ship",
    "mutation",
    "github",
    "branch",
    "pr",
    "issues",
    "checks",
    "actions",
    "security",
    "release",
    "child",
    "delegate",
    "sources",
    "stage",
    "specialist",
    "artifact"
  ];

  return {
    commands,
    showTargets,
    stageNames: inspection.stageLineage?.stages.map((stage) => stage.name) ?? [],
    specialistNames: [
      ...(inspection.stageLineage?.specialists.map((specialist) => specialist.name) ?? []),
      ...(inspection.routingPlan?.specialists.map((specialist) => specialist.name) ?? [])
    ],
    delegateTracks: inspection.discoverDelegates.map((delegate) => delegate.track),
    artifactPaths: inspection.artifacts.map((artifact) => artifact.path),
    childStages: inspection.childRuns.map((child) => child.stageName)
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function completionMatches(values: string[], fragment: string): string[] {
  const lowered = fragment.toLowerCase();
  return uniqueSorted(values.filter((value) => value.toLowerCase().startsWith(lowered)));
}

export function completeInspectorInput(inspection: RunInspection, line: string): [string[], string] {
  const trimmedStart = line.trimStart();
  const context = buildInspectorCompletionContext(inspection);

  if (trimmedStart.startsWith("show artifact ")) {
    const fragment = trimmedStart.slice("show artifact ".length);
    return [completionMatches(context.artifactPaths, fragment).map((match) => `show artifact ${match}`), line];
  }
  if (trimmedStart.startsWith("show stage ")) {
    const fragment = trimmedStart.slice("show stage ".length);
    return [completionMatches(context.stageNames, fragment).map((match) => `show stage ${match}`), line];
  }
  if (trimmedStart.startsWith("show specialist ")) {
    const fragment = trimmedStart.slice("show specialist ".length);
    return [completionMatches(context.specialistNames, fragment).map((match) => `show specialist ${match}`), line];
  }
  if (trimmedStart.startsWith("show delegate ")) {
    const fragment = trimmedStart.slice("show delegate ".length);
    return [completionMatches(context.delegateTracks, fragment).map((match) => `show delegate ${match}`), line];
  }
  if (trimmedStart.startsWith("show sources ")) {
    const fragment = trimmedStart.slice("show sources ".length);
    return [completionMatches(context.delegateTracks, fragment).map((match) => `show sources ${match}`), line];
  }
  if (trimmedStart.startsWith("show child ")) {
    const fragment = trimmedStart.slice("show child ".length);
    return [completionMatches(context.childStages, fragment).map((match) => `show child ${match}`), line];
  }
  if (trimmedStart.startsWith("show ")) {
    const fragment = trimmedStart.slice("show ".length);
    return [completionMatches(context.showTargets, fragment).map((match) => `show ${match}`), line];
  }
  if (trimmedStart.startsWith("why deferred ")) {
    const fragment = trimmedStart.slice("why deferred ".length);
    return [completionMatches(context.stageNames, fragment).map((match) => `why deferred ${match}`), line];
  }

  return [completionMatches(context.commands, trimmedStart), line];
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let row = 0; row < rows; row += 1) {
    matrix[row]![0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    matrix[0]![col] = col;
  }
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + cost
      );
    }
  }
  return matrix[rows - 1]![cols - 1]!;
}

function nearestInspectorCommands(inspection: RunInspection, input: string): string[] {
  const context = buildInspectorCompletionContext(inspection);
  const normalized = input.toLowerCase();
  return uniqueSorted(context.commands)
    .map((command) => ({ command, score: levenshteinDistance(normalized, command.toLowerCase()) }))
    .sort((left, right) => left.score - right.score || left.command.localeCompare(right.command))
    .slice(0, 3)
    .filter((entry) => entry.score <= Math.max(3, Math.floor(normalized.length / 2)))
    .map((entry) => entry.command);
}

function helpText(): string {
  return [
    "Inspector commands:",
    "- 1 (summary)",
    "- 2 (stages)",
    "- 3 (specialists)",
    "- 4 (artifacts)",
    "- f (show final)",
    "- r (show routing)",
    "- g (gaps)",
    "- q (exit)",
    "- summary",
    "- stages",
    "- specialists",
    "- artifacts",
    "- gaps",
    "- show final",
    "- show routing",
    "- show research",
    "- show session",
    "- show verification",
    "- show validation",
    "- show pyramid",
    "- show coverage",
    "- show ci-validation",
    "- show tool-research",
    "- show review",
    "- show mitigations",
    "- show ship",
    "- show mutation",
    "- show github",
    "- show branch",
    "- show pr",
    "- show issues",
    "- show checks",
    "- show actions",
    "- show security",
    "- show release",
    "- show child <stage>",
    "- show delegate <track>",
    "- show sources <track>",
    "- show stage <name>",
    "- show specialist <name>",
    "- show artifact <relative-path>",
    "- why deferred <stage>",
    "- what remains",
    "- mitigate",
    "- mitigate <n>",
    "- mitigate <workflow>",
    "- mitigate <workflow> <n>",
    "- resume",
    "- fork",
    "- help",
    "- exit"
  ].join("\n");
}

export async function executeInspectorCommand(cwd: string, inspection: RunInspection, input: string): Promise<InspectorCommandResponse> {
  const trimmed = input.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed === "1" || trimmed === "summary") {
    return { output: renderInspectionSummary(cwd, inspection).trimEnd() };
  }
  if (trimmed === "2" || trimmed === "stages") {
    return { output: renderStages(inspection) };
  }
  if (trimmed === "3" || trimmed === "specialists") {
    return { output: renderSpecialists(inspection) };
  }
  if (trimmed === "4" || trimmed === "artifacts") {
    return { output: renderArtifacts(inspection) };
  }
  if (trimmed === "g" || trimmed === "gaps") {
    return { output: renderGapClusters(inspection) };
  }
  if (trimmed === "f" || trimmed === "show final") {
    return { output: inspection.finalBody || "(missing)" };
  }
  if (trimmed === "r" || trimmed === "show routing") {
    return { output: inspection.routingPlan ? `${JSON.stringify(inspection.routingPlan, null, 2)}\n` : "No routing plan recorded for this run." };
  }
  if (trimmed === "show research") {
    if (!inspection.discoverResearchPlan) {
      return { output: "No discover research plan was recorded for this run." };
    }
    return { output: [
      JSON.stringify(inspection.discoverResearchPlan, null, 2),
      "",
      renderDiscoverDelegates(inspection)
    ].join("\n") };
  }
  if (trimmed === "show session") {
    return { output: renderSession(inspection) };
  }
  if (trimmed === "show verification") {
    return { output: renderVerification(inspection) };
  }
  if (trimmed === "show validation") {
    return { output: renderValidation(inspection) };
  }
  if (trimmed === "show pyramid") {
    return { output: await renderValidationPyramid(inspection) };
  }
  if (trimmed === "show coverage") {
    return { output: await renderValidationCoverage(inspection) };
  }
  if (trimmed === "show ci-validation") {
    return { output: await renderValidationCi(inspection) };
  }
  if (trimmed === "show tool-research") {
    return { output: await renderValidationToolResearch(inspection) };
  }
  if (trimmed === "show review") {
    return { output: renderDeliverReview(inspection) };
  }
  if (trimmed === "show mitigations") {
    return { output: renderMitigations(inspection) };
  }
  if (trimmed === "show ship") {
    return { output: renderDeliverShip(inspection) };
  }
  if (trimmed === "show mutation") {
    return { output: renderGitHubMutation(inspection) };
  }
  if (trimmed === "show github") {
    return { output: renderGitHub(inspection) };
  }
  if (trimmed === "show branch") {
    return { output: renderGitHubBranch(inspection) };
  }
  if (trimmed === "show pr") {
    return { output: renderGitHubPullRequest(inspection) };
  }
  if (trimmed === "show issues") {
    return { output: renderGitHubIssues(inspection) };
  }
  if (trimmed === "show checks") {
    return { output: renderGitHubChecks(inspection) };
  }
  if (trimmed === "show actions") {
    return { output: renderGitHubActions(inspection) };
  }
  if (trimmed === "show security") {
    return { output: renderGitHubSecurity(inspection) };
  }
  if (trimmed === "show release") {
    return { output: renderGitHubRelease(inspection) };
  }
  if (trimmed === "what remains") {
    return { output: renderWhatRemains(inspection) };
  }
  if (trimmed === "mitigate" || trimmed.startsWith("mitigate ")) {
    return startMitigationWorkflow(cwd, inspection, trimmed);
  }
  if (trimmed === "resume") {
    return { output: inspection.run.sessionId
      ? `Resume this run with:\n\ncstack resume ${inspection.run.id}`
      : "This run has no recorded session id, so resume is unavailable." };
  }
  if (trimmed === "fork") {
    return { output: inspection.run.sessionId
      ? `Fork this run with:\n\ncstack fork ${inspection.run.id}`
      : "This run has no recorded session id, so fork is unavailable." };
  }
  if (trimmed === "help" || trimmed === "?") {
    return { output: helpText() };
  }
  if (trimmed === "q" || trimmed === "exit" || trimmed === "quit") {
    return { exit: true };
  }
  if (trimmed.startsWith("why deferred ")) {
    return { output: renderWhyDeferred(inspection, trimmed.slice("why deferred ".length).trim()) };
  }
  if (trimmed.startsWith("show stage ")) {
    const stageName = trimmed.slice("show stage ".length).trim();
    const stage = inspection.stageLineage?.stages.find((entry) => entry.name === stageName);
    if (!stage) {
      return { output: `No stage named \`${stageName}\` was recorded for this run.` };
    }
    const child = stage.childRunId ? inspection.childRuns.find((entry) => entry.run.id === stage.childRunId) : undefined;
    return {
      output:
        [
          JSON.stringify(stage, null, 2),
          child
            ? [
                "",
                "Linked child run:",
                `- run: ${child.run.id}`,
                `- workflow: ${child.run.workflow}`,
                `- status: ${child.run.status}`,
                child.run.error ? `- error: ${child.run.error}` : undefined,
                child.run.lastActivity ? `- last activity: ${child.run.lastActivity}` : undefined,
                `- final: ${path.relative(cwd, child.run.finalPath)}`,
                `- inspect child with: cstack inspect ${child.run.id}`
              ]
                .filter(Boolean)
                .join("\n")
            : undefined
        ]
          .filter(Boolean)
          .join("\n") + "\n"
    };
  }
  if (trimmed.startsWith("show child ")) {
    const stageName = trimmed.slice("show child ".length).trim();
    const child = inspection.childRuns.find((entry) => entry.stageName === stageName);
    if (!child) {
      return { output: `No linked child run was recorded for stage \`${stageName}\`.` };
    }
    return {
      output: [
        `Child run for stage \`${stageName}\`:`,
        `- run: ${child.run.id}`,
        `- workflow: ${child.run.workflow}`,
        `- status: ${child.run.status}`,
        child.run.lastActivity ? `- last activity: ${child.run.lastActivity}` : undefined,
        `- final: ${path.relative(cwd, child.run.finalPath)}`,
        `- inspect child with: cstack inspect ${child.run.id}`
      ]
        .filter(Boolean)
        .join("\n")
    };
  }
  if (trimmed.startsWith("show specialist ")) {
    const specialistName = trimmed.slice("show specialist ".length).trim();
    const specialist = inspection.stageLineage?.specialists.find((entry) => entry.name === specialistName);
    if (specialist) {
      return { output: `${JSON.stringify(specialist, null, 2)}\n` };
    }
    const planned = inspection.routingPlan?.specialists.find((entry) => entry.name === specialistName);
    return { output: planned ? `${JSON.stringify(planned, null, 2)}\n` : `No specialist named \`${specialistName}\` was recorded for this run.` };
  }
  if (trimmed.startsWith("show delegate ")) {
    const track = trimmed.slice("show delegate ".length).trim();
    const delegate = inspection.discoverDelegates.find((entry) => entry.track === track);
    return { output: delegate ? `${JSON.stringify(delegate, null, 2)}\n` : `No discover delegate named \`${track}\` was recorded for this run.` };
  }
  if (trimmed.startsWith("show sources ")) {
    const track = trimmed.slice("show sources ".length).trim();
    const delegate = inspection.discoverDelegates.find((entry) => entry.track === track);
    if (!delegate) {
      return { output: `No discover delegate named \`${track}\` was recorded for this run.` };
    }
    return { output: `${JSON.stringify(delegate.sources, null, 2)}\n` };
  }
  if (trimmed.startsWith("show artifact ")) {
    const relativePath = trimmed.slice("show artifact ".length).trim();
    return { output: await readRelativeArtifact(inspection, relativePath) };
  }

  const suggestions = nearestInspectorCommands(inspection, trimmed);
  return {
    output: [
      `Unknown inspector command: ${trimmed}`,
      suggestions.length > 0 ? "" : undefined,
      suggestions.length > 0 ? `Did you mean: ${suggestions.join(", ")}` : undefined,
      "",
      helpText()
    ]
      .filter((line) => line !== undefined)
      .join("\n")
  };
}

export async function handleInspectorCommand(cwd: string, inspection: RunInspection, input: string): Promise<string | null> {
  const response = await executeInspectorCommand(cwd, inspection, input);
  if (response.exit) {
    return "__EXIT__";
  }
  return response.output ?? null;
}

export async function runInteractiveInspector(
  cwd: string,
  inspection: RunInspection,
  io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = { input: process.stdin, output: process.stdout }
): Promise<void> {
  if (!("isTTY" in io.input) || !io.input.isTTY || !("isTTY" in io.output) || !io.output.isTTY) {
    throw new Error("Interactive inspection requires a TTY.");
  }

  let currentInspection = inspection;
  const rl = readline.createInterface({
    input: io.input,
    output: io.output,
    terminal: true,
    completer: (line) => completeInspectorInput(currentInspection, line)
  });

  try {
    io.output.write("Entering cstack run inspector. Type `help` for commands.\n");
    io.output.write(renderInspectionSummary(cwd, currentInspection));
    while (true) {
      let answer: string;
      try {
        answer = await rl.question("inspect> ");
      } catch {
        io.output.write("Leaving inspector.\n");
        return;
      }
      const commands = answer
        .split(/[\r\n]+/)
        .map((command) => command.trim())
        .filter(Boolean);

      if (commands.length === 0) {
        continue;
      }

      for (const command of commands) {
        const response = await executeInspectorCommand(cwd, currentInspection, command);
        if (!response.output && !response.exit && !response.switchToRunId) {
          continue;
        }
        if (response.exit) {
          io.output.write("Leaving inspector.\n");
          return;
        }
        if (response.output) {
          io.output.write(`${response.output}\n`);
        }
        if (response.switchToRunId) {
          currentInspection = await loadRunInspection(cwd, response.switchToRunId);
          io.output.write(`Switched inspector context to ${response.switchToRunId}.\n`);
          io.output.write(renderInspectionSummary(cwd, currentInspection));
        }
      }
    }
  } finally {
    rl.close();
  }
}

export async function maybeOfferInteractiveInspect(cwd: string, runId: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI || process.env.CSTACK_NO_POSTRUN_INSPECT === "1") {
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  try {
    const answer = (await rl.question("Inspect this run now? [Y/n] ")).trim().toLowerCase();
    if (answer === "n" || answer === "no") {
      return;
    }
  } finally {
    rl.close();
  }

  const inspection = await loadRunInspection(cwd, runId);
  await runInteractiveInspector(cwd, inspection);
}

function formatLedgerTimestamp(value: string): string {
  return value.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function pad(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  return `${value}${" ".repeat(width - value.length)}`;
}

export function renderRunLedger(entries: RunLedgerEntry[]): string {
  if (entries.length === 0) {
    return "No cstack runs found.\n";
  }

  const headers = ["run_id", "workflow", "status", "stage", "updated_at", "specialists", "summary"];
  const rows = entries.map((entry) => [
    entry.id,
    entry.workflow,
    entry.status,
    entry.currentStage ?? "-",
    formatLedgerTimestamp(entry.updatedAt),
    entry.activeSpecialists.join(",") || "-",
    entry.summary
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]!.length))
  );

  const lines = [
    headers.map((header, index) => pad(header, widths[index]!)).join("  "),
    ...rows.map((row) => row.map((value, index) => pad(value, widths[index]!)).join("  "))
  ];
  return `${lines.join("\n")}\n`;
}

export async function loadRunLedger(cwd: string, options: {
  activeOnly?: boolean;
  workflow?: RunLedgerEntry["workflow"];
  status?: RunLedgerEntry["status"];
  recent?: number;
}): Promise<RunLedgerEntry[]> {
  const query: {
    activeOnly?: boolean;
    workflow?: RunLedgerEntry["workflow"];
    status?: RunLedgerEntry["status"];
    recent?: number;
  } = {};

  if (typeof options.activeOnly === "boolean") {
    query.activeOnly = options.activeOnly;
  }
  if (options.workflow) {
    query.workflow = options.workflow;
  }
  if (options.status) {
    query.status = options.status;
  }
  if (typeof options.recent === "number") {
    query.recent = options.recent;
  }

  return listRunLedger(cwd, query);
}
