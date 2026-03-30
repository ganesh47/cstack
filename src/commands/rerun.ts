import path from "node:path";
import { promises as fs } from "node:fs";
import { runBuild } from "./build.js";
import { runDeliver } from "./deliver.js";
import { runDiscover } from "./discover.js";
import { runIntent } from "../intent.js";
import { runReview } from "./review.js";
import { runShip } from "./ship.js";
import { runSpec } from "./spec.js";
import { readRun, runDirForId, writeRunRecord } from "../run.js";
import type { RunRecord } from "../types.js";

export function parseRerunArgs(args: string[]): { runId: string } {
  const [runId, ...rest] = args;
  if (!runId) {
    throw new Error("`cstack rerun` requires a run id.");
  }
  if (rest.length > 0) {
    throw new Error("`cstack rerun` accepts exactly one run id.");
  }
  return { runId };
}

function buildWorkflowArgs(run: RunRecord): string[] {
  const args: string[] = [];
  const prompt = run.inputs.userPrompt;
  const linkedRunId = run.inputs.linkedRunId;
  const safe = run.inputs.safe ?? false;

  switch (run.workflow) {
    case "discover":
      if (safe) {
        args.push("--safe");
      }
      if (typeof run.inputs.planningIssueNumber === "number") {
        args.push("--issue", String(run.inputs.planningIssueNumber));
      }
      args.push(prompt);
      return args;
    case "spec":
      if (safe) {
        args.push("--safe");
      }
      if (linkedRunId) {
        args.push("--from-run", linkedRunId);
      }
      if (typeof run.inputs.planningIssueNumber === "number") {
        args.push("--issue", String(run.inputs.planningIssueNumber));
      }
      if (prompt) {
        args.push(prompt);
      }
      return args;
    case "build":
      if (safe) {
        args.push("--safe");
      }
      if (linkedRunId) {
        args.push("--from-run", linkedRunId);
      }
      if (run.inputs.requestedMode === "exec") {
        args.push("--exec");
      }
      if (safe && run.inputs.allowDirty) {
        args.push("--allow-dirty");
      }
      if (prompt) {
        args.push(prompt);
      }
      return args;
    case "review":
      if (safe) {
        args.push("--safe");
      }
      if (linkedRunId) {
        args.push("--from-run", linkedRunId);
      }
      if (prompt) {
        args.push(prompt);
      }
      return args;
    case "ship":
      if (safe) {
        args.push("--safe");
      }
      if (linkedRunId) {
        args.push("--from-run", linkedRunId);
      }
      if (run.inputs.deliveryMode === "release") {
        args.push("--release");
      }
      for (const issueNumber of run.inputs.issueNumbers ?? []) {
        args.push("--issue", String(issueNumber));
      }
      if (safe && run.inputs.allowDirty) {
        args.push("--allow-dirty");
      }
      if (prompt) {
        args.push(prompt);
      }
      return args;
    case "deliver":
      if (safe) {
        args.push("--safe");
      }
      if (linkedRunId) {
        args.push("--from-run", linkedRunId);
      }
      if (run.inputs.requestedMode === "exec") {
        args.push("--exec");
      }
      if (run.inputs.deliveryMode === "release") {
        args.push("--release");
      }
      for (const issueNumber of run.inputs.issueNumbers ?? []) {
        args.push("--issue", String(issueNumber));
      }
      if (safe && run.inputs.allowDirty) {
        args.push("--allow-dirty");
      }
      if (prompt) {
        args.push(prompt);
      }
      return args;
    case "intent":
      return [...(safe ? ["--safe"] : []), prompt];
    default:
      throw new Error(`\`cstack rerun\` does not support workflow ${run.workflow}.`);
  }
}

async function annotateRerun(cwd: string, rerunId: string, sourceRunId: string): Promise<void> {
  const rerun = await readRun(cwd, rerunId);
  rerun.rerunOfRunId = sourceRunId;
  await writeRunRecord(runDirForId(cwd, rerunId), rerun);
  await fs.writeFile(
    path.join(runDirForId(cwd, rerunId), "artifacts", "rerun.json"),
    `${JSON.stringify({ rerunOfRunId: sourceRunId, recordedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

export async function runRerun(cwd: string, args: string[] = []): Promise<string> {
  const { runId } = parseRerunArgs(args);
  const run = await readRun(cwd, runId);
  const workflowArgs = buildWorkflowArgs(run);

  let newRunId: string;
  switch (run.workflow) {
    case "discover":
      newRunId = await runDiscover(cwd, workflowArgs.join(" "));
      break;
    case "spec":
      newRunId = await runSpec(cwd, workflowArgs);
      break;
    case "build":
      newRunId = await runBuild(cwd, workflowArgs);
      break;
    case "review":
      newRunId = await runReview(cwd, workflowArgs);
      break;
    case "ship":
      newRunId = await runShip(cwd, workflowArgs);
      break;
    case "deliver":
      newRunId = await runDeliver(cwd, workflowArgs);
      break;
    case "intent":
      newRunId = await runIntent(cwd, run.inputs.userPrompt, {
        entrypoint: run.inputs.entrypoint === "intent" ? "bare" : "run",
        dryRun: run.inputs.dryRun ?? false,
        safe: run.inputs.safe ?? false
      });
      break;
    default:
      throw new Error(`\`cstack rerun\` does not support workflow ${run.workflow}.`);
  }

  await annotateRerun(cwd, newRunId, runId);
  return newRunId;
}
