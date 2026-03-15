#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  await new Promise((resolve) => process.stdout.write("fake-codex 0.0.1\n", resolve));
  process.exit(0);
}

if (args[0] === "resume") {
  await new Promise((resolve) => process.stdout.write(`resumed session ${args[1] ?? "unknown"}\n`, resolve));
  process.exit(0);
}

if (args[0] === "fork") {
  await new Promise((resolve) => process.stderr.write("session id: fake-fork-session-789\n", resolve));
  await new Promise((resolve) => process.stdout.write(`forked session ${args[1] ?? "unknown"}\n`, resolve));
  process.exit(0);
}

const finalIndex = args.indexOf("--output-last-message");
const finalPath = finalIndex >= 0 ? args[finalIndex + 1] : undefined;
const promptFromArgs = finalIndex >= 0 ? args.at(-1) : args.filter((arg) => !arg.startsWith("-")).at(-1);

let prompt = "";
for await (const chunk of process.stdin) {
  prompt += chunk.toString("utf8");
}
prompt = prompt.trim() || (promptFromArgs ?? "");

await new Promise((resolve) => process.stderr.write("session id: fake-session-123\n", resolve));
await new Promise((resolve) => process.stdout.write("scanning repository context\n", resolve));
await new Promise((resolve) => setTimeout(resolve, 25));

