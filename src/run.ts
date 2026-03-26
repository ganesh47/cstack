import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runsRoot } from "./paths.js";
import type { RunLedgerEntry, RunRecord, StageLineage, WorkflowName } from "./types.js";

const execFileAsync = promisify(execFile);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "run";
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

export function makeRunId(workflow: WorkflowName, userPrompt: string, now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `${timestamp}-${workflow}-${slugify(userPrompt)}`;
}

export async function ensureRunDir(cwd: string, runId: string): Promise<string> {
  const dir = path.join(runsRoot(cwd), runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "artifacts"), { recursive: true });
  return dir;
}

export async function detectGitBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd });
    return stdout.trim() || "detached";
  } catch {
    return "unknown";
  }
}

export async function detectCodexVersion(cwd: string, codexCommand = process.env.CSTACK_CODEX_BIN || "codex"): Promise<string | null> {
  try {
    const invocation = resolveCommand(codexCommand, ["--version"]);
    const { stdout } = await execFileAsync(invocation.file, invocation.args, { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function writeRunRecord(runDir: string, run: RunRecord): Promise<void> {
  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export function runDirForId(cwd: string, runId: string): string {
  return path.join(runsRoot(cwd), runId);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function summarizePrompt(input: string, max = 72): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(empty)";
  }
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 1)}…`;
}

function summarizeRun(run: RunRecord): string {
  if (typeof run.summary === "string" && run.summary.trim()) {
    return run.summary;
  }

  const prompt = typeof run.inputs?.userPrompt === "string" ? run.inputs.userPrompt : "";
  if (prompt.trim()) {
    return summarizePrompt(prompt);
  }

  return `${run.workflow} ${run.id}`;
}

export async function readStageLineage(cwd: string, runId: string): Promise<StageLineage | null> {
  return readJsonFile<StageLineage>(path.join(runDirForId(cwd, runId), "stage-lineage.json"));
}

export async function buildRunLedgerEntry(cwd: string, run: RunRecord): Promise<RunLedgerEntry> {
  const stageLineage = await readStageLineage(cwd, run.id);
  const runningStage = stageLineage?.stages.find((stage) => stage.status === "running");
  const activeSpecialists =
    run.activeSpecialists && run.activeSpecialists.length > 0
      ? run.activeSpecialists
      : (stageLineage?.specialists
          .filter((specialist) => specialist.status === "running")
          .map((specialist) => specialist.name) ?? []);

  return {
    id: run.id,
    workflow: run.workflow,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    summary: summarizeRun(run),
    currentStage: run.currentStage ?? runningStage?.name,
    activeSpecialists,
    finalPath: run.finalPath
  };
}

export interface ListRunLedgerOptions {
  activeOnly?: boolean;
  status?: RunRecord["status"];
  workflow?: WorkflowName;
  recent?: number;
}

export async function listRuns(cwd: string): Promise<RunRecord[]> {
  const root = runsRoot(cwd);
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const runs: RunRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const runFile = path.join(root, entry.name, "run.json");
      try {
        const raw = await fs.readFile(runFile, "utf8");
        runs.push(JSON.parse(raw) as RunRecord);
      } catch {
        continue;
      }
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function listRunLedger(cwd: string, options: ListRunLedgerOptions = {}): Promise<RunLedgerEntry[]> {
  let runs = await listRuns(cwd);

  if (options.activeOnly) {
    runs = runs.filter((run) => run.status === "running");
  }
  if (options.status) {
    runs = runs.filter((run) => run.status === options.status);
  }
  if (options.workflow) {
    runs = runs.filter((run) => run.workflow === options.workflow);
  }

  if (typeof options.recent === "number") {
    runs = runs.slice(0, Math.max(options.recent, 0));
  }

  return Promise.all(runs.map((run) => buildRunLedgerEntry(cwd, run)));
}

export async function readRun(cwd: string, runId: string): Promise<RunRecord> {
  const runFile = path.join(runDirForId(cwd, runId), "run.json");
  const raw = await fs.readFile(runFile, "utf8");
  return JSON.parse(raw) as RunRecord;
}
