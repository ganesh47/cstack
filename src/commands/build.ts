import path from "node:path";
import { loadConfig } from "../config.js";
import { prepareExecutionCheckout, writeExecutionContext } from "../execution-checkout.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { emitDeprecatedAllowAllWarning, resolveRunPolicy, resolveSourceExecutionReason } from "../runtime-config.js";
import {
  resolveLinkedBuildContext,
  runBuildExecution
} from "../build.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId, writeRunRecord } from "../run.js";
import type { RunRecord, WorkflowMode } from "../types.js";

export interface BuildCliOptions {
  fromRunId?: string;
  requestedMode?: WorkflowMode;
  initiativeId?: string;
  initiativeTitle?: string;
  allowDirty?: boolean;
  safe?: boolean;
  allowAll?: boolean;
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

export function parseBuildArgs(args: string[]): { prompt: string; options: BuildCliOptions } {
  const options: BuildCliOptions = {};
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--from-run") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack build --from-run` requires a run id.");
      }
      options.fromRunId = value;
      index += 1;
      continue;
    }
    if (arg === "--exec") {
      options.requestedMode = "exec";
      continue;
    }
    if (arg === "--initiative") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack build --initiative` requires an initiative id.");
      }
      options.initiativeId = value;
      index += 1;
      continue;
    }
    if (arg === "--initiative-title") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack build --initiative-title` requires a value.");
      }
      options.initiativeTitle = value;
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
      throw new Error(`Unknown build option: ${arg}`);
    }
    promptParts.push(arg);
  }

  return {
    prompt: promptParts.join(" ").trim(),
    options
  };
}

function defaultBuildPrompt(fromRunId?: string): string {
  return fromRunId
    ? `Implement the approved change described by the linked upstream run ${fromRunId}.`
    : "";
}

