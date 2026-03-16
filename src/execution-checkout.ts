import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import type { ExecutionCheckoutKind, ExecutionContextRecord } from "./types.js";

export interface PreparedExecutionCheckout {
  executionCwd: string;
  record: ExecutionContextRecord;
}

const execFileAsync = promisify(execFile);
const GIT_STATUS_PORCELAIN_ARGS = ["status", "--porcelain", "--untracked-files=all"] as const;
const INTERNAL_RUN_ARTIFACT_PREFIX = ".cstack/runs/";

function isInternalRunArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  return normalized === ".cstack/runs" || normalized.startsWith(INTERNAL_RUN_ARTIFACT_PREFIX);
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

async function tryRunGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await runGit(cwd, args);
  } catch {
    return null;
  }
}

async function listDirtyFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", [...GIT_STATUS_PORCELAIN_ARGS], { cwd });
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
      .filter((filePath) => !isInternalRunArtifactPath(filePath));
  } catch {
    return [];
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyGitIdentity(sourceCwd: string, targetCwd: string): Promise<void> {
  const name = await tryRunGit(sourceCwd, ["config", "--get", "user.name"]);
  const email = await tryRunGit(sourceCwd, ["config", "--get", "user.email"]);
  if (name) {
    await execFileAsync("git", ["config", "user.name", name], { cwd: targetCwd });
  }
  if (email) {
    await execFileAsync("git", ["config", "user.email", email], { cwd: targetCwd });
  }
}

async function copyLocalTestFixtures(sourceCwd: string, targetCwd: string): Promise<void> {
  const fixtureNames = ["test-gh.json"] as const;
  for (const fixtureName of fixtureNames) {
    const sourcePath = path.join(sourceCwd, ".cstack", fixtureName);
    const targetPath = path.join(targetCwd, ".cstack", fixtureName);
    try {
      const body = await fs.readFile(sourcePath, "utf8");
      await ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, body, "utf8");
    } catch {
      continue;
    }
  }
}

function executionRoot(runId: string): string {
  return path.join(os.tmpdir(), "cstack-execution", runId);
}

function forceCloneFallback(): boolean {
  return process.env.CSTACK_FORCE_CLONE_FALLBACK === "1";
}

async function detectSourceSnapshot(sourceCwd: string): Promise<ExecutionContextRecord["source"]> {
  const [branch, commit, dirtyFiles] = await Promise.all([
    tryRunGit(sourceCwd, ["branch", "--show-current"]),
    runGit(sourceCwd, ["rev-parse", "HEAD"]),
    listDirtyFiles(sourceCwd)
  ]);

  return {
    cwd: sourceCwd,
    branch: branch || "detached",
    commit,
    dirtyFiles,
    localChangesIgnored: dirtyFiles.length > 0
  };
}

async function prepareGitWorktree(sourceCwd: string, checkoutPath: string, commit: string): Promise<void> {
  await execFileAsync("git", ["worktree", "add", "--detach", checkoutPath, commit], {
    cwd: sourceCwd,
    maxBuffer: 10 * 1024 * 1024
  });
  await copyLocalTestFixtures(sourceCwd, checkoutPath);
}

async function prepareTempClone(sourceCwd: string, checkoutPath: string, commit: string): Promise<void> {
  const remoteUrl = await tryRunGit(sourceCwd, ["remote", "get-url", "origin"]);
  if (!remoteUrl) {
    throw new Error("No origin remote is configured for clone fallback.");
  }

  await execFileAsync("git", ["clone", "--no-checkout", remoteUrl, checkoutPath], {
    cwd: sourceCwd,
    maxBuffer: 10 * 1024 * 1024
  });
  await copyGitIdentity(sourceCwd, checkoutPath);
  await execFileAsync("git", ["checkout", "--detach", commit], {
    cwd: checkoutPath,
    maxBuffer: 10 * 1024 * 1024
  });
  await copyLocalTestFixtures(sourceCwd, checkoutPath);
}

async function detectExecutionMetadata(
  kind: ExecutionCheckoutKind,
  executionCwd: string,
  notes: string[]
): Promise<ExecutionContextRecord["execution"]> {
  const [branch, commit] = await Promise.all([
    tryRunGit(executionCwd, ["branch", "--show-current"]),
    runGit(executionCwd, ["rev-parse", "HEAD"])
  ]);

  return {
    kind,
    cwd: executionCwd,
    branch: branch || "detached",
    commit,
    isolated: kind !== "source",
    notes
  };
}

export async function prepareExecutionCheckout(options: {
  sourceCwd: string;
  runId: string;
  workflow: "build" | "deliver";
  allowDirtySourceExecution?: boolean;
}): Promise<PreparedExecutionCheckout> {
  const source = await detectSourceSnapshot(options.sourceCwd);

  if (options.allowDirtySourceExecution) {
    return {
      executionCwd: options.sourceCwd,
      record: {
        workflow: options.workflow,
        preparedAt: new Date().toISOString(),
        source,
        execution: {
          kind: "source",
          cwd: options.sourceCwd,
          branch: source.branch,
          commit: source.commit,
          isolated: false,
          notes: source.dirtyFiles.length > 0 ? ["Dirty source execution was explicitly allowed."] : []
        },
        cleanup: {
          policy: "retain",
          status: "not-needed"
        }
      }
    };
  }

  const checkoutPath = executionRoot(options.runId);
  await fs.rm(checkoutPath, { recursive: true, force: true });
  await ensureDir(path.dirname(checkoutPath));

  const notes: string[] = [];
  let kind: ExecutionCheckoutKind = "git-worktree";

  try {
    if (forceCloneFallback()) {
      throw new Error("Forced clone fallback via CSTACK_FORCE_CLONE_FALLBACK.");
    }
    await prepareGitWorktree(options.sourceCwd, checkoutPath, source.commit);
    notes.push("Prepared isolated execution checkout via git worktree from source HEAD.");
  } catch (worktreeError) {
    kind = "temp-clone";
    notes.push(
      `git worktree add failed, falling back to temporary clone: ${worktreeError instanceof Error ? worktreeError.message : String(worktreeError)}`
    );
    await fs.rm(checkoutPath, { recursive: true, force: true });
    await prepareTempClone(options.sourceCwd, checkoutPath, source.commit);
    notes.push("Prepared isolated execution checkout via temporary clone from origin.");
  }

  const execution = await detectExecutionMetadata(kind, checkoutPath, notes);
  return {
    executionCwd: checkoutPath,
    record: {
      workflow: options.workflow,
      preparedAt: new Date().toISOString(),
      source,
      execution,
      cleanup: {
        policy: "retain",
        status: "retained"
      }
    }
  };
}

export async function writeExecutionContext(filePath: string, record: ExecutionContextRecord): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}
