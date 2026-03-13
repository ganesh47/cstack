import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("creates a completed run with artifact and session metadata", async () => {
    await runSpec(repoDir, "Draft the first vertical slice.");

    const runs = await listRuns(repoDir);
    expect(runs).toHaveLength(1);

    const run = await readRun(repoDir, runs[0]!.id);
    const finalBody = await fs.readFile(run.finalPath, "utf8");
    const artifactBody = await fs.readFile(path.join(path.dirname(run.finalPath), "artifacts", "spec.md"), "utf8");

    expect(run.status).toBe("completed");
    expect(run.codexVersion).toBe("fake-codex 0.0.1");
    expect(run.sessionId).toBe("fake-session-123");
    expect(run.codexCommand.some((part) => part.includes("fake-codex.mjs"))).toBe(true);
    expect(finalBody).toContain("Context included.");
    expect(artifactBody).toContain("Fake Spec");
  });
});