export async function runBuild(cwd: string, args: string[] = []): Promise<string> {
  const parsed = parseBuildArgs(args);
  const stdinPrompt = parsed.prompt || parsed.options.fromRunId ? "" : await readPromptFromStdin();
  const resolvedPrompt = (parsed.prompt || stdinPrompt || defaultBuildPrompt(parsed.options.fromRunId)).trim();
  if (!resolvedPrompt) {
    throw new Error("`cstack build` requires a prompt or `--from-run <run-id>`.");
  }

  const { config, sources, provenance } = await loadConfig(cwd);
  if (parsed.options.allowAll) {
    emitDeprecatedAllowAllWarning("build");
  }
  const policy = resolveRunPolicy({ config, provenance, ...(parsed.options.safe !== undefined ? { safe: parsed.options.safe } : {}) });
  const effectiveConfig = policy.config;
  const allowDirty = parsed.options.allowDirty ?? effectiveConfig.workflows.build.allowDirty ?? false;
  const linkedContext = parsed.options.fromRunId ? await resolveLinkedBuildContext(cwd, parsed.options.fromRunId) : undefined;
  const resolvedInitiativeId = parsed.options.initiativeId ?? linkedContext?.run.inputs.initiativeId;
  const resolvedInitiativeTitle = parsed.options.initiativeTitle ?? linkedContext?.run.inputs.initiativeTitle;
  const runId = makeRunId("build", resolvedPrompt);
  const runDir = await ensureRunDir(cwd, runId);
  const promptPath = path.join(runDir, "prompt.md");
  const contextPath = path.join(runDir, "context.md");
  const finalPath = path.join(runDir, "final.md");
  const eventsPath = path.join(runDir, "events.jsonl");
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const sessionPath = path.join(runDir, "session.json");
  const executionContextPath = path.join(runDir, "execution-context.json");
  const transcriptPath = path.join(runDir, "artifacts", "build-transcript.log");
  const changeSummaryPath = path.join(runDir, "artifacts", "change-summary.md");
  const verificationPath = path.join(runDir, "artifacts", "verification.json");
  const recoveryAttemptsPath = path.join(runDir, "artifacts", "recovery-attempts.json");
  const recoverySummaryPath = path.join(runDir, "artifacts", "recovery-summary.md");
  const failureDiagnosisPath = path.join(runDir, "artifacts", "failure-diagnosis.json");
  const [gitBranch, codexVersion] = await Promise.all([
    detectGitBranch(cwd),
    detectCodexVersion(cwd, config.codex.command)
  ]);
  const maxCodexAttempts = config.workflows.build.maxCodexAttempts ?? 3;

  const verificationCommands = [
    ...(config.workflows.build.verificationCommands ?? []),
    ...((config.workflows.build.verificationCommands?.length ?? 0) > 0 ? [] : (config.verification?.defaultCommands ?? []))
  ];
  const requestedMode = parsed.options.requestedMode ?? config.workflows.build.mode ?? "interactive";
  const timeoutSeconds = config.workflows.build.timeoutSeconds;

  const createdAt = new Date().toISOString();
  const runRecord: RunRecord = {
    id: runId,
    workflow: "build",
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
      ...(resolvedInitiativeId ? { initiativeId: resolvedInitiativeId } : {}),
      ...(resolvedInitiativeTitle ? { initiativeTitle: resolvedInitiativeTitle } : {}),
      requestedMode,
      verificationCommands,
      allowDirty,
      ...(policy.safe ? { safe: true } : {}),
      ...(timeoutSeconds ? { timeoutSeconds } : {}),
      ...(typeof maxCodexAttempts === "number" ? { maxCodexAttempts } : {})
    }
  };

  await writeRunRecord(runDir, runRecord);

  try {
    const sourceExecutionReason = resolveSourceExecutionReason({
      workflow: "build",
      allowDirty,
      safe: policy.safe,
      requestedAllowDirty: parsed.options.allowDirty === true,
      configuredAllowDirtySource: provenance.workflowAllowDirty.build.source
    });
    const executionCheckout = await prepareExecutionCheckout({
      sourceCwd: cwd,
      runId,
      workflow: "build",
      allowDirtySourceExecution: allowDirty,
      ...(sourceExecutionReason ? { sourceExecutionReason } : {})
    });
    await writeExecutionContext(executionContextPath, executionCheckout.record);
    const execution = await runBuildExecution({
      cwd,
      executionCwd: executionCheckout.executionCwd,
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
        sessionPath,
        transcriptPath,
        changeSummaryPath,
        verificationPath,
        recoveryAttemptsPath,
        recoverySummaryPath,
        failureDiagnosisPath
      },
      requestedMode,
      verificationCommands,
      ...(typeof timeoutSeconds === "number" ? { timeoutSeconds } : {}),
      ...(linkedContext ? { linkedContext } : {})
    });

    runRecord.status = execution.result.code === 0 ? "completed" : "failed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.codexCommand = execution.result.command;
    if (execution.result.sessionId) {
      runRecord.sessionId = execution.result.sessionId;
    }
    if (execution.result.lastActivity) {
      runRecord.lastActivity = execution.result.lastActivity;
    }
    runRecord.inputs.observedMode = execution.observedMode;
    if (execution.result.code !== 0) {
      runRecord.lastActivity = execution.failureDiagnosis?.summary ?? runRecord.lastActivity;
      runRecord.error =
        execution.failureDiagnosis?.summary ??
        (execution.result.timedOut
          ? `build timed out after ${execution.result.timeoutSeconds}s`
          : `build exited with code ${execution.result.code}${execution.result.signal ? ` (${execution.result.signal})` : ""}`);
    }
    await writeRunRecord(runDir, runRecord);

    if (execution.result.code !== 0) {
      throw new Error(runRecord.error);
    }

    process.stdout.write(
      [
        `Run: ${runId}`,
        "Workflow: build",
        `Mode: requested=${requestedMode} observed=${execution.observedMode}`,
        `Status: ${runRecord.status}`,
        execution.result.sessionId ? `Session: ${execution.result.sessionId}` : "Session: not observed",
        `Execution policy: ${policy.safe ? "safe overrides applied via --safe" : "default execution policy"}`,
        `Execution checkout: ${executionCheckout.record.execution.kind} @ ${executionCheckout.record.execution.cwd}`,
        `Source snapshot: ${executionCheckout.record.source.branch} ${executionCheckout.record.source.commit}`,
        executionCheckout.record.source.dirtyFiles.length > 0 && !allowDirty
          ? "Local dirty changes were ignored; execution used committed HEAD."
          : undefined,
        "Artifacts:",
        `  ${path.relative(cwd, executionContextPath)}`,
        `  ${path.relative(cwd, finalPath)}`,
        `  ${path.relative(cwd, changeSummaryPath)}`,
        `  ${path.relative(cwd, verificationPath)}`,
        `  ${path.relative(cwd, recoveryAttemptsPath)}`,
        `  ${path.relative(cwd, recoverySummaryPath)}`,
        `  ${path.relative(cwd, sessionPath)}`,
        linkedContext ? `Linked run: ${linkedContext.run.id}` : undefined,
        `  ${path.relative(cwd, path.join(runDir, "run.json"))}`
      ]
        .filter(Boolean)
        .join("\n") + "\n"
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
