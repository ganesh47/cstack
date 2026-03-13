import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { runDiscover } from "../src/commands/discover.js";
import { listRuns, readRun } from "../src/run.js";

describe("runDiscover", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-discover-"));
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
        "[workflows.discover.delegation]",
        "enabled = true",
        "maxAgents = 2",
        ""
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      path.join(repoDir, ".cstack", "prompts", "discover.md"),
      "# test discover prompt asset\n",
      "utf8"
    );
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

  it("creates a completed discover run with findings artifact", async () => {
    await runDiscover(repoDir, "Map the repo constraints for the next slice.");

    const runs = await listRuns(repoDir);
    expect(runs).toHaveLength(1);

    const run = await readRun(repoDir, runs[0]!.id);
    const finalBody = await fs.readFile(run.finalPath, "utf8");
    const artifactBody = await fs.readFile(path.join(path.dirname(run.finalPath), "artifacts", "findings.md"), "utf8");
    const contextBody = await fs.readFile(run.contextPath, "utf8");

    expect(run.workflow).toBe("discover");
    expect(run.status).toBe("completed");
    expect(contextBody).toContain("Delegation enabled: yes");
    expect(contextBody).toContain("Delegation max agents: 2");
    expect(finalBody).toContain("fake Codex response");
    expect(artifactBody).toContain("Fake Spec");
  });
});
