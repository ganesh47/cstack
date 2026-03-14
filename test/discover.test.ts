import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
        "maxAgents = 3",
        "",
        "[workflows.discover.research]",
        "enabled = true",
        "allowWeb = true",
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

  it("creates a completed discover run with research artifacts", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runDiscover(repoDir, "Map the repo constraints, official API docs, and security risks for the next slice.");

      const runs = await listRuns(repoDir);
      expect(runs).toHaveLength(1);

      const run = await readRun(repoDir, runs[0]!.id);
      const runDir = path.dirname(run.finalPath);
      const stageDir = path.join(runDir, "stages", "discover");
      const finalBody = await fs.readFile(run.finalPath, "utf8");
      const artifactBody = await fs.readFile(path.join(runDir, "artifacts", "findings.md"), "utf8");
      const discoveryReport = await fs.readFile(path.join(stageDir, "artifacts", "discovery-report.md"), "utf8");
      const contextBody = await fs.readFile(run.contextPath, "utf8");
      const eventsBody = await fs.readFile(run.eventsPath!, "utf8");
      const researchPlan = JSON.parse(await fs.readFile(path.join(stageDir, "research-plan.json"), "utf8")) as {
        mode: string;
        tracks: Array<{ name: string; selected: boolean }>;
      };
      const repoResult = JSON.parse(
        await fs.readFile(path.join(stageDir, "delegates", "repo-explorer", "result.json"), "utf8")
      ) as { track: string; leaderDisposition: string };
      const externalSources = JSON.parse(
        await fs.readFile(path.join(stageDir, "delegates", "external-researcher", "sources.json"), "utf8")
      ) as Array<{ location: string }>;
      const consoleOutput = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(run.workflow).toBe("discover");
      expect(run.status).toBe("completed");
      expect(contextBody).toContain("Role: Research Lead");
      expect(contextBody).toContain("Web research allowed: yes");
      expect(finalBody).toContain("Research Lead synthesis complete.");
      expect(artifactBody).toContain("Research Lead synthesis complete.");
      expect(discoveryReport).toContain("Research Lead synthesis complete.");
      expect(eventsBody).toContain("Running discover track repo-explorer");
      expect(eventsBody).toContain("Discover run completed");
      expect(researchPlan.mode).toBe("research-team");
      expect(researchPlan.tracks.filter((track) => track.selected).map((track) => track.name)).toEqual([
        "repo-explorer",
        "risk-researcher",
        "external-researcher"
      ]);
      expect(repoResult.track).toBe("repo-explorer");
      expect(repoResult.leaderDisposition).toBe("accepted");
      expect(externalSources[0]?.location).toContain("https://example.com/docs");
      expect(consoleOutput).toContain("Session: fake-session-123");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("suppresses discover delegation for a small local prompt", async () => {
    await runDiscover(repoDir, "Rename one helper.");

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const stageDir = path.join(runDir, "stages", "discover");
    const researchPlan = JSON.parse(await fs.readFile(path.join(stageDir, "research-plan.json"), "utf8")) as {
      mode: string;
      tracks: Array<{ name: string; selected: boolean }>;
      limitations: string[];
    };

    expect(researchPlan.mode).toBe("single-agent");
    expect(researchPlan.tracks.some((track) => track.selected)).toBe(false);
    expect(researchPlan.limitations[0]).toContain("suppressed");
    await expect(fs.access(path.join(stageDir, "delegates", "repo-explorer", "result.json"))).rejects.toThrow();
  });
});
