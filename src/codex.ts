import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { buildEvent, formatProgressMessage } from "./progress.js";
import type { CstackConfig } from "./types.js";
import type { RunEvent, WorkflowName } from "./types.js";

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
}

export interface CodexRunResult {
  code: number;
  signal: NodeJS.Signals | null;
  command: string[];
  sessionId?: string;
  lastActivity?: string;
}

function summarizeCommandLine(line: string): string | null {
  const toolMatch = line.match(/^(.+?) in .+ (succeeded|failed) in \d+ms:?$/);
  if (!toolMatch?.[1] || !toolMatch[2]) {
    return null;
  }

  const command = toolMatch[1].replace(/^\/bin\/bash -lc\s+/, "").replace(/^exec\s+/i, "").trim();
  return `Tool ${toolMatch[2]}: ${command}`;
}

function summarizeActivityLine(line: string): string | null {
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

export async function runCodexExec(options: CodexRunOptions): Promise<CodexRunResult> {
  const args = buildCodexExecArgs(options);
  const stdout = createWriteStream(path.resolve(options.stdoutPath), { flags: "w" });
  const stderr = createWriteStream(path.resolve(options.stderrPath), { flags: "w" });
  const events = createWriteStream(path.resolve(options.eventsPath), { flags: "w" });
  const bin = options.config.codex.command || process.env.CSTACK_CODEX_BIN || "codex";
  const invocation = resolveCommand(bin, args);
  const startedAt = Date.now();

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
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let lastHeartbeatAt = startedAt;

    const emitEvent = (event: RunEvent) => {
      events.write(`${JSON.stringify(event)}\n`);
      process.stdout.write(`${formatProgressMessage(event, options.workflow, options.runId)}\n`);
      lastActivity = event.message;
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
      if (now - lastHeartbeatAt >= 5_000) {
        emit("heartbeat", `Last activity: ${lastActivity}`);
        lastHeartbeatAt = now;
      }
    }, 1_000);

    emit("starting", `Running codex exec in ${options.cwd}`);
    child.stdin.write(options.prompt);
    child.stdin.end();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.write(chunk);
      const text = chunk.toString("utf8");
      stdoutBuffer += text;
      flushLines("stdout");
      const match = text.match(/session id:\s*([^\s]+)/i);
      if (match?.[1]) {
        sessionId = match[1];
        emit("session", sessionId);
      }
      lastHeartbeatAt = Date.now();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.write(chunk);
      const text = chunk.toString("utf8");
      stderrBuffer += text;
      flushLines("stderr");
      const match = text.match(/session id:\s*([^\s]+)/i);
      if (match?.[1]) {
        sessionId = match[1];
        emit("session", sessionId);
      }
      lastHeartbeatAt = Date.now();
    });

    child.on("error", (error) => {
      clearInterval(heartbeat);
      void closeStreams().finally(() => reject(error));
    });

    child.on("close", async (code, signal) => {
      clearInterval(heartbeat);
      flushLines("stdout", true);
      flushLines("stderr", true);
      const exitCode = code ?? 1;
      if (exitCode === 0) {
        emit("completed", `Exit code ${exitCode}`);
      } else {
        emit("failed", `Exit code ${exitCode}${signal ? ` (${signal})` : ""}`);
      }
      const result: CodexRunResult = {
        code: exitCode,
        signal,
        command: [invocation.file, ...invocation.args],
        lastActivity
      };
      if (sessionId) {
        result.sessionId = sessionId;
      }
      await closeStreams();
      resolve(result);
    });
  });
}
