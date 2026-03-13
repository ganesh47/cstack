import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runsRoot } from "./paths.js";
import type { RunRecord, WorkflowName } from "./types.js";

const execFileAsync = promisify(execFile);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "run";
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
    const { stdout } = await execFileAsync(codexCommand, ["--version"], { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function writeRunRecord(runDir: string, run: RunRecord): Promise<void> {
  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
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

export async function readRun(cwd: string, runId: string): Promise<RunRecord> {
  const runFile = path.join(runsRoot(cwd), runId, "run.json");
  const raw = await fs.readFile(runFile, "utf8");
  return JSON.parse(raw) as RunRecord;
}
