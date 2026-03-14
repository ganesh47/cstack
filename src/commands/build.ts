import path from "node:path";
import { loadConfig } from "../config.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import {
  ensureCleanWorktreeForWorkflow,
  resolveLinkedBuildContext,
  runBuildExecution
} from "../build.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId, writeRunRecord } from "../run.js";
import type { RunRecord, WorkflowMode } from "../types.js";

export interface BuildCliOptions {
  fromRunId?: string;
  requestedMode?: WorkflowMode;
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
    if (arg === "--allow-dirty") {
      options.allowDirty = true;
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

  const { config, sources } = await loadConfig(cwd);
  const allowDirty = parsed.options.allowDirty ?? config.workflows.build.allowDirty ?? false;
  await ensureCleanWorktreeForWorkflow(cwd, "build", allowDirty);
  const linkedContext = parsed.options.fromRunId ? await resolveLinkedBuildContext(cwd, parsed.options.fromRunId) : undefined;
  const runId = makeRunId("build", resolvedPrompt);
  const runDir = await ensureRunDir(cwd, runId);
  const promptPath = path.join(runDir, "prompt.md");
  const contextPath = path.join(runDir, "context.md");
  const finalPath = path.join(runDir, "final.md");
  const eventsPath = path.join(runDir, "events.jsonl");
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const sessionPath = path.join(runDir, "session.json");
  const transcriptPath = path.join(runDir, "artifacts", "build-transcript.log");
  const changeSummaryPath = path.join(runDir, "artifacts", "change-summary.md");
  const verificationPath = path.join(runDir, "artifacts", "verification.json");
  const [gitBranch, codexVersion] = await Promise.all([
    detectGitBranch(cwd),
    detectCodexVersion(cwd, config.codex.command)
  ]);

  const verificationCommands = [
    ...(config.workflows.build.verificationCommands ?? []),
    ...((config.workflows.build.verificationCommands?.length ?? 0) > 0 ? [] : (config.verification?.defaultCommands ?? []))
  ];
  const requestedMode = parsed.options.requestedMode ?? config.workflows.build.mode ?? "interactive";

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
      requestedMode,
      verificationCommands,
      allowDirty
    }
  };

  await writeRunRecord(runDir, runRecord);

  try {
    const execution = await runBuildExecution({
      cwd,
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
        sessionPath,
        transcriptPath,
        changeSummaryPath,
        verificationPath
      },
      requestedMode,
      verificationCommands,
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
      runRecord.error = `build exited with code ${execution.result.code}${execution.result.signal ? ` (${execution.result.signal})` : ""}`;
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
        "Artifacts:",
        `  ${path.relative(cwd, finalPath)}`,
        `  ${path.relative(cwd, changeSummaryPath)}`,
        `  ${path.relative(cwd, verificationPath)}`,
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
