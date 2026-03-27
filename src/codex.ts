import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { buildEvent, ProgressReporter } from "./progress.js";
import type { CstackConfig } from "./types.js";
import type { RunEvent, WorkflowName } from "./types.js";

const DEFAULT_COMPLETION_STALL_MS = 20_000;

export interface CodexRunOptions {
  cwd: string;
  workflow: WorkflowName;
  runId: string;
  prompt: string;
  finalPath: string;
  eventsPath: string;
  stdoutPath: string;
  stderrPath: string;
  config: CstackConfig;
  silentProgress?: boolean;
  timeoutSeconds?: number;
}

export interface CodexRunResult {
  code: number;
  signal: NodeJS.Signals | null;
  command: string[];
  sessionId?: string;
  lastActivity?: string;
  timedOut?: boolean;
  timeoutSeconds?: number;
}

export interface CodexInteractiveRunOptions {
  cwd: string;
  workflow: WorkflowName;
  runId: string;
  prompt: string;
  transcriptPath: string;
  eventsPath: string;
  stdoutPath: string;
  stderrPath: string;
  config: CstackConfig;
  timeoutSeconds?: number;
}

export interface CodexSubcommandResult {
  code: number;
  signal: NodeJS.Signals | null;
  command: string[];
  stdout: string;
  stderr: string;
  sessionId?: string;
}

interface WritableWithOptionalEvents {
  end(chunk?: string): void;
  on?(event: "error", listener: (error: NodeJS.ErrnoException) => void): this;
  once?(event: "error", listener: (error: NodeJS.ErrnoException) => void): this;
  off?(event: "error", listener: (error: NodeJS.ErrnoException) => void): this;
  removeListener?(event: "error", listener: (error: NodeJS.ErrnoException) => void): this;
}

function summarizeCommandLine(line: string): string | null {
  const toolMatch = line.match(/^(.+?) in .+ (succeeded|failed) in \d+ms:?$/);
  if (!toolMatch?.[1] || !toolMatch[2]) {
    return null;
  }

  const command = toolMatch[1].replace(/^exec\s+/i, "").replace(/^\/bin\/(?:ba|z)sh -lc\s+/, "").trim();
  return `Tool ${toolMatch[2]}: ${command}`;
}

function looksLikeCodeLine(trimmed: string): boolean {
  return (
    /^(const|let|var|function|class|interface|type|import|export|return|await)\b/.test(trimmed) ||
    /=>/.test(trimmed) ||
    /[;{}]$/.test(trimmed) ||
    (/[=]/.test(trimmed) && /[()]/.test(trimmed))
  );
}

