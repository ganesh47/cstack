import path from "node:path";
import { loadConfig } from "../config.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId, writeRunRecord } from "../run.js";
import { resolveLinkedReviewContext, runReviewExecution } from "../review.js";
import type { RunRecord } from "../types.js";

export interface ReviewCliOptions {
  fromRunId?: string;
}

async function readPromptFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  return chunks.join("").trim();
}

export function parseReviewArgs(args: string[]): { prompt: string; options: ReviewCliOptions } {
  const options: ReviewCliOptions = {};
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--from-run") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack review --from-run` requires a run id.");
      }
      options.fromRunId = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown review option: ${arg}`);
    }
    promptParts.push(arg);
  }

  return {
    prompt: promptParts.join(" ").trim(),
    options
  };
}

function defaultReviewPrompt(fromRunId?: string): string {
  return fromRunId ? `Review the linked upstream run ${fromRunId} and decide whether it is ready.` : "";
}

export async function runReview(cwd: string, args: string[] = []): Promise<string> {
  const parsed = parseReviewArgs(args);
  const stdinPrompt = parsed.prompt || parsed.options.fromRunId ? "" : await readPromptFromStdin();
  const resolvedPrompt = (parsed.prompt || stdinPrompt || defaultReviewPrompt(parsed.options.fromRunId)).trim();
  if (!resolvedPrompt) {
    throw new Error("`cstack review` requires a prompt or `--from-run <run-id>`.");
  }

  const { config, sources } = await loadConfig(cwd);
  const linkedContext = parsed.options.fromRunId ? await resolveLinkedReviewContext(cwd, parsed.options.fromRunId) : undefined;
  const runId = makeRunId("review", resolvedPrompt);
  const runDir = await ensureRunDir(cwd, runId);
  const promptPath = path.join(runDir, "prompt.md");
  const contextPath = path.join(runDir, "context.md");
  const finalPath = path.join(runDir, "final.md");
  const eventsPath = path.join(runDir, "events.jsonl");
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const findingsPath = path.join(runDir, "artifacts", "findings.md");
  const findingsJsonPath = path.join(runDir, "artifacts", "findings.json");
  const verdictPath = path.join(runDir, "artifacts", "verdict.json");
  const stageLineagePath = path.join(runDir, "stage-lineage.json");
  const [gitBranch, codexVersion] = await Promise.all([
    detectGitBranch(cwd),
    detectCodexVersion(cwd, config.codex.command)
  ]);

  const createdAt = new Date().toISOString();
  const runRecord: RunRecord = {
    id: runId,
    workflow: "review",
    createdAt,
    updatedAt: createdAt,
    status: "running",
    cwd,
    gitBranch,
    codexVersion,
    codexCommand: [],
    promptPath,
    finalPath,
    contextPath,
    eventsPath,
    stdoutPath,
    stderrPath,
    configSources: sources,
    currentStage: "review",
    summary: resolvedPrompt,
    inputs: {
      userPrompt: resolvedPrompt,
      entrypoint: "workflow",
      ...(linkedContext ? { linkedRunId: linkedContext.runId } : {})
    }
  };
  await writeRunRecord(runDir, runRecord);

  try {
    const execution = await runReviewExecution({
      cwd,
      runId,
      input: resolvedPrompt,
      config,
      paths: {
        runDir,
        promptPath,
        contextPath,
        finalPath,
        eventsPath,
        stdoutPath,
        stderrPath,
        findingsPath,
        findingsJsonPath,
        verdictPath,
        stageLineagePath
      },
      ...(linkedContext ? { linkedContext } : {})
    });

    runRecord.status = execution.reviewVerdict.status === "ready" ? "completed" : "failed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.inputs.selectedSpecialists = execution.selectedSpecialists.map((specialist) => specialist.name);
    runRecord.lastActivity = execution.reviewVerdict.summary;
    if (runRecord.status !== "completed") {
      runRecord.error = execution.reviewVerdict.summary;
    }
    await writeRunRecord(runDir, runRecord);

    process.stdout.write(
      [
        `Run: ${runId}`,
        "Workflow: review",
        `Status: ${runRecord.status}`,
        `Verdict: ${execution.reviewVerdict.status}`,
        "Artifacts:",
        `  ${path.relative(cwd, finalPath)}`,
        `  ${path.relative(cwd, findingsPath)}`,
        `  ${path.relative(cwd, findingsJsonPath)}`,
        `  ${path.relative(cwd, verdictPath)}`,
        `  ${path.relative(cwd, stageLineagePath)}`,
        `  ${path.relative(cwd, path.join(runDir, "run.json"))}`
      ].join("\n") + "\n"
    );
    await maybeOfferInteractiveInspect(cwd, runId);
    return runId;
  } catch (error) {
    runRecord.status = "failed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.error = error instanceof Error ? error.message : String(error);
    await writeRunRecord(runDir, runRecord);
    throw error;
  }
}
