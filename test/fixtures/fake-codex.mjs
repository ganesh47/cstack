#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("fake-codex 0.0.1\n");
  process.exit(0);
}

const finalIndex = args.indexOf("--output-last-message");
const finalPath = finalIndex >= 0 ? args[finalIndex + 1] : undefined;

let prompt = "";
for await (const chunk of process.stdin) {
  prompt += chunk.toString("utf8");
}

process.stderr.write("session id: fake-session-123\n");

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
    prompt.includes("Repository spec context") ? "Context included." : "Context missing."
  ].join("\n") + "\n",
  "utf8"
);

process.stdout.write("completed\n");
