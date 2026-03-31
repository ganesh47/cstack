import path from "node:path";
import { promises as fs } from "node:fs";
import { isBroadGapRemediationPrompt } from "./spec-contract.js";
import type {
  CstackConfig,
  DeliverValidationPlan,
  DeliverReviewVerdict,
  DiscoverDelegateResult,
  DiscoverResearchPlan,
  DiscoverTrackName,
  ReviewMode,
  RoutingPlan,
  SpecialistName,
  ValidationRepoProfile,
  ValidationToolResearch,
  WorkflowMode
} from "./types.js";

export function excerpt(input: string, lines = 24): string {
  return input.split("\n").slice(0, lines).join("\n");
}

interface PromptReferenceFile {
  path: string;
  label: string;
  body: string;
}

const REPOSITORY_CONTEXT_CANDIDATES = [
  "docs/specs/cstack-spec-v0.1.md",
  "docs/research/gstack-codex-interaction-model.md",
  "specs/001-plan-alignment/spec.md",
  "specs/001-plan-alignment/research.md",
  "sqlite-metadata-system.md",
  "docs/project-readme.md",
  "AGENTS.md",
  "README.md"
];

async function readPromptReferenceFiles(cwd: string, limit = 4): Promise<PromptReferenceFile[]> {
  const resolved: PromptReferenceFile[] = [];

  for (const relativePath of REPOSITORY_CONTEXT_CANDIDATES) {
    if (resolved.length >= limit) {
      break;
    }

    const filePath = path.join(cwd, relativePath);
    try {
      const body = await fs.readFile(filePath, "utf8");
      resolved.push({
        path: filePath,
        label: path.relative(cwd, filePath) || path.basename(filePath),
        body
      });
    } catch {}
  }

  return resolved;
}

function buildReferenceContextLines(referenceFiles: PromptReferenceFile[]): string[] {
  if (referenceFiles.length === 0) {
    return ["Reference files: none"];
  }

  return [
    `Reference files: ${referenceFiles.map((file) => file.label).join(", ")}`,
    ...referenceFiles.map((file, index) => `Reference ${index + 1}: ${file.path}`)
  ];
}

function buildReferencePromptLines(referenceFiles: PromptReferenceFile[], options: { includeExcerpts?: boolean } = {}): string[] {
  const { includeExcerpts = false } = options;

  if (referenceFiles.length === 0) {
    return ["## Referenced files", "- none"];
  }

  const lines: string[] = [];

  if (includeExcerpts) {
    lines.push("## Repository context excerpts", "");
    for (const file of referenceFiles) {
      lines.push(`### ${file.label}`, excerpt(file.body) || "(empty)", "");
    }
  }

  lines.push("## Referenced files", ...referenceFiles.map((file) => `- ${file.path}`));
  return lines;
}

function summarizeDiscoverDelegates(delegateResults: DiscoverDelegateResult[]): Array<Record<string, unknown>> {
  return delegateResults.map((delegate) => ({
    track: delegate.track,
    status: delegate.status,
    disposition: delegate.leaderDisposition,
    summary: delegate.summary,
    topFindings: delegate.findings.slice(0, 3),
    unresolved: delegate.unresolved.slice(0, 3),
    filesInspected: delegate.filesInspected.slice(0, 6),
    commandsRun: delegate.commandsRun.slice(0, 6),
    sourceCount: delegate.sources.length,
    notes: delegate.notes ?? ""
  }));
}

async function buildWorkflowPrompt(options: {
  cwd: string;
  input: string;
  workflow: "spec" | "discover" | "build" | "review" | "ship" | "deliver";
  config: CstackConfig;
}): Promise<{ prompt: string; context: string }> {
  const { cwd, input, workflow, config } = options;
  const promptAssetPath = path.join(cwd, ".cstack", "prompts", `${workflow}.md`);
  const workflowConfig = config.workflows[workflow];
  const referenceFiles = await readPromptReferenceFiles(cwd);
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
    ...buildReferenceContextLines(referenceFiles)
  ].join("\n");

  let promptAsset = "";
  try {
    promptAsset = await fs.readFile(promptAssetPath, "utf8");
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
    ...buildReferencePromptLines(referenceFiles, { includeExcerpts: true })
  ].join("\n");

  return { prompt, context };
}

