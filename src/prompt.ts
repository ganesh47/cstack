import path from "node:path";
import { promises as fs } from "node:fs";
import type {
  CstackConfig,
  DeliverReviewVerdict,
  DiscoverDelegateResult,
  DiscoverResearchPlan,
  DiscoverTrackName,
  RoutingPlan,
  SpecialistName,
  WorkflowMode
} from "./types.js";

export function excerpt(input: string, lines = 24): string {
  return input.split("\n").slice(0, lines).join("\n");
}

async function buildWorkflowPrompt(options: {
  cwd: string;
  input: string;
  workflow: "spec" | "discover" | "build" | "deliver";
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

export async function buildBuildPrompt(options: {
  cwd: string;
  input: string;
  config: CstackConfig;
  mode: WorkflowMode;
  finalArtifactPath: string;
  linkedArtifactPath?: string;
  linkedArtifactBody?: string;
  linkedRunId?: string;
  linkedWorkflow?: string;
  verificationCommands: string[];
  dirtyWorktree: boolean;
}): Promise<{ prompt: string; context: string }> {
  const {
    cwd,
    input,
    config,
    mode,
    finalArtifactPath,
    linkedArtifactPath,
    linkedArtifactBody,
    linkedRunId,
    linkedWorkflow,
    verificationCommands,
    dirtyWorktree
  } = options;
  const { prompt, context } = await buildWorkflowPrompt({ cwd, input, workflow: "build", config });

  return {
    prompt: [
      prompt,
      "",
      "## Build execution contract",
      "- implement the requested change in the repository when justified",
      "- stay within the scope of the task and linked upstream artifact",
      "- be explicit about files changed, tests run, and remaining risks",
      "- keep the final response concise and implementation-oriented",
      ...(mode === "interactive"
        ? [`- before exiting, write a concise markdown summary to: ${finalArtifactPath}`]
        : ["- the wrapper will capture your final response into the run artifacts"]),
      "",
      "## Linked upstream run",
      linkedRunId ? `- run: ${linkedRunId}` : "- none",
      linkedWorkflow ? `- workflow: ${linkedWorkflow}` : "- workflow: none",
      linkedArtifactPath ? `- artifact: ${linkedArtifactPath}` : "- artifact: none",
      "",
      "## Linked artifact excerpt",
      linkedArtifactBody ? excerpt(linkedArtifactBody, 40) : "(none)",
      "",
      "## Wrapper verification commands",
      ...(verificationCommands.length > 0 ? verificationCommands.map((command) => `- ${command}`) : ["- none requested"]),
      "",
      "## Working tree state",
      dirtyWorktree ? "- dirty worktree detected; avoid touching unrelated files" : "- worktree appears clean"
    ].join("\n"),
    context: [
      context,
      `Requested mode: ${mode}`,
      `Final artifact path: ${finalArtifactPath}`,
      linkedRunId ? `Linked run: ${linkedRunId}` : "Linked run: none",
      linkedWorkflow ? `Linked workflow: ${linkedWorkflow}` : "Linked workflow: none",
      linkedArtifactPath ? `Linked artifact: ${linkedArtifactPath}` : "Linked artifact: none",
      `Verification commands: ${verificationCommands.join(" | ") || "none"}`,
      `Dirty worktree: ${dirtyWorktree ? "yes" : "no"}`
    ].join("\n")
  };
}

export async function buildDeliverPrompt(options: {
  cwd: string;
  input: string;
  config: CstackConfig;
  requestedMode: WorkflowMode;
  linkedArtifactPath?: string;
  linkedArtifactBody?: string;
  linkedRunId?: string;
  linkedWorkflow?: string;
  verificationCommands: string[];
  selectedSpecialists: SpecialistName[];
}): Promise<{ prompt: string; context: string }> {
  const {
    cwd,
    input,
    config,
    requestedMode,
    linkedArtifactPath,
    linkedArtifactBody,
    linkedRunId,
    linkedWorkflow,
    verificationCommands,
    selectedSpecialists
  } = options;
  const { prompt, context } = await buildWorkflowPrompt({ cwd, input, workflow: "deliver", config });

  return {
    prompt: [
      prompt,
      "",
      "## Deliver workflow contract",
      "- run a bounded delivery workflow with explicit internal stages: build, review, ship",
      "- preserve stage artifacts so later inspection can explain every handoff",
      "- treat specialist reviewers as advisory inputs to the review lead",
      "- do not claim release readiness if verification or review artifacts do not support it",
      "",
      "## Requested build mode",
      `- ${requestedMode}`,
      "",
      "## Linked upstream run",
      linkedRunId ? `- run: ${linkedRunId}` : "- none",
      linkedWorkflow ? `- workflow: ${linkedWorkflow}` : "- workflow: none",
      linkedArtifactPath ? `- artifact: ${linkedArtifactPath}` : "- artifact: none",
      "",
      "## Linked artifact excerpt",
      linkedArtifactBody ? excerpt(linkedArtifactBody, 40) : "(none)",
      "",
      "## Deliver team",
      `- review specialists: ${selectedSpecialists.join(", ") || "none"}`,
      `- verification commands: ${verificationCommands.join(" | ") || "none"}`
    ].join("\n"),
    context: [
      context,
      `Requested build mode: ${requestedMode}`,
      linkedRunId ? `Linked run: ${linkedRunId}` : "Linked run: none",
      linkedWorkflow ? `Linked workflow: ${linkedWorkflow}` : "Linked workflow: none",
      linkedArtifactPath ? `Linked artifact: ${linkedArtifactPath}` : "Linked artifact: none",
      `Selected review specialists: ${selectedSpecialists.join(", ") || "none"}`,
      `Verification commands: ${verificationCommands.join(" | ") || "none"}`
    ].join("\n")
  };
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

export async function buildDeliverReviewLeadPrompt(options: {
  cwd: string;
  input: string;
  buildSummary: string;
  verificationRecord: object;
  specialistResults: Array<{ name: SpecialistName; reason: string; finalBody: string }>;
}): Promise<{ prompt: string; context: string }> {
  const { cwd, input, buildSummary, verificationRecord, specialistResults } = options;
  const specDoc = path.join(cwd, "docs", "specs", "cstack-spec-v0.1.md");

  return {
    prompt: [
      "You are the `Review Lead` for a bounded `cstack deliver` workflow.",
      "",
      "Synthesize the build stage output, verification evidence, and specialist reviews into one review verdict.",
      "",
      "Requirements:",
      "- be explicit about whether delivery is ready, needs changes, or is blocked",
      "- preserve serious risks even when the build itself completed",
      "- cite specialist input only when it materially changed the verdict",
      "- return valid JSON only, with no markdown fences or extra commentary",
      "",
      "Required JSON shape:",
      "{",
      '  "status": "ready" | "changes-requested" | "blocked",',
      '  "summary": "short summary",',
      '  "findings": [{"severity": "info" | "warning" | "high", "title": "finding title", "detail": "details", "owner": "optional"}],',
      '  "recommendedActions": ["action"],',
      '  "acceptedSpecialists": [{"name": "security-review", "disposition": "accepted" | "partial" | "discarded", "reason": "why"}],',
      '  "reportMarkdown": "# Review Findings\\n..."',
      "}",
      "",
      "## Deliver request",
      input,
      "",
      "## Build summary",
      excerpt(buildSummary, 80) || "(missing)",
      "",
      "## Verification evidence",
      JSON.stringify(verificationRecord, null, 2),
      "",
      "## Specialist outputs",
      JSON.stringify(specialistResults, null, 2),
      "",
      "## Referenced files",
      `- ${specDoc}`
    ].join("\n"),
    context: [
      "Workflow: deliver",
      "Role: Review Lead",
      `Selected specialists: ${specialistResults.map((result) => result.name).join(", ") || "none"}`,
      `Spec source: ${specDoc}`
    ].join("\n")
  };
}

export async function buildDeliverSpecialistPrompt(options: {
  cwd: string;
  input: string;
  name: SpecialistName;
  reason: string;
  buildSummary: string;
  verificationRecord: object;
}): Promise<{ prompt: string; context: string }> {
  const { cwd, input, name, reason, buildSummary, verificationRecord } = options;
  const specDoc = path.join(cwd, "docs", "specs", "cstack-spec-v0.1.md");
  const title = specialistTitle(name);

  return {
    prompt: [
      `You are running the \`${name}\` specialist for a \`cstack deliver\` review stage.`,
      "",
      `Perform a focused ${title} against the current build and release-readiness evidence.`,
      "",
      "Requirements:",
      "- stay inside the named specialist scope",
      "- call out concrete risks, gaps, and required follow-up",
      "- be concise and operational",
      "- structure the output so the review lead can accept, partially accept, or discard it cleanly",
      "",
      "## Deliver request",
      input,
      "",
      "## Specialist activation reason",
      reason,
      "",
      "## Build summary",
      excerpt(buildSummary, 60) || "(missing)",
      "",
      "## Verification evidence",
      JSON.stringify(verificationRecord, null, 2),
      "",
      "## Referenced files",
      `- ${specDoc}`
    ].join("\n"),
    context: [
      "Workflow: deliver",
      `Specialist: ${name}`,
      `Reason: ${reason}`,
      `Spec source: ${specDoc}`
    ].join("\n")
  };
}

export async function buildDeliverShipPrompt(options: {
  cwd: string;
  input: string;
  buildSummary: string;
  reviewVerdict: DeliverReviewVerdict;
  verificationRecord: object;
}): Promise<{ prompt: string; context: string }> {
  const { cwd, input, buildSummary, reviewVerdict, verificationRecord } = options;
  const specDoc = path.join(cwd, "docs", "specs", "cstack-spec-v0.1.md");

  return {
    prompt: [
      "You are the `Ship Lead` for a bounded `cstack deliver` workflow.",
      "",
      "Prepare a release-readiness handoff from the saved build and review artifacts.",
      "",
      "Requirements:",
      "- distinguish completed checklist items from blockers",
      "- treat failed verification or blocked review as release blockers",
      "- keep the output implementation-facing rather than marketing-facing",
      "- return valid JSON only, with no markdown fences or extra commentary",
      "",
      "Required JSON shape:",
      "{",
      '  "readiness": "ready" | "blocked",',
      '  "summary": "short summary",',
      '  "checklist": [{"item": "name", "status": "complete" | "incomplete" | "blocked", "notes": "optional"}],',
      '  "unresolved": ["issue"],',
      '  "nextActions": ["action"],',
      '  "reportMarkdown": "# Ship Summary\\n..."',
      "}",
      "",
      "## Deliver request",
      input,
      "",
      "## Build summary",
      excerpt(buildSummary, 80) || "(missing)",
      "",
      "## Review verdict",
      JSON.stringify(reviewVerdict, null, 2),
      "",
      "## Verification evidence",
      JSON.stringify(verificationRecord, null, 2),
      "",
      "## Referenced files",
      `- ${specDoc}`
    ].join("\n"),
    context: [
      "Workflow: deliver",
      "Role: Ship Lead",
      `Review status: ${reviewVerdict.status}`,
      `Spec source: ${specDoc}`
    ].join("\n")
  };
}
