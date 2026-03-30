import path from "node:path";
import { loadConfig } from "../config.js";
import { prepareExecutionCheckout, writeExecutionContext } from "../execution-checkout.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { emitDeprecatedAllowAllWarning, resolveRunPolicy, resolveSourceExecutionReason } from "../runtime-config.js";
import { resolveLinkedBuildContext, runDeliverExecution } from "../deliver.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId } from "../run.js";
import type { DeliverTargetMode, RunRecord, WorkflowMode } from "../types.js";
import { getWorkflowMachineDefinition, WorkflowController } from "../workflow-machine.js";

export interface DeliverCliOptions {
  fromRunId?: string;
  requestedMode?: WorkflowMode;
  deliveryMode?: DeliverTargetMode;
  issueNumbers?: number[];
  initiativeId?: string;
  initiativeTitle?: string;
  allowDirty?: boolean;
  safe?: boolean;
  allowAll?: boolean;
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
    if (arg === "--initiative") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack deliver --initiative` requires an initiative id.");
      }
      options.initiativeId = value;
      index += 1;
      continue;
    }
    if (arg === "--initiative-title") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack deliver --initiative-title` requires a value.");
      }
      options.initiativeTitle = value;
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
    if (arg === "--safe") {
      options.safe = true;
      continue;
    }
    if (arg === "--allow-all") {
      options.allowAll = true;
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

  const { config, sources, provenance } = await loadConfig(cwd);
  if (parsed.options.allowAll) {
    emitDeprecatedAllowAllWarning("deliver");
  }
  const policy = resolveRunPolicy({ config, provenance, ...(parsed.options.safe !== undefined ? { safe: parsed.options.safe } : {}) });
  const effectiveConfig = policy.config;
  const allowDirty = parsed.options.allowDirty ?? effectiveConfig.workflows.deliver.allowDirty ?? false;
  const linkedContext = parsed.options.fromRunId ? await resolveLinkedBuildContext(cwd, parsed.options.fromRunId) : undefined;
  const resolvedInitiativeId = parsed.options.initiativeId ?? linkedContext?.run.inputs.initiativeId;
  const resolvedInitiativeTitle = parsed.options.initiativeTitle ?? linkedContext?.run.inputs.initiativeTitle;
  const resolvedIssueNumbers = parsed.options.issueNumbers?.length
    ? parsed.options.issueNumbers
    : linkedContext?.run.inputs.issueNumbers;
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
  const executionContextPath = path.join(runDir, "execution-context.json");
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
  const issueNumbers = resolvedIssueNumbers ?? [];
  const buildTimeoutSeconds = config.workflows.deliver.stageTimeoutSeconds?.build ?? config.workflows.build.timeoutSeconds;
  const validationTimeoutSeconds = config.workflows.deliver.stageTimeoutSeconds?.validation ?? config.workflows.deliver.timeoutSeconds;
  const reviewTimeoutSeconds = config.workflows.deliver.stageTimeoutSeconds?.review ?? config.workflows.review.timeoutSeconds;
  const shipTimeoutSeconds = config.workflows.deliver.stageTimeoutSeconds?.ship ?? config.workflows.ship.timeoutSeconds;

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
    summary: resolvedPrompt,
    inputs: {
      userPrompt: resolvedPrompt,
      entrypoint: "workflow",
      ...(linkedContext ? { linkedRunId: linkedContext.run.id } : {}),
      requestedMode,
      verificationCommands,
      deliveryMode,
      allowDirty,
      ...(policy.safe ? { safe: true } : {}),
      ...(resolvedInitiativeId ? { initiativeId: resolvedInitiativeId } : {}),
      ...(resolvedInitiativeTitle ? { initiativeTitle: resolvedInitiativeTitle } : {}),
      ...(buildTimeoutSeconds ? { timeoutSeconds: buildTimeoutSeconds } : {}),
      ...(issueNumbers.length > 0 ? { issueNumbers } : {})
    }
  };

  const controller = await WorkflowController.create({
    definition: getWorkflowMachineDefinition("deliver"),
    runDir,
    runRecord,
    intent: resolvedPrompt,
    stages: [
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
    ]
  });
  await hooks.onRunCreated?.(controller.currentRunRecord);

  try {
    const sourceExecutionReason = resolveSourceExecutionReason({
      workflow: "deliver",
      allowDirty,
      safe: policy.safe,
      requestedAllowDirty: parsed.options.allowDirty === true,
      configuredAllowDirtySource: provenance.workflowAllowDirty.deliver.source
    });
    const executionCheckout = await prepareExecutionCheckout({
      sourceCwd: cwd,
      runId,
      workflow: "deliver",
      allowDirtySourceExecution: allowDirty,
      ...(sourceExecutionReason ? { sourceExecutionReason } : {})
    });
    await writeExecutionContext(executionContextPath, executionCheckout.record);
    const execution = await runDeliverExecution({
      cwd: executionCheckout.executionCwd,
      gitBranch,
      runId,
      input: resolvedPrompt,
      config: effectiveConfig,
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
      controller,
      requestedMode,
      verificationCommands,
      deliveryMode,
      issueNumbers,
      ...(typeof buildTimeoutSeconds === "number" ? { buildTimeoutSeconds } : {}),
      ...(typeof validationTimeoutSeconds === "number" ? { validationTimeoutSeconds } : {}),
      ...(typeof reviewTimeoutSeconds === "number" ? { reviewTimeoutSeconds } : {}),
      ...(typeof shipTimeoutSeconds === "number" ? { shipTimeoutSeconds } : {}),
      ...(linkedContext ? { linkedContext } : {})
    });

    const buildSession = execution.buildExecution.sessionRecord;
    await controller.patchRun({
      gitBranch: execution.githubMutationRecord.branch.current || gitBranch,
      codexCommand: buildSession.codexCommand,
      ...(buildSession.sessionId ? { sessionId: buildSession.sessionId } : {}),
      inputs: {
        userPrompt: resolvedPrompt,
        observedMode: execution.buildExecution.observedMode,
        selectedSpecialists: execution.selectedSpecialists.map((specialist) => specialist.name),
        deliveryMode,
        ...(execution.githubDeliveryRecord.issueReferences.length > 0 ? { issueNumbers: execution.githubDeliveryRecord.issueReferences } : {})
      }
    });
    const finalRunRecord = controller.currentRunRecord;

    process.stdout.write(
      [
        `Run: ${runId}`,
        "Workflow: deliver",
        `Mode: requested=${requestedMode} observed=${execution.buildExecution.observedMode}`,
        `Status: ${finalRunRecord.status}`,
        buildSession.sessionId ? `Build session: ${buildSession.sessionId}` : "Build session: not observed",
        `Execution policy: ${policy.safe ? "dangerous default disabled via --safe" : "default dangerous execution"}`,
        `Execution checkout: ${executionCheckout.record.execution.kind} @ ${executionCheckout.record.execution.cwd}`,
        `Source snapshot: ${executionCheckout.record.source.branch} ${executionCheckout.record.source.commit}`,
        executionCheckout.record.source.dirtyFiles.length > 0 && !allowDirty
          ? "Local dirty changes were ignored; execution used committed HEAD."
          : undefined,
        `Validation: ${execution.validationExecution.validationPlan.status} (${execution.validationExecution.validationPlan.outcomeCategory})`,
        `Review verdict: ${execution.reviewVerdict.status}`,
        `Ship readiness: ${execution.shipRecord.readiness}`,
        `GitHub mutation: ${execution.githubMutationRecord.summary}`,
        `GitHub delivery: ${execution.githubDeliveryRecord.overall.status}`,
        "Artifacts:",
        `  ${path.relative(cwd, executionContextPath)}`,
        `  ${path.relative(cwd, finalPath)}`,
        `  ${path.relative(cwd, deliveryReportPath)}`,
        `  ${path.relative(cwd, path.join(runDir, "artifacts", "github-mutation.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "artifacts", "github-delivery.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "artifacts", "readiness-policy.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "artifacts", "deployment-evidence.json"))}`,
        `  ${path.relative(cwd, stageLineagePath)}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "build", "artifacts", "change-summary.md"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "validation", "validation-plan.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "validation", "artifacts", "test-pyramid.md"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "review", "artifacts", "verdict.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "ship", "artifacts", "ship-summary.md"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "ship", "artifacts", "readiness-policy.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "ship", "artifacts", "deployment-evidence.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "artifacts", "post-ship-summary.md"))}`,
        `  ${path.relative(cwd, path.join(runDir, "artifacts", "post-ship-evidence.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "artifacts", "follow-up-draft.md"))}`,
        `  ${path.relative(cwd, path.join(runDir, "artifacts", "follow-up-lineage.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "run.json"))}`
      ].join("\n") + "\n"
    );
    if (!hooks.suppressInteractiveInspect) {
      await maybeOfferInteractiveInspect(cwd, runId);
    }
    return runId;
  } catch (error) {
    await controller.send({
      type: "DELIVER_FINALIZED",
      buildSucceeded: false,
      validationStatus: "blocked",
      reviewStatus: "blocked",
      shipReadiness: "blocked",
      githubDeliveryStatus: "blocked",
      summary: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
