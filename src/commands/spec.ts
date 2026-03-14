import path from "node:path";
import { promises as fs } from "node:fs";
import { loadConfig } from "../config.js";
import { runCodexExec } from "../codex.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { buildSpecPrompt, excerpt } from "../prompt.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, makeRunId, writeRunRecord } from "../run.js";
import { resolveLinkedBuildContext } from "../build.js";
import type { RunRecord } from "../types.js";

export interface SpecCliOptions {
  fromRunId?: string;
}

function parseSpecArgs(args: string[]): { prompt: string; options: SpecCliOptions } {
  const options: SpecCliOptions = {};
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--from-run") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack spec --from-run` requires a run id.");
      }
      options.fromRunId = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown spec option: ${arg}`);
    }
    promptParts.push(arg);
  }

  return {
    prompt: promptParts.join(" ").trim(),
    options
  };
}

function derivePlanArtifact(finalBody: string): Record<string, unknown> {
  const lines = finalBody
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines.filter((line) => line.startsWith("- ") || /^[0-9]+\.\s/.test(line)).slice(0, 12);
  const questions = lines.filter((line) => line.includes("?"));

  return {
    summary: lines.find((line) => !line.startsWith("#")) ?? "",
    steps: bullets.map((line) => line.replace(/^-\s+/, "").replace(/^[0-9]+\.\s+/, "")),
    openQuestions: questions
  };
}

function deriveOpenQuestions(finalBody: string): string {
  const questions = finalBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("?"));
  return ["# Open Questions", "", ...(questions.length > 0 ? questions.map((line) => `- ${line}`) : ["- none"])].join("\n") + "\n";
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

export async function runSpec(cwd: string, input: string | string[]): Promise<string> {
  const parsed = parseSpecArgs(Array.isArray(input) ? input : input.trim() ? input.split(/\s+/) : []);
  const stdinPrompt = parsed.prompt || parsed.options.fromRunId ? "" : await readPromptFromStdin();
  const resolvedPrompt = (parsed.prompt || stdinPrompt).trim();
  if (!resolvedPrompt && !parsed.options.fromRunId) {
    throw new Error("`cstack spec` requires a prompt or `--from-run <run-id>`.");
  }

  const { config, sources } = await loadConfig(cwd);
  const linkedContext = parsed.options.fromRunId ? await resolveLinkedBuildContext(cwd, parsed.options.fromRunId) : undefined;
  const specInput =
    linkedContext && resolvedPrompt
      ? `${resolvedPrompt}\n\n## Linked upstream run\n- run: ${linkedContext.run.id}\n- workflow: ${linkedContext.run.workflow}\n\n## Linked artifact excerpt\n${excerpt(linkedContext.artifactBody, 40)}`
      : linkedContext
        ? `Design the next implementation-ready spec from upstream run ${linkedContext.run.id}.\n\n## Linked artifact excerpt\n${excerpt(linkedContext.artifactBody, 40)}`
        : resolvedPrompt;
  const runId = makeRunId("spec", resolvedPrompt);
  const runDir = await ensureRunDir(cwd, runId);
  const promptPath = path.join(runDir, "prompt.md");
  const contextPath = path.join(runDir, "context.md");
  const finalPath = path.join(runDir, "final.md");
  const artifactPath = path.join(runDir, "artifacts", "spec.md");
  const planPath = path.join(runDir, "artifacts", "plan.json");
  const openQuestionsPath = path.join(runDir, "artifacts", "open-questions.md");
  const eventsPath = path.join(runDir, "events.jsonl");
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const [gitBranch, codexVersion] = await Promise.all([
    detectGitBranch(cwd),
    detectCodexVersion(cwd, config.codex.command)
  ]);
  const { prompt, context } = await buildSpecPrompt(cwd, specInput, config);

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
    currentStage: "spec",
    summary: resolvedPrompt,
    inputs: {
      userPrompt: resolvedPrompt
      ,
      ...(linkedContext ? { linkedRunId: linkedContext.run.id } : {})
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
    delete runRecord.currentStage;
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
      await fs.writeFile(planPath, `${JSON.stringify(derivePlanArtifact(finalBody), null, 2)}\n`, "utf8");
      await fs.writeFile(openQuestionsPath, deriveOpenQuestions(finalBody), "utf8");
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
        `  ${path.relative(cwd, planPath)}`,
        `  ${path.relative(cwd, openQuestionsPath)}`,
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
