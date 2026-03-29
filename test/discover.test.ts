import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { runRerun } from "../src/commands/rerun.js";
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
        "",
        "[workflows.discover.capabilities]",
        'allowed = ["shell", "web", "github"]',
        'defaultRequested = ["shell", "web"]',
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
    delete process.env.CSTACK_DISCOVER_NO_PROGRESS_TIMEOUT_SECONDS;
    delete process.env.FAKE_CODEX_DELAY_MS;
    delete process.env.FAKE_CODEX_DISCOVER_DELAY_MS;
    delete process.env.FAKE_CODEX_ACTIVITY_AFTER_SESSION;
    delete process.env.FAKE_CODEX_HANG_AFTER_SESSION_MS;
    delete process.env.FAKE_CODEX_PRINT_BODY;
    delete process.env.FAKE_CODEX_SKIP_FINAL_WRITE;
    delete process.env.FAKE_CODEX_EXIT_CODE;
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
      const capabilities = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "capabilities.json"), "utf8")) as {
        allowed: string[];
        requested: string[];
        available: string[];
        used: string[];
        downgraded: Array<{ name: string }>;
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
      expect(capabilities.allowed).toEqual(["shell", "web", "github"]);
      expect(capabilities.requested).toEqual(["shell", "web"]);
      expect(capabilities.available).toEqual(["shell", "web"]);
      expect(capabilities.used).toContain("shell");
      expect(capabilities.used).toContain("web");
      expect(capabilities.downgraded).toEqual([]);
      expect(repoResult.track).toBe("repo-explorer");
      expect(repoResult.leaderDisposition).toBe("accepted");
      expect(externalSources[0]?.location).toContain("https://example.com/docs");
      expect(consoleOutput).toContain("Session: fake-session-123");
    } finally {
      stdoutSpy.mockRestore();
    }
  }, 30_000);

  it("writes planning issue lineage artifacts for issue-linked discover runs", async () => {
    await runDiscover(repoDir, ["--issue", "123", "Map the repo constraints for the next slice."]);

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const lineage = JSON.parse(await fs.readFile(path.join(runDir, "artifacts", "issue-lineage.json"), "utf8")) as {
      planningIssueNumber: number;
      currentRun: { runId: string; workflow: string };
    };
    const contextBody = await fs.readFile(run.contextPath, "utf8");
    const researchPlan = JSON.parse(await fs.readFile(path.join(runDir, "stages", "discover", "research-plan.json"), "utf8")) as {
      planningIssueNumber?: number;
    };

    expect(run.inputs.planningIssueNumber).toBe(123);
    expect(lineage.planningIssueNumber).toBe(123);
    expect(lineage.currentRun.runId).toBe(run.id);
    expect(lineage.currentRun.workflow).toBe("discover");
    expect(contextBody).toContain("Planning issue: #123");
    expect(researchPlan.planningIssueNumber).toBe(123);
  });

  it("preserves planning issue linkage on discover rerun", async () => {
    await runDiscover(repoDir, ["--issue", "123", "Map the repo constraints for the next slice."]);
    const initialRuns = await listRuns(repoDir);
    const sourceRun = initialRuns.find((entry) => entry.workflow === "discover");

    const rerunId = await runRerun(repoDir, [sourceRun!.id]);
    const rerun = await readRun(repoDir, rerunId);

    expect(rerun.workflow).toBe("discover");
    expect(rerun.inputs.planningIssueNumber).toBe(123);
    const rerunLineage = JSON.parse(
      await fs.readFile(path.join(path.dirname(rerun.finalPath), "artifacts", "issue-lineage.json"), "utf8")
    ) as {
      planningIssueNumber: number;
    };
    expect(rerunLineage.planningIssueNumber).toBe(123);
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

  it("records downgraded web capability when discover policy disables web research", async () => {
    const configPath = path.join(repoDir, ".cstack", "config.toml");
    const existing = await fs.readFile(configPath, "utf8");
    await fs.writeFile(
      configPath,
      existing.replace('allowWeb = true', 'allowWeb = false'),
      "utf8"
    );

    await runDiscover(repoDir, "Map the repo constraints, official API docs, and security risks for the next slice.");

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const capabilities = JSON.parse(await fs.readFile(path.join(path.dirname(run.finalPath), "artifacts", "capabilities.json"), "utf8")) as {
      requested: string[];
      available: string[];
      downgraded: Array<{ name: string; reason: string }>;
    };

    expect(capabilities.requested).toContain("web");
    expect(capabilities.available).not.toContain("web");
    expect(capabilities.downgraded).toContainEqual({
      name: "web",
      reason: "disabled by discover research policy"
    });
  });

  it("uses bounded repo-explorer delegation for broad gap-remediation prompts", async () => {
    await runDiscover(repoDir, "What are the gaps in the current project and find them and fix them");

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const stageDir = path.join(path.dirname(run.finalPath), "stages", "discover");
    const researchPlan = JSON.parse(await fs.readFile(path.join(stageDir, "research-plan.json"), "utf8")) as {
      mode: string;
      tracks: Array<{ name: string; selected: boolean }>;
      limitations: string[];
    };

    expect(researchPlan.mode).toBe("research-team");
    expect(researchPlan.tracks.filter((track) => track.selected).map((track) => track.name)).toEqual(["repo-explorer"]);
    expect(researchPlan.limitations.join("\n")).not.toContain("repo-explorer track qualified");
    expect(await fs.readFile(path.join(stageDir, "delegates", "repo-explorer", "result.json"), "utf8")).toContain(
      "\"track\": \"repo-explorer\""
    );
  });

  it("fails cleanly when a delegated discover track times out before writing a final artifact", async () => {
    const configPath = path.join(repoDir, ".cstack", "config.toml");
    const existing = await fs.readFile(configPath, "utf8");
    await fs.writeFile(configPath, `${existing}\n[workflows.discover]\ntimeoutSeconds = 1\n`, "utf8");

    process.env.FAKE_CODEX_DELAY_MS = "1500";
    try {
      await expect(
        runDiscover(repoDir, "Map the repo constraints, official API docs, and security risks for the next slice.")
      ).rejects.toThrow(/discover research lead exited with code 124/);

      const runs = await listRuns(repoDir);
      const run = await readRun(repoDir, runs[0]!.id);
      expect(run.status).toBe("failed");
      expect(run.error).toContain("code 124");
    } finally {
      delete process.env.FAKE_CODEX_DELAY_MS;
    }
  }, 15_000);

  it("recovers a partial discover artifact from structured stdout when Codex exits non-zero", async () => {
    process.env.FAKE_CODEX_PRINT_BODY = "1";
    process.env.FAKE_CODEX_SKIP_FINAL_WRITE = "1";
    process.env.FAKE_CODEX_EXIT_CODE = "1";

    await runDiscover(repoDir, "Map the repo constraints for the next slice.");

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const stageDir = path.join(runDir, "stages", "discover");
    const findings = await fs.readFile(path.join(runDir, "artifacts", "findings.md"), "utf8");
    const discoveryReport = await fs.readFile(path.join(stageDir, "artifacts", "discovery-report.md"), "utf8");
    const researchPlan = JSON.parse(await fs.readFile(path.join(stageDir, "research-plan.json"), "utf8")) as {
      mode: string;
      tracks: Array<{ name: string; selected: boolean }>;
      limitations: string[];
    };

    expect(run.status).toBe("completed");
    expect(run.lastActivity).toContain("partial artifact");
    expect(run.inputs.delegatedTracks).toEqual([]);
    expect(findings).toContain("Research Lead synthesis complete.");
    expect(discoveryReport).toContain("Research Lead synthesis complete.");
    expect(researchPlan.mode).toBe("single-agent");
    expect(researchPlan.tracks.every((track) => !track.selected)).toBe(true);
    await expect(fs.access(path.join(stageDir, "delegates", "repo-explorer", "result.json"))).rejects.toThrow();
  }, 15_000);

  it("recovers bounded heuristic findings when a broad discover run stalls after initial activity", async () => {
    await fs.mkdir(path.join(repoDir, "docker", "api"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "specs", "001-plan-alignment"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "docker", "README.md"),
      [
        "# Docker Artifacts",
        "",
        "Use `docker compose -f docker/api/compose.yml up -d` and then `curl http://localhost:8080/health/ready` for a local smoke test."
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(repoDir, "docker", "api", "compose.yml"),
      [
        "services:",
        "  api:",
        "    command: [\"bash\", \"-lc\", \"echo 'Run pnpm start once Fastify server exists' && tail -f /dev/null\"]"
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(repoDir, "docker", "compose.stack.yml"),
      [
        "services:",
        "  cli:",
        "    command: [\"bash\", \"-lc\", \"echo 'CLI placeholder – ingest logic to be added later' && tail -f /dev/null\"]"
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(repoDir, "specs", "001-plan-alignment", "quickstart.md"),
      "# Quickstart\n\nFollow the documented build -> test -> sign -> push flow.\n",
      "utf8"
    );

    process.env.CSTACK_DISCOVER_NO_PROGRESS_TIMEOUT_SECONDS = "1";
    process.env.FAKE_CODEX_ACTIVITY_AFTER_SESSION = "1";
    process.env.FAKE_CODEX_HANG_AFTER_SESSION_MS = "2500";

    await runDiscover(repoDir, "What are the gaps in the current project and find them and fix them");

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const findings = await fs.readFile(path.join(runDir, "artifacts", "findings.md"), "utf8");
    const discoveryReport = await fs.readFile(path.join(runDir, "stages", "discover", "artifacts", "discovery-report.md"), "utf8");

    expect(run.status).toBe("completed");
    expect(run.lastActivity).toContain("partial artifact");
    expect(findings).toContain("Docker delivery artifacts drift from the documented runnable flow");
    expect(findings).toContain("recovered this bounded fallback from representative repo files");
    expect(discoveryReport).toContain("placeholder commands");
  }, 15_000);

  it("respects a shared discover budget instead of giving every delegated track the full timeout", async () => {
    const configPath = path.join(repoDir, ".cstack", "config.toml");
    const existing = await fs.readFile(configPath, "utf8");
    await fs.writeFile(configPath, `${existing}\n[workflows.discover]\ntimeoutSeconds = 2\n`, "utf8");

    process.env.FAKE_CODEX_DISCOVER_DELAY_MS = "1200";
    const startedAt = Date.now();
    await expect(
      runDiscover(repoDir, "Map the repo constraints, official API docs, and security risks for the next slice.")
    ).rejects.toThrow(/code 124/);
    const elapsedMs = Date.now() - startedAt;

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const stageDir = path.join(path.dirname(run.finalPath), "stages", "discover");
    const repoResult = JSON.parse(
      await fs.readFile(path.join(stageDir, "delegates", "repo-explorer", "result.json"), "utf8")
    ) as { notes?: string };

    expect(elapsedMs).toBeLessThan(5_000);
    expect(run.status).toBe("failed");
    expect(repoResult.notes).toContain("did not produce structured findings");
  }, 15_000);
});
