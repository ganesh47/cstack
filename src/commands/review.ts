import path from "node:path";
import { loadConfig } from "../config.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { emitDeprecatedAllowAllWarning, resolveRunPolicy } from "../runtime-config.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId } from "../run.js";
import { resolveLinkedReviewContext, runReviewExecution } from "../review.js";
import type { RunRecord } from "../types.js";
import { getWorkflowMachineDefinition, WorkflowController } from "../workflow-machine.js";

export interface ReviewCliOptions {
  fromRunId?: string;
  initiativeId?: string;
  initiativeTitle?: string;
  safe?: boolean;
  allowAll?: boolean;
}

export interface ReviewRunHooks {
  onRunCreated?: (run: RunRecord) => Promise<void> | void;
  suppressInteractiveInspect?: boolean;
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
    if (arg === "--initiative") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack review --initiative` requires an initiative id.");
      }
      options.initiativeId = value;
      index += 1;
      continue;
    }
    if (arg === "--initiative-title") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack review --initiative-title` requires a value.");
      }
      options.initiativeTitle = value;
      index += 1;
      continue;
    }
    if (arg === "--allow-all") {
      options.allowAll = true;
      continue;
    }
    if (arg === "--safe") {
      options.safe = true;
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

export async function runReview(cwd: string, args: string[] = [], hooks: ReviewRunHooks = {}): Promise<string> {
  const parsed = parseReviewArgs(args);
  const stdinPrompt = parsed.prompt || parsed.options.fromRunId ? "" : await readPromptFromStdin();
  const resolvedPrompt = (parsed.prompt || stdinPrompt || defaultReviewPrompt(parsed.options.fromRunId)).trim();
  if (!resolvedPrompt) {
    throw new Error("`cstack review` requires a prompt or `--from-run <run-id>`.");
  }

  const { config, sources, provenance } = await loadConfig(cwd);
  if (parsed.options.allowAll) {
    emitDeprecatedAllowAllWarning("review");
  }
  const policy = resolveRunPolicy({ config, provenance, ...(parsed.options.safe !== undefined ? { safe: parsed.options.safe } : {}) });
  const effectiveConfig = policy.config;
  const linkedContext = parsed.options.fromRunId ? await resolveLinkedReviewContext(cwd, parsed.options.fromRunId) : undefined;
  const resolvedInitiativeId = parsed.options.initiativeId ?? linkedContext?.initiativeId;
  const resolvedInitiativeTitle = parsed.options.initiativeTitle ?? linkedContext?.initiativeTitle;
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
    summary: resolvedPrompt,
    inputs: {
      userPrompt: resolvedPrompt,
      entrypoint: "workflow",
      ...(policy.safe ? { safe: true } : {}),
      ...(resolvedInitiativeId ? { initiativeId: resolvedInitiativeId } : {}),
      ...(resolvedInitiativeTitle ? { initiativeTitle: resolvedInitiativeTitle } : {}),
      ...(linkedContext ? { linkedRunId: linkedContext.runId } : {})
    }
  };
  const controller = await WorkflowController.create({
    definition: getWorkflowMachineDefinition("review"),
    runDir,
    runRecord,
    intent: resolvedPrompt,
    stages: [
      {
        name: "review",
        rationale: "Critique the current change, risks, and next actions.",
        status: "planned",
        executed: false
      }
    ]
  });
  await hooks.onRunCreated?.(controller.currentRunRecord);

  try {
    const execution = await runReviewExecution({
      cwd,
      runId,
      input: resolvedPrompt,
      config: effectiveConfig,
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
      controller,
      ...(linkedContext ? { linkedContext } : {})
    });

    await controller.patchRun({
      inputs: {
        userPrompt: resolvedPrompt,
        selectedSpecialists: execution.selectedSpecialists.map((specialist) => specialist.name)
      }
    });
    const finalRunRecord = controller.currentRunRecord;

    process.stdout.write(
      [
        `Run: ${runId}`,
        "Workflow: review",
        `Status: ${finalRunRecord.status}`,
        `Review mode: ${execution.reviewVerdict.mode}`,
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
    if (!hooks.suppressInteractiveInspect) {
      await maybeOfferInteractiveInspect(cwd, runId);
    }
    return runId;
  } catch (error) {
    await controller.send({
      type: "REVIEW_FINALIZED",
      executionSucceeded: false,
      verdictStatus: "failed",
      summary: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
