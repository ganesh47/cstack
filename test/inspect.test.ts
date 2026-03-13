import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runInspect } from "../src/commands/inspect.js";
import { handleInspectorCommand, loadRunInspection, runInteractiveInspector } from "../src/inspector.js";
import type { RoutingPlan, RunEvent, RunRecord, StageLineage } from "../src/types.js";

async function seedIntentRun(repoDir: string): Promise<string> {
  const runId = "2026-03-13T18-20-00-intent-sso-audit";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(runDir, "delegates", "audit-review"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "intent",
    createdAt: "2026-03-13T18:20:00.000Z",
    updatedAt: "2026-03-13T18:20:20.000Z",
    status: "completed",
    cwd: repoDir,
    gitBranch: "main",
    codexVersion: "fake",
    codexCommand: ["codex", "exec"],
    promptPath: path.join(runDir, "prompt.md"),
    finalPath: path.join(runDir, "final.md"),
    contextPath: path.join(runDir, "context.md"),
    eventsPath: path.join(runDir, "events.jsonl"),
    stdoutPath: path.join(runDir, "stdout.log"),
    stderrPath: path.join(runDir, "stderr.log"),
    configSources: [],
    sessionId: "fake-session-123",
    lastActivity: "Intent run completed",
    summary: "Add SSO with audit logging",
    inputs: {
      userPrompt: "Add SSO with audit logging",
      entrypoint: "intent",
      plannedStages: ["discover", "spec", "build", "review"],
      selectedSpecialists: ["security-review", "audit-review"]
    }
  };

  const routingPlan: RoutingPlan = {
    intent: "Add SSO with audit logging",
    inferredAt: "2026-03-13T18:20:00.000Z",
    entrypoint: "bare",
    summary: "Infer discover -> spec -> build -> review with specialists: security-review, audit-review",
    stages: [
      {
        name: "discover",
        rationale: "Gather repo context.",
        status: "planned",
        executed: false
      },
      {
        name: "spec",
        rationale: "Plan the implementation.",
        status: "planned",
        executed: false
      },
      {
        name: "build",
        rationale: "Implementation work is implied.",
        status: "planned",
        executed: false
      },
      {
        name: "review",
        rationale: "Risk-oriented review language is present.",
        status: "planned",
        executed: false
      }
    ],
    specialists: [
      {
        name: "security-review",
        reason: "The intent suggests auth risk.",
        selected: true
      },
      {
        name: "audit-review",
        reason: "The intent suggests audit logging requirements.",
        selected: true
      },
      {
        name: "release-pipeline-review",
        reason: "Not strongly implied by the current intent.",
        selected: false
      },
      {
        name: "devsecops-review",
        reason: "Not strongly implied by the current intent.",
        selected: false
      },
      {
        name: "traceability-review",
        reason: "Not strongly implied by the current intent.",
        selected: false
      }
    ]
  };

  const lineage: StageLineage = {
    intent: "Add SSO with audit logging",
    stages: [
      {
        name: "discover",
        rationale: "Gather repo context.",
        status: "completed",
        executed: true
      },
      {
        name: "spec",
        rationale: "Plan the implementation.",
        status: "completed",
        executed: true
      },
      {
        name: "build",
        rationale: "Implementation work is implied.",
        status: "deferred",
        executed: false,
        notes: "Planned by the router, but not executed in this first intent-runner slice."
      },
      {
        name: "review",
        rationale: "Risk-oriented review language is present.",
        status: "deferred",
        executed: false,
        notes: "Planned by the router, but not executed in this first intent-runner slice."
      }
    ],
    specialists: [
      {
        name: "audit-review",
        reason: "The intent suggests audit logging requirements.",
        status: "completed",
        disposition: "accepted",
        specialistDir: path.join(runDir, "delegates", "audit-review"),
        artifactPath: path.join(runDir, "delegates", "audit-review", "audit-findings.md")
      }
    ]
  };

  const events: RunEvent[] = [
    {
      timestamp: "2026-03-13T18:20:00.000Z",
      elapsedMs: 0,
      type: "starting",
      message: "Routing intent across discover -> spec -> build -> review"
    },
    {
      timestamp: "2026-03-13T18:20:20.000Z",
      elapsedMs: 20_000,
      type: "completed",
      message: "Intent run completed"
    }
  ];

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "routing-plan.json"), `${JSON.stringify(routingPlan, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "stage-lineage.json"), `${JSON.stringify(lineage, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Final\n\nAll done.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "spec.md"), "# Spec artifact\n", "utf8");
  await fs.writeFile(path.join(runDir, "delegates", "audit-review", "audit-findings.md"), "# Audit findings\n", "utf8");

  return runId;
}

describe("inspect", () => {
  let repoDir: string;
  let runId: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-inspect-"));
    await fs.mkdir(path.join(repoDir, ".cstack", "runs"), { recursive: true });
    runId = await seedIntentRun(repoDir);
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("renders the enriched non-interactive summary", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runInspect(repoDir, [runId]);
      const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(output).toContain("Observed");
      expect(output).toContain("Plan");
      expect(output).toContain("Suggested next actions");
      expect(output).toContain("Shortcuts");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("answers artifact-grounded inspector commands", async () => {
    const inspection = await loadRunInspection(repoDir, runId);

    await expect(handleInspectorCommand(repoDir, inspection, "what remains")).resolves.toContain("stage build: deferred");
    await expect(handleInspectorCommand(repoDir, inspection, "why deferred build")).resolves.toContain("first intent-runner slice");
    await expect(handleInspectorCommand(repoDir, inspection, "show specialist audit-review")).resolves.toContain("\"disposition\": \"accepted\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show artifact artifacts/spec.md")).resolves.toContain("# Spec artifact");
    await expect(handleInspectorCommand(repoDir, inspection, "resume")).resolves.toContain("codex resume fake-session-123");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("Observed");
    await expect(handleInspectorCommand(repoDir, inspection, "f")).resolves.toContain("# Final");
  });

  it("rejects interactive inspection without a tty", async () => {
    const inspection = await loadRunInspection(repoDir, runId);
    await expect(
      runInteractiveInspector(repoDir, inspection, { input: process.stdin, output: process.stdout })
    ).rejects.toThrow("Interactive inspection requires a TTY.");
  });
});
