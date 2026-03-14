import path from "node:path";
import { promises as fs } from "node:fs";
import { loadRunInspection } from "./inspector.js";
import { runDirForId } from "./run.js";
import type { BuildSessionRecord, WorkflowName } from "./types.js";

export interface ResolvedSessionTarget {
  runId: string;
  workflow: WorkflowName;
  runDir: string;
  sessionId: string;
  sessionRecord: BuildSessionRecord | null;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function resolveSessionTarget(cwd: string, runId: string): Promise<ResolvedSessionTarget> {
  const inspection = await loadRunInspection(cwd, runId);
  const sessionId = inspection.sessionRecord?.sessionId ?? inspection.run.sessionId;
  if (!sessionId) {
    throw new Error(`Run ${runId} has no recorded Codex session id.`);
  }

  return {
    runId: inspection.run.id,
    workflow: inspection.run.workflow,
    runDir: inspection.runDir,
    sessionId,
    sessionRecord: inspection.sessionRecord
  };
}

export async function recordForkObservation(options: {
  cwd: string;
  runId: string;
  childSessionId?: string;
  childRunId?: string;
  childWorkflow?: WorkflowName;
}): Promise<void> {
  const runDir = runDirForId(options.cwd, options.runId);
  const sessionPath = path.join(runDir, "session.json");
  const sessionRecord = await readJsonFile<BuildSessionRecord & Record<string, unknown>>(sessionPath);
  if (!sessionRecord) {
    return;
  }

  const nextRecord: Record<string, unknown> = { ...sessionRecord };
  if (options.childSessionId) {
    nextRecord.childSessionId = options.childSessionId;
  }
  if (options.childRunId) {
    nextRecord.childRunId = options.childRunId;
  }
  if (options.childWorkflow) {
    nextRecord.childWorkflow = options.childWorkflow;
  }

  await fs.writeFile(sessionPath, `${JSON.stringify(nextRecord, null, 2)}\n`, "utf8");
}
