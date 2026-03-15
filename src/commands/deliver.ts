import path from "node:path";
import { loadConfig } from "../config.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { resolveLinkedBuildContext, runDeliverExecution } from "../deliver.js";
import { ensureCleanWorktreeForWorkflow } from "../build.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId, writeRunRecord } from "../run.js";
import type { DeliverTargetMode, RunRecord, WorkflowMode } from "../types.js";

export interface DeliverCliOptions {
  fromRunId?: string;
  requestedMode?: WorkflowMode;
  deliveryMode?: DeliverTargetMode;
  issueNumbers?: number[];
  allowDirty?: boolean;
}

export interface DeliverRunHooks {
  onRunCreated?: (run: RunRecord) => Promise<void> | void;
  suppressInteractiveInspect?: boolean;
}

async function readPromptFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  return chunks.join("").trim();
}

export function parseDeliverArgs(args: string[]): { prompt: string; options: DeliverCliOptions } {
  const options: DeliverCliOptions = {};
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--from-run") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack deliver --from-run` requires a run id.");
      }
      options.fromRunId = value;
      index += 1;
      continue;
    }
    if (arg === "--exec") {
      options.requestedMode = "exec";
      continue;
    }
    if (arg === "--release") {
      options.deliveryMode = "release";
      continue;
    }
    if (arg === "--issue") {
      const value = args[index + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error("`cstack deliver --issue` requires a numeric issue id.");
      }
      options.issueNumbers = [...(options.issueNumbers ?? []), Number.parseInt(value, 10)];
      index += 1;
      continue;
    }
    if (arg === "--allow-dirty") {
      options.allowDirty = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown deliver option: ${arg}`);
    }
    promptParts.push(arg);
  }

  return {
    prompt: promptParts.join(" ").trim(),
    options
  };
}

function defaultDeliverPrompt(fromRunId?: string): string {
  return fromRunId ? `Deliver the approved change described by upstream run ${fromRunId}.` : "";
}

export async function runDeliver(cwd: string, args: string[] = [], hooks: DeliverRunHooks = {}): Promise<string> {
  const parsed = parseDeliverArgs(args);
  const stdinPrompt = parsed.prompt || parsed.options.fromRunId ? "" : await readPromptFromStdin();
  const resolvedPrompt = (parsed.prompt || stdinPrompt || defaultDeliverPrompt(parsed.options.fromRunId)).trim();
  if (!resolvedPrompt) {
    throw new Error("`cstack deliver` requires a prompt or `--from-run <run-id>`.");
  }

  const { config, sources } = await loadConfig(cwd);
  const allowDirty = parsed.options.allowDirty ?? config.workflows.deliver.allowDirty ?? false;
  await ensureCleanWorktreeForWorkflow(cwd, "deliver", allowDirty);
  const linkedContext = parsed.options.fromRunId ? await resolveLinkedBuildContext(cwd, parsed.options.fromRunId) : undefined;
  const runId = makeRunId("deliver", resolvedPrompt);
  const runDir = await ensureRunDir(cwd, runId);
  const promptPath = path.join(runDir, "prompt.md");
  const contextPath = path.join(runDir, "context.md");
  const finalPath = path.join(runDir, "final.md");
  const deliveryReportPath = path.join(runDir, "artifacts", "delivery-report.md");
  const eventsPath = path.join(runDir, "events.jsonl");
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const stageLineagePath = path.join(runDir, "stage-lineage.json");
  const [gitBranch, codexVersion] = await Promise.all([
    detectGitBranch(cwd),
    detectCodexVersion(cwd, config.codex.command)
  ]);

  const verificationCommands = [
    ...(config.workflows.deliver.verificationCommands ?? []),
    ...((config.workflows.deliver.verificationCommands?.length ?? 0) > 0 ? [] : (config.verification?.defaultCommands ?? []))
  ];
  const requestedMode = parsed.options.requestedMode ?? config.workflows.deliver.mode ?? config.workflows.build.mode ?? "interactive";
  const deliveryMode = parsed.options.deliveryMode ?? config.workflows.deliver.github?.mode ?? "merge-ready";
  const issueNumbers = parsed.options.issueNumbers ?? [];

  const createdAt = new Date().toISOString();
  const runRecord: RunRecord = {
    id: runId,
    workflow: "deliver",
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
    currentStage: "build",
    summary: resolvedPrompt,
    inputs: {
      userPrompt: resolvedPrompt,
      entrypoint: "workflow",
      ...(linkedContext ? { linkedRunId: linkedContext.run.id } : {}),
      requestedMode,
      verificationCommands,
      deliveryMode,
      allowDirty,
      ...(issueNumbers.length > 0 ? { issueNumbers } : {})
    }
  };

  await writeRunRecord(runDir, runRecord);
  await hooks.onRunCreated?.(runRecord);

  try {
    const execution = await runDeliverExecution({
      cwd,
      gitBranch,
      runId,
      input: resolvedPrompt,
      config,
      paths: {
        runDir,
        promptPath,
        contextPath,
        finalPath,
        deliveryReportPath,
        eventsPath,
        stdoutPath,
        stderrPath,
        stageLineagePath
      },
      requestedMode,
      verificationCommands,
      deliveryMode,
      issueNumbers,
      ...(linkedContext ? { linkedContext } : {})
    });

    const buildSession = execution.buildExecution.sessionRecord;
    runRecord.status =
      execution.buildExecution.result.code === 0 &&
      execution.validationExecution.validationPlan.status !== "blocked" &&
      execution.reviewVerdict.status === "ready" &&
      execution.shipRecord.readiness === "ready" &&
      execution.githubDeliveryRecord.overall.status === "ready"
        ? "completed"
        : "failed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.gitBranch = execution.githubMutationRecord.branch.current || gitBranch;
    runRecord.codexCommand = buildSession.codexCommand;
    if (buildSession.sessionId) {
      runRecord.sessionId = buildSession.sessionId;
    }
    runRecord.lastActivity = `Validation: ${execution.validationExecution.validationPlan.status}; Ship readiness: ${execution.shipRecord.readiness}; GitHub delivery: ${execution.githubDeliveryRecord.overall.status}`;
    runRecord.inputs.observedMode = execution.buildExecution.observedMode;
    runRecord.inputs.selectedSpecialists = execution.selectedSpecialists.map((specialist) => specialist.name);
    runRecord.inputs.deliveryMode = deliveryMode;
    if (execution.githubDeliveryRecord.issueReferences.length > 0) {
      runRecord.inputs.issueNumbers = execution.githubDeliveryRecord.issueReferences;
    }
    if (runRecord.status !== "completed") {
      runRecord.error = [
        execution.buildExecution.result.code !== 0 ? `build exited with code ${execution.buildExecution.result.code}` : null,
        execution.validationExecution.validationPlan.status === "blocked"
          ? `validation status: ${execution.validationExecution.validationPlan.status}`
          : null,
        execution.reviewVerdict.status !== "ready" ? `review status: ${execution.reviewVerdict.status}` : null,
        execution.shipRecord.readiness === "blocked" ? "ship stage blocked release readiness" : null,
        execution.githubDeliveryRecord.overall.status === "blocked"
          ? `github delivery blocked: ${execution.githubDeliveryRecord.overall.blockers.join("; ")}`
          : null
      ]
        .filter(Boolean)
        .join("; ");
    }
    await writeRunRecord(runDir, runRecord);

    process.stdout.write(
      [
        `Run: ${runId}`,
        "Workflow: deliver",
        `Mode: requested=${requestedMode} observed=${execution.buildExecution.observedMode}`,
        `Status: ${runRecord.status}`,
        buildSession.sessionId ? `Build session: ${buildSession.sessionId}` : "Build session: not observed",
        `Validation: ${execution.validationExecution.validationPlan.status}`,
        `Review verdict: ${execution.reviewVerdict.status}`,
        `Ship readiness: ${execution.shipRecord.readiness}`,
        `GitHub mutation: ${execution.githubMutationRecord.summary}`,
        `GitHub delivery: ${execution.githubDeliveryRecord.overall.status}`,
        "Artifacts:",
        `  ${path.relative(cwd, finalPath)}`,
        `  ${path.relative(cwd, deliveryReportPath)}`,
        `  ${path.relative(cwd, path.join(runDir, "artifacts", "github-mutation.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "artifacts", "github-delivery.json"))}`,
        `  ${path.relative(cwd, stageLineagePath)}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "build", "artifacts", "change-summary.md"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "validation", "validation-plan.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "validation", "artifacts", "test-pyramid.md"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "review", "artifacts", "verdict.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "ship", "artifacts", "ship-summary.md"))}`,
        `  ${path.relative(cwd, path.join(runDir, "run.json"))}`
      ].join("\n") + "\n"
    );
    if (!hooks.suppressInteractiveInspect) {
      await maybeOfferInteractiveInspect(cwd, runId);
    }
    return runId;
  } catch (error) {
    runRecord.status = "failed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.error = error instanceof Error ? error.message : String(error);
    await writeRunRecord(runDir, runRecord);
    throw error;
  }
}
