import path from "node:path";
import { promises as fs } from "node:fs";
import type {
  CstackConfig,
  DiscoverDelegateResult,
  DiscoverResearchPlan,
  DiscoverTrackName,
  RoutingPlan,
  SpecialistName
} from "./types.js";

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
    ...(workflow === "discover"
      ? [
          `Research enabled: ${workflowConfig.research?.enabled === false ? "no" : "yes"}`,
          `Web research allowed: ${workflowConfig.research?.allowWeb ? "yes" : "no"}`
        ]
      : []),
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

function discoverTrackTitle(name: DiscoverTrackName): string {
  switch (name) {
    case "repo-explorer":
      return "repo explorer";
    case "external-researcher":
      return "external researcher";
    case "risk-researcher":
      return "risk researcher";
  }
}

export async function buildDiscoverTrackPrompt(options: {
  cwd: string;
  input: string;
  track: DiscoverTrackName;
  reason: string;
  plan: DiscoverResearchPlan;
}): Promise<{ prompt: string; context: string }> {
  const { cwd, input, track, reason, plan } = options;
  const specDoc = path.join(cwd, "docs", "specs", "cstack-spec-v0.1.md");
  const researchDoc = path.join(cwd, "docs", "research", "gstack-codex-interaction-model.md");
  const title = discoverTrackTitle(track);

  const context = [
    "Workflow: discover",
    `Track: ${track}`,
    `Reason: ${reason}`,
    `Web research allowed: ${plan.webResearchAllowed ? "yes" : "no"}`,
    `Spec source: ${specDoc}`,
    `Research source: ${researchDoc}`
  ].join("\n");

  const prompt = [
    `You are the \`${track}\` track in a bounded \`cstack discover\` research run.`,
    "",
    `Perform a focused ${title} pass for the user's request.`,
    "",
    "Rules:",
    "- stay inside this track's scope",
    "- be concrete and operational",
    "- do not write implementation code",
    "- if web research is not allowed, stay local to the repository and provided docs",
    "- if web research is allowed and needed, cite sources explicitly with stable URLs when possible",
    "- return valid JSON only, with no markdown fences or commentary",
    "",
    "Required JSON shape:",
    '{',
    '  "status": "completed" | "failed" | "stalled" | "discarded",',
    '  "summary": "short summary",',
    '  "filesInspected": ["relative/path"],',
    '  "commandsRun": ["command"],',
    '  "sources": [{"title": "name", "location": "url-or-path", "kind": "url|file|command|note", "retrievedAt": "optional"}],',
    '  "findings": ["finding"],',
    '  "confidence": "low" | "medium" | "high",',
    '  "unresolved": ["question or missing info"]',
    '}',
    "",
    "## User request",
    input,
    "",
    "## Track activation reason",
    reason,
    "",
    "## Discover research plan",
    JSON.stringify(plan, null, 2),
    "",
    "## Referenced files",
    `- ${specDoc}`,
    `- ${researchDoc}`
  ].join("\n");

  return { prompt, context };
}

export async function buildDiscoverLeadPrompt(options: {
  cwd: string;
  input: string;
  plan: DiscoverResearchPlan;
  delegateResults: DiscoverDelegateResult[];
}): Promise<{ prompt: string; context: string }> {
  const { cwd, input, plan, delegateResults } = options;
  const specDoc = path.join(cwd, "docs", "specs", "cstack-spec-v0.1.md");
  const researchDoc = path.join(cwd, "docs", "research", "gstack-codex-interaction-model.md");

  const context = [
    "Workflow: discover",
    "Role: Research Lead",
    `Delegated tracks: ${delegateResults.map((result) => result.track).join(", ") || "none"}`,
    `Web research allowed: ${plan.webResearchAllowed ? "yes" : "no"}`,
    `Spec source: ${specDoc}`,
    `Research source: ${researchDoc}`
  ].join("\n");

  const prompt = [
    "You are the `Research Lead` for a bounded `cstack discover` run.",
    "",
    "Synthesize the delegated research tracks into one concise discovery report.",
    "",
    "Requirements:",
    "- distinguish observed local findings from external findings",
    "- preserve uncertainty and unresolved questions",
    "- do not invent facts not supported by delegate output",
    "- make the result directly useful for a later `spec` stage",
    "- structure the output with clear sections and direct language",
    "- return valid JSON only, with no markdown fences or commentary",
    "",
    "Required JSON shape:",
    "{",
    '  "summary": "short summary",',
    '  "localFindings": ["finding"],',
    '  "externalFindings": ["finding"],',
    '  "risks": ["risk"],',
    '  "openQuestions": ["question"],',
    '  "delegateDisposition": [{"track": "repo-explorer", "leaderDisposition": "accepted" | "partial" | "discarded", "reason": "why"}],',
    '  "reportMarkdown": "# Discovery Report\\n..."',
    "}",
    "",
    "## User request",
    input,
    "",
    "## Discover research plan",
    JSON.stringify(plan, null, 2),
    "",
    "## Delegate results",
    JSON.stringify(delegateResults, null, 2),
    "",
    "## Referenced files",
    `- ${specDoc}`,
    `- ${researchDoc}`
  ].join("\n");

  return { prompt, context };
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
