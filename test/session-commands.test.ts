import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { promisify } from "node:util";
import { runFork } from "../src/commands/fork.js";
import { runResume } from "../src/commands/resume.js";
import { runRerun } from "../src/commands/rerun.js";
import { listRuns, readRun } from "../src/run.js";
import type { RunRecord } from "../src/types.js";

const execFileAsync = promisify(execFile);

async function initGitRepo(repoDir: string): Promise<string> {
  const remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-session-remote-"));
  await execFileAsync("git", ["init", "--bare", remoteDir]);
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.name", "cstack test"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.email", "cstack-test@example.com"], { cwd: repoDir });
  await execFileAsync("git", ["config", "commit.gpgSign", "false"], { cwd: repoDir });
  await execFileAsync("git", ["config", "tag.gpgSign", "false"], { cwd: repoDir });
  await execFileAsync("git", ["remote", "add", "origin", remoteDir], { cwd: repoDir });
  await execFileAsync("git", ["add", "."], { cwd: repoDir });
  await execFileAsync("git", ["-c", "commit.gpgSign=false", "commit", "-m", "fixture"], { cwd: repoDir });
  await execFileAsync("git", ["push", "-u", "origin", "main"], { cwd: repoDir });
  return remoteDir;
}

async function seedBuildRun(repoDir: string): Promise<string> {
  const runId = "2026-03-14T11-00-00-build-billing-cleanup";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "build",
    createdAt: "2026-03-14T11:00:00.000Z",
    updatedAt: "2026-03-14T11:00:10.000Z",
    status: "completed",
    cwd: repoDir,
    gitBranch: "main",
    codexVersion: "fake",
    codexCommand: ["codex", "exec"],
    promptPath: path.join(runDir, "prompt.md"),
    finalPath: path.join(runDir, "final.md"),
    contextPath: path.join(runDir, "context.md"),
    stdoutPath: path.join(runDir, "stdout.log"),
    stderrPath: path.join(runDir, "stderr.log"),
    configSources: [],
    sessionId: "fake-session-123",
    summary: "Implement billing cleanup",
    inputs: {
      userPrompt: "Implement billing cleanup",
      requestedMode: "exec",
      observedMode: "exec"
    }
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Build Summary\n\nImplemented billing cleanup.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "change-summary.md"), "# Build Summary\n\nImplemented billing cleanup.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "verification.json"), `${JSON.stringify({
    status: "passed",
    requestedCommands: ["npm test"],
    results: []
  }, null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(runDir, "session.json"),
    `${JSON.stringify(
      {
        workflow: "build",
        requestedMode: "exec",
        mode: "exec",
        startedAt: "2026-03-14T11:00:00.000Z",
        endedAt: "2026-03-14T11:00:10.000Z",
        sessionId: "fake-session-123",
        codexCommand: ["codex", "exec"],
        resumeCommand: "codex resume fake-session-123",
        forkCommand: "codex fork fake-session-123",
        observability: {
          sessionIdObserved: true,
          transcriptObserved: false,
          finalArtifactObserved: true
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return runId;
}

describe("session support commands", () => {
  let repoDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-session-"));
    const fakeCodexPath = path.resolve("test/fixtures/fake-codex.mjs");
    chmodSync(fakeCodexPath, 0o755);

    await fs.mkdir(path.join(repoDir, ".cstack", "prompts"), { recursive: true });
    await fs.mkdir(path.join(repoDir, ".cstack", "runs"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "specs"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "research"), { recursive: true });

    await fs.writeFile(
      path.join(repoDir, ".cstack", "config.toml"),
      [
        "[codex]",
        `command = "${fakeCodexPath.replaceAll("\\", "\\\\")}"`,
        'sandbox = "workspace-write"',
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "build.md"), "# test build prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# repo spec\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"), "# repo research\n", "utf8");
    remoteDir = await initGitRepo(repoDir);
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
    if (remoteDir) {
      await fs.rm(remoteDir, { recursive: true, force: true });
    }
  });

  it("resolves a run id to codex resume", async () => {
    const runId = await seedBuildRun(repoDir);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await runResume(repoDir, [runId]);
      expect(stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("resumed session fake-session-123");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("records observed fork session metadata", async () => {
    const runId = await seedBuildRun(repoDir);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await runFork(repoDir, [runId, "--workflow", "build"]);
      const session = JSON.parse(await fs.readFile(path.join(repoDir, ".cstack", "runs", runId, "session.json"), "utf8")) as {
        childSessionId?: string;
        childWorkflow?: string;
      };

      expect(session.childSessionId).toBe("fake-fork-session-789");
      expect(session.childWorkflow).toBe("build");
      expect(stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("forked session fake-session-123");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("creates a fresh rerun and records source lineage", async () => {
    const runId = await seedBuildRun(repoDir);

    const rerunId = await runRerun(repoDir, [runId]);
    const rerun = await readRun(repoDir, rerunId);

    expect(rerun.workflow).toBe("build");
    expect(rerun.rerunOfRunId).toBe(runId);
    await expect(fs.access(path.join(repoDir, ".cstack", "runs", rerunId, "artifacts", "rerun.json"))).resolves.toBeUndefined();

    const runs = await listRuns(repoDir);
    expect(runs.filter((run) => run.workflow === "build")).toHaveLength(2);
  });
});
