#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const fixturePath = path.join(process.cwd(), ".cstack", "test-codex.json");

async function loadFixture() {
  try {
    return JSON.parse(await readFile(fixturePath, "utf8"));
  } catch {
    return {};
  }
}

const fixture = await loadFixture();

function envValue(name) {
  const value = fixture[name];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return process.env[name];
}

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

if (prompt.includes("## Build execution contract") && envValue("FAKE_CODEX_EARLY_EXIT_BUILD") === "1") {
  process.stderr.write("Interactive codex exited with code 1\n");
  process.exit(1);
}

await new Promise((resolve) => process.stderr.write("session id: fake-session-123\n", resolve));
if (envValue("FAKE_CODEX_ACTIVITY_AFTER_SESSION") === "1") {
  await new Promise((resolve) =>
    process.stderr.write("I'm checking the local repository and the referenced planning documents.\n", resolve)
  );
  await new Promise((resolve) =>
    process.stderr.write("exec /bin/zsh -lc pwd in /tmp succeeded in 0ms:\n", resolve)
  );
}
if (envValue("FAKE_CODEX_HANG_AFTER_SESSION_MS")) {
  await new Promise((resolve) => setTimeout(resolve, Number.parseInt(envValue("FAKE_CODEX_HANG_AFTER_SESSION_MS"), 10)));
}
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
  if (envValue("FAKE_CODEX_FAIL_BUILD") === "1") {
    process.stderr.write("fake build failure\n");
    process.exit(1);
  }
  await writeFile(path.join(process.cwd(), "codex-generated-change.txt"), "generated by fake codex\n", "utf8");
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
  if (envValue("FAKE_CODEX_NO_FINAL_VALIDATION") === "1") {
    process.stderr.write("synthetic validation failure without final output\n");
    process.exit(1);
  }
  if (envValue("FAKE_CODEX_VALIDATION_MUTATE_REPO") === "1") {
    await writeFile(path.join(process.cwd(), "README.md"), "# mutated during validation\n", "utf8");
  }
  const validationStatus = envValue("FAKE_CODEX_VALIDATION_STATUS") ?? "ready";
  const validationCommand = envValue("FAKE_CODEX_VALIDATION_COMMAND") ?? "node -e \"process.stdout.write('deliver verify ok')\"";
  const manyCommands = envValue("FAKE_CODEX_VALIDATION_MANY_COMMANDS") === "1";
  const localCommands = manyCommands
    ? [
        validationCommand,
        "npm run lint",
        "npm run typecheck",
        "npm test",
        "npm run ci:e2e"
      ]
    : [validationCommand];
  const ciJobs = manyCommands
    ? [
        {
          name: "validation",
          runner: "ubuntu-latest",
          purpose: "Run selected validation commands.",
          commands: localCommands,
          artifacts: ["test-reports"]
        },
        {
          name: "contract-sync",
          runner: "ubuntu-latest",
          purpose: "Check contract alignment.",
          commands: ["npm run validate:contract-sync", "npm run validate:api", "npm run test:integration"],
          artifacts: ["contract-report"]
        },
        {
          name: "compose-smoke",
          runner: "ubuntu-latest",
          purpose: "Validate compose stacks.",
          commands: ["npm run validate:compose"],
          artifacts: ["compose-report"]
        }
      ]
    : [
        {
          name: "validation",
          runner: "ubuntu-latest",
          purpose: "Run selected validation commands.",
          commands: [validationCommand],
          artifacts: ["test-reports"]
        }
      ];
  const noLocalValidationCommands = envValue("FAKE_CODEX_NO_LOCAL_VALIDATION_COMMANDS") === "1";
  const validationGap = validationStatus === "partial" ? ["Validation evidence intentionally missing from this fake fixture to force partial workflow handling."] : [];
  body = JSON.stringify(
    {
      status: validationStatus,
      summary:
        validationStatus === "ready"
          ? "Validation plan completed with bounded local and CI validation."
          : "Validation evidence is intentionally incomplete for test control.",
      profileSummary: "Detected a JavaScript/TypeScript repository with GitHub Actions and packaging validation needs.",
      boundedScope: true,
      selectedScope: ["local command: node -e \"process.stdout.write('deliver verify ok')\"", "ci job: validation"],
      deferredScope: manyCommands ? ["local command: npm run typecheck", "ci job: compose-smoke"] : [],
      classificationReason: "bounded validation first slice",
      layers: [
        {
          name: "static",
          selected: true,
          status: "ready",
          rationale: "Static checks catch syntax, types, and workflow errors early.",
          selectedTools: ["actionlint", "zizmor"],
          localCommands: noLocalValidationCommands ? [] : localCommands,
          ciCommands: localCommands,
          coverageIntent: ["type and workflow correctness"],
          notes: []
        },
        {
          name: "unit-component",
          selected: true,
          status: "ready",
          rationale: "Unit checks protect the common regression surface.",
          selectedTools: ["vitest"],
          localCommands: noLocalValidationCommands ? [] : localCommands,
          ciCommands: localCommands,
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
          localCommands: noLocalValidationCommands ? [] : localCommands,
          ciCommands: localCommands,
          coverageIntent: ["packaging confidence"],
          notes: []
        }
      ],
      selectedSpecialists: [],
      localValidation: {
        commands: noLocalValidationCommands ? [] : localCommands,
        prerequisites: ["linux-default"],
        notes: []
      },
      ciValidation: {
        workflowFiles: [".github/workflows/release.yml"],
        jobs: ciJobs,
        notes: []
      },
      coverage: {
        confidence: "medium",
        summary: "Coverage is layered and centered on the highest-signal checks for this fake fixture.",
        signals: ["build verification carried forward", "validation pyramid created"],
        gaps: validationGap
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
  if (envValue("FAKE_CODEX_VALIDATION_SPECIALIST_REGISTRY_STALL") === "1") {
    await new Promise((resolve) =>
      process.stderr.write(
        "I’m checking current workflow lint output before changing anything so the fixes are tied to real findings rather than generic hardening advice.\n",
        resolve
      )
    );
    await new Promise((resolve) =>
      process.stderr.write(
        "error: Request failed after 3 retries in 12.6s\n  Caused by: Failed to fetch: `https://pypi.org/simple/zizmor/`\n  Caused by: error sending request for url (https://pypi.org/simple/zizmor/)\n  Caused by: client error (Connect)\n  Caused by: dns error\n  Caused by: failed to lookup address information: nodename nor servname provided, or not known\n",
        resolve
      )
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Number.parseInt(envValue("FAKE_CODEX_VALIDATION_SPECIALIST_STALL_MS") ?? "5000", 10))
    );
    process.exit(1);
  }
  body = [
    "# Validation Specialist Findings",
    "",
    "Validation specialist review completed.",
    "",
    "No blocking gaps detected in the fake fixture."
  ].join("\n");
} else if (prompt.includes("You are the `Review Lead` for a bounded `cstack review` workflow running in analysis mode.")) {
  body = JSON.stringify(
    {
      mode: "analysis",
      status: "completed",
      summary: "Gap analysis completed. High-priority product and delivery gaps remain.",
      findings: [
        {
          severity: "high",
          title: "Contract drift",
          detail: "The shipped interfaces and the planned contract are no longer aligned."
        },
        {
          severity: "warning",
          title: "Validation evidence missing",
          detail: "There is no runnable end-to-end evidence attached to this review path."
        }
      ],
      recommendedActions: [
        "Align the repo on one source of truth for API routes and ingest semantics.",
        "Add verification evidence before treating the project as release-ready."
      ],
      gapClusters: [
        {
          title: "Contract drift",
          severity: "high",
          summary: "The API, connector, and documented behavior no longer describe the same system.",
          evidence: ["spec drift", "connector mismatch"]
        },
        {
          title: "Validation gap",
          severity: "high",
          summary: "The repo lacks runnable end-to-end or contract validation evidence for the advertised behavior.",
          evidence: ["missing verification artifacts"]
        }
      ],
      likelyRootCauses: [
        "Contract updates and implementation changes are landing through different paths.",
        "Validation expectations are not encoded as a required workflow gate."
      ],
      recommendedNextSlices: [
        "Define and align one API contract across code, docs, and clients.",
        "Add runnable verification for the main ingest and metadata flows."
      ],
      confidence: "high",
      evidenceNotes: ["Fake fixture inferred gaps from the linked prompt contract."],
      acceptedSpecialists: [],
      reportMarkdown: "# Review Findings\n\nGap analysis completed.\n"
    },
    null,
    2
  );
} else if (prompt.includes("You are the `Review Lead` for a bounded `cstack deliver` workflow.")) {
  if (envValue("FAKE_CODEX_NO_FINAL_DELIVER_REVIEW") === "1") {
    process.stderr.write("synthetic deliver review failure without final output\n");
    process.exit(1);
  }
  body = JSON.stringify(
    {
      mode: "readiness",
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
  if (envValue("FAKE_CODEX_NO_FINAL_SHIP") === "1") {
    process.stderr.write("synthetic ship failure without final output\n");
    process.exit(1);
  }
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
} else if (envValue("FAKE_CODEX_SPEC_TOO_BROAD") === "1") {
  body = [
    "# Fake Spec",
    "",
    "## Summary",
    "This plan spans multiple workstreams across the repository.",
    "",
    "## Workstreams",
    "- Align every API contract and connector in one pass.",
    "- Rebuild validation across Java, Python, and Node simultaneously.",
    "- Rewrite release automation and docs.",
    "",
    "## Roadmap",
    "1. Audit everything.",
    "2. Implement the platform-wide changes.",
    "3. Revisit any remaining drift."
  ].join("\n");
} else if (envValue("FAKE_CODEX_SPEC_BOUNDED") === "1" || prompt.includes("## Required output headings")) {
  body = [
    "# Fake Spec",
    "",
    "## Gap Clusters",
    "- API contract drift between implementation and documented behavior.",
    "- Missing runnable validation for the main metadata ingest path.",
    "",
    "## Selected First Slice",
    "Add one bounded contract-validation slice for the metadata ingest endpoint and stop after the narrowest implementation-ready plan.",
    "",
    "## Files In Scope",
    "- specs/001-plan-alignment/contracts/api.yaml",
    "- packages/api/src/routes/connectors.ts",
    "- packages/connectors/java/integration-tests/src/test/java/com/sqlite/metadata/integration/ApiContractTest.java",
    "",
    "## Validation",
    "- Run the contract integration test for the ingest endpoint.",
    "- Verify the documented route and implementation semantics match.",
    "",
    "## Out Of Scope",
    "- Do not redesign unrelated connector flows.",
    "- Do not rewrite the release pipeline in this slice.",
    "",
    "## Open Questions",
    "- Confirm whether Python connector parity belongs in a follow-up slice."
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

if (envValue("FAKE_CODEX_DISCOVER_DELAY_MS") && prompt.includes("cstack discover")) {
  await new Promise((resolve) => setTimeout(resolve, Number.parseInt(envValue("FAKE_CODEX_DISCOVER_DELAY_MS"), 10)));
} else if (envValue("FAKE_CODEX_DELAY_MS")) {
  await new Promise((resolve) => setTimeout(resolve, Number.parseInt(envValue("FAKE_CODEX_DELAY_MS"), 10)));
}

const resolvedFinalPath =
  finalPath ??
  prompt.match(/write a concise markdown summary to:\s*(.+)$/im)?.[1]?.trim();

if (!resolvedFinalPath) {
  process.stderr.write("missing final path\n");
  process.exit(2);
}

if (envValue("FAKE_CODEX_PRINT_BODY") === "1" || envValue("FAKE_CODEX_STALL_AFTER_OUTPUT_MS")) {
  await new Promise((resolve) => process.stdout.write(`${body}\n`, resolve));
}

if (envValue("FAKE_CODEX_SKIP_FINAL_WRITE") !== "1") {
  await writeFile(resolvedFinalPath, `${body}\n`, "utf8");
}

await new Promise((resolve) => process.stdout.write("writing final output\n", resolve));
process.stdout.write("completed\n");

if (envValue("FAKE_CODEX_KEEP_STDIO_OPEN_MS")) {
  const holdOpenMs = Number.parseInt(envValue("FAKE_CODEX_KEEP_STDIO_OPEN_MS"), 10);
  const sidecar = spawn(process.execPath, ["-e", `setTimeout(() => {}, ${holdOpenMs})`], {
    stdio: "inherit",
    detached: true
  });
  sidecar.unref();
}

if (envValue("FAKE_CODEX_STALL_AFTER_OUTPUT_MS")) {
  await new Promise((resolve) => setTimeout(resolve, Number.parseInt(envValue("FAKE_CODEX_STALL_AFTER_OUTPUT_MS"), 10)));
}

if (envValue("FAKE_CODEX_EXIT_CODE")) {
  process.exit(Number.parseInt(envValue("FAKE_CODEX_EXIT_CODE"), 10));
}
