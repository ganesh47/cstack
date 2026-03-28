import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { promisify } from "node:util";
import { runInspect } from "../src/commands/inspect.js";
import { completeInspectorInput, executeInspectorCommand, handleInspectorCommand, loadRunInspection, runInteractiveInspector } from "../src/inspector.js";
import type { RoutingPlan, RunEvent, RunRecord, StageLineage } from "../src/types.js";

const execFileAsync = promisify(execFile);

async function runGit(repoDir: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repoDir });
}

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

async function seedIntentFailedReviewRun(repoDir: string): Promise<string> {
  const reviewRunId = await seedReviewRun(repoDir);
  const runId = "2026-03-15T10-05-13-993Z-intent-what-are-the-gaps-in-this-project";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "intent",
    createdAt: "2026-03-15T10:05:13.000Z",
    updatedAt: "2026-03-15T10:05:40.000Z",
    status: "failed",
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
    lastActivity: "Intent run finished with downstream workflow failures",
    summary: "What are the gaps in this project",
    error: `review failed via ${reviewRunId}`,
    inputs: {
      userPrompt: "What are the gaps in this project",
      entrypoint: "intent",
      plannedStages: ["discover", "spec", "review"],
      selectedSpecialists: []
    }
  };

  const routingPlan: RoutingPlan = {
    intent: "What are the gaps in this project",
    inferredAt: "2026-03-15T10:05:13.000Z",
    entrypoint: "bare",
    summary: "Infer discover -> spec -> review with no specialist reviews selected",
    stages: [
      { name: "discover", rationale: "Gather repo context.", status: "planned", executed: false },
      { name: "spec", rationale: "Plan the implementation.", status: "planned", executed: false },
      { name: "review", rationale: "Gap analysis implies critique.", status: "planned", executed: false }
    ],
    specialists: []
  };

  const childFailure =
    "Delivery is not ready. The repo has unresolved contract, runtime, and configuration gaps, and there is no verification evidence for this review run.";
  const lineage: StageLineage = {
    intent: "What are the gaps in this project",
    stages: [
      { name: "discover", rationale: "Gather repo context.", status: "completed", executed: true },
      { name: "spec", rationale: "Plan the implementation.", status: "completed", executed: true },
      {
        name: "review",
        rationale: "Gap analysis implies critique.",
        status: "failed",
        executed: true,
        childRunId: reviewRunId,
        stageDir: path.join(repoDir, ".cstack", "runs", reviewRunId),
        artifactPath: path.join(repoDir, ".cstack", "runs", reviewRunId, "artifacts", "verdict.json"),
        notes: `Executed through downstream review run ${reviewRunId}. ${childFailure}`
      }
    ],
    specialists: []
  };

  const events: RunEvent[] = [
    {
      timestamp: "2026-03-15T10:05:13.000Z",
      elapsedMs: 0,
      type: "starting",
      message: "Routing intent across discover -> spec -> review"
    },
    {
      timestamp: "2026-03-15T10:05:38.000Z",
      elapsedMs: 25_000,
      type: "activity",
      message: `Downstream review: ${childFailure}`
    },
    {
      timestamp: "2026-03-15T10:05:40.000Z",
      elapsedMs: 27_000,
      type: "failed",
      message: "Intent run finished with downstream workflow failures"
    }
  ];

  const finalBody = [
    "# Intent Run Summary",
    "",
    "## Intent",
    "What are the gaps in this project",
    "",
    "## Routing summary",
    "Infer discover -> spec -> review with no specialist reviews selected",
    "",
    "## Stage status",
    "- discover: completed (executed)",
    "- spec: completed (executed)",
    `- review: failed (executed) via ${reviewRunId}`,
    `  note: Executed through downstream review run ${reviewRunId}. ${childFailure}`,
    "",
    "## Planned specialists",
    "- none selected",
    "",
    "## Specialist status",
    "- none executed",
    ""
  ].join("\n");

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "routing-plan.json"), `${JSON.stringify(routingPlan, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "stage-lineage.json"), `${JSON.stringify(lineage, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), `${finalBody}\n`, "utf8");

  return runId;
}

