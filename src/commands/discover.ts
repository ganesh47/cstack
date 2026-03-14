import path from "node:path";
import { loadConfig } from "../config.js";
import { runDiscoverExecution } from "../discover.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId, writeRunRecord } from "../run.js";
import type { RunRecord } from "../types.js";

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

export async function runDiscover(cwd: string, userPrompt: string): Promise<string> {
  const resolvedPrompt = userPrompt.trim() || (await readPromptFromStdin());
  if (!resolvedPrompt) {
    throw new Error("`cstack discover` requires a prompt.");
  }

  const { config, sources } = await loadConfig(cwd);
  const runId = makeRunId("discover", resolvedPrompt);
  const runDir = await ensureRunDir(cwd, runId);
  const promptPath = path.join(runDir, "prompt.md");
  const contextPath = path.join(runDir, "context.md");
  const finalPath = path.join(runDir, "final.md");
  const artifactPath = path.join(runDir, "artifacts", "findings.md");
  const eventsPath = path.join(runDir, "events.jsonl");
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
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
      userPrompt: resolvedPrompt
    }
  };

  await writeRunRecord(runDir, runRecord);

  try {
    const result = await runDiscoverExecution({
      cwd,
      runId,
      input: resolvedPrompt,
      config,
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

    runRecord.status = result.leadResult.code === 0 ? "completed" : "failed";
    runRecord.updatedAt = new Date().toISOString();
    delete runRecord.currentStage;
    runRecord.codexCommand = result.leadResult.command;
    if (result.leadResult.sessionId) {
      runRecord.sessionId = result.leadResult.sessionId;
    }
    if (result.leadResult.lastActivity) {
      runRecord.lastActivity = result.leadResult.lastActivity;
    }
    runRecord.inputs.delegatedTracks = result.researchPlan.tracks.filter((track) => track.selected).map((track) => track.name);
    runRecord.inputs.webResearchAllowed = result.researchPlan.webResearchAllowed;
    await writeRunRecord(runDir, runRecord);

    if (result.leadResult.code !== 0) {
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
