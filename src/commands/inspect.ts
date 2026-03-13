import { loadRunInspection, renderInspectionSummary, runInteractiveInspector } from "../inspector.js";

export interface InspectCommandOptions {
  runId?: string | undefined;
  interactive: boolean;
}

export function parseInspectArgs(args: string[]): InspectCommandOptions {
  let interactive = false;
  let runId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--interactive") {
      interactive = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown inspect option: ${arg}`);
    }
    if (runId) {
      throw new Error("`cstack inspect` accepts at most one run id.");
    }
    runId = arg;
  }

  return { runId, interactive };
}

export async function runInspect(cwd: string, args: string[] = []): Promise<void> {
  const options = parseInspectArgs(args);
  const inspection = await loadRunInspection(cwd, options.runId);

  if (options.interactive) {
    await runInteractiveInspector(cwd, inspection);
    return;
  }

  process.stdout.write(renderInspectionSummary(cwd, inspection));
}
