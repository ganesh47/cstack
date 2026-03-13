#!/usr/bin/env node
import path from "node:path";
import { runSpec } from "./commands/spec.js";
import { runRuns } from "./commands/runs.js";
import { runInspect } from "./commands/inspect.js";

function usage(): string {
  return [
    "Usage:",
    "  cstack spec <prompt>",
    "  cstack runs",
    "  cstack inspect [run-id]"
  ].join("\n");
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "spec":
      await runSpec(cwd, rest.join(" "));
      return;
    case "runs":
      await runRuns(cwd);
      return;
    case "inspect":
      await runInspect(cwd, rest[0]);
      return;
    case undefined:
    case "--help":
    case "-h":
      process.stdout.write(`${usage()}\n`);
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
