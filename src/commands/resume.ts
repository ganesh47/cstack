import { loadConfig } from "../config.js";
import { runCodexSubcommand } from "../codex.js";
import { resolveSessionTarget } from "../session.js";

export function parseResumeArgs(args: string[]): { runId: string } {
  const [runId, ...rest] = args;
  if (!runId) {
    throw new Error("`cstack resume` requires a run id.");
  }
  if (rest.length > 0) {
    throw new Error("`cstack resume` accepts exactly one run id.");
  }
  return { runId };
}

export async function runResume(cwd: string, args: string[] = []): Promise<void> {
  const { runId } = parseResumeArgs(args);
  const { config } = await loadConfig(cwd);
  const target = await resolveSessionTarget(cwd, runId);
  const result = await runCodexSubcommand({
    cwd,
    subcommand: "resume",
    args: [target.sessionId],
    config
  });
  if (result.code !== 0) {
    throw new Error(`codex resume exited with code ${result.code}${result.signal ? ` (${result.signal})` : ""}`);
  }
}
