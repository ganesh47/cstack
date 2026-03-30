import { runIntent } from "../intent.js";

export interface IntentCliOptions {
  dryRun: boolean;
  entrypoint: "bare" | "run";
  safe?: boolean;
  allowAll?: boolean;
}

function parseIntentArgs(args: string[], entrypoint: "bare" | "run"): { intent: string; options: IntentCliOptions } {
  const options: IntentCliOptions = {
    dryRun: false,
    entrypoint
  };
  const intentParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--safe") {
      options.safe = true;
      continue;
    }
    if (arg === "--allow-all") {
      options.allowAll = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown intent option: ${arg}`);
    }
    intentParts.push(arg);
  }

  const intent = intentParts.join(" ").trim();
  if (!intent) {
    throw new Error("`cstack <intent>` requires a task description.");
  }

  return { intent, options };
}

export async function runIntentCommand(cwd: string, args: string[], entrypoint: "bare" | "run"): Promise<void> {
  const { intent, options } = parseIntentArgs(args, entrypoint);
  await runIntent(cwd, intent, options);
}
