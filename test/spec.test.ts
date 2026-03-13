import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { runSpec } from "../src/commands/spec.js";
import { listRuns, readRun } from "../src/run.js";

describe("runSpec", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-spec-"));
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
        "[workflows.spec.delegation]",
        "enabled = false",
        "maxAgents = 0",
        ""
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "spec.md"), "# test prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# repo spec\n", "utf8");
    await fs.writeFile(
      path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"),
      "# repo research\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("creates a completed run with artifact, progress events, and session metadata", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runSpec(repoDir, "Draft the first vertical slice.");

      const runs = await listRuns(repoDir);
      expect(runs).toHaveLength(1);

      const run = await readRun(repoDir, runs[0]!.id);
      const finalBody = await fs.readFile(run.finalPath, "utf8");
      const artifactBody = await fs.readFile(path.join(path.dirname(run.finalPath), "artifacts", "spec.md"), "utf8");
      const eventsBody = await fs.readFile(run.eventsPath!, "utf8");
      const consoleOutput = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(run.status).toBe("completed");
      expect([null, "fake-codex 0.0.1"]).toContain(run.codexVersion);
      expect([undefined, "fake-session-123"]).toContain(run.sessionId);
      expect(run.codexCommand.some((part) => part.includes("fake-codex.mjs"))).toBe(true);
      expect(run.lastActivity).toBe("Exit code 0");
      expect(finalBody).toContain("fake Codex response");
      expect(artifactBody).toContain("Fake Spec");
      expect(eventsBody).toContain("\"type\":\"starting\"");
      expect(eventsBody).toContain("scanning repository context");
      expect(eventsBody).toContain("\"type\":\"completed\"");
      expect(consoleOutput).toContain("Starting Codex run");
      expect(consoleOutput).toContain("Activity (stdout): scanning repository context");
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
