import { loadConfig } from "../config.js";
import { runCodexSubcommand } from "../codex.js";
import { recordForkObservation, resolveSessionTarget } from "../session.js";
import type { WorkflowName } from "../types.js";

export interface ForkCliOptions {
  workflow?: WorkflowName;
}

export function parseForkArgs(args: string[]): { runId: string; options: ForkCliOptions } {
  let runId: string | undefined;
  const options: ForkCliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--workflow") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack fork --workflow` requires a workflow name.");
      }
      options.workflow = value as WorkflowName;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown fork option: ${arg}`);
    }
    if (runId) {
      throw new Error("`cstack fork` accepts exactly one run id.");
    }
    runId = arg;
  }

  if (!runId) {
    throw new Error("`cstack fork` requires a run id.");
  }

  return { runId, options };
}

export async function runFork(cwd: string, args: string[] = []): Promise<void> {
  const { runId, options } = parseForkArgs(args);
  const { config } = await loadConfig(cwd);
  const target = await resolveSessionTarget(cwd, runId);
  const result = await runCodexSubcommand({
    cwd,
    subcommand: "fork",
    args: [target.sessionId],
    config
  });
  if (result.code !== 0) {
    throw new Error(`codex fork exited with code ${result.code}${result.signal ? ` (${result.signal})` : ""}`);
  }

  await recordForkObservation({
    cwd,
    runId,
    ...(result.sessionId ? { childSessionId: result.sessionId } : {}),
    ...(options.workflow ? { childWorkflow: options.workflow } : {})
  });
}
