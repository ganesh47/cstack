import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { chmodSync } from "node:fs";
import { promisify } from "node:util";
import { runLoop } from "../src/commands/loop.js";

const execFileAsync = promisify(execFile);

async function initGitRepo(repoDir: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.name", "cstack test"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.email", "cstack-test@example.com"], { cwd: repoDir });
  await execFileAsync("git", ["add", "."], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: repoDir });
}

describe("runLoop", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-loop-"));
    const fakeCodexPath = path.resolve("test/fixtures/fake-codex.mjs");
    chmodSync(fakeCodexPath, 0o755);

    await fs.mkdir(path.join(repoDir, ".cstack", "prompts"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "specs"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "research"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, ".cstack", "config.toml"),
      [
        "[codex]",
        `command = "${fakeCodexPath.replaceAll("\\", "\\\\")}"`,
        'sandbox = "workspace-write"',
        "",
        "[workflows.deliver]",
        "allowDirty = false",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "spec.md"), "# test prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "discover.md"), "# test discover prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "build.md"), "# test build prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "deliver.md"), "# test deliver prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# repo spec\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"), "# repo research\n", "utf8");
    await initGitRepo(repoDir);
  });

  afterEach(async () => {
    delete process.env.FAKE_CODEX_FAIL_BUILD;
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("writes loop trace artifacts when retries fail", async () => {
    process.env.FAKE_CODEX_FAIL_BUILD = "1";

    await expect(
      runLoop(repoDir, [
        "--iterations",
        "2",
        "What are the gaps in this project? Can you work on closing the gaps?"
      ])
    ).rejects.toThrow("cstack loop did not reach a successful completed intent run");

    const loopRoot = path.join(repoDir, ".cstack", "loops");
    const loopIds = await fs.readdir(loopRoot);
    expect(loopIds.length).toBe(1);
    const loopDir = path.join(loopRoot, loopIds[0]!);
    const benchmarkOutcome = JSON.parse(await fs.readFile(path.join(loopDir, "benchmark-outcome.json"), "utf8")) as {
      iterationsCompleted: number;
      latestRunId: string;
      status: string;
      iterations: Array<{ iteration: number; status: string; specialists: string[] }>;
    };
    const cycleRecord = JSON.parse(await fs.readFile(path.join(loopDir, "cycle-record.json"), "utf8")) as {
      primaryBlockerCluster: string | null;
      iterationsCompleted: number;
    };
    const backtrackDecision = JSON.parse(await fs.readFile(path.join(loopDir, "backtrack-decision.json"), "utf8")) as {
      specialists: string[];
      summary: string;
    };

    expect(benchmarkOutcome.iterationsCompleted).toBe(2);
    expect(benchmarkOutcome.status).toBe("failed");
    expect(benchmarkOutcome.iterations).toHaveLength(2);
    expect(cycleRecord.iterationsCompleted).toBe(2);
    expect(cycleRecord.primaryBlockerCluster).toBeTruthy();
    expect(backtrackDecision.summary).toContain("Target cluster:");
  }, 120_000);
});
