import { promises as fs } from "node:fs";
import path from "node:path";
import type { RoutingPlan, RunEvent, StageLineage } from "../types.js";
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

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const body = await fs.readFile(filePath, "utf8");
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

export async function runInspect(cwd: string, runId?: string): Promise<void> {
  const targetId = runId ?? (await listRuns(cwd))[0]?.id;
  if (!targetId) {
    throw new Error("No runs found to inspect.");
  }

  const run = await readRun(cwd, targetId);
  const recentEvents = await readRecentEvents(run.eventsPath);
  const runDir = path.dirname(run.finalPath);
  const routingPlan = await readJsonFile<RoutingPlan>(path.join(runDir, "routing-plan.json"));
  const stageLineage = await readJsonFile<StageLineage>(path.join(runDir, "stage-lineage.json"));
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
      routingPlan ? "" : undefined,
      routingPlan ? `Routing plan: ${path.relative(cwd, path.join(runDir, "routing-plan.json"))}` : undefined,
      ...(routingPlan
        ? [
            "Planned stages:",
            ...routingPlan.stages.map((stage) => `  - ${stage.name}: ${stage.status} (${stage.rationale})`),
            "",
            "Selected specialists:",
            ...(routingPlan.specialists.some((specialist) => specialist.selected)
              ? routingPlan.specialists
                  .filter((specialist) => specialist.selected)
                  .map((specialist) => `  - ${specialist.name}: ${specialist.reason}`)
              : ["  - none"])
          ]
        : []),
      ...(stageLineage
        ? [
            "",
            "Stage lineage:",
            ...stageLineage.stages.map((stage) => `  - ${stage.name}: ${stage.status}${stage.executed ? " (executed)" : ""}`),
            "",
            "Specialists:",
            ...(stageLineage.specialists.length > 0
              ? stageLineage.specialists.map(
                  (specialist) =>
                    `  - ${specialist.name}: ${specialist.status}, disposition=${specialist.disposition}, reason=${specialist.reason}`
                )
              : ["  - none"])
          ]
        : []),
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
