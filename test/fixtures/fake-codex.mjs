#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  await new Promise((resolve) => process.stdout.write("fake-codex 0.0.1\n", resolve));
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
