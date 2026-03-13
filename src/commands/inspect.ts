import { promises as fs } from "node:fs";
import path from "node:path";
import { listRuns, readRun } from "../run.js";

export async function runInspect(cwd: string, runId?: string): Promise<void> {
  const targetId = runId ?? (await listRuns(cwd))[0]?.id;
  if (!targetId) {
    throw new Error("No runs found to inspect.");
  }

  const run = await readRun(cwd, targetId);
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
      run.sessionId ? `Session: ${run.sessionId}` : undefined,
      "",
      "Final output:",
      finalBody || "(missing)"
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
}
