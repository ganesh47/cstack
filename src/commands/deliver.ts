import path from "node:path";
import { loadConfig } from "../config.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { resolveLinkedBuildContext, runDeliverExecution } from "../deliver.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId, writeRunRecord } from "../run.js";
import type { RunRecord, WorkflowMode } from "../types.js";

export interface DeliverCliOptions {
  fromRunId?: string;
  requestedMode?: WorkflowMode;
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

export async function runDeliver(cwd: string, args: string[] = []): Promise<void> {
  const parsed = parseDeliverArgs(args);
  const stdinPrompt = parsed.prompt || parsed.options.fromRunId ? "" : await readPromptFromStdin();
  const resolvedPrompt = (parsed.prompt || stdinPrompt || defaultDeliverPrompt(parsed.options.fromRunId)).trim();
  if (!resolvedPrompt) {
    throw new Error("`cstack deliver` requires a prompt or `--from-run <run-id>`.");
  }

  const { config, sources } = await loadConfig(cwd);
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
      verificationCommands
    }
  };

  await writeRunRecord(runDir, runRecord);

  try {
    const execution = await runDeliverExecution({
      cwd,
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
      ...(linkedContext ? { linkedContext } : {})
    });

    const buildSession = execution.buildExecution.sessionRecord;
    runRecord.status =
      execution.buildExecution.result.code === 0 &&
      execution.reviewVerdict.status === "ready" &&
      execution.shipRecord.readiness === "ready"
        ? "completed"
        : "failed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.codexCommand = buildSession.codexCommand;
    if (buildSession.sessionId) {
      runRecord.sessionId = buildSession.sessionId;
    }
    runRecord.lastActivity = `Ship readiness: ${execution.shipRecord.readiness}`;
    runRecord.inputs.observedMode = execution.buildExecution.observedMode;
    runRecord.inputs.selectedSpecialists = execution.selectedSpecialists.map((specialist) => specialist.name);
    if (runRecord.status !== "completed") {
      runRecord.error = [
        execution.buildExecution.result.code !== 0 ? `build exited with code ${execution.buildExecution.result.code}` : null,
        execution.reviewVerdict.status !== "ready" ? `review status: ${execution.reviewVerdict.status}` : null,
        execution.shipRecord.readiness === "blocked" ? "ship stage blocked release readiness" : null
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
        `Review verdict: ${execution.reviewVerdict.status}`,
        `Ship readiness: ${execution.shipRecord.readiness}`,
        "Artifacts:",
        `  ${path.relative(cwd, finalPath)}`,
        `  ${path.relative(cwd, deliveryReportPath)}`,
        `  ${path.relative(cwd, stageLineagePath)}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "build", "artifacts", "change-summary.md"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "review", "artifacts", "verdict.json"))}`,
        `  ${path.relative(cwd, path.join(runDir, "stages", "ship", "artifacts", "ship-summary.md"))}`,
        `  ${path.relative(cwd, path.join(runDir, "run.json"))}`
      ].join("\n") + "\n"
    );
    await maybeOfferInteractiveInspect(cwd, runId);
  } catch (error) {
    runRecord.status = "failed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.error = error instanceof Error ? error.message : String(error);
    await writeRunRecord(runDir, runRecord);
    throw error;
  }
}
