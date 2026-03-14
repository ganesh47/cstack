#!/usr/bin/env node
import { runBuild } from "./commands/build.js";
import { runDeliver } from "./commands/deliver.js";
import { runDiscover } from "./commands/discover.js";
import { runFork } from "./commands/fork.js";
import { runIntentCommand } from "./commands/intent.js";
import { runReview } from "./commands/review.js";
import { runRerun } from "./commands/rerun.js";
import { runResume } from "./commands/resume.js";
import { runShip } from "./commands/ship.js";
import { runSpec } from "./commands/spec.js";
import { runRuns } from "./commands/runs.js";
import { runInspect } from "./commands/inspect.js";
import { runUpdateCommand, UpdateCommandError } from "./commands/update.js";

function usage(): string {
  return [
    "Usage:",
    "  cstack <intent>",
    "  cstack run <intent> [--dry-run]",
    "  cstack discover <prompt>",
    "  cstack spec <prompt>",
    "  cstack build <prompt> [--from-run <run-id>] [--exec] [--allow-dirty]",
    "  cstack review <prompt> [--from-run <run-id>]",
    "  cstack ship <prompt> [--from-run <run-id>] [--release] [--issue <n>] [--allow-dirty]",
    "  cstack deliver <prompt> [--from-run <run-id>] [--exec] [--release] [--issue <n>]",
    "  cstack rerun <run-id>",
    "  cstack resume <run-id>",
    "  cstack fork <run-id> [--workflow <name>]",
    "  cstack update [--check] [--dry-run] [--yes] [--version <x>] [--channel stable]",
    "  cstack runs [--active] [--workflow <name>] [--status <status>] [--recent <n>] [--json]",
    "  cstack inspect [run-id] [--interactive]"
  ].join("\n");
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "discover":
      await runDiscover(cwd, rest.join(" "));
      return;
    case "run":
      await runIntentCommand(cwd, rest, "run");
      return;
    case "spec":
      await runSpec(cwd, rest.join(" "));
      return;
    case "build":
      await runBuild(cwd, rest);
      return;
    case "review":
      await runReview(cwd, rest);
      return;
    case "ship":
      await runShip(cwd, rest);
      return;
    case "deliver":
      await runDeliver(cwd, rest);
      return;
    case "rerun":
      await runRerun(cwd, rest);
      return;
    case "resume":
      await runResume(cwd, rest);
      return;
    case "fork":
      await runFork(cwd, rest);
      return;
    case "runs":
      await runRuns(cwd, rest);
      return;
    case "update":
      await runUpdateCommand(cwd, rest);
      return;
    case "inspect":
      await runInspect(cwd, rest);
      return;
    case undefined:
    case "--help":
    case "-h":
      process.stdout.write(`${usage()}\n`);
      return;
    default:
      if (command && !command.startsWith("-") && (rest.length > 0 || /\s/.test(command))) {
        await runIntentCommand(cwd, [command, ...rest], "bare");
        return;
      }
      throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = error instanceof UpdateCommandError ? error.exitCode : 1;
});
