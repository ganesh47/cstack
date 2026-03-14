import path from "node:path";
import { loadConfig } from "../config.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { detectGitBranch, detectCodexVersion, ensureRunDir, makeRunId, writeRunRecord } from "../run.js";
import { ensureCleanWorktreeForWorkflow } from "../build.js";
import { resolveLinkedShipContext, runShipExecution } from "../ship.js";
import type { DeliverTargetMode, RunRecord } from "../types.js";

export interface ShipCliOptions {
  fromRunId?: string;
  deliveryMode?: DeliverTargetMode;
  issueNumbers?: number[];
  allowDirty?: boolean;
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

export async function runShip(cwd: string, args: string[] = []): Promise<string> {
  const parsed = parseShipArgs(args);
  const stdinPrompt = parsed.prompt || parsed.options.fromRunId ? "" : await readPromptFromStdin();
  const resolvedPrompt = (parsed.prompt || stdinPrompt || defaultShipPrompt(parsed.options.fromRunId)).trim();
  if (!resolvedPrompt) {
    throw new Error("`cstack ship` requires a prompt or `--from-run <run-id>`.");
  }

  const { config, sources } = await loadConfig(cwd);
  const allowDirty = parsed.options.allowDirty ?? config.workflows.ship.allowDirty ?? config.workflows.deliver.allowDirty ?? false;
  await ensureCleanWorktreeForWorkflow(cwd, "ship", allowDirty);

  const linkedContext = parsed.options.fromRunId ? await resolveLinkedShipContext(cwd, parsed.options.fromRunId) : undefined;
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
    currentStage: "ship",
    summary: resolvedPrompt,
    inputs: {
      userPrompt: resolvedPrompt,
      entrypoint: "workflow",
      ...(linkedContext ? { linkedRunId: linkedContext.runId } : {}),
      deliveryMode,
      issueNumbers,
      allowDirty
    }
  };
  await writeRunRecord(runDir, runRecord);

  try {
    const execution = await runShipExecution({
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
        eventsPath,
        stdoutPath,
        stderrPath,
        shipSummaryPath,
        checklistPath,
        unresolvedPath,
        shipRecordPath,
        githubMutationPath,
        githubDeliveryPath,
        stageLineagePath,
        pullRequestBodyPath
      },
      deliveryMode,
      issueNumbers,
      ...(linkedContext ? { linkedContext } : {})
    });

    runRecord.status =
      execution.shipRecord.readiness === "ready" &&
      execution.githubMutationRecord.blockers.length === 0 &&
      execution.githubDeliveryRecord.overall.status === "ready"
        ? "completed"
        : "failed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.gitBranch = execution.githubMutationRecord.branch.current || gitBranch;
    runRecord.lastActivity = execution.shipRecord.summary;
    if (runRecord.status !== "completed") {
      runRecord.error = execution.githubDeliveryRecord.overall.blockers.join("; ") || execution.shipRecord.summary;
    }
    await writeRunRecord(runDir, runRecord);

    process.stdout.write(
      [
        `Run: ${runId}`,
        "Workflow: ship",
        `Status: ${runRecord.status}`,
        `Ship readiness: ${execution.shipRecord.readiness}`,
        `GitHub mutation: ${execution.githubMutationRecord.summary}`,
        `GitHub delivery: ${execution.githubDeliveryRecord.overall.status}`,
        "Artifacts:",
        `  ${path.relative(cwd, finalPath)}`,
        `  ${path.relative(cwd, shipSummaryPath)}`,
        `  ${path.relative(cwd, checklistPath)}`,
        `  ${path.relative(cwd, unresolvedPath)}`,
        `  ${path.relative(cwd, githubMutationPath)}`,
        `  ${path.relative(cwd, githubDeliveryPath)}`,
        `  ${path.relative(cwd, stageLineagePath)}`,
        `  ${path.relative(cwd, path.join(runDir, "run.json"))}`
      ].join("\n") + "\n"
    );
    await maybeOfferInteractiveInspect(cwd, runId);
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
