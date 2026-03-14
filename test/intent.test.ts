import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { inferRoutingPlan, runIntent } from "../src/intent.js";
import { listRuns, readRun } from "../src/run.js";
import type { RoutingPlan, StageLineage } from "../src/types.js";

describe("intent router", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-intent-"));
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

    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "spec.md"), "# test prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "discover.md"), "# test discover prompt asset\n", "utf8");
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

  it("infers staged execution and specialists from intent", () => {
    const plan = inferRoutingPlan("Introduce SSO with audit logging and hardened release checks", "bare");
    expect(plan.stages.map((stage) => stage.name)).toEqual(["discover", "spec", "build", "review", "ship"]);
    expect(plan.specialists.filter((specialist) => specialist.selected).map((specialist) => specialist.name)).toEqual([
      "security-review",
      "audit-review",
      "release-pipeline-review"
    ]);
  });

  it("creates an intent run with routing artifacts, executed stages, and specialist outputs", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runIntent(repoDir, "Introduce SSO with audit logging and hardened release checks", {
        entrypoint: "bare",
        dryRun: false
      });

      const runs = await listRuns(repoDir);
      expect(runs).toHaveLength(1);

      const run = await readRun(repoDir, runs[0]!.id);
      const runDir = path.dirname(run.finalPath);
      const routingPlan = JSON.parse(await fs.readFile(path.join(runDir, "routing-plan.json"), "utf8")) as RoutingPlan;
      const lineage = JSON.parse(await fs.readFile(path.join(runDir, "stage-lineage.json"), "utf8")) as StageLineage;
      const discoverResearchPlan = JSON.parse(
        await fs.readFile(path.join(runDir, "stages", "discover", "research-plan.json"), "utf8")
      ) as { mode: string; tracks: Array<{ name: string; selected: boolean }> };
      const finalBody = await fs.readFile(run.finalPath, "utf8");

      expect(run.workflow).toBe("intent");
      expect(run.status).toBe("completed");
      expect(routingPlan.stages.map((stage) => stage.name)).toEqual(["discover", "spec", "build", "review", "ship"]);
      expect(lineage.stages.find((stage) => stage.name === "discover")?.status).toBe("completed");
      expect(lineage.stages.find((stage) => stage.name === "spec")?.status).toBe("completed");
      expect(lineage.stages.find((stage) => stage.name === "build")?.status).toBe("deferred");
      expect(lineage.specialists).toHaveLength(3);
      expect(lineage.specialists.every((specialist) => specialist.disposition === "accepted")).toBe(true);
      expect(discoverResearchPlan.mode).toBe("research-team");
      expect(discoverResearchPlan.tracks.filter((track) => track.selected).map((track) => track.name)).toEqual([
        "repo-explorer",
        "risk-researcher",
        "external-researcher"
      ]);
      expect(await fs.readFile(path.join(runDir, "stages", "discover", "artifacts", "findings.md"), "utf8")).toContain(
        "Research Lead synthesis complete."
      );
      expect(await fs.readFile(path.join(runDir, "stages", "discover", "artifacts", "discovery-report.md"), "utf8")).toContain(
        "Research Lead synthesis complete."
      );
      expect(await fs.readFile(path.join(runDir, "stages", "discover", "delegates", "risk-researcher", "result.json"), "utf8")).toContain(
        "\"track\": \"risk-researcher\""
      );
      expect(await fs.readFile(path.join(runDir, "stages", "spec", "artifacts", "spec.md"), "utf8")).toContain("Fake Spec");
      expect(await fs.readFile(path.join(runDir, "delegates", "security-review", "result.json"), "utf8")).toContain(
        "\"disposition\": \"accepted\""
      );
      expect(finalBody).toContain("Stage status");
      expect(finalBody).toContain("Specialist status");
      expect(stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("Inferred stages:");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("supports dry-run routing without executing stages", async () => {
    await runIntent(repoDir, "Plan a compliance-safe billing migration", {
      entrypoint: "run",
      dryRun: true
    });

    const runs = await listRuns(repoDir);
    const run = await readRun(repoDir, runs[0]!.id);
    const runDir = path.dirname(run.finalPath);
    const lineage = JSON.parse(await fs.readFile(path.join(runDir, "stage-lineage.json"), "utf8")) as StageLineage;

    expect(run.workflow).toBe("intent");
    expect(run.status).toBe("completed");
    expect(lineage.stages.every((stage) => stage.status === "skipped")).toBe(true);
    await expect(fs.access(path.join(runDir, "stages", "discover"))).rejects.toThrow();
  });
});
