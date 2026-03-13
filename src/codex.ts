import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import type { CstackConfig } from "./types.js";

export interface CodexRunOptions {
  cwd: string;
  prompt: string;
  finalPath: string;
  stdoutPath: string;
  stderrPath: string;
  config: CstackConfig;
}

export interface CodexRunResult {
  code: number;
  signal: NodeJS.Signals | null;
  command: string[];
  sessionId?: string;
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
  const bin = options.config.codex.command || process.env.CSTACK_CODEX_BIN || "codex";
  const invocation = resolveCommand(bin, args);

  return new Promise<CodexRunResult>((resolve, reject) => {
    const child = spawn(invocation.file, invocation.args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let sessionId: string | undefined;
    child.stdin.write(options.prompt);
    child.stdin.end();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.write(chunk);
      const text = chunk.toString("utf8");
      const match = text.match(/session id:\s*([^\s]+)/i);
      if (match?.[1]) {
        sessionId = match[1];
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.write(chunk);
      const text = chunk.toString("utf8");
      const match = text.match(/session id:\s*([^\s]+)/i);
      if (match?.[1]) {
        sessionId = match[1];
      }
    });

    child.on("error", (error) => {
      stdout.end();
      stderr.end();
      reject(error);
    });

    child.on("close", (code, signal) => {
      stdout.end();
      stderr.end();
      const result: CodexRunResult = {
        code: code ?? 1,
        signal,
        command: [invocation.file, ...invocation.args]
      };
      if (sessionId) {
        result.sessionId = sessionId;
      }
      resolve(result);
    });
  });
}
