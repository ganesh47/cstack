#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  await new Promise((resolve) => process.stdout.write("fake-codex 0.0.1\n", resolve));
  process.exit(0);
}

const finalIndex = args.indexOf("--output-last-message");
const finalPath = finalIndex >= 0 ? args[finalIndex + 1] : undefined;

let prompt = "";
for await (const chunk of process.stdin) {
  prompt += chunk.toString("utf8");
}

await new Promise((resolve) => process.stderr.write("session id: fake-session-123\n", resolve));
await new Promise((resolve) => process.stdout.write("scanning repository context\n", resolve));
await new Promise((resolve) => setTimeout(resolve, 25));

if (!finalPath) {
  process.stderr.write("missing final path\n");
  process.exit(2);
}

await writeFile(
  finalPath,
  [
    "# Fake Spec",
    "",
    "This is a fake Codex response.",
    "",
    prompt.includes("Repository spec excerpt") || prompt.includes("Repository spec context")
      ? "Context included."
      : "Context missing."
  ].join("\n") + "\n",
  "utf8"
);

await new Promise((resolve) => process.stdout.write("writing final output\n", resolve));
process.stdout.write("completed\n");
