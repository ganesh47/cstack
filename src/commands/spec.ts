import path from "node:path";
import { promises as fs } from "node:fs";
import { loadConfig } from "../config.js";
import { runCodexExec } from "../codex.js";
import { maybeOfferInteractiveInspect } from "../inspector.js";
import { buildSpecPrompt, excerpt } from "../prompt.js";
import { emitDeprecatedAllowAllWarning, resolveRunPolicy } from "../runtime-config.js";
import { buildBoundedSpecInput, buildSpecContractError, deriveSpecPlanArtifact, validateSpecOutput } from "../spec-contract.js";
import { detectCodexVersion, detectGitBranch, ensureRunDir, listRuns, makeRunId, writeRunRecord } from "../run.js";
import { resolveLinkedBuildContext } from "../build.js";
import type { InitiativeGraphRecord, PlanningIssueLineageRecord, RunRecord } from "../types.js";

export interface SpecCliOptions {
  fromRunId?: string;
  planningIssueNumber?: number;
  initiativeId?: string;
  initiativeTitle?: string;
  safe?: boolean;
  allowAll?: boolean;
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
    if (arg === "--issue") {
      const value = args[index + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error("`cstack spec --issue` requires a numeric issue id.");
      }
      options.planningIssueNumber = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (arg === "--initiative") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack spec --initiative` requires an initiative id.");
      }
      options.initiativeId = value;
      index += 1;
      continue;
    }
    if (arg === "--initiative-title") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`cstack spec --initiative-title` requires a value.");
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
      throw new Error(`Unknown spec option: ${arg}`);
    }
    promptParts.push(arg);
  }

  return {
    prompt: promptParts.join(" ").trim(),
    options
  };
}

function deriveOpenQuestions(finalBody: string): string {
  const questions = finalBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("?"));
  return ["# Open Questions", "", ...(questions.length > 0 ? questions.map((line) => `- ${line}`) : ["- none"])].join("\n") + "\n";
}

function deriveIssueDraft(options: {
  finalBody: string;
  prompt: string;
  planningIssueNumber: number;
  linkedContext?: { run: { id: string; workflow: string } };
}): string {
  const plan = deriveSpecPlanArtifact(options.finalBody, validateSpecOutput(options.prompt, options.finalBody));
  const steps = Array.isArray(plan.steps) ? plan.steps.map((step: unknown) => String(step)) : [];
  const openQuestions = Array.isArray(plan.openQuestions)
    ? plan.openQuestions.map((item: unknown) => String(item))
    : [];

  return [
    `# Planning Issue Draft: #${options.planningIssueNumber}`,
    "",
    `Related issue: #${options.planningIssueNumber}`,
    "",
    "## Summary",
    typeof plan.summary === "string" && plan.summary.trim() ? plan.summary : options.prompt,
    "",
    "## Requested outcome",
    options.prompt,
    "",
    "## Proposed implementation slice",
    ...(steps.length > 0 ? steps.map((step) => `- ${step}`) : ["- refine the implementation slice from the saved spec output"]),
    "",
    "## Open questions",
    ...(openQuestions.length > 0 ? openQuestions.map((question: string) => `- ${question}`) : ["- none recorded"]),
    "",
    "## Lineage",
    options.linkedContext ? `- upstream run: ${options.linkedContext.run.id} (${options.linkedContext.run.workflow})` : "- upstream run: none"
  ].join("\n") + "\n";
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