export async function buildSpecPrompt(
  cwd: string,
  input: string,
  config: CstackConfig,
  options: { planningIssueNumber?: number; initiativeId?: string; initiativeTitle?: string } = {}
): Promise<{ prompt: string; context: string }> {
  const { prompt, context } = await buildWorkflowPrompt({ cwd, input, workflow: "spec", config });
  const requiresBoundedFirstSlice = isBroadGapRemediationPrompt(input);
  return {
    prompt: [
      prompt,
      "",
      "## Linked planning issue",
      options.planningIssueNumber ? `- GitHub issue: #${options.planningIssueNumber}` : "- none",
      "",
      "## Initiative",
      options.initiativeId ? `- initiative: ${options.initiativeId}` : "- none",
      options.initiativeTitle ? `- title: ${options.initiativeTitle}` : "- no title provided",
      "",
      "## Spec execution contract",
      "- this stage is planning-only; do not edit repository files, apply patches, or run implementation commands",
      "- produce an implementation-ready plan, not an exhaustive repo audit",
      "- if the request is broad, choose the highest-leverage first remediation slice",
      "- if the prompt includes a preselected first slice, keep that slice fixed unless the linked evidence proves it is impossible",
      "- for mixed gap-analysis plus remediation prompts, rank the top 1-3 gap clusters briefly and then select exactly one slice to implement first",
      "- the chosen slice must fit in one bounded change set with named files, validation, and out-of-scope boundaries",
      "- avoid multi-epic roadmaps, repo-wide rewrites, or parallel workstreams in the first slice",
      "- rely on provided discover findings and a representative sample of repo files instead of re-scanning everything",
      "- inspect at most 8 additional files and run at most 6 shell commands before you stop planning",
      "- stop once you can fill the required headings with evidence; do not continue scanning after the first slice is clear",
      "- if evidence is incomplete, record bounded open questions and stop",
      ...(requiresBoundedFirstSlice
        ? [
            "",
            "## Required output headings",
            "- include these exact headings in the final output, in order:",
            "- `## Gap Clusters`",
            "- `## Selected First Slice`",
            "- `## Files In Scope`",
            "- `## Validation`",
            "- `## Out Of Scope`",
            "- optional: `## Open Questions`"
          ]
        : [])
    ].join("\n"),
    context: [
      context,
      `Planning issue: ${options.planningIssueNumber ? `#${options.planningIssueNumber}` : "none"}`,
      `Initiative id: ${options.initiativeId ?? "none"}`,
      `Initiative title: ${options.initiativeTitle ?? "none"}`,
      `Bounded first-slice required: ${requiresBoundedFirstSlice ? "yes" : "no"}`
    ].join("\n")
  };
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
  retryAttempt?: {
    attemptNumber: number;
    maxAttempts: number;
    reason?: string;
    missingTools?: string[];
    remediationCommands?: string[];
  };
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
    dirtyWorktree,
    retryAttempt
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
      ...(retryAttempt
        ? [
            "## Recovery retry attempt",
            `- attempt ${retryAttempt.attemptNumber} of ${retryAttempt.maxAttempts}`,
            `- ${retryAttempt.reason ??
              "Previous attempt exited before cstack observed a usable session, transcript, or final artifact; keep the same intent and retry with a conservative scope."}`,
            ...(retryAttempt.missingTools?.length
              ? [
                  `- Missing tools detected in prior attempt: ${retryAttempt.missingTools.join(", ")}`,
                  "- Repair the environment first, then continue with implementation."
                ]
              : []),
            ...(retryAttempt.remediationCommands?.length
              ? [
                  "### Suggested environment repair commands",
                  ...retryAttempt.remediationCommands.map((command) => `- ${command}`),
                  "- If a command fails, capture the exact error and choose a safer fallback command for the same tool."
                ]
              : []),
            "- Prioritise writing the final artifact even if implementation is incomplete.",
            ""
          ]
        : []),
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
      `Dirty worktree: ${dirtyWorktree ? "yes" : "no"}`,
      ...(retryAttempt
        ? [
            `Retry attempt: ${retryAttempt.attemptNumber}/${retryAttempt.maxAttempts}`,
            ...(retryAttempt.missingTools?.length ? [`Retry missing tools: ${retryAttempt.missingTools.join(", ")}`] : [])
          ]
        : [])
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
      "- run a bounded delivery workflow with explicit internal stages: build, validation, review, ship",
      "- preserve stage artifacts so later inspection can explain every handoff",
      "- validation should profile the repo, choose a test pyramid, and align local and GitHub Actions validation where justified",
      "- treat specialist reviewers as advisory inputs to the review lead",
      "- when GitHub mutation policy is enabled, the wrapper may create a branch, push it, and open or update a pull request during ship",
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
  const title = discoverTrackTitle(track);
  const referenceFiles = await readPromptReferenceFiles(cwd);

  const context = [
    "Workflow: discover",
    `Track: ${track}`,
    `Reason: ${reason}`,
    typeof plan.planningIssueNumber === "number" ? `Planning issue: #${plan.planningIssueNumber}` : undefined,
    `Web research allowed: ${plan.webResearchAllowed ? "yes" : "no"}`,
    ...buildReferenceContextLines(referenceFiles)
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = [
    `You are the \`${track}\` track in a bounded \`cstack discover\` research run.`,
    "",
    `Perform a focused ${title} pass for the user's request.`,
    "",
    "Rules:",
    "- stay inside this track's scope",
    "- be concrete and operational",
    "- do not write implementation code",
    "- inspect representative files only; start with manifests, README/docs, CI workflows, entrypoints, tests, and contracts before deep source scans",
    "- stop once you can name the top 3 gaps or first remediation candidates with evidence",
    "- after the first credible implementation-ready gap is supported by evidence, stop scanning and summarize it",
    "- cap shell activity to a small bounded sample; prefer at most 6 commands and at most 8 files inspected",
    "- if web research is not allowed, stay local to the repository and provided docs",
    "- if web research is allowed and needed, cite sources explicitly with stable URLs when possible",
    "- if the time or evidence budget is insufficient, return partial findings and unresolved items instead of continuing to scan",
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
    ...(typeof plan.planningIssueNumber === "number"
      ? ["## Linked planning issue", `- GitHub issue: #${plan.planningIssueNumber}`, ""]
      : []),
    "## Track activation reason",
    reason,
    "",
    "## Discover research plan",
    JSON.stringify(plan, null, 2),
    "",
    ...buildReferencePromptLines(referenceFiles)
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
  const referenceFiles = await readPromptReferenceFiles(cwd);

  const context = [
    "Workflow: discover",
    "Role: Research Lead",
    `Delegated tracks: ${delegateResults.map((result) => result.track).join(", ") || "none"}`,
    typeof plan.planningIssueNumber === "number" ? `Planning issue: #${plan.planningIssueNumber}` : undefined,
    `Web research allowed: ${plan.webResearchAllowed ? "yes" : "no"}`,
    ...buildReferenceContextLines(referenceFiles)
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = [
    "You are the `Research Lead` for a bounded `cstack discover` run.",
    "",
    delegateResults.length > 0
      ? "Synthesize the delegated research tracks into one concise discovery report."
      : "Perform one bounded first-pass discover sweep and return a concise discovery report.",
    "",
    "Requirements:",
    "- distinguish observed local findings from external findings",
    "- preserve uncertainty and unresolved questions",
    "- do not invent facts not supported by delegate output",
    "- make the result directly useful for a later `spec` stage",
    "- if no delegated tracks were provided, inspect representative files only and avoid a repo-wide scan",
    "- stop once you can name the top 3 gaps or first remediation candidates with evidence",
    "- after the first credible implementation-ready gap is supported by evidence, stop scanning and summarize it",
    "- cap shell activity to a small bounded sample; prefer at most 6 commands and at most 8 files inspected",
    "- if time or evidence is limited, return partial findings instead of continuing to scan",
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
    ...(typeof plan.planningIssueNumber === "number"
      ? ["## Linked planning issue", `- GitHub issue: #${plan.planningIssueNumber}`, ""]
      : []),
    "## Discover research plan",
    JSON.stringify(plan, null, 2),
    "",
    "## Delegate results",
    JSON.stringify(summarizeDiscoverDelegates(delegateResults), null, 2),
    "",
    ...buildReferencePromptLines(referenceFiles)
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
    case "mobile-validation-specialist":
      return "mobile validation review";
    case "container-validation-specialist":
      return "container validation review";
    case "browser-e2e-specialist":
      return "browser end-to-end validation review";
    case "api-contract-specialist":
      return "API contract validation review";
    case "workflow-security-specialist":
      return "workflow security validation review";
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
  const title = specialistTitle(name);
  const referenceFiles = await readPromptReferenceFiles(cwd);

  const context = [
    `Workflow: intent`,
    `Specialist: ${name}`,
    `Reason: ${reason}`,
    ...buildReferenceContextLines(referenceFiles)
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
    ...buildReferencePromptLines(referenceFiles)
  ].join("\n");

  return { prompt, context };
}

export async function buildDeliverReviewLeadPrompt(options: {
  cwd: string;
  input: string;
  mode: ReviewMode;
  buildSummary: string;
  verificationRecord: object;
  validationPlan?: object;
  validationLocalRecord?: object;
  specialistResults: Array<{ name: SpecialistName; reason: string; finalBody: string }>;
}): Promise<{ prompt: string; context: string }> {
  const { cwd, input, mode, buildSummary, verificationRecord, validationPlan, validationLocalRecord, specialistResults } = options;
  const referenceFiles = await readPromptReferenceFiles(cwd);

  return {
    prompt: [
      mode === "analysis"
        ? "You are the `Review Lead` for a bounded `cstack review` workflow running in analysis mode."
        : "You are the `Review Lead` for a bounded `cstack deliver` workflow.",
      "",
      mode === "analysis"
        ? "Synthesize the linked context, evidence, and specialist reviews into one analytical gap assessment."
        : "Synthesize the build stage output, verification evidence, and specialist reviews into one review verdict.",
      "",
      "Requirements:",
      ...(mode === "analysis"
        ? [
            "- treat this as analytical critique, not as a release gate",
            "- identify the main gap clusters, likely root causes, and next implementation slices",
            "- use `status: \"completed\"` when the analysis succeeded, even if the findings are severe",
            "- do not phrase the summary as `delivery is blocked` unless the user explicitly asked for readiness"
          ]
        : [
            "- be explicit about whether delivery is ready, needs changes, or is blocked",
            "- preserve serious risks even when the build itself completed"
          ]),
      "- cite specialist input only when it materially changed the verdict",
      "- return valid JSON only, with no markdown fences or extra commentary",
      "",
      "Required JSON shape:",
      "{",
      mode === "analysis"
        ? '  "mode": "analysis",'
        : '  "mode": "readiness",',
      mode === "analysis"
        ? '  "status": "completed",'
        : '  "status": "ready" | "changes-requested" | "blocked",',
      '  "summary": "short summary",',
      '  "findings": [{"severity": "info" | "warning" | "high", "title": "finding title", "detail": "details", "owner": "optional"}],',
      '  "recommendedActions": ["action"],',
      ...(mode === "analysis"
        ? [
            '  "gapClusters": [{"title": "gap cluster", "severity": "info" | "warning" | "high", "summary": "what is missing", "evidence": ["optional evidence"]}],',
            '  "likelyRootCauses": ["cause"],',
            '  "recommendedNextSlices": ["next slice"],',
            '  "confidence": "low" | "medium" | "high",',
            '  "evidenceNotes": ["evidence note"],'
          ]
        : []),
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
      "## Validation evidence",
      validationPlan ? JSON.stringify(validationPlan, null, 2) : "(missing)",
      "",
      "## Local validation results",
      validationLocalRecord ? JSON.stringify(validationLocalRecord, null, 2) : "(missing)",
      "",
      "## Specialist outputs",
      JSON.stringify(specialistResults, null, 2),
      "",
      ...buildReferencePromptLines(referenceFiles)
    ].join("\n"),
    context: [
      `Workflow: ${mode === "analysis" ? "review" : "deliver"}`,
      "Role: Review Lead",
      `Review mode: ${mode}`,
      `Selected specialists: ${specialistResults.map((result) => result.name).join(", ") || "none"}`,
      ...buildReferenceContextLines(referenceFiles)
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
  const title = specialistTitle(name);
  const referenceFiles = await readPromptReferenceFiles(cwd);

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
      ...buildReferencePromptLines(referenceFiles)
    ].join("\n"),
    context: [
      "Workflow: deliver",
      `Specialist: ${name}`,
      `Reason: ${reason}`,
      ...buildReferenceContextLines(referenceFiles)
    ].join("\n")
  };
}

export async function buildDeliverShipPrompt(options: {
  cwd: string;
  input: string;
  buildSummary: string;
  validationPlan?: object;
  validationLocalRecord?: object;
  reviewVerdict: DeliverReviewVerdict;
  verificationRecord: object;
  githubMutationRecord: object;
  githubDeliveryRecord: object;
}): Promise<{ prompt: string; context: string }> {
  const { cwd, input, buildSummary, validationPlan, validationLocalRecord, reviewVerdict, verificationRecord, githubMutationRecord, githubDeliveryRecord } = options;
  const referenceFiles = await readPromptReferenceFiles(cwd);

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
      "## Validation evidence",
      validationPlan ? JSON.stringify(validationPlan, null, 2) : "(missing)",
      "",
      "## Local validation results",
      validationLocalRecord ? JSON.stringify(validationLocalRecord, null, 2) : "(missing)",
      "",
      "## GitHub mutation state",
      JSON.stringify(githubMutationRecord, null, 2),
      "",
      "## GitHub delivery evidence",
      JSON.stringify(githubDeliveryRecord, null, 2),
      "",
      ...buildReferencePromptLines(referenceFiles)
    ].join("\n"),
    context: [
      "Workflow: deliver",
      "Role: Ship Lead",
      `Review status: ${reviewVerdict.status}`,
      ...buildReferenceContextLines(referenceFiles)
    ].join("\n")
  };
}

export async function buildDeliverValidationSpecialistPrompt(options: {
  cwd: string;
  input: string;
  name: SpecialistName;
  reason: string;
  repoProfile: ValidationRepoProfile;
  toolResearch: ValidationToolResearch;
  buildSummary: string;
  buildVerificationRecord: object;
}): Promise<{ prompt: string; context: string }> {
  const { cwd, input, name, reason, repoProfile, toolResearch, buildSummary, buildVerificationRecord } = options;
  const title = specialistTitle(name);
  const referenceFiles = await readPromptReferenceFiles(cwd);

  return {
    prompt: [
      `You are running the \`${name}\` specialist for the \`validation\` stage inside \`cstack deliver\`.`,
      "",
      `Perform a focused ${title} against the current repo profile, tool research, and build outputs.`,
      "",
      "Requirements:",
      "- stay inside the named specialist scope",
      "- prefer OSS tools that work both locally and in GitHub Actions",
      "- do not install, download, or upgrade tools during this specialist run; use only tools already present on the host",
      "- if a desired tool is missing or would require registry/network access, record that as an external blocker or limitation instead of retrying installs",
      "- do not mutate repository files in this specialist run",
      "- call out concrete gaps, runner constraints, and suggested test layers",
      "- be concise and operational",
      "- structure the output so the validation lead can accept, partially accept, or discard it cleanly",
      "",
      "## Deliver request",
      input,
      "",
      "## Specialist activation reason",
      reason,
      "",
      "## Repo profile",
      JSON.stringify(repoProfile, null, 2),
      "",
      "## Tool research",
      JSON.stringify(toolResearch, null, 2),
      "",
      "## Build summary",
      excerpt(buildSummary, 60) || "(missing)",
      "",
      "## Build verification",
      JSON.stringify(buildVerificationRecord, null, 2),
      "",
      ...buildReferencePromptLines(referenceFiles)
    ].join("\n"),
    context: [
      "Workflow: deliver",
      "Role: Validation specialist",
      `Specialist: ${name}`,
      `Reason: ${reason}`,
      ...buildReferenceContextLines(referenceFiles)
    ].join("\n")
  };
}

export async function buildDeliverValidationLeadPrompt(options: {
  cwd: string;
  input: string;
  repoProfile: ValidationRepoProfile;
  toolResearch: ValidationToolResearch;
  initialPlan: DeliverValidationPlan;
  buildSummary: string;
  buildVerificationRecord: object;
  specialistResults: Array<{ name: SpecialistName; reason: string; finalBody: string }>;
}): Promise<{ prompt: string; context: string }> {
  const { cwd, input, repoProfile, toolResearch, initialPlan, buildSummary, buildVerificationRecord, specialistResults } = options;
  const referenceFiles = await readPromptReferenceFiles(cwd);

  return {
    prompt: [
      "You are the `Validation Lead` for a bounded `cstack deliver` workflow.",
      "",
      "Turn the build output into a repo-aware validation stage.",
      "",
      "Requirements:",
      "- refine or extend tests and GitHub Actions validation only when justified by the repo profile",
      "- think in a test pyramid: static, unit/component, integration/contract, e2e/system, packaging/smoke",
      "- prefer OSS tools that support both local execution and GitHub Actions",
      "- do not rely on ad-hoc network installs or package-registry downloads during this validation run",
      "- classify missing tools, registry failures, or network failures as explicit external blockers instead of repo defects",
      "- avoid recommending tools with weak repo fit just because they are popular",
      "- preserve platform constraints such as macOS, emulators, or Docker requirements",
      "- return valid JSON only, with no markdown fences or extra commentary",
      "",
      "Required JSON shape:",
      "{",
      '  "status": "ready" | "partial" | "blocked",',
      '  "summary": "short summary",',
      '  "profileSummary": "short summary",',
      '  "layers": [{"name": "static" | "unit-component" | "integration-contract" | "e2e-system" | "packaging-smoke", "selected": true, "status": "planned" | "ready" | "partial" | "blocked" | "skipped", "rationale": "why", "selectedTools": ["tool"], "localCommands": ["command"], "ciCommands": ["command"], "coverageIntent": ["intent"], "notes": ["optional"]}],',
      '  "selectedSpecialists": [{"name": "browser-e2e-specialist", "disposition": "accepted" | "partial" | "discarded", "reason": "why"}],',
      '  "localValidation": {"commands": ["command"], "prerequisites": ["item"], "notes": ["note"]},',
      '  "ciValidation": {"workflowFiles": ["path"], "jobs": [{"name": "job", "runner": "ubuntu-latest", "purpose": "why", "commands": ["cmd"], "artifacts": ["artifact"]}], "notes": ["note"]},',
      '  "coverage": {"confidence": "low" | "medium" | "high", "summary": "summary", "signals": ["signal"], "gaps": ["gap"]},',
      '  "recommendedChanges": ["change"],',
      '  "unsupported": ["limit"],',
      '  "pyramidMarkdown": "# Test Pyramid\\n...",',
      '  "reportMarkdown": "# Validation Summary\\n...",',
      '  "githubActionsPlanMarkdown": "# GitHub Actions Validation Plan\\n..."',
      "}",
      "",
      "## Deliver request",
      input,
      "",
      "## Repo profile",
      JSON.stringify(repoProfile, null, 2),
      "",
      "## Tool research",
      JSON.stringify(toolResearch, null, 2),
      "",
      "## Initial validation plan",
      JSON.stringify(initialPlan, null, 2),
      "",
      "## Build summary",
      excerpt(buildSummary, 80) || "(missing)",
      "",
      "## Build verification",
      JSON.stringify(buildVerificationRecord, null, 2),
      "",
      "## Validation specialist outputs",
      JSON.stringify(specialistResults, null, 2),
      "",
      ...buildReferencePromptLines(referenceFiles)
    ].join("\n"),
    context: [
      "Workflow: deliver",
      "Role: Validation Lead",
      `Selected validation specialists: ${specialistResults.map((result) => result.name).join(", ") || "none"}`,
      ...buildReferenceContextLines(referenceFiles)
    ].join("\n")
  };
}
