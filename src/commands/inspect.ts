import { promises as fs } from "node:fs";
import path from "node:path";
import type { RunEvent } from "../types.js";
import { listRuns, readRun } from "../run.js";

async function readRecentEvents(eventsPath?: string): Promise<RunEvent[]> {
  if (!eventsPath) {
    return [];
  }

  try {
    const body = await fs.readFile(eventsPath, "utf8");
    return body
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-8)
      .map((line) => JSON.parse(line) as RunEvent);
  } catch {
    return [];
  }
}

export async function runInspect(cwd: string, runId?: string): Promise<void> {
  const targetId = runId ?? (await listRuns(cwd))[0]?.id;
  if (!targetId) {
    throw new Error("No runs found to inspect.");
  }

  const run = await readRun(cwd, targetId);
  const recentEvents = await readRecentEvents(run.eventsPath);
  let finalBody = "";
  try {
    finalBody = await fs.readFile(run.finalPath, "utf8");
  } catch {}

  process.stdout.write(
    [
      `Run: ${run.id}`,
      `Workflow: ${run.workflow}`,
      `Status: ${run.status}`,
      `Created: ${run.createdAt}`,
      `Branch: ${run.gitBranch}`,
      `Final: ${path.relative(cwd, run.finalPath)}`,
      run.eventsPath ? `Events: ${path.relative(cwd, run.eventsPath)}` : undefined,
      run.sessionId ? `Session: ${run.sessionId}` : undefined,
      run.lastActivity ? `Last activity: ${run.lastActivity}` : undefined,
      recentEvents.length > 0 ? "" : undefined,
      recentEvents.length > 0 ? "Recent activity:" : undefined,
      ...recentEvents.map((event) => `  [${event.type}] +${Math.floor(event.elapsedMs / 1000)}s ${event.message}`),
      "",
      "Final output:",
      finalBody || "(missing)"
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
}
