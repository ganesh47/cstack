import path from "node:path";
import { loadConfig } from "../config.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { emitDeprecatedAllowAllWarning, resolveRunPolicy } from "../runtime-config.js";
import { detectGitBranch, detectCodexVersion, ensureRunDir, makeRunId } from "../run.js";
import { ensureCleanWorktreeForWorkflow } from "../build.js";
import { resolveLinkedShipContext, runShipExecution } from "../ship.js";
import type { DeliverTargetMode, RunRecord } from "../types.js";
import { getWorkflowMachineDefinition, WorkflowController } from "../workflow-machine.js";

export interface ShipCliOptions {
  fromRunId?: string;
  deliveryMode?: DeliverTargetMode;
  issueNumbers?: number[];
  initiativeId?: string;
  initiativeTitle?: string;
  allowDirty?: boolean;
  safe?: boolean;
  allowAll?: boolean;
}

export interface ShipRunHooks {
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

export function parseShipArgs(args: string[]): { prompt: string; options: ShipCliOptions } {
  const options: ShipCliOptions = {};
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--from-run") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack ship --from-run` requires a run id.");
      }
      options.fromRunId = value;
      index += 1;
      continue;
    }
    if (arg === "--initiative") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack ship --initiative` requires an initiative id.");
      }
      options.initiativeId = value;
      index += 1;
      continue;
    }
    if (arg === "--initiative-title") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack ship --initiative-title` requires a value.");
      }
      options.initiativeTitle = value;
      index += 1;
      continue;
    }
    if (arg === "--release") {
      options.deliveryMode = "release";
      continue;
    }
    if (arg === "--issue") {
      const value = args[index + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error("`cstack ship --issue` requires a numeric issue id.");
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
      throw new Error(`Unknown ship option: ${arg}`);
    }
    promptParts.push(arg);
  }

  return {
    prompt: promptParts.join(" ").trim(),
    options
  };
}

function defaultShipPrompt(fromRunId?: string): string {
  return fromRunId ? `Ship the linked upstream run ${fromRunId} and evaluate GitHub readiness.` : "";
}