export function summarizeActivityLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  if (/^session id:/i.test(trimmed)) {
    return null;
  }

  if (
    /^(OpenAI Codex v|[-]{3,}|workdir:|model:|provider:|approval:|sandbox:|reasoning effort:|reasoning summaries:|user$)/i.test(
      trimmed
    )
  ) {
    return null;
  }

  if (/^(#|##|###)\s/.test(trimmed)) {
    return null;
  }

  if (looksLikeCodeLine(trimmed)) {
    return null;
  }

  const commandSummary = summarizeCommandLine(trimmed);
  if (commandSummary) {
    return commandSummary;
  }

  if (/^(mcp:|mcp startup:)/i.test(trimmed)) {
    return trimmed;
  }

  if (/^(I('| a)m|I'm)\b/i.test(trimmed)) {
    return trimmed;
  }

  if (/^(scanning|writing|thinking|reading|mapping|drafting|analyzing|summarizing|checking|reviewing|completed)\b/i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function resolveCommand(command: string, args: string[]): { file: string; args: string[] } {
  if (/\.(mjs|cjs|js|ts)$/i.test(command)) {
    return {
      file: process.execPath,
      args: [command, ...args]
    };
  }

  return {
    file: command,
    args
  };
}

export function writePromptToChildStdin(
  stream: WritableWithOptionalEvents,
  prompt: string,
  onError?: (error: NodeJS.ErrnoException) => void
): () => void {
  const handleError = (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED") {
      return;
    }
    onError?.(error);
  };

  if (stream.on) {
    stream.on("error", handleError);
  } else if (stream.once) {
    stream.once("error", handleError);
  }

  try {
    stream.end(prompt);
  } catch (error) {
    handleError(error as NodeJS.ErrnoException);
  }

  return () => {
    if (stream.off) {
      stream.off("error", handleError);
    } else if (stream.removeListener) {
      stream.removeListener("error", handleError);
    }
  };
}

export async function runCodexSubcommand(options: {
  cwd: string;
  subcommand: string;
  args: string[];
  config: CstackConfig;
}): Promise<CodexSubcommandResult> {
  const bin = options.config.codex.command || process.env.CSTACK_CODEX_BIN || "codex";
  const invocation = resolveCommand(bin, [options.subcommand, ...options.args]);

  return new Promise<CodexSubcommandResult>((resolve, reject) => {
    const child = spawn(invocation.file, invocation.args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      const sessionId = `${stdout}\n${stderr}`.match(/session id:\s*([^\s]+)/i)?.[1];
      resolve({
        code: code ?? 1,
        signal,
        command: [invocation.file, ...invocation.args],
        stdout,
        stderr,
        ...(sessionId ? { sessionId } : {})
      });
    });
  });
}

function stripCapturedControl(input: string): string {
  return input
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function appendPreview(preview: string, chunk: string, limit = 16_384): string {
  const combined = preview + chunk;
  return combined.length <= limit ? combined : combined.slice(combined.length - limit);
}

function looksLikeCompletedPayload(input: string): boolean {
  const cleaned = stripCapturedControl(input).trim();
  if (!cleaned) {
    return false;
  }

  return (
    /^\{\s*"status"\s*:\s*"completed"/.test(cleaned) ||
    /^\{\s*"summary"\s*:\s*"/.test(cleaned) ||
    /^#\s+/.test(cleaned)
  );
}

async function appendEvent(eventsPath: string, event: RunEvent): Promise<void> {
  await fs.appendFile(path.resolve(eventsPath), `${JSON.stringify(event)}\n`, "utf8");
}

export function buildCodexExecArgs(options: CodexRunOptions): string[] {
  const args = [
    "exec",
    "-C",
    options.cwd,
    "--skip-git-repo-check",
    "--output-last-message",
    options.finalPath
  ];

  if (options.config.codex.model) {
    args.push("--model", options.config.codex.model);
  }
  if (options.config.codex.profile) {
    args.push("--profile", options.config.codex.profile);
  }
  if (options.config.codex.sandbox) {
    args.push("--sandbox", options.config.codex.sandbox);
  }
  if (options.config.codex.extraArgs?.length) {
    args.push(...options.config.codex.extraArgs);
  }
  args.push("-");
  return args;
}

export function buildCodexInteractiveArgs(options: {
  cwd: string;
  prompt: string;
  config: CstackConfig;
}): string[] {
  const args = ["-C", options.cwd, "--skip-git-repo-check"];

  if (options.config.codex.model) {
    args.push("--model", options.config.codex.model);
  }
  if (options.config.codex.profile) {
    args.push("--profile", options.config.codex.profile);
  }
  if (options.config.codex.sandbox) {
    args.push("--sandbox", options.config.codex.sandbox);
  }
  if (options.config.codex.extraArgs?.length) {
    args.push(...options.config.codex.extraArgs);
  }
  args.push(options.prompt);
  return args;
}

function resolveWorkflowTimeoutSeconds(options: { workflow: WorkflowName; config: CstackConfig; timeoutSeconds?: number }): number | undefined {
  if (typeof options.timeoutSeconds === "number") {
    return options.timeoutSeconds;
  }

  const workflowConfig = options.config.workflows[options.workflow as keyof CstackConfig["workflows"]];
  return typeof workflowConfig?.timeoutSeconds === "number" ? workflowConfig.timeoutSeconds : undefined;
}

export async function runCodexExec(options: CodexRunOptions): Promise<CodexRunResult> {
  const args = buildCodexExecArgs(options);
  const stdout = createWriteStream(path.resolve(options.stdoutPath), { flags: "w" });
  const stderr = createWriteStream(path.resolve(options.stderrPath), { flags: "w" });
  const events = createWriteStream(path.resolve(options.eventsPath), { flags: "w" });
  const bin = options.config.codex.command || process.env.CSTACK_CODEX_BIN || "codex";
  const invocation = resolveCommand(bin, args);
  const startedAt = Date.now();
  const reporter = options.silentProgress ? null : new ProgressReporter(options.workflow, options.runId);
  const timeoutSeconds = resolveWorkflowTimeoutSeconds(options);

  return new Promise<CodexRunResult>((resolve, reject) => {
    const closeStreams = async (): Promise<void> =>
      await new Promise<void>((resolveClose) => {
        let pending = 3;
        const done = () => {
          pending -= 1;
          if (pending === 0) {
            resolveClose();
          }
        };
        stdout.end(done);
        stderr.end(done);
        events.end(done);
      });

    const child = spawn(invocation.file, invocation.args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let sessionId: string | undefined;
    let lastActivity = "Codex process launched";
    let lastMeaningfulActivityAt = startedAt;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let stdoutPreview = "";
    let stderrPreview = "";
    let lastHeartbeatAt = startedAt;
    let lastRawOutputAt = startedAt;
    let timedOut = false;
    let stalledAfterOutput = false;
    let forcedSignal: NodeJS.Signals | null = null;
    let killTimer: NodeJS.Timeout | undefined;
    const completionStallMs = Number.parseInt(process.env.CSTACK_CODEX_COMPLETION_STALL_MS ?? "", 10);
    const postOutputStallMs =
      Number.isFinite(completionStallMs) && completionStallMs > 0 ? completionStallMs : DEFAULT_COMPLETION_STALL_MS;

    const emitEvent = (event: RunEvent) => {
      events.write(`${JSON.stringify(event)}\n`);
      reporter?.emit(event);
      if (event.type !== "heartbeat") {
        lastActivity = event.message;
        lastMeaningfulActivityAt = Date.now();
      }
    };

    const emit = (type: RunEvent["type"], message: string, stream?: "stdout" | "stderr") => {
      const event = buildEvent(type, Date.now() - startedAt, message, stream);
      emitEvent(event);
    };

    const flushLines = (source: "stdout" | "stderr", flushRemainder = false) => {
      const current = source === "stdout" ? stdoutBuffer : stderrBuffer;
      const parts = current.split(/\r?\n/);
      const remainder = parts.pop() ?? "";
      for (const line of parts) {
        const summary = summarizeActivityLine(line);
        if (summary) {
          emit("activity", summary, source);
        }
      }
      if (source === "stdout") {
        stdoutBuffer = flushRemainder ? "" : remainder;
      } else {
        stderrBuffer = flushRemainder ? "" : remainder;
      }
      if (flushRemainder) {
        const summary = summarizeActivityLine(remainder);
        if (summary) {
          emit("activity", summary, source);
        }
      }
    };

    const heartbeat = setInterval(() => {
      const now = Date.now();
      if (now - lastHeartbeatAt >= 5_000 && now - lastMeaningfulActivityAt >= 5_000) {
        emit("heartbeat", `Last activity: ${lastActivity}`);
        lastHeartbeatAt = now;
      }
      if (
        !timedOut &&
        !stalledAfterOutput &&
        now - lastRawOutputAt >= postOutputStallMs &&
        (looksLikeCompletedPayload(stdoutPreview) || looksLikeCompletedPayload(stderrPreview))
      ) {
        stalledAfterOutput = true;
        forcedSignal = "SIGTERM";
        lastActivity = `Accepted completed output after ${Math.round(postOutputStallMs / 1000)}s of post-output silence`;
        emit("activity", lastActivity);
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) {
            forcedSignal = "SIGKILL";
            child.kill("SIGKILL");
          }
        }, 2_000).unref?.();
      }
    }, 1_000);

    const stopTimeouts = () => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
    };

    emit("starting", `Running codex exec in ${options.cwd}`);
    const detachStdinError = writePromptToChildStdin(child.stdin, options.prompt, (error) => {
      clearInterval(heartbeat);
      reporter?.close();
      void closeStreams().finally(() => reject(error));
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.write(chunk);
      const text = chunk.toString("utf8");
      lastRawOutputAt = Date.now();
      stdoutBuffer += text;
      stdoutPreview = appendPreview(stdoutPreview, text);
      flushLines("stdout");
      const match = text.match(/session id:\s*([^\s]+)/i);
      if (match?.[1]) {
        sessionId = match[1];
        emit("session", sessionId);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.write(chunk);
      const text = chunk.toString("utf8");
      lastRawOutputAt = Date.now();
      stderrBuffer += text;
      stderrPreview = appendPreview(stderrPreview, text);
      flushLines("stderr");
      const match = text.match(/session id:\s*([^\s]+)/i);
      if (match?.[1]) {
        sessionId = match[1];
        emit("session", sessionId);
      }
    });

    if (timeoutSeconds && timeoutSeconds > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        forcedSignal = "SIGTERM";
        lastActivity = `Timed out after ${timeoutSeconds}s`;
        emit("failed", `Timed out after ${timeoutSeconds}s`);
        stderr.write(`cstack: stage timed out after ${timeoutSeconds}s\n`);
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) {
            forcedSignal = "SIGKILL";
            child.kill("SIGKILL");
          }
        }, 2_000).unref?.();
      }, timeoutSeconds * 1000);
      killTimer.unref?.();
    }

    child.on("error", (error) => {
      detachStdinError();
      clearInterval(heartbeat);
      stopTimeouts();
      reporter?.close();
      void closeStreams().finally(() => reject(error));
    });

    child.on("close", async (code, signal) => {
      detachStdinError();
      clearInterval(heartbeat);
       stopTimeouts();
      flushLines("stdout", true);
      flushLines("stderr", true);
      const exitCode = timedOut ? 124 : stalledAfterOutput ? 0 : (code ?? 1);
      const resolvedSignal = forcedSignal ?? signal;
      if (exitCode === 0) {
        emit("completed", `Exit code ${exitCode}`);
      } else if (!timedOut) {
        emit("failed", `Exit code ${exitCode}${signal ? ` (${signal})` : ""}`);
      }
      const result: CodexRunResult = {
        code: exitCode,
        signal: resolvedSignal,
        command: [invocation.file, ...invocation.args],
        lastActivity,
        ...(timedOut ? { timedOut: true } : {}),
        ...(timeoutSeconds ? { timeoutSeconds } : {})
      };
      if (sessionId) {
        result.sessionId = sessionId;
      }
      reporter?.close();
      await closeStreams();
      resolve(result);
    });
  });
}

