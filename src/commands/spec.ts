import path from "node:path";
import { promises as fs } from "node:fs";
import { loadConfig } from "../config.js";
import { runCodexExec } from "../codex.js";
import { buildSpecPrompt } from "../prompt.js";
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

export async function runSpec(cwd: string, userPrompt: string): Promise<void> {
  const resolvedPrompt = userPrompt.trim() || (await readPromptFromStdin());
  if (!resolvedPrompt) {
    throw new Error("`cstack spec` requires a prompt.");
  }

  const { config, sources } = await loadConfig(cwd);
  const runId = makeRunId("spec", resolvedPrompt);
  const runDir = await ensureRunDir(cwd, runId);
  const promptPath = path.join(runDir, "prompt.md");
  const contextPath = path.join(runDir, "context.md");
  const finalPath = path.join(runDir, "final.md");
  const artifactPath = path.join(runDir, "artifacts", "spec.md");
  const eventsPath = path.join(runDir, "events.jsonl");
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const [gitBranch, codexVersion] = await Promise.all([
    detectGitBranch(cwd),
    detectCodexVersion(cwd, config.codex.command)
  ]);
  const { prompt, context } = await buildSpecPrompt(cwd, resolvedPrompt, config);

  await fs.writeFile(promptPath, prompt, "utf8");
  await fs.writeFile(contextPath, `${context}\n`, "utf8");

  const createdAt = new Date().toISOString();
  const runRecord: RunRecord = {
    id: runId,
    workflow: "spec",
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
    inputs: {
      userPrompt: resolvedPrompt
    }
  };

  await writeRunRecord(runDir, runRecord);

  try {
    const result = await runCodexExec({
      cwd,
      workflow: "spec",
      runId,
      prompt,
      finalPath,
      eventsPath,
      stdoutPath,
      stderrPath,
      config
    });

    runRecord.status = result.code === 0 ? "completed" : "failed";
    runRecord.updatedAt = new Date().toISOString();
    runRecord.codexCommand = result.command;
    if (result.sessionId) {
      runRecord.sessionId = result.sessionId;
    }
    if (result.lastActivity) {
      runRecord.lastActivity = result.lastActivity;
    }
    if (result.code !== 0) {
      runRecord.error = `codex exec exited with code ${result.code}${result.signal ? ` (${result.signal})` : ""}`;
    }
    if (result.code === 0) {
      const finalBody = await fs.readFile(finalPath, "utf8");
      await fs.writeFile(artifactPath, finalBody, "utf8");
    }
    await writeRunRecord(runDir, runRecord);

    if (result.code !== 0) {
      throw new Error(runRecord.error);
    }

    process.stdout.write(
      [
        `Run: ${runId}`,
        `Workflow: spec`,
        `Status: ${runRecord.status}`,
        `Artifacts:`,
        `  ${path.relative(cwd, finalPath)}`,
        `  ${path.relative(cwd, artifactPath)}`,
        `  ${path.relative(cwd, eventsPath)}`,
        `  ${path.relative(cwd, path.join(runDir, "run.json"))}`
      ].join("\n") + "\n"
    );
  } catch (error) {
    runRecord.status = "failed";
    runRecord.updatedAt = new Date().toISOString();
    runRecord.error = error instanceof Error ? error.message : String(error);
    await writeRunRecord(runDir, runRecord);
    throw error;
  }
}