export async function runShip(cwd: string, args: string[] = [], hooks: ShipRunHooks = {}): Promise<string> {
  const parsed = parseShipArgs(args);
  const stdinPrompt = parsed.prompt || parsed.options.fromRunId ? "" : await readPromptFromStdin();
  const resolvedPrompt = (parsed.prompt || stdinPrompt || defaultShipPrompt(parsed.options.fromRunId)).trim();
  if (!resolvedPrompt) {
    throw new Error("`cstack ship` requires a prompt or `--from-run <run-id>`.");
  }

  const { config, sources, provenance } = await loadConfig(cwd);
  if (parsed.options.allowAll) {
    emitDeprecatedAllowAllWarning("ship");
  }
  const policy = resolveRunPolicy({ config, provenance, ...(parsed.options.safe !== undefined ? { safe: parsed.options.safe } : {}) });
  const effectiveConfig = policy.config;
  const allowDirty = parsed.options.allowDirty ?? effectiveConfig.workflows.ship.allowDirty ?? effectiveConfig.workflows.deliver.allowDirty ?? false;
  await ensureCleanWorktreeForWorkflow(cwd, "ship", allowDirty);

  const linkedContext = parsed.options.fromRunId ? await resolveLinkedShipContext(cwd, parsed.options.fromRunId) : undefined;
  const resolvedInitiativeId = parsed.options.initiativeId ?? linkedContext?.initiativeId;
  const resolvedInitiativeTitle = parsed.options.initiativeTitle ?? linkedContext?.initiativeTitle;
  const runId = makeRunId("ship", resolvedPrompt);
  const runDir = await ensureRunDir(cwd, runId);
  const promptPath = path.join(runDir, "prompt.md");
  const contextPath = path.join(runDir, "context.md");
  const finalPath = path.join(runDir, "final.md");
  const eventsPath = path.join(runDir, "events.jsonl");
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const shipSummaryPath = path.join(runDir, "artifacts", "ship-summary.md");
  const checklistPath = path.join(runDir, "artifacts", "release-checklist.md");
  const unresolvedPath = path.join(runDir, "artifacts", "unresolved.md");
  const shipRecordPath = path.join(runDir, "artifacts", "ship-record.json");
  const readinessPolicyPath = path.join(runDir, "artifacts", "readiness-policy.json");
  const deploymentEvidencePath = path.join(runDir, "artifacts", "deployment-evidence.json");
  const postShipSummaryPath = path.join(runDir, "artifacts", "post-ship-summary.md");
  const postShipEvidencePath = path.join(runDir, "artifacts", "post-ship-evidence.json");
  const followUpDraftPath = path.join(runDir, "artifacts", "follow-up-draft.md");
  const followUpLineagePath = path.join(runDir, "artifacts", "follow-up-lineage.json");
  const githubMutationPath = path.join(runDir, "artifacts", "github-mutation.json");
  const githubDeliveryPath = path.join(runDir, "artifacts", "github-delivery.json");
  const stageLineagePath = path.join(runDir, "stage-lineage.json");
  const pullRequestBodyPath = path.join(runDir, "artifacts", "pull-request-body.md");
  const [gitBranch, codexVersion] = await Promise.all([
    detectGitBranch(cwd),
    detectCodexVersion(cwd, config.codex.command)
  ]);

  const createdAt = new Date().toISOString();
  const deliveryMode = parsed.options.deliveryMode ?? config.workflows.ship.github?.mode ?? config.workflows.deliver.github?.mode ?? "merge-ready";
  const issueNumbers = parsed.options.issueNumbers ?? [];
  const runRecord: RunRecord = {
    id: runId,
    workflow: "ship",
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
      ...(linkedContext ? { linkedRunId: linkedContext.runId } : {}),
      ...(resolvedInitiativeId ? { initiativeId: resolvedInitiativeId } : {}),
      ...(resolvedInitiativeTitle ? { initiativeTitle: resolvedInitiativeTitle } : {}),
      deliveryMode,
      issueNumbers,
      allowDirty,
      ...(policy.safe ? { safe: true } : {})
    }
  };
  const controller = await WorkflowController.create({
    definition: getWorkflowMachineDefinition("ship"),
    runDir,
    runRecord,
    intent: resolvedPrompt,
    stages: [
      {
        name: "ship",
        rationale: "Prepare handoff or release artifacts and evaluate GitHub delivery policy.",
        status: "planned",
        executed: false
      }
    ]
  });
  await hooks.onRunCreated?.(controller.currentRunRecord);

  try {
    const execution = await runShipExecution({
      cwd,
      gitBranch,
      runId,
      input: resolvedPrompt,
      config: effectiveConfig,
      paths: {
        runDir,
        promptPath,
        contextPath,
        finalPath,
        eventsPath,
        stdoutPath,
        stderrPath,
        shipSummaryPath,
        checklistPath,
        unresolvedPath,
        shipRecordPath,
        readinessPolicyPath,
        deploymentEvidencePath,
        postShipSummaryPath,
        postShipEvidencePath,
        followUpDraftPath,
        followUpLineagePath,
        githubMutationPath,
        githubDeliveryPath,
        stageLineagePath,
        pullRequestBodyPath
      },
      controller,
      deliveryMode,
      issueNumbers,
      ...(linkedContext ? { linkedContext } : {})
    });

    await controller.patchRun({
      gitBranch: execution.githubMutationRecord.branch.current || gitBranch
    });
    const finalRunRecord = controller.currentRunRecord;

    process.stdout.write(
      [
        `Run: ${runId}`,
        "Workflow: ship",
        `Status: ${finalRunRecord.status}`,
        `Execution policy: ${policy.safe ? "dangerous default disabled via --safe" : "default dangerous execution"}`,
        `Ship readiness: ${execution.shipRecord.readiness}`,
        `GitHub mutation: ${execution.githubMutationRecord.summary}`,
        `GitHub delivery: ${execution.githubDeliveryRecord.overall.status}`,
        "Artifacts:",
        `  ${path.relative(cwd, finalPath)}`,
        `  ${path.relative(cwd, shipSummaryPath)}`,
        `  ${path.relative(cwd, checklistPath)}`,
        `  ${path.relative(cwd, unresolvedPath)}`,
        `  ${path.relative(cwd, postShipSummaryPath)}`,
        `  ${path.relative(cwd, postShipEvidencePath)}`,
        `  ${path.relative(cwd, followUpDraftPath)}`,
        `  ${path.relative(cwd, followUpLineagePath)}`,
        `  ${path.relative(cwd, readinessPolicyPath)}`,
        `  ${path.relative(cwd, deploymentEvidencePath)}`,
        `  ${path.relative(cwd, githubMutationPath)}`,
        `  ${path.relative(cwd, githubDeliveryPath)}`,
        `  ${path.relative(cwd, stageLineagePath)}`,
        `  ${path.relative(cwd, path.join(runDir, "run.json"))}`
      ].join("\n") + "\n"
    );
    if (!hooks.suppressInteractiveInspect) {
      await maybeOfferInteractiveInspect(cwd, runId);
    }
    return runId;
  } catch (error) {
    await controller.send({
      type: "SHIP_FINALIZED",
      readiness: "blocked",
      githubDeliveryStatus: "blocked",
      hasMutationBlockers: true,
      summary: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
