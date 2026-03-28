import { loadRunLedger, renderRunLedger } from "../inspector.js";
import type { RunStatus, WorkflowName } from "../types.js";

export interface RunsCommandOptions {
  activeOnly: boolean;
  workflow?: WorkflowName;
  status?: RunStatus;
  planningIssueNumber?: number;
  initiativeId?: string;
  recent?: number;
  json: boolean;
}

function parseCount(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer for ${flag}, received: ${value}`);
  }
  return parsed;
}

export function parseRunsArgs(args: string[]): RunsCommandOptions {
  const options: RunsCommandOptions = {
    activeOnly: false,
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--active") {
      options.activeOnly = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--workflow") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --workflow");
      }
      options.workflow = value as WorkflowName;
      index += 1;
      continue;
    }
    if (arg === "--status") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --status");
      }
      options.status = value as RunStatus;
      index += 1;
      continue;
    }
    if (arg === "--issue") {
      const value = args[index + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error("`cstack runs --issue` requires a numeric issue id.");
      }
      options.planningIssueNumber = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (arg === "--initiative") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack runs --initiative` requires an initiative id.");
      }
      options.initiativeId = value;
      index += 1;
      continue;
    }
    if (arg === "--recent") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --recent");
      }
      options.recent = parseCount(value, "--recent");
      index += 1;
      continue;
    }
    throw new Error(`Unknown runs option: ${arg}`);
  }

  return options;
}

export async function runRuns(cwd: string, args: string[] = []): Promise<void> {
  const options = parseRunsArgs(args);
  const entries = await loadRunLedger(cwd, options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderRunLedger(entries));
}
