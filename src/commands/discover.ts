import path from "node:path";
import { promises as fs } from "node:fs";
import { loadConfig } from "../config.js";
import { runDiscoverExecution } from "../discover.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { emitDeprecatedAllowAllWarning, resolveRunPolicy } from "../runtime-config.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId, writeRunRecord } from "../run.js";
import type { PlanningIssueLineageRecord, RunRecord } from "../types.js";

export interface DiscoverCliOptions {
  planningIssueNumber?: number;
  safe?: boolean;
  allowAll?: boolean;
}

function parseDiscoverArgs(input: string | string[]): { prompt: string; options: DiscoverCliOptions } {
  const parts = Array.isArray(input) ? input : input.trim() ? input.split(/\s+/) : [];
  const options: DiscoverCliOptions = {};
  const promptParts: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const arg = parts[index]!;
    if (arg === "--issue") {
      const value = parts[index + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error("`cstack discover --issue` requires a numeric issue id.");
      }
      options.planningIssueNumber = Number.parseInt(value, 10);
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
      throw new Error(`Unknown discover option: ${arg}`);
    }
    promptParts.push(arg);
  }

  return {
    prompt: promptParts.join(" ").trim(),
    options
  };
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

export async function runDiscover(cwd: string, input: string | string[]): Promise<string> {
  const parsed = parseDiscoverArgs(input);
  const resolvedPrompt = parsed.prompt || (await readPromptFromStdin());
  if (!resolvedPrompt) {
    throw new Error("`cstack discover` requires a prompt.");
  }

  const { config, sources, provenance } = await loadConfig(cwd);
  if (parsed.options.allowAll) {
    emitDeprecatedAllowAllWarning("discover");
  }
  const policy = resolveRunPolicy({ config, provenance, ...(parsed.options.safe !== undefined ? { safe: parsed.options.safe } : {}) });
  const effectiveConfig = policy.config;
  const runId = makeRunId("discover", resolvedPrompt);
  const runDir = await ensureRunDir(cwd, runId);
  const promptPath = path.join(runDir, "prompt.md");
  const contextPath = path.join(runDir, "context.md");
  const finalPath = path.join(runDir, "final.md");
  const artifactPath = path.join(runDir, "artifacts", "findings.md");
  const eventsPath = path.join(runDir, "events.jsonl");
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const issueLineagePath = path.join(runDir, "artifacts", "issue-lineage.json");
  const stageDir = path.join(runDir, "stages", "discover");
  const [gitBranch, codexVersion] = await Promise.all([
    detectGitBranch(cwd),
    detectCodexVersion(cwd, config.codex.command)
  ]);

  const createdAt = new Date().toISOString();
  const runRecord: RunRecord = {
    id: runId,
    workflow: "discover",
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
    currentStage: "discover",
    summary: resolvedPrompt,
    inputs: {
      userPrompt: resolvedPrompt,
      ...(policy.safe ? { safe: true } : {}),
      ...(parsed.options.planningIssueNumber ? { planningIssueNumber: parsed.options.planningIssueNumber } : {})
    }
  };

  await writeRunRecord(runDir, runRecord);

  try {
    const result = await runDiscoverExecution({
      cwd,
      runId,
      input: resolvedPrompt,
      config: effectiveConfig,
      ...(typeof parsed.options.planningIssueNumber === "number"
        ? { planningIssueNumber: parsed.options.planningIssueNumber }
        : {}),
      paths: {
        runDir,
        stageDir,
        promptPath,
        contextPath,
        finalPath,
        eventsPath,
        stdoutPath,
        stderrPath,
        artifactPath
      }
    });

    runRecord.status = result.status === "failed" ? "failed" : "completed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.codexCommand = result.leadResult.command;
    if (result.leadResult.sessionId) {
      runRecord.sessionId = result.leadResult.sessionId;
    }
    if (result.leadResult.lastActivity) {
      runRecord.lastActivity = result.leadResult.lastActivity;
    }
    if (result.status === "partial") {
      runRecord.lastActivity = `Discover recovered a partial artifact after a non-zero lead exit.${result.notes[0] ? ` ${result.notes[0]}` : ""}`;
    }
    runRecord.inputs.delegatedTracks = result.researchPlan.tracks.filter((track) => track.selected).map((track) => track.name);
    runRecord.inputs.webResearchAllowed = result.researchPlan.webResearchAllowed;
    if (parsed.options.planningIssueNumber) {
      const issueLineage: PlanningIssueLineageRecord = {
        planningIssueNumber: parsed.options.planningIssueNumber,
        currentRun: {
          runId,
          workflow: "discover"
        },
        downstreamPullRequests: [],
        downstreamReleases: []
      };
      await fs.writeFile(issueLineagePath, `${JSON.stringify(issueLineage, null, 2)}\n`, "utf8");
    }
    await writeRunRecord(runDir, runRecord);

    if (result.status === "failed") {
      throw new Error(`discover research lead exited with code ${result.leadResult.code}`);
    }

    process.stdout.write(
      [
        `Run: ${runId}`,
        `Workflow: discover`,
        `Status: ${runRecord.status}`,
        `Artifacts:`,
        `  ${path.relative(cwd, finalPath)}`,
        `  ${path.relative(cwd, artifactPath)}`,
        `  ${path.relative(cwd, path.join(stageDir, "artifacts", "discovery-report.md"))}`,
        `  ${path.relative(cwd, path.join(stageDir, "research-plan.json"))}`,
        ...(parsed.options.planningIssueNumber ? [`  ${path.relative(cwd, issueLineagePath)}`] : []),
        `  ${path.relative(cwd, eventsPath)}`,
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
