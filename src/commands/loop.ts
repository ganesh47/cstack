import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { runIntent } from "../intent.js";
import { readRun } from "../run.js";

const execFileAsync = promisify(execFile);

interface LoopCliOptions {
  repo?: string;
  branch?: string;
  iterations: number;
  safe?: boolean;
}

function parseLoopArgs(args: string[]): { intent: string; options: LoopCliOptions } {
  const options: LoopCliOptions = {
    iterations: 3
  };
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--repo") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack loop --repo` requires a git URL.");
      }
      options.repo = value;
      index += 1;
      continue;
    }
    if (arg === "--branch") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack loop --branch` requires a branch name.");
      }
      options.branch = value;
      index += 1;
      continue;
    }
    if (arg === "--iterations") {
      const value = args[index + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error("`cstack loop --iterations` requires a positive integer.");
      }
      options.iterations = Math.max(1, Number.parseInt(value, 10));
      index += 1;
      continue;
    }
    if (arg === "--safe") {
      options.safe = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown loop option: ${arg}`);
    }
    promptParts.push(arg);
  }

  const intent = promptParts.join(" ").trim();
  if (!intent) {
    throw new Error("`cstack loop` requires an intent.");
  }

  return { intent, options };
}

async function cloneIterationRepo(repo: string, branch: string | undefined, iteration: number): Promise<string> {
  const cloneDir = await fs.mkdtemp(path.join(os.tmpdir(), `cstack-loop-${iteration}-`));
  await execFileAsync("git", ["clone", ...(branch ? ["--branch", branch] : []), repo, cloneDir], {
    maxBuffer: 20 * 1024 * 1024
  });
  return cloneDir;
}

function buildRetryIntent(baseIntent: string, previousFinalBody: string): string {
  const summary = previousFinalBody
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18)
    .join("\n");

  return [
    baseIntent,
    "",
    "Use the previous failed run as context.",
    "Backtrack from the failure, choose a different bounded option if needed, and continue instead of quitting on the first blocked path.",
    "If the prior run surfaced more than three gap clusters, keep the top 3 in scope and defer the remainder explicitly.",
    "",
    "## Prior run summary",
    summary || "No prior summary was available."
  ].join("\n");
}

export async function runLoop(cwd: string, args: string[] = []): Promise<void> {
  const parsed = parseLoopArgs(args);
  let priorFinalBody = "";
  let succeeded = false;
  let loopWorkspace = cwd;
  const previousNoInspect = process.env.CSTACK_NO_POSTRUN_INSPECT;
  const previousAutomatedLoop = process.env.CSTACK_AUTOMATED_LOOP;
  process.env.CSTACK_NO_POSTRUN_INSPECT = "1";
  process.env.CSTACK_AUTOMATED_LOOP = "1";

  try {
    if (parsed.options.repo) {
      loopWorkspace = await cloneIterationRepo(parsed.options.repo, parsed.options.branch, 1);
    }
    for (let iteration = 1; iteration <= parsed.options.iterations; iteration += 1) {
      const intent =
        iteration === 1 || !priorFinalBody ? parsed.intent : buildRetryIntent(parsed.intent, priorFinalBody);

      process.stdout.write(
        [
          `Loop iteration: ${iteration}/${parsed.options.iterations}`,
          `Workspace: ${loopWorkspace}`,
          `Intent: ${intent.split("\n")[0]}`
        ].join("\n") + "\n"
      );

      const runId = await runIntent(loopWorkspace, intent, {
        dryRun: false,
        entrypoint: "run",
        ...(parsed.options.safe ? { safe: true } : {})
      });
      const run = await readRun(loopWorkspace, runId);
      priorFinalBody = await fs.readFile(run.finalPath, "utf8").catch(() => "");

      process.stdout.write(
        [
          `Result run: ${runId}`,
          `Status: ${run.status}`,
          `Final summary: ${run.lastActivity ?? run.error ?? "completed"}`
        ].join("\n") + "\n"
      );

      if (run.status === "completed") {
        succeeded = true;
        break;
      }
    }
  } finally {
    if (previousNoInspect === undefined) {
      delete process.env.CSTACK_NO_POSTRUN_INSPECT;
    } else {
      process.env.CSTACK_NO_POSTRUN_INSPECT = previousNoInspect;
    }
    if (previousAutomatedLoop === undefined) {
      delete process.env.CSTACK_AUTOMATED_LOOP;
    } else {
      process.env.CSTACK_AUTOMATED_LOOP = previousAutomatedLoop;
    }
  }

  if (!succeeded) {
    throw new Error(`cstack loop did not reach a successful completed intent run within ${parsed.options.iterations} iteration(s).`);
  }
}