export async function runCodexInteractive(options: CodexInteractiveRunOptions): Promise<CodexRunResult> {
  const args = buildCodexInteractiveArgs(options);
  const bin = options.config.codex.command || process.env.CSTACK_CODEX_BIN || "codex";
  const invocation = resolveCommand(bin, args);
  const scriptArgs = ["-q", "-F", path.resolve(options.transcriptPath), invocation.file, ...invocation.args];
  const startedAt = Date.now();
  const reporter = new ProgressReporter(options.workflow, options.runId);
  const timeoutSeconds = resolveWorkflowTimeoutSeconds(options);

  await fs.mkdir(path.dirname(path.resolve(options.transcriptPath)), { recursive: true });
  await fs.writeFile(path.resolve(options.eventsPath), "", "utf8");
  await fs.writeFile(path.resolve(options.stdoutPath), "", "utf8");
  await fs.writeFile(path.resolve(options.stderrPath), "", "utf8");

  const emit = async (type: RunEvent["type"], message: string) => {
    const event = buildEvent(type, Date.now() - startedAt, message);
    await appendEvent(options.eventsPath, event);
    reporter.emit(event);
  };

  return new Promise<CodexRunResult>((resolve, reject) => {
    const child = spawn("script", scriptArgs, {
      cwd: options.cwd,
      stdio: "inherit"
    });

    void emit("starting", `Running interactive codex build in ${options.cwd}`);
    let timedOut = false;
    let forcedSignal: NodeJS.Signals | null = null;
    let killTimer: NodeJS.Timeout | undefined;

    if (timeoutSeconds && timeoutSeconds > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        forcedSignal = "SIGTERM";
        void emit("failed", `Timed out after ${timeoutSeconds}s`);
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            forcedSignal = "SIGKILL";
            child.kill("SIGKILL");
          }
        }, 2_000).unref?.();
      }, timeoutSeconds * 1000);
      killTimer.unref?.();
    }

    child.on("error", async (error) => {
      if (killTimer) {
        clearTimeout(killTimer);
      }
      reporter.close();
      await fs.writeFile(path.resolve(options.stderrPath), `${String(error)}\n`, "utf8");
      reject(error);
    });

    child.on("close", async (code, signal) => {
      if (killTimer) {
        clearTimeout(killTimer);
      }
      const exitCode = timedOut ? 124 : (code ?? 1);
      const resolvedSignal = forcedSignal ?? signal;
      const transcriptRaw = await fs.readFile(path.resolve(options.transcriptPath), "utf8").catch(() => "");
      const transcript = stripCapturedControl(transcriptRaw).trim();
      const sessionId = transcript.match(/session id:\s*([^\s]+)/i)?.[1];
      const transcriptLines = transcript
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      const lastActivity =
        [...transcriptLines].reverse().map((line) => summarizeActivityLine(line)).find(Boolean) ??
        (exitCode === 0 ? "Interactive build completed" : "Interactive build failed");

      await fs.writeFile(
        path.resolve(options.stdoutPath),
        transcript ? `${transcript}\n` : "No interactive transcript was captured.\n",
        "utf8"
      );
      await fs.writeFile(
        path.resolve(options.stderrPath),
        exitCode === 0
          ? ""
          : timedOut
            ? `Interactive codex timed out after ${timeoutSeconds}s\n`
            : `Interactive codex exited with code ${exitCode}${resolvedSignal ? ` (${resolvedSignal})` : ""}\n`,
        "utf8"
      );

      if (sessionId) {
        await emit("session", sessionId);
      }
      if (!timedOut) {
        await emit(exitCode === 0 ? "completed" : "failed", `Exit code ${exitCode}${resolvedSignal ? ` (${resolvedSignal})` : ""}`);
      }
      reporter.close();

      resolve({
        code: exitCode,
        signal: resolvedSignal,
        command: ["script", ...scriptArgs],
        ...(sessionId ? { sessionId } : {}),
        lastActivity,
        ...(timedOut ? { timedOut: true } : {}),
        ...(timeoutSeconds ? { timeoutSeconds } : {})
      });
    });
  });
}