  const { config, sources, provenance } = await loadConfig(cwd);
  if (parsed.options.allowAll) {
    emitDeprecatedAllowAllWarning("spec");
  }
  const policy = resolveRunPolicy({ config, provenance, ...(parsed.options.safe !== undefined ? { safe: parsed.options.safe } : {}) });
  const effectiveConfig = policy.config;
  const linkedContext = parsed.options.fromRunId ? await resolveLinkedBuildContext(cwd, parsed.options.fromRunId) : undefined;
  const resolvedPlanningIssueNumber =
    typeof parsed.options.planningIssueNumber === "number"
      ? parsed.options.planningIssueNumber
      : linkedContext?.run.inputs.planningIssueNumber;
  const narrowedLinkedDiscoverInput =
    linkedContext?.run.workflow === "discover" && resolvedPrompt
      ? buildBoundedSpecInput(resolvedPrompt, linkedContext.artifactBody)
      : null;
  const specInput =
    narrowedLinkedDiscoverInput
      ? narrowedLinkedDiscoverInput
      : linkedContext && resolvedPrompt
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
  const specContractPath = path.join(runDir, "artifacts", "spec-contract.json");
  const issueDraftPath = path.join(runDir, "artifacts", "issue-draft.md");
  const issueLineagePath = path.join(runDir, "artifacts", "issue-lineage.json");
  const initiativeGraphPath = path.join(runDir, "artifacts", "initiative-graph.json");
  const eventsPath = path.join(runDir, "events.jsonl");
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const resolvedInitiativeId = parsed.options.initiativeId
    ? parsed.options.initiativeId
    : linkedContext?.run.inputs.initiativeId;
  const resolvedInitiativeTitle = parsed.options.initiativeTitle
    ? parsed.options.initiativeTitle
    : linkedContext?.run.inputs.initiativeTitle;
  const priorInitiativeRuns = resolvedInitiativeId ? await listRuns(cwd) : [];
  const [gitBranch, codexVersion] = await Promise.all([
    detectGitBranch(cwd),
    detectCodexVersion(cwd, config.codex.command)
  ]);
  const promptOptions = {
    ...(typeof resolvedPlanningIssueNumber === "number"
      ? { planningIssueNumber: resolvedPlanningIssueNumber }
      : {}),
    ...(typeof resolvedInitiativeId === "string" ? { initiativeId: resolvedInitiativeId } : {}),
    ...(typeof resolvedInitiativeTitle === "string" ? { initiativeTitle: resolvedInitiativeTitle } : {})
  };
  const { prompt, context } = await buildSpecPrompt(cwd, specInput, config, promptOptions);

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
      userPrompt: resolvedPrompt,
      ...(policy.safe ? { safe: true } : {}),
      ...(linkedContext ? { linkedRunId: linkedContext.run.id } : {}),
      ...(typeof resolvedPlanningIssueNumber === "number" ? { planningIssueNumber: resolvedPlanningIssueNumber } : {}),
      ...(resolvedInitiativeId ? { initiativeId: resolvedInitiativeId } : {}),
      ...(resolvedInitiativeTitle ? { initiativeTitle: resolvedInitiativeTitle } : {})
    }
  };

  await writeRunRecord(runDir, runRecord);
  let specContract = validateSpecOutput("", "");

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
      config: effectiveConfig
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
      specContract = validateSpecOutput(resolvedPrompt || specInput, finalBody);
      await fs.writeFile(artifactPath, finalBody, "utf8");
      await fs.writeFile(planPath, `${JSON.stringify(deriveSpecPlanArtifact(finalBody, specContract), null, 2)}\n`, "utf8");
      await fs.writeFile(openQuestionsPath, deriveOpenQuestions(finalBody), "utf8");
      if (specContract.required) {
        await fs.writeFile(specContractPath, `${JSON.stringify(specContract, null, 2)}\n`, "utf8");
      }
      if (specContract.status === "invalid") {
        throw new Error(buildSpecContractError(specContract));
      }
      if (resolvedInitiativeId) {
        const relatedRuns = priorInitiativeRuns
          .filter((run) => run.inputs?.initiativeId === resolvedInitiativeId)
          .map((run) => ({
            runId: run.id,
            workflow: run.workflow,
            status: run.status
          }));
        const initiativeGraph: InitiativeGraphRecord = {
          initiativeId: resolvedInitiativeId,
          ...(resolvedInitiativeTitle ? { initiativeTitle: resolvedInitiativeTitle } : {}),
          ...(parsed.options.fromRunId
            ? {
                sourceRun: {
                  runId: linkedContext!.run.id,
                  workflow: linkedContext!.run.workflow
                }
              }
            : relatedRuns.length > 0
              ? {
                  sourceRun: {
                    runId: relatedRuns[0]!.runId,
                    workflow: relatedRuns[0]!.workflow
                  }
                }
              : {}),
          currentRun: {
            runId,
            workflow: "spec"
          },
          relatedRuns: [
            ...relatedRuns,
            {
              runId,
              workflow: "spec",
              status: runRecord.status
            }
          ]
        };
        await fs.writeFile(initiativeGraphPath, `${JSON.stringify(initiativeGraph, null, 2)}\n`, "utf8");
      }
      if (typeof resolvedPlanningIssueNumber === "number") {
        const issueLineage: PlanningIssueLineageRecord = {
          planningIssueNumber: resolvedPlanningIssueNumber,
          currentRun: {
            runId,
            workflow: "spec"
          },
          ...(linkedContext
            ? {
                sourceRun: {
                  runId: linkedContext.run.id,
                  workflow: linkedContext.run.workflow
                }
              }
            : {}),
          downstreamPullRequests: [],
          downstreamReleases: []
        };
        await fs.writeFile(
          issueDraftPath,
          deriveIssueDraft({
            finalBody,
            prompt: resolvedPrompt || specInput,
            planningIssueNumber: resolvedPlanningIssueNumber,
            ...(linkedContext ? { linkedContext } : {})
          }),
          "utf8"
        );
        await fs.writeFile(issueLineagePath, `${JSON.stringify(issueLineage, null, 2)}\n`, "utf8");
      }
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
        ...(specContract.required ? [`  ${path.relative(cwd, specContractPath)}`] : []),
        ...(typeof resolvedPlanningIssueNumber === "number"
          ? [`  ${path.relative(cwd, issueDraftPath)}`, `  ${path.relative(cwd, issueLineagePath)}`]
          : []),
        ...(resolvedInitiativeId ? [`  ${path.relative(cwd, initiativeGraphPath)}`] : []),
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