async function seedIntentFailedDeliverBuildRun(repoDir: string): Promise<string> {
  const deliverRunId = await seedDeliverRun(repoDir, { buildFailure: true });
  const runId = "2026-03-16T12-49-00-888Z-intent-build-root-cause";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "intent",
    createdAt: "2026-03-16T12:49:00.000Z",
    updatedAt: "2026-03-16T13:12:01.000Z",
    status: "failed",
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
    lastActivity: "Intent run finished with downstream workflow failures",
    summary: "What are the gaps in this project? Can you work on closing the gaps?",
    error: `build failed via ${deliverRunId}`,
    inputs: {
      userPrompt: "What are the gaps in this project? Can you work on closing the gaps?",
      entrypoint: "intent",
      plannedStages: ["discover", "spec", "build", "review", "ship"],
      selectedSpecialists: []
    }
  };
  const intentSummary = run.summary ?? run.inputs.userPrompt;

  const routingPlan: RoutingPlan = {
    intent: intentSummary,
    inferredAt: "2026-03-16T12:49:00.000Z",
    entrypoint: "bare",
    summary: "Infer discover -> spec -> build -> review -> ship with no specialist reviews selected",
    decision: {
      classification: "mixed",
      reason:
        "The prompt mixes gap-analysis language with explicit remediation intent, so the router stayed on the implementation path and carried the run through planning and downstream delivery stages.",
      winningSignals: ["analysis", "implementation", "review"]
    },
    signals: [
      { name: "analysis", matched: true, evidence: ["What are the gaps"] },
      { name: "implementation", matched: true, evidence: ["work on", "closing"] },
      { name: "review", matched: true, evidence: ["gaps"] },
      { name: "release", matched: false, evidence: [] }
    ],
    stages: [
      { name: "discover", rationale: "Gather repo context.", status: "planned", executed: false },
      { name: "spec", rationale: "Plan the implementation.", status: "planned", executed: false },
      { name: "build", rationale: "Implement the approved change.", status: "planned", executed: false },
      { name: "review", rationale: "Critique the implementation.", status: "planned", executed: false },
      { name: "ship", rationale: "Prepare release readiness.", status: "planned", executed: false }
    ],
    specialists: []
  };

  const aggregateFailure =
    "build exited with code 1; validation status: blocked; review status: blocked; ship stage blocked release readiness";
  const lineage: StageLineage = {
    intent: intentSummary,
    stages: [
      { name: "discover", rationale: "Gather repo context.", status: "completed", executed: true },
      { name: "spec", rationale: "Plan the implementation.", status: "completed", executed: true },
      {
        name: "build",
        rationale: "Implement the approved change.",
        status: "failed",
        executed: true,
        childRunId: deliverRunId,
        notes: `Executed through downstream deliver run ${deliverRunId}. ${aggregateFailure}`
      },
      {
        name: "review",
        rationale: "Critique the implementation.",
        status: "completed",
        executed: true,
        childRunId: deliverRunId,
        notes: `Executed through downstream deliver run ${deliverRunId}. ${aggregateFailure}`
      },
      {
        name: "ship",
        rationale: "Prepare release readiness.",
        status: "completed",
        executed: true,
        childRunId: deliverRunId,
        notes: `Executed through downstream deliver run ${deliverRunId}. ${aggregateFailure}`
      }
    ],
    specialists: []
  };

  const events: RunEvent[] = [
    {
      timestamp: "2026-03-16T12:49:00.000Z",
      elapsedMs: 0,
      type: "starting",
      message: "Routing intent across discover -> spec -> build -> review -> ship"
    },
    {
      timestamp: "2026-03-16T12:58:54.000Z",
      elapsedMs: 593_000,
      type: "activity",
      message: `Downstream deliver run ${deliverRunId} started`
    },
    {
      timestamp: "2026-03-16T13:12:01.000Z",
      elapsedMs: 1_380_000,
      type: "failed",
      message: "Intent run finished with downstream workflow failures"
    }
  ];

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "routing-plan.json"), `${JSON.stringify(routingPlan, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "stage-lineage.json"), `${JSON.stringify(lineage, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  await fs.writeFile(
    path.join(runDir, "final.md"),
    [
      "# Intent Run Summary",
      "",
      "## Intent",
      run.summary,
      "",
      "## Stage status",
      `- build: failed (executed) via ${deliverRunId}`,
      `  note: ${aggregateFailure}`
    ].join("\n"),
    "utf8"
  );

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

async function seedReviewRun(repoDir: string): Promise<string> {
  const runId = "2026-03-15T05-36-07-789Z-review-what-are-the-gaps-in-the-current-project";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "review",
    createdAt: "2026-03-15T05:36:07.000Z",
    updatedAt: "2026-03-15T05:36:38.070Z",
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
    lastActivity: "Gap analysis completed. High-priority product and delivery gaps remain.",
    summary: "What are the gaps in the current project",
    inputs: {
      userPrompt: "What are the gaps in the current project",
      linkedRunId: "2026-03-15T05-28-16-672Z-intent-what-are-the-gaps-in-the-current-project"
    }
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Review Run Summary\n\nGap analysis completed.\n", "utf8");
  await fs.writeFile(
    path.join(runDir, "stage-lineage.json"),
    `${JSON.stringify(
      {
        intent: "What are the gaps in the current project",
        stages: [{ name: "review", rationale: "Analyze the main gaps and risks.", status: "completed", executed: true }],
        specialists: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "artifacts", "verdict.json"),
    `${JSON.stringify(
      {
        mode: "analysis",
        status: "completed",
        summary: "Gap analysis completed. High-priority product and delivery gaps remain.",
        findings: [
          {
            severity: "high",
            title: "Contract drift",
            detail: "API behavior, docs, and connector expectations no longer line up."
          }
        ],
        recommendedActions: [
          "Choose one source of truth for API routes, status codes, and ingest/heartbeat semantics, then align API code, Java clients, integration tests, and docs to it.",
          "Run the intended API, CLI, and connector verification commands and attach the results to the next review."
        ],
        gapClusters: [
          {
            title: "Contract drift",
            severity: "high",
            summary: "The API, docs, and connector behavior disagree on key runtime semantics."
          },
          {
            title: "Validation gap",
            severity: "high",
            summary: "There is no runnable end-to-end evidence for the advertised metadata path."
          }
        ],
        likelyRootCauses: [
          "Contract changes are not flowing through one source of truth.",
          "Validation requirements are not enforced before review."
        ],
        recommendedNextSlices: [
          "Align the API contract across code, docs, and client surfaces.",
          "Add runnable verification for ingest and metadata flows."
        ],
        confidence: "high",
        acceptedSpecialists: [],
        reportMarkdown: "# Review Findings\n\nGap analysis completed.\n"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await fs.writeFile(path.join(runDir, "artifacts", "findings.md"), "# Review Findings\n\nGap analysis completed.\n", "utf8");
  await fs.writeFile(
    path.join(runDir, "artifacts", "findings.json"),
    `${JSON.stringify(
      {
        findings: [],
        recommendedActions: [
          "Choose one source of truth for API routes, status codes, and ingest/heartbeat semantics, then align API code, Java clients, integration tests, and docs to it.",
          "Run the intended API, CLI, and connector verification commands and attach the results to the next review."
        ],
        acceptedSpecialists: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "events.jsonl"),
    `${JSON.stringify({
      timestamp: "2026-03-15T05:36:38.070Z",
      elapsedMs: 30_000,
      type: "completed",
      message: "Exit code 0"
    })}\n`,
    "utf8"
  );

  return runId;
}

async function seedDeliverRun(
  repoDir: string,
  options: {
    readiness?: "ready" | "blocked";
    mode?: "merge-ready" | "release";
    buildFailure?: boolean;
  } = {}
): Promise<string> {
  const readiness = options.readiness ?? "blocked";
  const mode = options.mode ?? "merge-ready";
  const buildFailure = options.buildFailure ?? false;
  const blocked = readiness === "blocked" || buildFailure;
  const runId =
    readiness === "blocked"
      ? "2026-03-14T12-15-00-deliver-billing-cleanup-blocked"
      : "2026-03-14T12-16-00-deliver-billing-cleanup-ready";
  const runDir = path.join(repoDir, ".cstack", "runs", runId);
  await fs.mkdir(path.join(runDir, "stages", "build", "artifacts"), { recursive: true });
  await fs.mkdir(path.join(runDir, "stages", "validation", "artifacts"), { recursive: true });
  await fs.mkdir(path.join(runDir, "stages", "review", "artifacts"), { recursive: true });
  await fs.mkdir(path.join(runDir, "stages", "ship", "artifacts"), { recursive: true });
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const run: RunRecord = {
    id: runId,
    workflow: "deliver",
    createdAt: "2026-03-14T12:15:00.000Z",
    updatedAt: "2026-03-14T12:15:30.000Z",
    status: blocked ? "failed" : "completed",
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
    ...(buildFailure ? {} : { sessionId: "fake-session-deliver" }),
    lastActivity: buildFailure ? "Validation: blocked; Ship readiness: blocked; GitHub delivery: ready" : "Deliver run completed",
    summary: "Deliver billing cleanup",
    ...(buildFailure
      ? { error: "build exited with code 1; validation status: blocked; review status: blocked; ship stage blocked release readiness" }
      : {}),
    inputs: {
      userPrompt: "Deliver billing cleanup",
      linkedRunId: "2026-03-14T12-00-00-spec-deliver-billing",
      requestedMode: "interactive",
      observedMode: buildFailure ? "interactive" : "exec",
      verificationCommands: ["npm test"]
    }
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "final.md"), "# Deliver Run Summary\n\nDone.\n", "utf8");
  await fs.writeFile(
    path.join(runDir, "stage-lineage.json"),
    `${JSON.stringify(
      {
        intent: "Deliver billing cleanup",
        stages: [
          { name: "build", rationale: "Implement", status: buildFailure ? "failed" : "completed", executed: true, notes: buildFailure ? "Build exited with code 1." : undefined },
          {
            name: "validation",
            rationale: "Validate",
            status: buildFailure ? "failed" : blocked ? "deferred" : "completed",
            executed: true,
            notes: buildFailure
              ? "Validation planning landed, but validation remained blocked because build did not finish and verification did not run."
              : blocked
                ? "Validation completed but GitHub parity remains blocked."
                : "Validation completed."
          },
          {
            name: "review",
            rationale: "Critique",
            status: "completed",
            executed: true,
            notes: buildFailure ? "Delivery is blocked because build exited unsuccessfully and verification did not run." : undefined
          },
          {
            name: "ship",
            rationale: "Prepare release",
            status: "completed",
            executed: true,
            notes: buildFailure ? "Release readiness is blocked by the failed build stage." : undefined
          }
        ],
        specialists: [{ name: "audit-review", reason: "Audit logging scope.", status: "completed", disposition: "accepted" }]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "stages", "build", "session.json"),
    `${JSON.stringify(
      {
        workflow: "build",
        requestedMode: "interactive",
        mode: buildFailure ? "interactive" : "exec",
        startedAt: "2026-03-14T12:15:00.000Z",
        endedAt: "2026-03-14T12:15:10.000Z",
        ...(buildFailure ? {} : { sessionId: "fake-session-deliver" }),
        ...(buildFailure ? { transcriptPath: path.join(runDir, "stages", "build", "artifacts", "build-transcript.log") } : {}),
        codexCommand: ["codex", "exec"],
        observability: {
          sessionIdObserved: !buildFailure,
          transcriptObserved: false,
          finalArtifactObserved: true
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "stages", "build", "artifacts", "verification.json"),
    `${JSON.stringify(
      buildFailure ? { status: "not-run", requestedCommands: ["npm test"], results: [], notes: "Build failed before verification started." } : { status: "passed", requestedCommands: ["npm test"], results: [] },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(runDir, "stages", "build", "artifacts", "change-summary.md"), "# Build Summary\n", "utf8");
  await fs.writeFile(
    path.join(runDir, "stages", "build", "final.md"),
    buildFailure
      ? [
          "# Build Run Summary",
          "",
          "## Codex session",
          "- session id: not observed",
          "- exit code: 1",
          `- transcript: ${path.join(runDir, "stages", "build", "artifacts", "build-transcript.log")}`,
          "",
          "## Verification",
          "- status: not-run",
          "",
          "## Notes",
          "- Codex did not leave a final markdown summary."
        ].join("\n")
      : "# Build Run Summary\n\nCompleted.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "stages", "validation", "repo-profile.json"),
    `${JSON.stringify(
      {
        detectedAt: "2026-03-14T12:15:11.000Z",
        languages: ["typescript"],
        buildSystems: ["npm"],
        surfaces: ["cli-binary", "github-workflows"],
        packageManagers: ["npm"],
        ciSystems: ["github-actions"],
        runnerConstraints: ["linux-default"],
        manifests: ["package.json"],
        workflowFiles: [".github/workflows/release.yml"],
        existingTests: [{ kind: "unit", location: "test/inspect.test.ts", tool: "vitest" }],
        packageScripts: [{ name: "test", command: "npm test" }],
        detectedTools: ["vitest"],
        workspaceTargets: [
          {
            path: ".",
            manifests: ["package.json"],
            languages: ["typescript"],
            buildSystems: ["npm"],
            surfaces: ["cli-binary", "github-workflows"],
            packageScripts: [{ name: "test", command: "npm test" }],
            detectedTools: ["vitest"],
            support: "native",
            notes: []
          },
          {
            path: "packages/cli",
            manifests: ["pyproject.toml"],
            languages: ["python"],
            buildSystems: ["python"],
            surfaces: ["library"],
            packageScripts: [],
            detectedTools: [],
            support: "inventory-only",
            notes: ["Validation command inference is currently rooted in the top-level repo; inspect this target manually."]
          }
        ],
        limitations: ["Validation command inference is currently root-biased; nested workspace targets are inventoried and reported explicitly."]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "stages", "validation", "tool-research.json"),
    `${JSON.stringify(
      {
        generatedAt: "2026-03-14T12:15:12.000Z",
        summary: "Selected OSS validation tools for the repo.",
        candidates: [{ tool: "actionlint", category: "static", selected: true, rationale: "Validate Actions workflows.", localSupport: "optional", ciSupport: "native", source: "https://github.com/rhysd/actionlint" }],
        selectedTools: ["actionlint"],
        limitations: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "stages", "validation", "validation-plan.json"),
    `${JSON.stringify(
      {
        status: blocked ? "partial" : "ready",
        outcomeCategory: blocked ? "partial" : "ready",
        summary: "Validation planning completed with local and CI parity guidance.",
        profileSummary: "CLI plus GitHub workflow validation.",
        layers: [
          {
            name: "static",
            selected: true,
            status: "ready",
            rationale: "Static checks protect workflows and code hygiene.",
            selectedTools: ["actionlint"],
            localCommands: ["npm test"],
            ciCommands: ["npm test"],
            coverageIntent: ["workflow correctness"],
            notes: []
          }
        ],
        selectedSpecialists: [],
        localValidation: { commands: ["npm test"], prerequisites: ["linux-default"], notes: [] },
        ciValidation: {
          workflowFiles: [".github/workflows/release.yml"],
          jobs: [{ name: "validation", runner: "ubuntu-latest", purpose: "Run tests.", commands: ["npm test"], artifacts: ["test-reports"] }],
          notes: []
        },
        coverage: {
          confidence: "medium",
          summary: "Coverage is layered across static and unit validation.",
          signals: ["validation plan recorded"],
          gaps: blocked ? ["GitHub parity remains blocked by required checks."] : []
        },
        recommendedChanges: [],
        unsupported: [],
        pyramidMarkdown: "# Test Pyramid\n\n- static\n- unit-component\n",
        reportMarkdown: "# Validation Summary\n\nValidation complete.\n",
        githubActionsPlanMarkdown: "# GitHub Actions Validation Plan\n\nUse one validation job.\n"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "stages", "validation", "artifacts", "local-validation.json"),
    `${JSON.stringify(
      {
        status: "passed",
        requestedCommands: ["npm test"],
        results: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(runDir, "stages", "validation", "artifacts", "test-pyramid.md"), "# Test Pyramid\n\n- static\n- unit-component\n", "utf8");
  await fs.writeFile(
    path.join(runDir, "stages", "validation", "artifacts", "coverage-summary.json"),
    `${JSON.stringify(
      {
        status: blocked ? "partial" : "ready",
        outcomeCategory: blocked ? "partial" : "ready",
        confidence: "medium",
        summary: "Coverage is layered.",
        signals: ["static checks planned"],
        gaps: blocked ? ["GitHub parity remains blocked by required checks."] : [],
        localValidationStatus: "passed"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "stages", "validation", "artifacts", "ci-validation.json"),
    `${JSON.stringify(
      {
        workflowFiles: [".github/workflows/release.yml"],
        jobs: [{ name: "validation", runner: "ubuntu-latest", purpose: "Run tests.", commands: ["npm test"], artifacts: ["test-reports"] }],
        notes: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(runDir, "stages", "review", "artifacts", "findings.md"), "# Review Findings\n", "utf8");
  await fs.writeFile(
    path.join(runDir, "stages", "review", "artifacts", "verdict.json"),
    `${JSON.stringify(
      {
        mode: "readiness",
        status: "changes-requested",
        summary: "Review completed with bounded follow-up.",
        findings: [],
        recommendedActions: blocked ? ["Review the release checklist before merge."] : [],
        acceptedSpecialists: [],
        reportMarkdown: "# Review Findings\n"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(runDir, "stages", "ship", "artifacts", "ship-summary.md"), "# Ship Summary\n", "utf8");
  await fs.writeFile(
    path.join(runDir, "stages", "ship", "artifacts", "ship-record.json"),
    `${JSON.stringify(
      {
        readiness,
        summary: blocked ? "Ship artifacts prepared with outstanding blockers." : "Ship artifacts prepared.",
        checklist: [{ item: "Confirm version bump.", status: "complete" }],
        unresolved: blocked ? ["Required GitHub gates remain blocked."] : [],
        nextActions: blocked ? ["Resolve the blocked GitHub gates before rerunning deliver."] : [],
        reportMarkdown: "# Ship Summary\n"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "stages", "ship", "artifacts", "post-ship-evidence.json"),
    `${JSON.stringify(
      {
        status: blocked ? "follow-up-required" : "stable",
        summary: blocked
          ? "Post-ship follow-up is required based on the recorded ship and GitHub delivery blockers."
          : "Post-ship evidence is stable based on the recorded ship and GitHub delivery artifacts.",
        observedAt: "2026-03-14T12:15:21.000Z",
        observedSignals: [
          {
            kind: "ship-readiness",
            status: readiness === "ready" ? "ready" : "blocked",
            summary: blocked ? "Ship artifacts prepared with outstanding blockers." : "Ship artifacts prepared."
          },
          {
            kind: "github-delivery",
            status: blocked ? "blocked" : "ready",
            summary: blocked ? "GitHub delivery still has blockers." : "GitHub delivery is ready."
          }
        ],
        inferredRecommendations: blocked ? ["Create a follow-up to restore the blocked required checks and rerun delivery verification."] : [],
        followUpRequired: blocked,
        sourceArtifacts: ["artifacts/ship-record.json", "artifacts/github-delivery.json", "artifacts/github-mutation.json"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "stages", "ship", "artifacts", "follow-up-lineage.json"),
    `${JSON.stringify(
      {
        status: blocked ? "recommended" : "none",
        sourceRun: { runId, workflow: "deliver" },
        linkedIssueNumbers: [123],
        recommendedDrafts: blocked
          ? [{ title: "Follow-up for linked issue #123 (1)", reason: "Create a follow-up to restore the blocked required checks and rerun delivery verification.", priority: "high" }]
          : []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(runDir, "artifacts", "post-ship-summary.md"), "# Post-Ship Summary\n", "utf8");
  await fs.writeFile(
    path.join(runDir, "artifacts", "post-ship-evidence.json"),
    await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "post-ship-evidence.json"), "utf8"),
    "utf8"
  );
  await fs.writeFile(path.join(runDir, "artifacts", "follow-up-draft.md"), "# Post-Ship Follow-Up Draft\n", "utf8");
  await fs.writeFile(
    path.join(runDir, "artifacts", "follow-up-lineage.json"),
    await fs.readFile(path.join(runDir, "stages", "ship", "artifacts", "follow-up-lineage.json"), "utf8"),
    "utf8"
  );
  const githubDelivery = {
    repository: "ganesh47/cstack",
    mode,
    branch: {
      name: "main",
      headSha: "abc123",
      defaultBranch: "main"
    },
    requestedPolicy: {
      enabled: true,
      prRequired: true,
      requiredChecks: ["deliver/test"],
      requiredWorkflows: ["Release"]
    },
    issueReferences: [123],
    branchState: {
      required: true,
      status: "ready",
      summary: "Observed main.",
      blockers: [],
      observedAt: "2026-03-14T12:15:20.000Z",
      source: "gh",
      observed: { current: "main", headSha: "abc123", defaultBranch: "main" }
    },
    pullRequest: {
      required: true,
      status: "ready",
      summary: "PR looks good.",
      blockers: [],
      observedAt: "2026-03-14T12:15:20.000Z",
      source: "gh",
      observed: {
        number: 42,
        title: "Deliver billing cleanup",
        state: "OPEN",
        isDraft: false,
        reviewDecision: "APPROVED",
        url: "https://example.com/pr/42",
        headRefName: "main",
        baseRefName: "main"
      }
    },
    issues: {
      required: true,
      status: "ready",
      summary: "Issue closed.",
      blockers: [],
      observedAt: "2026-03-14T12:15:20.000Z",
      source: "gh",
      observed: [{ number: 123, title: "Track deliver", state: "CLOSED", url: "https://example.com/issues/123" }]
    },
    checks: {
      required: true,
      status: blocked ? "blocked" : "ready",
      summary: blocked ? "Required check deliver/test is failing." : "Observed 1 required check.",
      blockers: blocked ? ["Required check deliver/test is failing."] : [],
      observedAt: "2026-03-14T12:15:20.000Z",
      source: "gh",
      observed: [{ name: "deliver/test", status: "completed", conclusion: blocked ? "fail" : "pass" }]
    },
    actions: {
      required: true,
      status: "ready",
      summary: "Release workflow passed.",
      blockers: [],
      observedAt: "2026-03-14T12:15:20.000Z",
      source: "gh",
      observed: [{ databaseId: 1, workflowName: "Release", status: "completed", conclusion: "success" }]
    },
    release: {
      required: mode === "release",
      status: mode === "release" ? "ready" : "not-applicable",
      summary: mode === "release" ? "Release artifacts are present." : "No release required.",
      blockers: [],
      observedAt: "2026-03-14T12:15:20.000Z",
      source: mode === "release" ? "gh" : "config",
      observed:
        mode === "release"
          ? {
              tagName: "v1.2.3",
              version: "1.2.3",
              url: "https://example.com/releases/v1.2.3",
              publishedAt: "2026-03-14T12:15:20.000Z",
              tagExists: true,
              releaseExists: true
            }
          : null
    },
    security: {
      required: true,
      status: blocked ? "blocked" : "ready",
      summary: blocked ? "Dependabot alert is open." : "GitHub security gates passed.",
      blockers: blocked ? ["Dependabot alert #7 is open at severity high."] : [],
      observedAt: "2026-03-14T12:15:20.000Z",
      source: "gh",
      observed: {
        dependabot: blocked ? [{ number: 7, severity: "high", state: "open", packageName: "lodash" }] : [],
        codeScanning: []
      }
    },
    overall: {
      status: blocked ? "blocked" : "ready",
      summary: blocked ? "2 blockers remain." : "All required GitHub gates passed.",
      blockers: blocked ? ["Required check deliver/test is failing.", "Dependabot alert #7 is open at severity high."] : [],
      observedAt: "2026-03-14T12:15:20.000Z"
    },
    limitations: []
  };
  await fs.writeFile(
    path.join(runDir, "artifacts", "github-delivery.json"),
    `${JSON.stringify(githubDelivery, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "artifacts", "github-mutation.json"),
    `${JSON.stringify(
      {
        enabled: true,
        branch: {
          initial: "main",
          current: blocked ? "cstack/billing-cleanup" : "cstack/billing-cleanup-ready",
          created: true,
          pushed: true,
          remote: "origin"
        },
        commit: {
          created: true,
          sha: "def456",
          message: "cstack deliver: billing cleanup",
          changedFiles: ["src/billing.ts"]
        },
        pullRequest: {
          created: true,
          updated: false,
          number: 42,
          url: "https://example.com/pr/42",
          title: "Deliver billing cleanup",
          baseRefName: "main",
          headRefName: blocked ? "cstack/billing-cleanup" : "cstack/billing-cleanup-ready",
          draft: false
        },
        checks: {
          watched: true,
          polls: 1,
          completed: !blocked,
          summary: blocked ? "Timed out while waiting for required checks." : "Observed 1 completed required checks."
        },
        blockers: [],
        summary: "Branch pushed and pull request prepared."
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(runDir, "stages", "ship", "artifacts", "github-state.json"), `${JSON.stringify({
    repository: githubDelivery.repository,
    mode: githubDelivery.mode,
    branch: githubDelivery.branch,
    overall: githubDelivery.overall
  }, null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(runDir, "stages", "ship", "artifacts", "github-mutation.json"),
    `${JSON.stringify(
      {
        enabled: true,
        branch: {
          initial: "main",
          current: blocked ? "cstack/billing-cleanup" : "cstack/billing-cleanup-ready",
          created: true,
          pushed: true,
          remote: "origin"
        },
        commit: {
          created: true,
          sha: "def456",
          message: "cstack deliver: billing cleanup",
          changedFiles: ["src/billing.ts"]
        },
        pullRequest: {
          created: true,
          updated: false,
          number: 42,
          url: "https://example.com/pr/42"
        },
        checks: {
          watched: true,
          polls: 1,
          completed: !blocked,
          summary: blocked ? "Timed out while waiting for required checks." : "Observed 1 completed required checks."
        },
        blockers: [],
        summary: "Branch pushed and pull request prepared."
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(runDir, "stages", "ship", "artifacts", "pull-request.json"), `${JSON.stringify(githubDelivery.pullRequest, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "stages", "ship", "artifacts", "issues.json"), `${JSON.stringify(githubDelivery.issues, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "stages", "ship", "artifacts", "checks.json"), `${JSON.stringify(githubDelivery.checks, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "stages", "ship", "artifacts", "actions.json"), `${JSON.stringify(githubDelivery.actions, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "stages", "ship", "artifacts", "security.json"), `${JSON.stringify(githubDelivery.security, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "stages", "ship", "artifacts", "release.json"), `${JSON.stringify(githubDelivery.release, null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(runDir, "stages", "ship", "artifacts", "readiness-policy.json"),
    `${JSON.stringify(
      {
        mode,
        readiness,
        generatedAt: "2026-03-14T12:15:20.000Z",
        summary: blocked ? "Readiness policy has 2 unmet requirements." : "Readiness policy requirements are satisfied.",
        blockers: blocked ? ["github-delivery: 2 blockers remain."] : [],
        requirements: [
          {
            name: "ship-readiness",
            required: true,
            status: blocked ? "blocked" : "satisfied",
            summary: blocked ? "Ship artifacts prepared with outstanding blockers." : "Ship artifacts prepared.",
            evidence: []
          },
          {
            name: "github-delivery",
            required: true,
            status: blocked ? "blocked" : "satisfied",
            summary: blocked ? "2 blockers remain." : "All required GitHub gates passed.",
            evidence: blocked ? ["Required check deliver/test is failing.", "Dependabot alert #7 is open at severity high."] : []
          }
        ],
        classifiedBlockers: blocked
          ? [
              {
                category: "github-delivery",
                requirement: "github-delivery",
                status: "blocked",
                summary: "2 blockers remain.",
                evidence: ["Required check deliver/test is failing.", "Dependabot alert #7 is open at severity high."]
              }
            ]
          : [],
        postReadinessSummary: {
          status: readiness,
          headline: blocked ? "Final delivery is blocked by 1 readiness category." : "Final delivery readiness is satisfied.",
          highlights: [`Ship readiness: ${readiness}`],
          blockers: blocked ? ["github-delivery: 2 blockers remain."] : [],
          nextActions: blocked ? ["Resolve the blocked GitHub gates before rerunning deliver."] : []
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "stages", "ship", "artifacts", "deployment-evidence.json"),
    `${JSON.stringify(
      {
        mode,
        generatedAt: "2026-03-14T12:15:20.000Z",
        summary: blocked ? "Recorded 3 deployment-adjacent evidence references." : "Recorded 4 deployment-adjacent evidence references.",
        blockers: [],
        references: [
          { kind: "pull-request", label: "PR #42", status: blocked ? "blocked" : "ready", url: "https://example.com/pr/42" },
          { kind: "check", label: "deliver/test", status: blocked ? "fail" : "pass" },
          { kind: "action", label: "Release", status: "success", url: "https://example.com/actions/1" }
        ],
        status: "recorded"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "artifacts", "post-ship-summary.md"),
    `${blocked ? "# Post-ship follow-up required\n" : "# Post-ship stable\n"}` +
      `\n- status: ${blocked ? "follow-up-required" : "stable"}\n- summary: synthetic post-ship status\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "artifacts", "post-ship-evidence.json"),
    `${JSON.stringify(
      {
        status: blocked || buildFailure ? "follow-up-required" : "stable",
        summary: "Synthetic post-ship evidence for inspect fixture.",
        observedAt: "2026-03-14T12:15:30.000Z",
        observedSignals: [
          {
            kind: "ship-readiness",
            status: blocked ? "blocked" : "ready",
            summary: "Synthetic ship readiness signal."
          },
          {
            kind: "github-delivery",
            status: blocked || buildFailure ? "blocked" : "ready",
            summary: "Synthetic github delivery signal."
          },
          {
            kind: "issues",
            status: blocked ? "blocked" : "ready",
            summary: "Synthetic issue signal."
          },
          {
            kind: "checks",
            status: blocked || buildFailure ? "blocked" : "ready",
            summary: "Synthetic check signal."
          },
          {
            kind: "actions",
            status: "ready",
            summary: "Synthetic actions signal."
          },
          {
            kind: "release",
            status: mode === "release" ? "ready" : "not-applicable",
            summary: "Synthetic release signal."
          },
          {
            kind: "security",
            status: blocked || buildFailure ? "blocked" : "ready",
            summary: "Synthetic security signal."
          }
        ],
        inferredRecommendations: blocked || buildFailure ? ["Re-run checks and blockers before ship is stable."] : [],
        followUpRequired: blocked || buildFailure,
        sourceArtifacts: ["artifacts/ship-record.json", "artifacts/github-delivery.json", "artifacts/github-mutation.json"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "artifacts", "follow-up-draft.md"),
    blocked || buildFailure ? "# Follow-up draft\n\n- medium: re-run blocked checks\n" : "# Follow-up draft\n\nNo follow-up required.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "artifacts", "follow-up-lineage.json"),
    `${JSON.stringify(
      {
        status: blocked || buildFailure ? "recommended" : "none",
        sourceRun: { runId, workflow: "deliver" },
        linkedIssueNumbers: githubDelivery.issueReferences,
        recommendedDrafts: blocked || buildFailure
          ? [{
            title: `Follow-up for linked issue #${githubDelivery.issueReferences[0] ?? 0} (1)`,
            reason: "Rerun delivery after blockers clear.",
            priority: "high"
          }]
          : []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(runDir, "stderr.log"), buildFailure ? "Interactive codex exited with code 1\n" : "", "utf8");

  return runId;
}

describe("inspect", () => {
  let repoDir: string;
  let runId: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-inspect-"));
    await fs.mkdir(path.join(repoDir, ".cstack", "runs"), { recursive: true });
    await fs.mkdir(path.join(repoDir, ".cstack", "prompts"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "specs"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "research"), { recursive: true });
    const fakeCodexPath = path.resolve("test/fixtures/fake-codex.mjs");
    chmodSync(fakeCodexPath, 0o755);
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
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "build.md"), "# build prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "deliver.md"), "# deliver prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# repo spec\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"), "# repo research\n", "utf8");
    await runGit(repoDir, ["init", "-b", "main"]);
    await runGit(repoDir, ["config", "user.name", "cstack inspect"]);
    await runGit(repoDir, ["config", "user.email", "cstack-inspect@example.com"]);
    await runGit(repoDir, ["config", "commit.gpgsign", "false"]);
    await runGit(repoDir, ["add", "."]);
    await runGit(repoDir, ["commit", "-m", "fixture"]);
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
    await expect(handleInspectorCommand(repoDir, inspection, "resume")).resolves.toContain(`cstack resume ${runId}`);
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

  it("loads nested build session and deliver stage artifacts for deliver runs", async () => {
    const deliverRunId = await seedDeliverRun(repoDir, { readiness: "blocked" });
    const inspection = await loadRunInspection(repoDir, deliverRunId);

    expect(inspection.sessionRecord?.mode).toBe("exec");
    expect(inspection.verificationRecord?.status).toBe("passed");
    expect(inspection.validationPlan?.status).toBe("partial");
    expect(inspection.deliverReviewVerdict?.status).toBe("changes-requested");
    expect(inspection.deliverShipRecord?.readiness).toBe("blocked");
    expect(inspection.githubMutationRecord?.pullRequest.url).toBe("https://example.com/pr/42");
    expect(inspection.githubDeliveryRecord?.overall.status).toBe("blocked");
    expect(inspection.run.status).toBe("failed");
    await expect(handleInspectorCommand(repoDir, inspection, "show verification")).resolves.toContain("\"status\": \"passed\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show validation")).resolves.toContain("Workspace targets: 2");
    await expect(handleInspectorCommand(repoDir, inspection, "show validation")).resolves.toContain("\"status\": \"partial\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show validation")).resolves.toContain("Outcome category: partial");
    await expect(handleInspectorCommand(repoDir, inspection, "show validation")).resolves.toContain("packages/cli: inventory-only");
    await expect(handleInspectorCommand(repoDir, inspection, "show pyramid")).resolves.toContain("# Test Pyramid");
    await expect(handleInspectorCommand(repoDir, inspection, "show coverage")).resolves.toContain("\"localValidationStatus\": \"passed\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show coverage")).resolves.toContain("Outcome category: partial");
    await expect(handleInspectorCommand(repoDir, inspection, "show ci-validation")).resolves.toContain("\"runner\": \"ubuntu-latest\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show tool-research")).resolves.toContain("\"tool\": \"actionlint\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show review")).resolves.toContain("\"status\": \"changes-requested\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show post-ship")).resolves.toContain("Post-ship evidence:");
    await expect(handleInspectorCommand(repoDir, inspection, "show follow-up")).resolves.toContain("Post-ship follow-up:");
    await expect(handleInspectorCommand(repoDir, inspection, "show ship")).resolves.toContain("\"readiness\": \"blocked\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show readiness")).resolves.toContain("Classified blockers:");
    await expect(handleInspectorCommand(repoDir, inspection, "show readiness")).resolves.toContain("github-delivery: 2 blockers remain.");
    await expect(handleInspectorCommand(repoDir, inspection, "show deployment")).resolves.toContain("Deployment evidence:");
    await expect(handleInspectorCommand(repoDir, inspection, "show deployment")).resolves.toContain("pull-request: PR #42");
    await expect(handleInspectorCommand(repoDir, inspection, "show mutation")).resolves.toContain("\"current\": \"cstack/billing-cleanup\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show github")).resolves.toContain("\"status\": \"blocked\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show checks")).resolves.toContain("GitHub checks gate: blocked");
    await expect(handleInspectorCommand(repoDir, inspection, "show security")).resolves.toContain("GitHub security gate: blocked");
    await expect(handleInspectorCommand(repoDir, inspection, "what remains")).resolves.toContain("github checks: Required check deliver/test is failing.");
    await expect(handleInspectorCommand(repoDir, inspection, "what remains")).resolves.toContain("github security: Dependabot alert is open.");
    await expect(handleInspectorCommand(repoDir, inspection, "show artifact stages/ship/artifacts/github-mutation.json")).resolves.toContain("\"created\": true");
    await expect(handleInspectorCommand(repoDir, inspection, "show artifact stages/ship/artifacts/checks.json")).resolves.toContain("\"conclusion\": \"fail\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show artifact stages/ship/artifacts/security.json")).resolves.toContain("\"severity\": \"high\"");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("ship readiness: blocked");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("validation: partial (partial)");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("github mutation: Branch pushed and pull request prepared.");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("github delivery: blocked (checks, security: Required check deliver/test is failing.)");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("post-ship: follow-up-required");
  });

  it("shows ready GitHub delivery details for ready deliver runs", async () => {
    const deliverRunId = await seedDeliverRun(repoDir, { readiness: "ready", mode: "release" });
    const inspection = await loadRunInspection(repoDir, deliverRunId);

    expect(inspection.run.status).toBe("completed");
    expect(inspection.deliverShipRecord?.readiness).toBe("ready");
    expect(inspection.githubMutationRecord?.branch.current).toBe("cstack/billing-cleanup-ready");
    expect(inspection.githubDeliveryRecord?.overall.status).toBe("ready");
    await expect(handleInspectorCommand(repoDir, inspection, "show readiness")).resolves.toContain("Final delivery readiness is satisfied.");
    await expect(handleInspectorCommand(repoDir, inspection, "show deployment")).resolves.toContain("status: recorded");
    await expect(handleInspectorCommand(repoDir, inspection, "show mutation")).resolves.toContain("\"url\": \"https://example.com/pr/42\"");
    await expect(handleInspectorCommand(repoDir, inspection, "show pr")).resolves.toContain("GitHub pull request gate: ready");
    await expect(handleInspectorCommand(repoDir, inspection, "show release")).resolves.toContain("GitHub release gate: ready");
    await expect(handleInspectorCommand(repoDir, inspection, "show actions")).resolves.toContain("GitHub actions gate: ready");
    await expect(handleInspectorCommand(repoDir, inspection, "show post-ship")).resolves.toContain("- status: stable");
    await expect(handleInspectorCommand(repoDir, inspection, "show follow-up")).resolves.toContain("No recommended follow-up drafts.");
    await expect(handleInspectorCommand(repoDir, inspection, "show artifact artifacts/post-ship-evidence.json")).resolves.toContain("\"status\": \"stable\"");
    await expect(handleInspectorCommand(repoDir, inspection, "what remains")).resolves.toContain("no deferred or missing work recorded");
    await expect(handleInspectorCommand(repoDir, inspection, "show artifact stages/ship/artifacts/release.json")).resolves.toContain("\"tagName\": \"v1.2.3\"");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("github delivery: ready");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("post-ship: stable");
  });

  it("can launch a mitigation workflow directly from a review inspection", async () => {
    const reviewRunId = await seedReviewRun(repoDir);
    await fs.mkdir(path.join(repoDir, ".cstack", "runs", "local-dirty"), { recursive: true });
    await fs.writeFile(path.join(repoDir, ".cstack", "runs", "local-dirty", "payload.json"), "{}\n", "utf8");
    const inspection = await loadRunInspection(repoDir, reviewRunId);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await expect(handleInspectorCommand(repoDir, inspection, "show mitigations")).resolves.toContain("default workflow: build");
      await expect(handleInspectorCommand(repoDir, inspection, "show mitigations")).resolves.toContain("Choose one source of truth for API routes");
      await expect(handleInspectorCommand(repoDir, inspection, "?")).resolves.toContain("Inspector commands:");

      const response = await executeInspectorCommand(repoDir, inspection, "mitigate 1");
      expect(response.output).toContain("Started mitigation workflow: build");
      expect(response.switchToRunId).toBeTruthy();

      const mitigationInspection = await loadRunInspection(repoDir, response.switchToRunId);
      expect(mitigationInspection.run.workflow).toBe("build");
      expect(mitigationInspection.run.inputs.linkedRunId).toBe(reviewRunId);
      expect(mitigationInspection.run.inputs.allowDirty).toBe(true);
      expect(mitigationInspection.run.summary).toContain("mitigate the findings");
    } finally {
      stdoutSpy.mockRestore();
    }
  }, 15_000);

  it("renders analysis-mode review summaries and gap commands for review runs", async () => {
    const reviewRunId = await seedReviewRun(repoDir);
    const inspection = await loadRunInspection(repoDir, reviewRunId);

    expect(inspection.deliverReviewVerdict?.mode).toBe("analysis");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("review mode: analysis");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("gap: Contract drift");
    await expect(handleInspectorCommand(repoDir, inspection, "show review")).resolves.toContain("Analysis review:");
    await expect(handleInspectorCommand(repoDir, inspection, "gaps")).resolves.toContain("Gap clusters:");
    await expect(handleInspectorCommand(repoDir, inspection, "gaps")).resolves.toContain("Recommended next slices:");
  });

  it("offers completion and suggestions in the interactive inspector model", async () => {
    const reviewRunId = await seedReviewRun(repoDir);
    const reviewInspection = await loadRunInspection(repoDir, reviewRunId);
    const intentRunId = await seedIntentFailedReviewRun(repoDir);
    const intentInspection = await loadRunInspection(repoDir, intentRunId);

    expect(completeInspectorInput(reviewInspection, "sho")[0]).toContain("show final");
    expect(completeInspectorInput(reviewInspection, "show st")[0]).toContain("show stage");
    expect(completeInspectorInput(reviewInspection, "show stage re")[0]).toContain("show stage review");
    expect(completeInspectorInput(reviewInspection, "show artifact arti")[0]).toContain("show artifact artifacts/verdict.json");
    await expect(handleInspectorCommand(reviewInspection.run.cwd, reviewInspection, "artifatcs")).resolves.toContain("Did you mean:");
    await expect(handleInspectorCommand(intentInspection.run.cwd, intentInspection, "show child review")).resolves.toContain("run:");
  });

  it("surfaces downstream review failure context from a parent intent run", async () => {
    const failedIntentRunId = await seedIntentFailedReviewRun(repoDir);
    const inspection = await loadRunInspection(repoDir, failedIntentRunId);

    expect(inspection.childRuns).toHaveLength(1);
    expect(inspection.childRuns[0]?.run.workflow).toBe("review");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("Intent run finished with downstream workflow failures");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("inspect linked child runs with `show child review`");
    await expect(handleInspectorCommand(repoDir, inspection, "artifacts")).resolves.toContain("Linked child runs:");
    await expect(handleInspectorCommand(repoDir, inspection, "artifacts")).resolves.toContain("artifacts/verdict.json");
    await expect(handleInspectorCommand(repoDir, inspection, "show stage review")).resolves.toContain("Linked child run:");
    await expect(handleInspectorCommand(repoDir, inspection, "show stage review")).resolves.toContain("workflow: review");
    await expect(handleInspectorCommand(repoDir, inspection, "what remains")).resolves.toContain("child summary:");
    await expect(handleInspectorCommand(repoDir, inspection, "f")).resolves.toContain("note: Executed through downstream review run");
  });

  it("surfaces downstream build root cause from a parent intent run", async () => {
    const failedIntentRunId = await seedIntentFailedDeliverBuildRun(repoDir);
    const inspection = await loadRunInspection(repoDir, failedIntentRunId);

    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("root cause: downstream build failed: interactive Codex exited with code 1");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("no Codex session id was observed");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("verification did not run");
    await expect(handleInspectorCommand(repoDir, inspection, "show stage build")).resolves.toContain("root cause stage: build");
    await expect(handleInspectorCommand(repoDir, inspection, "show stage build")).resolves.toContain("transcript: missing");
    await expect(handleInspectorCommand(repoDir, inspection, "show child build")).resolves.toContain("build final:");
    await expect(handleInspectorCommand(repoDir, inspection, "show child build")).resolves.toContain("- exit code: 1");
    await expect(handleInspectorCommand(repoDir, inspection, "what remains")).resolves.toContain("child summary: interactive Codex exited with code 1");
  });

  it("explains routing decisions for mixed prompts in inspect output", async () => {
    const failedIntentRunId = await seedIntentFailedDeliverBuildRun(repoDir);
    const inspection = await loadRunInspection(repoDir, failedIntentRunId);

    await expect(handleInspectorCommand(repoDir, inspection, "show routing")).resolves.toContain("Decision: mixed");
    await expect(handleInspectorCommand(repoDir, inspection, "show routing")).resolves.toContain(
      "matched signals: analysis, implementation, review"
    );
    await expect(handleInspectorCommand(repoDir, inspection, "show routing")).resolves.toContain(
      "implementation: matched (work on, closing)"
    );
  });

  it("surfaces direct build root cause inside failed deliver inspections", async () => {
    const deliverRunId = await seedDeliverRun(repoDir, { buildFailure: true });
    const inspection = await loadRunInspection(repoDir, deliverRunId);

    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("root cause: build failed: interactive Codex exited with code 1");
    await expect(handleInspectorCommand(repoDir, inspection, "show stage build")).resolves.toContain("Direct build evidence:");
    await expect(handleInspectorCommand(repoDir, inspection, "show stage build")).resolves.toContain("verification: not-run");
    await expect(handleInspectorCommand(repoDir, inspection, "stages")).resolves.toContain("root cause: interactive Codex exited with code 1");
  });

  it("surfaces stale child lineage instead of hiding missing child runs", async () => {
    const failedIntentRunId = await seedIntentFailedDeliverBuildRun(repoDir);
    const runDir = path.join(repoDir, ".cstack", "runs", failedIntentRunId);
    const stageLineagePath = path.join(runDir, "stage-lineage.json");
    const stageLineage = JSON.parse(await fs.readFile(stageLineagePath, "utf8")) as StageLineage;
    const deliverRunId = stageLineage.stages.find((stage) => stage.name === "build")?.childRunId;
    expect(deliverRunId).toBeTruthy();
    await fs.rm(path.join(repoDir, ".cstack", "runs", deliverRunId!), { recursive: true, force: true });

    const inspection = await loadRunInspection(repoDir, failedIntentRunId);

    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("linked child run missing for stage build");
    await expect(handleInspectorCommand(repoDir, inspection, "artifacts")).resolves.toContain("Stale child lineage:");
    await expect(handleInspectorCommand(repoDir, inspection, "what remains")).resolves.toContain("child run");
    await expect(handleInspectorCommand(repoDir, inspection, "what remains")).resolves.toContain("missing or unreadable");
    await expect(handleInspectorCommand(repoDir, inspection, "show child build")).resolves.toContain("missing or unreadable");
    await expect(handleInspectorCommand(repoDir, inspection, "show stage build")).resolves.toContain("Linked child run:");
  });

  it("degrades to missing-artifact messages when inspection json artifacts are corrupt", async () => {
    const deliverRunId = await seedDeliverRun(repoDir, { readiness: "blocked" });
    const runDir = path.join(repoDir, ".cstack", "runs", deliverRunId);
    await fs.writeFile(path.join(runDir, "stages", "validation", "validation-plan.json"), "{not-json\n", "utf8");
    await fs.writeFile(path.join(runDir, "stages", "review", "artifacts", "verdict.json"), "{still-not-json\n", "utf8");

    const inspection = await loadRunInspection(repoDir, deliverRunId);

    expect(inspection.validationPlan).toBeNull();
    expect(inspection.deliverReviewVerdict).toBeNull();
    await expect(handleInspectorCommand(repoDir, inspection, "show validation")).resolves.toContain("No validation plan was recorded");
    await expect(handleInspectorCommand(repoDir, inspection, "show review")).resolves.toContain("No deliver review verdict was recorded");
    await expect(handleInspectorCommand(repoDir, inspection, "1")).resolves.toContain("ship readiness: blocked");
  });

  it("keeps partial nested child runs inspectable when child artifacts are missing or corrupt", async () => {
    const failedIntentRunId = await seedIntentFailedDeliverBuildRun(repoDir);
    const parentLineage = JSON.parse(
      await fs.readFile(path.join(repoDir, ".cstack", "runs", failedIntentRunId, "stage-lineage.json"), "utf8")
    ) as StageLineage;
    const childRunId = parentLineage.stages.find((stage) => stage.name === "build")?.childRunId;
    expect(childRunId).toBeTruthy();
    const childRunDir = path.join(repoDir, ".cstack", "runs", childRunId!);
    await fs.rm(path.join(childRunDir, "stages", "build", "final.md"), { force: true });
    await fs.writeFile(path.join(childRunDir, "stage-lineage.json"), "{broken-lineage\n", "utf8");

    const inspection = await loadRunInspection(repoDir, failedIntentRunId);

    expect(inspection.childRuns.some((child) => child.stageName === "build" && child.run.id === childRunId)).toBe(true);
    await expect(handleInspectorCommand(repoDir, inspection, "show child build")).resolves.toContain(`- run: ${childRunId}`);
    await expect(handleInspectorCommand(repoDir, inspection, "show child build")).resolves.toContain("root cause stage: build");
    await expect(handleInspectorCommand(repoDir, inspection, "show stage build")).resolves.toContain("Linked child run:");
    await expect(handleInspectorCommand(repoDir, inspection, "artifacts")).resolves.toContain(`- child build: ${childRunId} (failed)`);
  });

  it("renders planning issue artifacts for spec runs", async () => {
    const runId = "2026-03-14T11-00-00-spec-issue-linked";
    const runDir = path.join(repoDir, ".cstack", "runs", runId);
    await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

    const run: RunRecord = {
      id: runId,
      workflow: "spec",
      createdAt: "2026-03-14T11:00:00.000Z",
      updatedAt: "2026-03-14T11:00:20.000Z",
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
      summary: "Issue-linked spec",
      inputs: {
        userPrompt: "Issue-linked spec",
        planningIssueNumber: 123
      }
    };

    await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(runDir, "final.md"), "# Final\n\nSpec summary.\n", "utf8");
    await fs.writeFile(path.join(runDir, "artifacts", "spec.md"), "# Spec\n", "utf8");
    await fs.writeFile(path.join(runDir, "artifacts", "issue-draft.md"), "# Planning Issue Draft: #123\n", "utf8");
    await fs.writeFile(
      path.join(runDir, "artifacts", "issue-lineage.json"),
      `${JSON.stringify({
        planningIssueNumber: 123,
        currentRun: { runId, workflow: "spec" },
        downstreamPullRequests: [],
        downstreamReleases: []
      }, null, 2)}\n`,
      "utf8"
    );

    const inspection = await loadRunInspection(repoDir, runId);

    await expect(handleInspectorCommand(repoDir, inspection, "summary")).resolves.toContain("planning issue: #123");
    await expect(handleInspectorCommand(repoDir, inspection, "summary")).resolves.toContain("issue draft: artifacts/issue-draft.md");
    await expect(handleInspectorCommand(repoDir, inspection, "show issue")).resolves.toContain("Planning issue: #123");
    await expect(handleInspectorCommand(repoDir, inspection, "show issue")).resolves.toContain("Issue lineage: artifacts/issue-lineage.json");
  });

  it("renders planning issue artifacts for discover runs", async () => {
    const runId = "2026-03-14T11-00-00-discover-issue-linked";
    const runDir = path.join(repoDir, ".cstack", "runs", runId);
    await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });

    const run: RunRecord = {
      id: runId,
      workflow: "discover",
      createdAt: "2026-03-14T11:00:00.000Z",
      updatedAt: "2026-03-14T11:00:20.000Z",
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
      summary: "Issue-linked discover",
      inputs: {
        userPrompt: "Issue-linked discover",
        planningIssueNumber: 123
      }
    };

    await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(runDir, "final.md"), "# Final\n\nDiscover summary.\n", "utf8");
    await fs.writeFile(path.join(runDir, "artifacts", "findings.md"), "# Findings\n", "utf8");
    await fs.writeFile(
      path.join(runDir, "artifacts", "issue-lineage.json"),
      `${JSON.stringify({
        planningIssueNumber: 123,
        currentRun: { runId, workflow: "discover" },
        downstreamPullRequests: [],
        downstreamReleases: []
      }, null, 2)}\n`,
      "utf8"
    );

    const inspection = await loadRunInspection(repoDir, runId);

    await expect(handleInspectorCommand(repoDir, inspection, "summary")).resolves.toContain("planning issue: #123");
    await expect(handleInspectorCommand(repoDir, inspection, "summary")).resolves.toContain("issue lineage: artifacts/issue-lineage.json");
    await expect(handleInspectorCommand(repoDir, inspection, "show issue")).resolves.toContain("Planning issue: #123");
    await expect(handleInspectorCommand(repoDir, inspection, "show issue")).resolves.toContain(`Current run: ${runId} (discover)`);
  });

  it("derives initiative summaries from run metadata when no artifact is present", async () => {
    const baselineRunId = "2026-03-14T11-00-00-spec-cache-base";
    const baselineRunDir = path.join(repoDir, ".cstack", "runs", baselineRunId);
    const baselineRun: RunRecord = {
      id: baselineRunId,
      workflow: "spec",
      createdAt: "2026-03-14T11:00:00.000Z",
      updatedAt: "2026-03-14T11:00:05.000Z",
      status: "completed",
      cwd: repoDir,
      gitBranch: "main",
      codexVersion: "fake",
      codexCommand: ["codex", "exec"],
      promptPath: path.join(baselineRunDir, "prompt.md"),
      finalPath: path.join(baselineRunDir, "final.md"),
      contextPath: path.join(baselineRunDir, "context.md"),
      stdoutPath: path.join(baselineRunDir, "stdout.log"),
      stderrPath: path.join(baselineRunDir, "stderr.log"),
      configSources: [],
      summary: "Baseline initiative planning",
      inputs: {
        userPrompt: "Baseline initiative planning",
        initiativeId: "initiative-cache",
        initiativeTitle: "Cache rollout"
      }
    };
    const currentRunId = "2026-03-14T11-10-00-spec-cache-follow-up";
    const currentRunDir = path.join(repoDir, ".cstack", "runs", currentRunId);
    const currentRun: RunRecord = {
      id: currentRunId,
      workflow: "spec",
      createdAt: "2026-03-14T11:10:00.000Z",
      updatedAt: "2026-03-14T11:10:05.000Z",
      status: "completed",
      cwd: repoDir,
      gitBranch: "main",
      codexVersion: "fake",
      codexCommand: ["codex", "exec"],
      promptPath: path.join(currentRunDir, "prompt.md"),
      finalPath: path.join(currentRunDir, "final.md"),
      contextPath: path.join(currentRunDir, "context.md"),
      eventsPath: path.join(currentRunDir, "events.jsonl"),
      stdoutPath: path.join(currentRunDir, "stdout.log"),
      stderrPath: path.join(currentRunDir, "stderr.log"),
      configSources: [],
      summary: "Follow-up initiative planning",
      inputs: {
        userPrompt: "Follow-up initiative planning",
        initiativeId: "initiative-cache",
        initiativeTitle: "Cache rollout"
      }
    };

    await fs.mkdir(baselineRunDir, { recursive: true });
    await fs.mkdir(currentRunDir, { recursive: true });
    await fs.writeFile(path.join(baselineRunDir, "run.json"), `${JSON.stringify(baselineRun, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(currentRunDir, "run.json"), `${JSON.stringify(currentRun, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(baselineRunDir, "final.md"), "# Final\n", "utf8");
    await fs.writeFile(path.join(currentRunDir, "final.md"), "# Final\n", "utf8");

    const inspection = await loadRunInspection(repoDir, currentRunId);

    expect(inspection.initiativeGraph?.initiativeId).toBe("initiative-cache");
    expect(inspection.initiativeGraph?.relatedRuns.some((entry) => entry.runId === baselineRunId)).toBe(true);
    await expect(handleInspectorCommand(repoDir, inspection, "summary")).resolves.toContain(
      "initiative: initiative-cache (Cache rollout)"
    );
    await expect(handleInspectorCommand(repoDir, inspection, "summary")).resolves.toContain(
      "initiative graph: derived from run metadata"
    );
    await expect(handleInspectorCommand(repoDir, inspection, "show initiative")).resolves.toContain(
      "Initiative: initiative-cache (Cache rollout)"
    );
    await expect(handleInspectorCommand(repoDir, inspection, "show initiative")).resolves.toContain("Run group:");
    await expect(handleInspectorCommand(repoDir, inspection, "show initiative")).resolves.toContain(
      `${baselineRunId} (spec, completed)`
    );
  });
});