let body;
if (prompt.includes("track in a bounded `cstack discover` research run")) {
  const track = prompt.includes("`external-researcher`")
    ? "external-researcher"
    : prompt.includes("`risk-researcher`")
      ? "risk-researcher"
      : "repo-explorer";
  body = JSON.stringify(
    {
      status: "completed",
      summary: `Fake delegated findings for ${track}.`,
      filesInspected: track === "external-researcher" ? [] : ["src/cli.ts", "README.md"],
      commandsRun: track === "external-researcher" ? ["web.lookup official docs"] : ["rg discover src README.md"],
      sources:
        track === "external-researcher"
          ? [
              {
                title: "Official example source",
                location: "https://example.com/docs",
                kind: "url",
                retrievedAt: "2026-03-14T00:00:00.000Z"
              }
            ]
          : [
              {
                title: "Local repo",
                location: "src/cli.ts",
                kind: "file"
              }
            ],
      findings: [`Finding from ${track}`],
      confidence: "high",
      unresolved: track === "risk-researcher" ? ["Need real threat model input."] : []
    },
    null,
    2
  );
} else if (prompt.includes("You are the `Research Lead` for a bounded `cstack discover` run.")) {
  body = JSON.stringify(
    {
      summary: "Fake discover synthesis.",
      localFindings: ["Repo findings accepted."],
      externalFindings: prompt.includes("external-researcher") ? ["External findings included."] : [],
      risks: prompt.includes("risk-researcher") ? ["Risk findings included."] : [],
      openQuestions: [],
      delegateDisposition: [
        { track: "repo-explorer", leaderDisposition: "accepted", reason: "Useful local context." },
        ...(prompt.includes("external-researcher")
          ? [{ track: "external-researcher", leaderDisposition: "accepted", reason: "Useful external context." }]
          : []),
        ...(prompt.includes("risk-researcher")
          ? [{ track: "risk-researcher", leaderDisposition: "accepted", reason: "Useful risk context." }]
          : [])
      ],
      reportMarkdown: [
        "# Fake Spec",
        "",
        "This is a fake Codex response.",
        "",
        "Research Lead synthesis complete.",
        "",
        prompt.includes("external-researcher") ? "External findings included." : "External findings absent."
      ].join("\n")
    },
    null,
    2
  );
} else if (prompt.includes("## Build execution contract")) {
  body = [
    "# Build Summary",
    "",
    "Implemented the requested change in the fake Codex fixture.",
    "",
    prompt.includes("Linked run:")
      ? "Linked context included."
      : "Linked context missing."
  ].join("\n");
} else if (prompt.includes("You are the `Validation Lead` for a bounded `cstack deliver` workflow.")) {
  body = JSON.stringify(
    {
      status: "ready",
      summary: "Validation plan completed with bounded local and CI validation.",
      profileSummary: "Detected a JavaScript/TypeScript repository with GitHub Actions and packaging validation needs.",
      layers: [
        {
          name: "static",
          selected: true,
          status: "ready",
          rationale: "Static checks catch syntax, types, and workflow errors early.",
          selectedTools: ["actionlint", "zizmor"],
          localCommands: ["node -e \"process.stdout.write('deliver verify ok')\""],
          ciCommands: ["node -e \"process.stdout.write('deliver verify ok')\""],
          coverageIntent: ["type and workflow correctness"],
          notes: []
        },
        {
          name: "unit-component",
          selected: true,
          status: "ready",
          rationale: "Unit checks protect the common regression surface.",
          selectedTools: ["vitest"],
          localCommands: ["node -e \"process.stdout.write('deliver verify ok')\""],
          ciCommands: ["node -e \"process.stdout.write('deliver verify ok')\""],
          coverageIntent: ["behavioral regressions"],
          notes: []
        },
        {
          name: "integration-contract",
          selected: false,
          status: "skipped",
          rationale: "No service contract was inferred in the fake fixture.",
          selectedTools: [],
          localCommands: [],
          ciCommands: [],
          coverageIntent: [],
          notes: []
        },
        {
          name: "e2e-system",
          selected: false,
          status: "skipped",
          rationale: "No browser or mobile runtime was inferred in the fake fixture.",
          selectedTools: [],
          localCommands: [],
          ciCommands: [],
          coverageIntent: [],
          notes: []
        },
        {
          name: "packaging-smoke",
          selected: true,
          status: "ready",
          rationale: "Build and packaging smoke should stay in the delivery path.",
          selectedTools: ["github_actions"],
          localCommands: ["node -e \"process.stdout.write('deliver verify ok')\""],
          ciCommands: ["node -e \"process.stdout.write('deliver verify ok')\""],
          coverageIntent: ["packaging confidence"],
          notes: []
        }
      ],
      selectedSpecialists: [],
      localValidation: {
        commands: ["node -e \"process.stdout.write('deliver verify ok')\""],
        prerequisites: ["linux-default"],
        notes: []
      },
      ciValidation: {
        workflowFiles: [".github/workflows/release.yml"],
        jobs: [
          {
            name: "validation",
            runner: "ubuntu-latest",
            purpose: "Run selected validation commands.",
            commands: ["node -e \"process.stdout.write('deliver verify ok')\""],
            artifacts: ["test-reports"]
          }
        ],
        notes: []
      },
      coverage: {
        confidence: "medium",
        summary: "Coverage is layered and centered on the highest-signal checks for this fake fixture.",
        signals: ["build verification carried forward", "validation pyramid created"],
        gaps: []
      },
      recommendedChanges: ["Keep local and CI validation commands aligned."],
      unsupported: [],
      pyramidMarkdown: "# Test Pyramid\n\n- static\n- unit-component\n- packaging-smoke\n",
      reportMarkdown: "# Validation Summary\n\nValidation completed.\n",
      githubActionsPlanMarkdown: "# GitHub Actions Validation Plan\n\nUse one `validation` job on `ubuntu-latest`.\n"
    },
    null,
    2
  );
} else if (prompt.includes("specialist for the `validation` stage inside `cstack deliver`")) {
  body = [
    "# Validation Specialist Findings",
    "",
    "Validation specialist review completed.",
    "",
    "No blocking gaps detected in the fake fixture."
  ].join("\n");
} else if (prompt.includes("You are the `Review Lead` for a bounded `cstack deliver` workflow.")) {
  body = JSON.stringify(
    {
      status: "ready",
      summary: "Review completed with bounded follow-up.",
      findings: [
        {
          severity: "warning",
          title: "Release readiness follow-up",
          detail: "Review the release checklist before merge."
        }
      ],
      recommendedActions: ["Review the release checklist before merge."],
      acceptedSpecialists: [],
      reportMarkdown: "# Review Findings\n\nBounded follow-up required.\n"
    },
    null,
    2
  );
} else if (prompt.includes("You are the `Ship Lead` for a bounded `cstack deliver` workflow.")) {
  body = JSON.stringify(
    {
      readiness: "ready",
      summary: "Ship artifacts prepared.",
      checklist: [
        { item: "Confirm version bump.", status: "complete" },
        { item: "Confirm verification artifacts.", status: "complete" }
      ],
      unresolved: ["Remote deployment remains manual."],
      nextActions: ["Handle remote deployment outside the wrapper."],
      reportMarkdown: "# Ship Summary\n\nReady for local handoff.\n"
    },
    null,
    2
  );
} else if (prompt.includes("specialist for a `cstack deliver` review stage")) {
  body = [
    "# Specialist Findings",
    "",
    "Deliver specialist review completed.",
    "",
    "Concrete follow-up recorded."
  ].join("\n");
} else {
  body = [
    "# Fake Spec",
    "",
    "This is a fake Codex response.",
    "",
    prompt.includes("Repository spec excerpt") || prompt.includes("Repository spec context")
      ? "Context included."
      : "Context missing."
  ].join("\n");
}

const resolvedFinalPath =
  finalPath ??
  prompt.match(/write a concise markdown summary to:\s*(.+)$/im)?.[1]?.trim();

if (!resolvedFinalPath) {
  process.stderr.write("missing final path\n");
  process.exit(2);
}

await writeFile(resolvedFinalPath, `${body}\n`, "utf8");

await new Promise((resolve) => process.stdout.write("writing final output\n", resolve));
process.stdout.write("completed\n");
