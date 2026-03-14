import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runCodexExec, runCodexInteractive } from "./codex.js";
import type { CodexRunResult } from "./codex.js";
import { buildBuildPrompt } from "./prompt.js";
import { readRun } from "./run.js";
import type {
  BuildSessionRecord,
  BuildVerificationCommandRecord,
  BuildVerificationRecord,
  CstackConfig,
  RunRecord,
  WorkflowMode
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface LinkedBuildContext {
  run: RunRecord;
  artifactPath: string | null;
  artifactBody: string;
}

export interface BuildPaths {
  runDir: string;
  promptPath: string;
  contextPath: string;
  finalPath: string;
  eventsPath: string;
  stdoutPath: string;
  stderrPath: string;
  sessionPath: string;
  transcriptPath: string;
  changeSummaryPath: string;
  verificationPath: string;
}

export interface BuildExecutionOptions {
  cwd: string;
  runId: string;
  input: string;
  config: CstackConfig;
  paths: BuildPaths;
  requestedMode: WorkflowMode;
  linkedContext?: LinkedBuildContext | undefined;
  verificationCommands: string[];
}

export interface BuildExecutionResult {
  result: CodexRunResult;
  finalBody: string;
  requestedMode: WorkflowMode;
  observedMode: WorkflowMode;
  sessionRecord: BuildSessionRecord;
  verificationRecord: BuildVerificationRecord;
}

function resolveCandidateArtifacts(run: RunRecord): string[] {
  const runDir = path.dirname(run.finalPath);
  switch (run.workflow) {
    case "spec":
      return [path.join(runDir, "artifacts", "spec.md"), run.finalPath];
    case "intent":
      return [path.join(runDir, "stages", "spec", "artifacts", "spec.md"), run.finalPath];
    case "discover":
      return [
        path.join(runDir, "stages", "discover", "artifacts", "discovery-report.md"),
        path.join(runDir, "artifacts", "findings.md"),
        run.finalPath
      ];
    case "build":
      return [path.join(runDir, "artifacts", "change-summary.md"), run.finalPath];
    case "deliver":
      return [
        path.join(runDir, "stages", "ship", "artifacts", "ship-summary.md"),
        path.join(runDir, "stages", "build", "artifacts", "change-summary.md"),
        run.finalPath
      ];
    default:
      return [run.finalPath];
  }
}

export async function resolveLinkedBuildContext(cwd: string, runId: string): Promise<LinkedBuildContext> {
  const run = await readRun(cwd, runId);
  for (const candidate of resolveCandidateArtifacts(run)) {
    try {
      const artifactBody = await fs.readFile(candidate, "utf8");
      return {
        run,
        artifactPath: candidate,
        artifactBody
      };
    } catch {}
  }

  return {
    run,
    artifactPath: null,
    artifactBody: ""
  };
}

export async function detectDirtyWorktree(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function listDirtyWorktreeFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function ensureCleanWorktreeForWorkflow(cwd: string, workflow: "build" | "ship" | "deliver", allowDirty: boolean): Promise<void> {
  if (allowDirty) {
    return;
  }

  const dirtyFiles = await listDirtyWorktreeFiles(cwd);
  if (dirtyFiles.length === 0) {
    return;
  }

  const preview = dirtyFiles.slice(0, 5).join(", ");
  throw new Error(
    `\`cstack ${workflow}\` requires a clean worktree unless \`--allow-dirty\` is set. Dirty files: ${preview}${dirtyFiles.length > 5 ? ", ..." : ""}`
  );
}

function canUseInteractiveBuild(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY);
}

function shouldFallbackLaunchError(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException | undefined;
  return err?.code === "ENOENT";
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function buildFallbackFinalBody(options: {
  input: string;
  requestedMode: WorkflowMode;
  observedMode: WorkflowMode;
  linkedContext?: LinkedBuildContext;
  result: CodexRunResult;
  verificationRecord: BuildVerificationRecord;
  transcriptPath: string;
  notes: string[];
}): string {
  const linked = options.linkedContext;
  const relativeTranscript = linked ? options.transcriptPath : options.transcriptPath;

  return [
    "# Build Run Summary",
    "",
    "## Request",
    options.input,
    "",
    "## Run",
    `- requested mode: ${options.requestedMode}`,
    `- observed mode: ${options.observedMode}`,
    linked ? `- linked run: ${linked.run.id}` : "- linked run: none",
    linked ? `- linked workflow: ${linked.run.workflow}` : "- linked workflow: none",
    linked?.artifactPath ? `- linked artifact: ${linked.artifactPath}` : "- linked artifact: none",
    "",
    "## Codex session",
    options.result.sessionId ? `- session id: ${options.result.sessionId}` : "- session id: not observed",
    `- exit code: ${options.result.code}${options.result.signal ? ` (${options.result.signal})` : ""}`,
    options.observedMode === "interactive" ? `- transcript: ${relativeTranscript}` : "- transcript: not captured",
    "",
    "## Verification",
    `- status: ${options.verificationRecord.status}`,
    ...(options.verificationRecord.results.length > 0
      ? options.verificationRecord.results.map(
          (result) => `- ${result.command}: ${result.status} (exit ${result.exitCode}, ${result.durationMs}ms)`
        )
      : ["- no verification results recorded"]),
    "",
    "## Notes",
    ...(options.notes.length > 0 ? options.notes.map((note) => `- ${note}`) : ["- Codex did not leave a final markdown summary."])
  ].join("\n") + "\n";
}

async function runVerificationCommands(
  cwd: string,
  runDir: string,
  commands: string[]
): Promise<BuildVerificationRecord> {
  if (commands.length === 0) {
    return {
      status: "not-run",
      requestedCommands: [],
      results: [],
      notes: "No verification commands were requested."
    };
  }

  const verificationDir = path.join(runDir, "artifacts", "verification");
  await fs.mkdir(verificationDir, { recursive: true });
  const shell = process.env.SHELL || "/bin/sh";
  const results: BuildVerificationCommandRecord[] = [];

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    const stdoutPath = path.join(verificationDir, `${index + 1}.stdout.log`);
    const stderrPath = path.join(verificationDir, `${index + 1}.stderr.log`);
    const startedAt = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync(shell, ["-lc", command], { cwd, maxBuffer: 10 * 1024 * 1024 });
      await fs.writeFile(stdoutPath, stdout, "utf8");
      await fs.writeFile(stderrPath, stderr, "utf8");
      results.push({
        command,
        exitCode: 0,
        status: "passed",
        durationMs: Date.now() - startedAt,
        stdoutPath,
        stderrPath
      });
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
      await fs.writeFile(stdoutPath, execError.stdout ?? "", "utf8");
      await fs.writeFile(stderrPath, execError.stderr ?? execError.message, "utf8");
      results.push({
        command,
        exitCode: typeof execError.code === "number" ? execError.code : 1,
        status: "failed",
        durationMs: Date.now() - startedAt,
        stdoutPath,
        stderrPath
      });
    }
  }

  return {
    status: results.every((result) => result.status === "passed") ? "passed" : "failed",
    requestedCommands: commands,
    results
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runBuildExecution(options: BuildExecutionOptions): Promise<BuildExecutionResult> {
  const dirtyWorktree = await detectDirtyWorktree(options.cwd);
  const notes: string[] = [];
  const requestedMode = options.requestedMode;
  let observedMode: WorkflowMode = requestedMode;
  let fallbackReason: string | undefined;

  if (requestedMode === "interactive" && !canUseInteractiveBuild()) {
    observedMode = "exec";
    fallbackReason = "Interactive build requested but no TTY was available, so cstack fell back to exec mode.";
    notes.push(fallbackReason);
  }

  const buildPrompt = async (mode: WorkflowMode) =>
    buildBuildPrompt({
      cwd: options.cwd,
      input: options.input,
      config: options.config,
      mode,
      finalArtifactPath: options.paths.finalPath,
      verificationCommands: options.verificationCommands,
      dirtyWorktree,
      ...(options.linkedContext?.artifactPath ? { linkedArtifactPath: options.linkedContext.artifactPath } : {}),
      ...(options.linkedContext?.artifactBody ? { linkedArtifactBody: options.linkedContext.artifactBody } : {}),
      ...(options.linkedContext?.run.id ? { linkedRunId: options.linkedContext.run.id } : {}),
      ...(options.linkedContext?.run.workflow ? { linkedWorkflow: options.linkedContext.run.workflow } : {})
    });

  let { prompt, context } = await buildPrompt(observedMode);
  await fs.writeFile(options.paths.promptPath, prompt, "utf8");
  await fs.writeFile(options.paths.contextPath, `${context}\n`, "utf8");

  const startedAt = new Date().toISOString();
  let result: CodexRunResult;

  if (observedMode === "interactive") {
    try {
      result = await runCodexInteractive({
        cwd: options.cwd,
        workflow: "build",
        runId: options.runId,
        prompt,
        transcriptPath: options.paths.transcriptPath,
        eventsPath: options.paths.eventsPath,
        stdoutPath: options.paths.stdoutPath,
        stderrPath: options.paths.stderrPath,
        config: options.config
      });
    } catch (error) {
      if (!shouldFallbackLaunchError(error)) {
        throw error;
      }
      observedMode = "exec";
      fallbackReason = "Interactive build launch failed because the local `script` utility was unavailable; cstack fell back to exec mode.";
      notes.push(fallbackReason);
      ({ prompt, context } = await buildPrompt(observedMode));
      await fs.writeFile(options.paths.promptPath, prompt, "utf8");
      await fs.writeFile(options.paths.contextPath, `${context}\n`, "utf8");
      result = await runCodexExec({
        cwd: options.cwd,
        workflow: "build",
        runId: options.runId,
        prompt,
        finalPath: options.paths.finalPath,
        eventsPath: options.paths.eventsPath,
        stdoutPath: options.paths.stdoutPath,
        stderrPath: options.paths.stderrPath,
        config: options.config
      });
    }
  } else {
    result = await runCodexExec({
      cwd: options.cwd,
      workflow: "build",
      runId: options.runId,
      prompt,
      finalPath: options.paths.finalPath,
      eventsPath: options.paths.eventsPath,
      stdoutPath: options.paths.stdoutPath,
      stderrPath: options.paths.stderrPath,
      config: options.config
    });
  }

  const verificationRecord: BuildVerificationRecord =
    result.code === 0
      ? await runVerificationCommands(options.cwd, options.paths.runDir, options.verificationCommands)
      : {
          status: "not-run",
          requestedCommands: options.verificationCommands,
          results: [],
          notes: "Verification was skipped because the build run did not complete successfully."
        };
  await writeJson(options.paths.verificationPath, verificationRecord);

  let finalBody = await readTextFile(options.paths.finalPath);
  if (!finalBody.trim()) {
    finalBody = buildFallbackFinalBody({
      input: options.input,
      requestedMode,
      observedMode,
      result,
      verificationRecord,
      transcriptPath: path.relative(options.cwd, options.paths.transcriptPath),
      notes,
      ...(options.linkedContext ? { linkedContext: options.linkedContext } : {})
    });
    await fs.writeFile(options.paths.finalPath, finalBody, "utf8");
  }

  await fs.writeFile(options.paths.changeSummaryPath, finalBody, "utf8");

  const transcriptBody = observedMode === "interactive" ? await readTextFile(options.paths.transcriptPath) : "";
  const sessionRecord: BuildSessionRecord = {
    workflow: "build",
    requestedMode,
    mode: observedMode,
    startedAt,
    endedAt: new Date().toISOString(),
    ...(result.sessionId ? { sessionId: result.sessionId } : {}),
    ...(options.linkedContext?.run.id ? { linkedRunId: options.linkedContext.run.id } : {}),
    ...(options.linkedContext?.run.workflow ? { linkedRunWorkflow: options.linkedContext.run.workflow } : {}),
    ...(options.linkedContext?.artifactPath ? { linkedArtifactPath: options.linkedContext.artifactPath } : {}),
    ...(observedMode === "interactive" ? { transcriptPath: options.paths.transcriptPath } : {}),
    codexCommand: result.command,
    ...(result.sessionId ? { resumeCommand: `codex resume ${result.sessionId}` } : {}),
    ...(result.sessionId ? { forkCommand: `codex fork ${result.sessionId}` } : {}),
    observability: {
      sessionIdObserved: Boolean(result.sessionId),
      transcriptObserved: Boolean(transcriptBody.trim()),
      finalArtifactObserved: Boolean(finalBody.trim()),
      ...(fallbackReason ? { fallbackReason } : {})
    },
    ...(notes.length > 0 ? { notes } : {})
  };
  await writeJson(options.paths.sessionPath, sessionRecord);

  return {
    result,
    finalBody,
    requestedMode,
    observedMode,
    sessionRecord,
    verificationRecord
  };
}
