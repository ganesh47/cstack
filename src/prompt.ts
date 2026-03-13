import path from "node:path";
import { promises as fs } from "node:fs";
import type { CstackConfig, RoutingPlan, SpecialistName } from "./types.js";

export function excerpt(input: string, lines = 24): string {
  return input.split("\n").slice(0, lines).join("\n");
}

async function buildWorkflowPrompt(options: {
  cwd: string;
  input: string;
  workflow: "spec" | "discover";
  config: CstackConfig;
}): Promise<{ prompt: string; context: string }> {
  const { cwd, input, workflow, config } = options;
  const specDoc = path.join(cwd, "docs", "specs", "cstack-spec-v0.1.md");
  const researchDoc = path.join(cwd, "docs", "research", "gstack-codex-interaction-model.md");
  const promptAssetPath = path.join(cwd, ".cstack", "prompts", `${workflow}.md`);
  const workflowConfig = config.workflows[workflow];
  const context = [
    `Workflow: ${workflow}`,
    `Delegation enabled: ${workflowConfig.delegation?.enabled ? "yes" : "no"}`,
    `Delegation max agents: ${workflowConfig.delegation?.maxAgents ?? 0}`,
    `Prompt asset: ${promptAssetPath}`,
    `Spec source: ${specDoc}`,
    `Research source: ${researchDoc}`
  ].join("\n");

  let specText = "";
  let researchText = "";
  let promptAsset = "";
  try {
    promptAsset = await fs.readFile(promptAssetPath, "utf8");
  } catch {}
  try {
    specText = await fs.readFile(specDoc, "utf8");
  } catch {}
  try {
    researchText = await fs.readFile(researchDoc, "utf8");
  } catch {}

  const prompt = [
    promptAsset || `You are running the \`cstack ${workflow}\` workflow.`,
    "",
    "Use the repository documents as directional context, not as text to restate.",
    "Prefer a focused, implementation-ready output.",
    "",
    "## User request",
    input,
    "",
    "## Repository spec excerpt",
    excerpt(specText) || "(missing)",
    "",
    "## Repository research excerpt",
    excerpt(researchText) || "(missing)",
    "",
    "## Referenced files",
    `- ${specDoc}`,
    `- ${researchDoc}`
  ].join("\n");

  return { prompt, context };
}

export async function buildSpecPrompt(cwd: string, input: string, config: CstackConfig): Promise<{ prompt: string; context: string }> {
  return buildWorkflowPrompt({ cwd, input, workflow: "spec", config });
}

export async function buildDiscoverPrompt(cwd: string, input: string, config: CstackConfig): Promise<{ prompt: string; context: string }> {
  return buildWorkflowPrompt({ cwd, input, workflow: "discover", config });
}

function specialistTitle(name: SpecialistName): string {
  switch (name) {
    case "security-review":
      return "security review";
    case "devsecops-review":
      return "DevSecOps review";
    case "traceability-review":
      return "traceability review";
    case "audit-review":
      return "audit review";
    case "release-pipeline-review":
      return "release pipeline review";
  }
}

export async function buildSpecialistPrompt(options: {
  cwd: string;
  intent: string;
  name: SpecialistName;
  reason: string;
  routingPlan: RoutingPlan;
  discoverFindings?: string;
  specOutput?: string;
}): Promise<{ prompt: string; context: string }> {
  const { cwd, intent, name, reason, routingPlan, discoverFindings, specOutput } = options;
  const specDoc = path.join(cwd, "docs", "specs", "cstack-spec-v0.1.md");
  const researchDoc = path.join(cwd, "docs", "research", "gstack-codex-interaction-model.md");
  const title = specialistTitle(name);

  const context = [
    `Workflow: intent`,
    `Specialist: ${name}`,
    `Reason: ${reason}`,
    `Spec source: ${specDoc}`,
    `Research source: ${researchDoc}`
  ].join("\n");

  const prompt = [
    `You are running the \`${name}\` specialist for a \`cstack <intent>\` orchestration.`,
    "",
    `Perform a focused ${title} against the inferred plan and current artifacts.`,
    "",
    "Requirements:",
    "- stay inside the named specialist scope",
    "- call out concrete risks, gaps, and required follow-up",
    "- be concise and operational",
    "- structure the output so the lead can accept or discard it cleanly",
    "",
    "## Original intent",
    intent,
    "",
    "## Specialist activation reason",
    reason,
    "",
    "## Inferred routing plan",
    JSON.stringify(routingPlan, null, 2),
    "",
    "## Discover findings excerpt",
    discoverFindings ? excerpt(discoverFindings, 40) : "(missing)",
    "",
    "## Spec output excerpt",
    specOutput ? excerpt(specOutput, 40) : "(missing)",
    "",
    "## Referenced files",
    `- ${specDoc}`,
    `- ${researchDoc}`
  ].join("\n");

  return { prompt, context };
}
