import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runInspect } from "../src/commands/inspect.js";
import { handleInspectorCommand, loadRunInspection, runInteractiveInspector } from "../src/inspector.js";
import type { RoutingPlan, RunEvent, RunRecord, StageLineage } from "../src/types.js";

async function seedDiscoverRun(repoDir: string): Promise<string> {
  const runId = "2026-03-14T10-00-00-discover-research";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  const stageDir = path.join(runDir, "stages", "discover");
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(stageDir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(stageDir, "delegates", "repo-explorer"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "discover",
    createdAt: "2026-03-14T10:00:00.000Z",
    updatedAt: "2026-03-14T10:00:20.000Z",
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
    sessionId: "fake-session-456",
    lastActivity: "Discover run completed",
    summary: "Map repo and external docs",
    inputs: {
      userPrompt: "Map repo and external docs"
    }
  };

  const researchPlan = {
    prompt: "Map repo and external docs",
    decidedAt: "2026-03-14T10:00:00.000Z",
    mode: "research-team",
    delegationEnabled: true,
    maxTracks: 2,
    webResearchAllowed: true,
    requestedCapabilities: ["repo", "web"],
    availableCapabilities: ["repo", "web"],
    summary: "Discover research team: repo-explorer, external-researcher",
    tracks: [
      { name: "repo-explorer", reason: "repo mapping", selected: true, requiresWeb: false },
      { name: "external-researcher", reason: "official docs", selected: true, requiresWeb: true },
      { name: "risk-researcher", reason: "not needed", selected: false, requiresWeb: false }
    ],
    limitations: []
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(stageDir, "research-plan.json"), `${JSON.stringify(researchPlan, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "events.jsonl"), `${JSON.stringify({
    timestamp: "2026-03-14T10:00:20.000Z",
    elapsedMs: 20_000,
    type: "completed",
    message: "Discover run completed"
  })}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Final\n\nResearch synthesis.\n", "utf8");
  await fs.writeFile(path.join(stageDir, "artifacts", "discovery-report.md"), "# Discovery report\n", "utf8");
  await fs.writeFile(path.join(stageDir, "delegates", "repo-explorer", "result.json"), `${JSON.stringify({
    track: "repo-explorer",
    status: "completed",
    summary: "Repo mapped.",
    filesInspected: ["src/cli.ts"],
    commandsRun: ["rg discover src"],
    sources: [{ title: "src/cli.ts", location: "src/cli.ts", kind: "file" }],
    findings: ["CLI entrypoint located."],
    confidence: "high",
    unresolved: [],
    leaderDisposition: "accepted"
  }, null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(stageDir, "delegates", "repo-explorer", "sources.json"),
    `${JSON.stringify([{ title: "src/cli.ts", location: "src/cli.ts", kind: "file" }], null, 2)}\n`,
    "utf8"
  );

  return runId;
}

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

async function seedBuildRun(repoDir: string): Promise<string> {
  const runId = "2026-03-14T11-00-00-build-billing-cleanup";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "build",
    createdAt: "2026-03-14T11:00:00.000Z",
    updatedAt: "2026-03-14T11:00:30.000Z",
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
    sessionId: "fake-session-789",
    lastActivity: "Build run completed",
    summary: "Implement billing cleanup",
    inputs: {
      userPrompt: "Implement billing cleanup",
      linkedRunId: "2026-03-14T10-00-00-spec-billing-retry",
      requestedMode: "interactive",
      observedMode: "exec",
      verificationCommands: ["npm test"]
    }
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Build Summary\n\nDone.\n", "utf8");
  await fs.writeFile(path.join(runDir, "artifacts", "change-summary.md"), "# Build Summary\n\nDone.\n", "utf8");
  await fs.writeFile(
    path.join(runDir, "session.json"),
    `${JSON.stringify(
      {
        workflow: "build",
        requestedMode: "interactive",
        mode: "exec",
        startedAt: "2026-03-14T11:00:00.000Z",
        endedAt: "2026-03-14T11:00:30.000Z",
        sessionId: "fake-session-789",
        linkedRunId: "2026-03-14T10-00-00-spec-billing-retry",
        linkedRunWorkflow: "spec",
        linkedArtifactPath: path.join(repoDir, ".cstack", "runs", "2026-03-14T10-00-00-spec-billing-retry", "artifacts", "spec.md"),
        codexCommand: ["codex", "exec"],
        resumeCommand: "codex resume fake-session-789",
        forkCommand: "codex fork fake-session-789",
        observability: {
          sessionIdObserved: true,
          transcriptObserved: false,
          finalArtifactObserved: true,
          fallbackReason: "Interactive build requested but no TTY was available, so cstack fell back to exec mode."
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "artifacts", "verification.json"),
    `${JSON.stringify(
      {
        status: "passed",
        requestedCommands: ["npm test"],
        results: [
          {
            command: "npm test",
            exitCode: 0,
            status: "passed",
            durationMs: 1250,
            stdoutPath: path.join(runDir, "artifacts", "verification", "1.stdout.log"),
            stderrPath: path.join(runDir, "artifacts", "verification", "1.stderr.log")
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

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

  it("shows discover research plan details when present", async () => {
    const discoverRunId = await seedDiscoverRun(repoDir);
    const inspection = await loadRunInspection(repoDir, discoverRunId);

    expect(inspection.discoverResearchPlan?.mode).toBe("research-team");
    await expect(handleInspectorCommand(repoDir, inspection, "show research")).resolves.toContain("\"webResearchAllowed\": true");
    await expect(handleInspectorCommand(repoDir, inspection, "show delegate repo-explorer")).resolves.toContain("\"track\": \"repo-explorer\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show sources repo-explorer")).resolves.toContain("\"src/cli.ts\"");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("Research");
  });

  it("shows build session and verification details when present", async () => {
    const buildRunId = await seedBuildRun(repoDir);
    const inspection = await loadRunInspection(repoDir, buildRunId);

    expect(inspection.sessionRecord?.mode).toBe("exec");
    expect(inspection.verificationRecord?.status).toBe("passed");
    await expect(handleInspectorCommand(repoDir, inspection, "show session")).resolves.toContain("\"requestedMode\": \"interactive\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show verification")).resolves.toContain("\"status\": \"passed\"");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("verification: passed");
  });
});
