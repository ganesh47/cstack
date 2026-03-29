import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { prepareExecutionCheckout, writeExecutionContext } from "../src/execution-checkout.js";
import type { ExecutionContextRecord } from "../src/types.js";

const execFileAsync = promisify(execFile);

type CheckoutInfo = Awaited<ReturnType<typeof prepareExecutionCheckout>>;

function runId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function initGitRepo(repoDir: string): Promise<string> {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.name", "cstack test"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.email", "cstack-test@example.com"], { cwd: repoDir });
  await execFileAsync("git", ["config", "commit.gpgSign", "false"], { cwd: repoDir });
  await fs.writeFile(path.join(repoDir, "package.json"), `${JSON.stringify({ name: "cstack" }, null, 2)}\n`, "utf8");
  await execFileAsync("git", ["add", "package.json"], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", "initial commit"], { cwd: repoDir });
  return repoDir;
}

describe("execution checkout", () => {
  let sourceDir: string;
  let remoteDir: string;
  let cleanupRoots: string[] = [];

  beforeEach(async () => {
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-exec-src-"));
    remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-exec-remote-"));
    await initGitRepo(sourceDir);
  });

  afterEach(async () => {
    await Promise.all([fs.rm(sourceDir, { recursive: true, force: true }), fs.rm(remoteDir, { recursive: true, force: true }),
      ...cleanupRoots.map((root) => fs.rm(root, { recursive: true, force: true }))
    ]);
    cleanupRoots = [];
    delete process.env.CSTACK_FORCE_CLONE_FALLBACK;
  });

  it("returns source execution when explicitly allowed", async () => {
    const dirtyPath = path.join(sourceDir, "notes.txt");
    await fs.writeFile(dirtyPath, "local dirty file", "utf8");

    const result = await prepareExecutionCheckout({
      sourceCwd: sourceDir,
      runId: runId("source"),
      workflow: "build",
      allowDirtySourceExecution: true
    });

    expect(result.executionCwd).toBe(sourceDir);
    expect(result.record.execution.kind).toBe("source");
    expect(result.record.execution.notes).toEqual(["Dirty source execution was explicitly allowed."]);
    expect(result.record.source.localChangesIgnored).toBe(true);
  });

  it("prepares an isolated git worktree checkout by default", async () => {
    const id = runId("git-worktree");
    const checkoutRoot = path.join(os.tmpdir(), "cstack-execution", id);
    cleanupRoots.push(checkoutRoot);

    const result: CheckoutInfo = await prepareExecutionCheckout({
      sourceCwd: sourceDir,
      runId: id,
      workflow: "build"
    });

    expect(result.record.execution.kind).toBe("git-worktree");
    expect(result.record.execution.cwd).toBe(checkoutRoot);
    expect(result.record.execution.notes).toEqual(["Prepared isolated execution checkout via git worktree from source HEAD."]);
    await expect(fs.access(checkoutRoot)).resolves.toBeUndefined();
    expect(result.record.cleanup.status).toBe("retained");
  });

  it("copies local test fixtures into isolated execution checkouts", async () => {
    const id = runId("fixtures");
    const checkoutRoot = path.join(os.tmpdir(), "cstack-execution", id);
    cleanupRoots.push(checkoutRoot);

    await fs.mkdir(path.join(sourceDir, ".cstack"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, ".cstack", "test-gh.json"), '{"fixture":"gh"}\n', "utf8");
    await fs.writeFile(path.join(sourceDir, ".cstack", "test-codex.json"), '{"fixture":"codex"}\n', "utf8");

    await prepareExecutionCheckout({
      sourceCwd: sourceDir,
      runId: id,
      workflow: "deliver"
    });

    await expect(fs.readFile(path.join(checkoutRoot, ".cstack", "test-gh.json"), "utf8")).resolves.toContain('"fixture":"gh"');
    await expect(fs.readFile(path.join(checkoutRoot, ".cstack", "test-codex.json"), "utf8")).resolves.toContain('"fixture":"codex"');
  });

  it("falls back to temporary clone when worktree execution is forced", async () => {
    const id = runId("temp-clone");
    const checkoutRoot = path.join(os.tmpdir(), "cstack-execution", id);
    cleanupRoots.push(checkoutRoot);

    await execFileAsync("git", ["init", "--bare"], { cwd: remoteDir });
    await execFileAsync("git", ["remote", "add", "origin", remoteDir], { cwd: sourceDir });
    await execFileAsync("git", ["push", "-u", "origin", "main"], { cwd: sourceDir });

    process.env.CSTACK_FORCE_CLONE_FALLBACK = "1";

    const result = await prepareExecutionCheckout({
      sourceCwd: sourceDir,
      runId: id,
      workflow: "build"
    });

    expect(result.record.execution.kind).toBe("temp-clone");
    expect(result.record.execution.cwd).toBe(checkoutRoot);
    expect(result.record.execution.notes[0]).toMatch(/git worktree add failed/);
    expect(result.record.execution.notes[1]).toMatch(/Prepared isolated execution checkout via temporary clone from origin/);
    await expect(fs.access(checkoutRoot)).resolves.toBeUndefined();
  });

  it("writes execution context records", async () => {
    const record: ExecutionContextRecord = {
      workflow: "build",
      preparedAt: new Date().toISOString(),
      source: {
        cwd: sourceDir,
        branch: "main",
        commit: "abc",
        dirtyFiles: ["one.txt", "two.txt"],
        localChangesIgnored: false
      },
      execution: {
        kind: "source",
        cwd: sourceDir,
        branch: "main",
        commit: "abc",
        isolated: false,
        notes: ["test"]
      },
      cleanup: {
        policy: "retain",
        status: "not-needed"
      }
    };

    const outputPath = path.join(sourceDir, "execution-context.json");
    await writeExecutionContext(outputPath, record);

    const body = await fs.readFile(outputPath, "utf8");
    expect(body).toContain('"workflow": "build"');
    expect(body.endsWith("\n")).toBe(true);
    expect(JSON.parse(body)).toEqual(record);
  });
});
