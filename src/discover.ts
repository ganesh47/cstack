import path from "node:path";
import { promises as fs } from "node:fs";
import { buildEvent, ProgressReporter } from "./progress.js";
import { runCodexExec, type CodexRunResult } from "./codex.js";
import { buildDiscoverLeadPrompt, buildDiscoverTrackPrompt } from "./prompt.js";
import { isBroadGapRemediationPrompt } from "./spec-contract.js";
import type {
  CapabilityUsageRecord,
  CstackConfig,
  DiscoverDelegateResult,
  DiscoverResearchPlan,
  DiscoverSourceRecord,
  DiscoverTrackName,
  DiscoverTrackSelection,
  RunEvent
} from "./types.js";

const TRACK_ORDER: DiscoverTrackName[] = ["repo-explorer", "risk-researcher", "external-researcher"];
const DISCOVER_LEAD_RESERVE_SECONDS = 15;
const DISCOVER_STALE_SESSION_TIMEOUT_SECONDS = 60;
const DEFAULT_DISCOVER_NO_PROGRESS_TIMEOUT_SECONDS = 45;

interface DiscoverPaths {
  runDir: string;
  stageDir: string;
  promptPath: string;
  contextPath: string;
  finalPath: string;
  eventsPath: string;
  stdoutPath: string;
  stderrPath: string;
  artifactPath: string;
}

export interface DiscoverExecutionOptions {
  cwd: string;
  runId: string;
  input: string;
  config: CstackConfig;
  planningIssueNumber?: number;
  paths: DiscoverPaths;
}

export interface DiscoverExecutionResult {
  researchPlan: DiscoverResearchPlan;
  delegates: DiscoverDelegateResult[];
  leadResult: CodexRunResult;
  finalBody: string;
  status: "completed" | "partial" | "failed";
  notes: string[];
}

interface DiscoverLeadJson {
  summary?: string;
  localFindings?: string[];
  externalFindings?: string[];
  risks?: string[];
  openQuestions?: string[];
  delegateDisposition?: Array<{
    track?: string;
    leaderDisposition?: string;
    reason?: string;
  }>;
  reportMarkdown?: string;
}

interface HeuristicFileRecord {
  path: string;
  body: string;
}

function compact(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function resolveDiscoverNoProgressTimeoutSeconds(timeoutSeconds?: number): number | undefined {
  const configured = Number.parseInt(process.env.CSTACK_DISCOVER_NO_PROGRESS_TIMEOUT_SECONDS ?? "", 10);
  const baseTimeout =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DISCOVER_NO_PROGRESS_TIMEOUT_SECONDS;

  if (typeof timeoutSeconds === "number" && timeoutSeconds > 0) {
    return Math.max(1, Math.min(baseTimeout, timeoutSeconds));
  }

  return baseTimeout;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildDiscoverCapabilityRecord(options: {
  config: CstackConfig;
  requested: string[];
  selectedTracks: DiscoverTrackSelection[];
  webResearchAllowed: boolean;
}): CapabilityUsageRecord {
  const workflowPolicy = options.config.workflows.discover.capabilities ?? {};
  const allowed = unique(workflowPolicy.allowed ?? []);
  const requested = unique([...(workflowPolicy.defaultRequested ?? []), ...options.requested]);
  const downgraded: CapabilityUsageRecord["downgraded"] = [];
  const available: string[] = [];

  for (const capability of requested) {
    if (allowed.length > 0 && !allowed.includes(capability)) {
      downgraded.push({
        name: capability,
        reason: "not allowed by workflow capability policy"
      });
      continue;
    }
    if (capability === "web" && !options.webResearchAllowed) {
      downgraded.push({
        name: capability,
        reason: "disabled by discover research policy"
      });
      continue;
    }
    available.push(capability);
  }

  const used = unique([
    "shell",
    ...(options.selectedTracks.some((track) => track.name === "external-researcher" && track.selected) && available.includes("web") ? ["web"] : [])
  ]).filter((capability) => available.includes(capability));

  return {
    workflow: "discover",
    allowed,
    requested,
    available,
    used,
    downgraded,
    notes: [
      `web research allowed: ${options.webResearchAllowed ? "yes" : "no"}`,
      `selected tracks: ${options.selectedTracks.filter((track) => track.selected).map((track) => track.name).join(", ") || "none"}`
    ]
  };
}

function inferTrackSelections(input: string, config: CstackConfig, planningIssueNumber?: number): DiscoverResearchPlan {
  const lower = input.toLowerCase();
  const words = input.trim().split(/\s+/).filter(Boolean).length;
  const researchEnabled = config.workflows.discover.research?.enabled !== false;
  const delegationEnabled = config.workflows.discover.delegation?.enabled === true;
  const maxTracks = Math.max(0, config.workflows.discover.delegation?.maxAgents ?? 0);
  const allowWeb = config.workflows.discover.research?.allowWeb === true;
  const localOnly = /\b(single file|one file|small|tiny|minor|rename|format|trivial|simple)\b/i.test(lower);
  const broadRepoSignal =
    /\b(map|research|explore|survey|architecture|constraints|risks|repo|repository|codebase|touchpoints|current)\b/i.test(lower) ||
    words >= 8;
  const externalSignal =
    /\b(latest|current version|official|documentation|docs|api|sdk|library|vendor|service|oauth|oidc|sso|standard|regulation|release notes|version|compare)\b/i.test(
      lower
    );
  const riskSignal =
    /\b(security|auth|audit|compliance|privacy|secret|token|credential|rollout|runtime|release|production|risk|threat|sso|oauth|oidc)\b/i.test(
      lower
    );

  const shouldDelegate = researchEnabled && delegationEnabled && maxTracks > 0 && !localOnly && broadRepoSignal;
  const selected = new Set<DiscoverTrackName>();

  if (shouldDelegate) {
    selected.add("repo-explorer");
    if (riskSignal && selected.size < maxTracks) {
      selected.add("risk-researcher");
    }
    if (allowWeb && externalSignal && selected.size < maxTracks) {
      selected.add("external-researcher");
    }
  }

  const repoOnlyDelegation =
    selected.size === 1 && selected.has("repo-explorer") && !isBroadGapRemediationPrompt(input);
  if (repoOnlyDelegation) {
    selected.clear();
  }

  const tracks: DiscoverTrackSelection[] = TRACK_ORDER.map((track) => {
    switch (track) {
      case "repo-explorer":
        return {
          name: track,
          reason: shouldDelegate
            ? "Selected to inspect local code, config, tests, and architecture."
            : "Not selected because the discover request stays small enough for a single coherent pass.",
          selected: selected.has(track),
          requiresWeb: false
        };
      case "risk-researcher":
        return {
          name: track,
          reason: riskSignal
            ? "The request implies a concrete security, compliance, audit, runtime, or rollout risk domain."
            : "Not strongly implied by the current discover request.",
          selected: selected.has(track),
          requiresWeb: false
        };
      case "external-researcher":
        return {
          name: track,
          reason: allowWeb
            ? externalSignal
              ? "The request depends on external or unstable facts that benefit from cited web research."
              : "Not strongly implied by the current discover request."
            : "Web research is disabled by discover policy.",
          selected: selected.has(track),
          requiresWeb: true
        };
    }
  });

  const requestedCapabilities = ["shell"];
  if (selected.has("external-researcher") || externalSignal) {
    requestedCapabilities.push("web");
  }

  const limitations: string[] = [];
  if (!shouldDelegate) {
    limitations.push("Delegated research was suppressed because the prompt appears small, local, or not broad enough to justify fan-out.");
  }
  if (repoOnlyDelegation) {
    limitations.push("Delegated research was suppressed because only the repo-explorer track qualified; a single-agent discover pass is faster and more reliable for repo-only prompts.");
  }
  if (externalSignal && !allowWeb) {
    limitations.push("Web-backed external research was requested by the prompt signal but disabled by discover policy.");
  }

  return {
    prompt: input,
    decidedAt: new Date().toISOString(),
    mode: shouldDelegate && selected.size > 0 ? "research-team" : "single-agent",
    ...(typeof planningIssueNumber === "number" ? { planningIssueNumber } : {}),
    delegationEnabled,
    maxTracks,
    webResearchAllowed: allowWeb,
    requestedCapabilities,
    availableCapabilities: requestedCapabilities,
    summary:
      shouldDelegate && selected.size > 0
        ? `Research Lead with tracks: ${tracks.filter((track) => track.selected).map((track) => track.name).join(", ")}`
        : "Research Lead only; delegated tracks suppressed",
    tracks,
    limitations
  };
}

function buildRequestBody(track: DiscoverTrackSelection, plan: DiscoverResearchPlan): string {
  return [
    `# ${track.name}`,
    "",
    `Reason: ${track.reason}`,
    `Web research allowed: ${track.requiresWeb && plan.webResearchAllowed ? "yes" : "no"}`,
    `Acceptance: return a bounded analyze-only result with explicit findings, provenance, and unresolved questions.`
  ].join("\n");
}

function normalizeSource(value: unknown): DiscoverSourceRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? compact(record.title) : "";
  const location = typeof record.location === "string" ? compact(record.location) : "";
  if (!title || !location) {
    return null;
  }
  const kind = record.kind;
  return {
    title,
    location,
    kind: kind === "url" || kind === "file" || kind === "command" || kind === "note" ? kind : "note",
    ...(typeof record.retrievedAt === "string" && record.retrievedAt ? { retrievedAt: record.retrievedAt } : {}),
    ...(typeof record.notes === "string" && record.notes ? { notes: compact(record.notes) } : {})
  };
}

function extractJsonObject(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fenced = trimmed.match(/```json\s*([\s\S]+?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return null;
}

function parseJson<T>(input: string): T | null {
  const candidate = extractJsonObject(input);
  if (!candidate) {
    return null;
  }
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

function urlsFromText(input: string): DiscoverSourceRecord[] {
  const matches = [...input.matchAll(/https?:\/\/[^\s)>\]]+/g)];
  return matches.slice(0, 5).map((match) => ({
    title: "Referenced URL",
    location: match[0],
    kind: "url"
  }));
}

function hasMeaningfulDelegateEvidence(delegate: Pick<DiscoverDelegateResult, "findings" | "sources" | "filesInspected" | "commandsRun" | "unresolved">): boolean {
  return (
    delegate.findings.length > 0 ||
    delegate.sources.length > 0 ||
    delegate.filesInspected.length > 0 ||
    delegate.commandsRun.length > 0 ||
    delegate.unresolved.length > 0
  );
}

function hasUsableLeadArtifact(lead: DiscoverLeadJson): boolean {
  return (
    (lead.localFindings?.length ?? 0) > 0 ||
    (lead.externalFindings?.length ?? 0) > 0 ||
    (lead.risks?.length ?? 0) > 0 ||
    (lead.openQuestions?.length ?? 0) > 0
  );
}

function remainingBudgetSeconds(startedAt: number, totalSeconds: number | undefined, reserveSeconds = 0): number | undefined {
  if (typeof totalSeconds !== "number" || totalSeconds <= 0) {
    return undefined;
  }
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  return Math.max(0, totalSeconds - elapsedSeconds - reserveSeconds);
}

function normalizeDelegateResult(
  track: DiscoverTrackName,
  rawText: string,
  code: number,
  sessionId?: string
): Omit<DiscoverDelegateResult, "delegateDir" | "artifactPath" | "resultPath" | "sourcesPath"> {
  const parsed = parseJson<Record<string, unknown>>(rawText);
  const summary = typeof parsed?.summary === "string" ? compact(parsed.summary) : "";
  const status = parsed?.status;
  const findings = Array.isArray(parsed?.findings) ? parsed!.findings.filter((value): value is string => typeof value === "string").map(compact) : [];
  const unresolved = Array.isArray(parsed?.unresolved)
    ? parsed!.unresolved.filter((value): value is string => typeof value === "string").map(compact)
    : [];
  const filesInspected = Array.isArray(parsed?.filesInspected)
    ? parsed!.filesInspected.filter((value): value is string => typeof value === "string").map(compact)
    : [];
  const commandsRun = Array.isArray(parsed?.commandsRun)
    ? parsed!.commandsRun.filter((value): value is string => typeof value === "string").map(compact)
    : [];
  const rawSources = Array.isArray(parsed?.sources)
    ? parsed!.sources.map(normalizeSource).filter((value): value is DiscoverSourceRecord => value !== null)
    : [];
  const confidence = parsed?.confidence;
  const completedWithStructuredEvidence =
    status === "completed" && (findings.length > 0 || unresolved.length > 0 || filesInspected.length > 0 || commandsRun.length > 0 || rawSources.length > 0);

  return {
    track,
    status:
      status === "completed" || status === "failed" || status === "stalled" || status === "discarded"
        ? status
        : code === 0
          ? "completed"
          : "failed",
    summary: summary || (completedWithStructuredEvidence ? `${track} returned structured findings.` : `${track} did not produce structured findings.`),
    filesInspected,
    commandsRun,
    sources: rawSources.length > 0 ? rawSources : code === 0 ? urlsFromText(rawText) : [],
    findings: findings,
    confidence: confidence === "low" || confidence === "medium" || confidence === "high" ? confidence : "medium",
    unresolved,
    leaderDisposition: completedWithStructuredEvidence ? "partial" : code === 0 ? "accepted" : "discarded",
    ...(code !== 0 ? { notes: completedWithStructuredEvidence ? `${track} exited non-zero after producing structured findings.` : `${track} exited unsuccessfully before producing structured findings.` } : {}),
    ...(sessionId ? { sessionId } : {})
  };
}

function synthesizeFallbackReport(input: string, delegates: DiscoverDelegateResult[], plan: DiscoverResearchPlan): DiscoverLeadJson {
  const localFindings = delegates
    .filter((delegate) => delegate.track !== "external-researcher")
    .flatMap((delegate) => delegate.findings)
    .slice(0, 6);
  const externalFindings = delegates
    .filter((delegate) => delegate.track === "external-researcher")
    .flatMap((delegate) => delegate.findings)
    .slice(0, 4);
  const openQuestions = delegates.flatMap((delegate) => delegate.unresolved).slice(0, 6);
  const risks = delegates
    .filter((delegate) => delegate.track === "risk-researcher")
    .flatMap((delegate) => delegate.findings)
    .slice(0, 4);

  return {
    summary: plan.summary,
    localFindings,
    externalFindings,
    risks,
    openQuestions,
    delegateDisposition: delegates.map((delegate) => ({
      track: delegate.track,
      leaderDisposition: delegate.leaderDisposition,
      reason: delegate.summary
    })),
    reportMarkdown:
      [
        "# Discovery Report",
        "",
        "## Request",
        input,
        "",
        "## Research plan",
        plan.summary,
        "",
        "## Local findings",
        ...(localFindings.length > 0 ? localFindings.map((finding) => `- ${finding}`) : ["- none recorded"]),
        "",
        "## External findings",
        ...(externalFindings.length > 0 ? externalFindings.map((finding) => `- ${finding}`) : ["- none recorded"]),
        "",
        "## Risks",
        ...(risks.length > 0 ? risks.map((risk) => `- ${risk}`) : ["- none recorded"]),
        "",
        "## Open questions",
        ...(openQuestions.length > 0 ? openQuestions.map((question) => `- ${question}`) : ["- none recorded"])
      ].join("\n") + "\n"
  };
}

async function readHeuristicFiles(cwd: string, relativePaths: string[]): Promise<HeuristicFileRecord[]> {
  const resolved: HeuristicFileRecord[] = [];

  for (const relativePath of relativePaths) {
    try {
      const body = await fs.readFile(path.join(cwd, relativePath), "utf8");
      resolved.push({ path: relativePath, body });
    } catch {}
  }

  return resolved;
}

async function buildBroadGapHeuristicFallback(
  cwd: string,
  input: string,
  plan: DiscoverResearchPlan,
  delegates: DiscoverDelegateResult[]
): Promise<DiscoverLeadJson | null> {
  if (!isBroadGapRemediationPrompt(input)) {
    return null;
  }

  const files = await readHeuristicFiles(cwd, [
    "README.md",
    "docs/project-readme.md",
    "docker/README.md",
    "docker/api/compose.yml",
    "docker/compose.stack.yml",
    "specs/001-plan-alignment/quickstart.md"
  ]);

  if (files.length === 0) {
    return null;
  }

  const docsBody = files
    .filter((file) => /(^|\/)(README\.md|project-readme\.md|quickstart\.md)$/i.test(file.path))
    .map((file) => file.body)
    .join("\n");
  const composeFiles = files.filter((file) => /compose\.(ya?ml)$/i.test(file.path));
  const composeBody = composeFiles.map((file) => file.body).join("\n");
  const dockerReadme = files.find((file) => file.path === "docker/README.md")?.body ?? "";

  const findings: string[] = [];
  const openQuestions: string[] = [];

  const hasPlaceholderCompose =
    /(tail -f \/dev\/null|placeholder|Run pnpm start once Fastify server exists|CLI placeholder|Connector placeholder)/i.test(composeBody);
  const docsClaimRunnableCompose =
    /(docker compose\s+-f\s+docker\/api\/compose\.yml\s+up -d|curl http:\/\/localhost:8080\/health\/ready|end-to-end workflow|local smoke tests)/i.test(
      `${docsBody}\n${dockerReadme}`
    );

  if (hasPlaceholderCompose && docsClaimRunnableCompose) {
    findings.push(
      "Docker delivery artifacts drift from the documented runnable flow: the compose files still use placeholder commands and `tail -f /dev/null`, while the docs present them as ready smoke-test entrypoints."
    );
    openQuestions.push(
      "After the compose entrypoints are made truthful, rerun the documented local smoke path to confirm the API and dependent services actually boot."
    );
  }

  if (findings.length === 0) {
    return null;
  }

  return {
    summary: "Recovered bounded local findings from repo heuristics after delegated discover did not converge cleanly.",
    localFindings: findings,
    externalFindings: [],
    risks: [],
    openQuestions,
    delegateDisposition: delegates.map((delegate) => ({
      track: delegate.track,
      leaderDisposition: delegate.leaderDisposition,
      reason: delegate.notes ?? delegate.summary
    })),
    reportMarkdown:
      [
        "# Discovery Report",
        "",
        "## Request",
        input,
        "",
        "## Research plan",
        plan.summary,
        "",
        "## Local findings",
        ...findings.map((finding) => `- ${finding}`),
        "",
        "## External findings",
        "- none recorded",
        "",
        "## Risks",
        "- none recorded",
        "",
        "## Open questions",
        ...openQuestions.map((question) => `- ${question}`),
        "",
        "## Recovery notes",
        "- Discover recovered this bounded fallback from representative repo files after delegated research exceeded the no-progress guard."
      ].join("\n") + "\n"
  };
}

function normalizeLeadJson(input: string, delegates: DiscoverDelegateResult[], plan: DiscoverResearchPlan, rawText: string): DiscoverLeadJson {
  const parsed = parseJson<DiscoverLeadJson>(rawText);
  if (!parsed) {
    return delegates.some((delegate) => hasMeaningfulDelegateEvidence(delegate))
      ? synthesizeFallbackReport(input, delegates, plan)
      : {
          summary: plan.summary,
          localFindings: [],
          externalFindings: [],
          risks: [],
          openQuestions: [],
          delegateDisposition: delegates.map((delegate) => ({
            track: delegate.track,
            leaderDisposition: delegate.leaderDisposition,
            reason: delegate.summary
          })),
          reportMarkdown: ""
        };
  }
  return {
    summary: typeof parsed.summary === "string" ? compact(parsed.summary) : plan.summary,
    localFindings: Array.isArray(parsed.localFindings) ? parsed.localFindings.filter((value): value is string => typeof value === "string").map(compact) : [],
    externalFindings: Array.isArray(parsed.externalFindings)
      ? parsed.externalFindings.filter((value): value is string => typeof value === "string").map(compact)
      : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.filter((value): value is string => typeof value === "string").map(compact) : [],
    openQuestions: Array.isArray(parsed.openQuestions)
      ? parsed.openQuestions.filter((value): value is string => typeof value === "string").map(compact)
      : [],
    delegateDisposition: Array.isArray(parsed.delegateDisposition) ? parsed.delegateDisposition : [],
    reportMarkdown:
      typeof parsed.reportMarkdown === "string" && parsed.reportMarkdown.trim()
        ? parsed.reportMarkdown.endsWith("\n")
          ? parsed.reportMarkdown
          : `${parsed.reportMarkdown}\n`
        : synthesizeFallbackReport(input, delegates, plan).reportMarkdown ?? ""
  };
}

function applyLeadDisposition(delegates: DiscoverDelegateResult[], lead: DiscoverLeadJson): DiscoverDelegateResult[] {
  const dispositions = new Map(
    (lead.delegateDisposition ?? [])
      .filter((entry) => typeof entry.track === "string")
      .map((entry) => [entry.track as DiscoverTrackName, entry])
  );

  return delegates.map((delegate) => {
    const disposition = dispositions.get(delegate.track);
    if (!disposition) {
      return delegate;
    }
    const leaderDisposition =
      disposition.leaderDisposition === "accepted" ||
      disposition.leaderDisposition === "partial" ||
      disposition.leaderDisposition === "discarded"
        ? disposition.leaderDisposition
        : delegate.leaderDisposition;
    const nextNotes = typeof disposition.reason === "string" && disposition.reason ? compact(disposition.reason) : delegate.notes;
    return {
      ...delegate,
      leaderDisposition,
      ...(nextNotes ? { notes: nextNotes } : {})
    };
  });
}

function createDiscoverRecorder(runId: string, eventsPath: string): {
  emit: (type: RunEvent["type"], message: string, stream?: "stdout" | "stderr") => Promise<void>;
  setTracks: (names: string[]) => void;
  markTrack: (name: string, status: "pending" | "running" | "completed" | "failed" | "deferred" | "skipped") => void;
  close: () => void;
} {
  const reporter = new ProgressReporter("discover", runId);
  const startedAt = Date.now();

  return {
    emit: async (type, message, stream) => {
      const event = buildEvent(type, Date.now() - startedAt, message, stream);
      await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
      reporter.emit(event);
    },
    setTracks: (names) => reporter.setSpecialists(names),
    markTrack: (name, status) => reporter.markSpecialist(name, status),
    close: () => reporter.close()
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readBestEffortCodexOutput(paths: { finalPath: string; stdoutPath: string; stderrPath: string }): Promise<string> {
  for (const filePath of [paths.finalPath, paths.stdoutPath, paths.stderrPath]) {
    try {
      const body = await fs.readFile(filePath, "utf8");
      if (body.trim()) {
        return body;
      }
    } catch {}
  }

  return "";
}

async function runTrack(options: {
  cwd: string;
  runId: string;
  input: string;
  config: CstackConfig;
  stageDir: string;
  plan: DiscoverResearchPlan;
  track: DiscoverTrackSelection;
  recorder: ReturnType<typeof createDiscoverRecorder>;
  timeoutSeconds?: number;
}): Promise<{ delegate: DiscoverDelegateResult; result: CodexRunResult }> {
  const delegateDir = path.join(options.stageDir, "delegates", options.track.name);
  await fs.mkdir(delegateDir, { recursive: true });
  const requestPath = path.join(delegateDir, "request.md");
  const promptPath = path.join(delegateDir, "prompt.md");
  const contextPath = path.join(delegateDir, "context.md");
  const finalPath = path.join(delegateDir, "final.md");
  const eventsPath = path.join(delegateDir, "events.jsonl");
  const stdoutPath = path.join(delegateDir, "stdout.log");
  const stderrPath = path.join(delegateDir, "stderr.log");
  const resultPath = path.join(delegateDir, "result.json");
  const sourcesPath = path.join(delegateDir, "sources.json");

  const { prompt, context } = await buildDiscoverTrackPrompt({
    cwd: options.cwd,
    input: options.input,
    track: options.track.name,
    reason: options.track.reason,
    plan: options.plan
  });

  await fs.writeFile(requestPath, buildRequestBody(options.track, options.plan), "utf8");
  await fs.writeFile(promptPath, prompt, "utf8");
  await fs.writeFile(contextPath, `${context}\n`, "utf8");

  options.recorder.markTrack(options.track.name, "running");
  await options.recorder.emit("activity", `Running discover track ${options.track.name}`);
  const noProgressTimeoutSeconds = resolveDiscoverNoProgressTimeoutSeconds(options.timeoutSeconds);

  const result = await runCodexExec({
    cwd: options.cwd,
    workflow: "discover",
    runId: `${options.runId}-${options.track.name}`,
    prompt,
    finalPath,
    eventsPath,
    stdoutPath,
    stderrPath,
    config: options.config,
    silentProgress: true,
    staleSessionTimeoutSeconds: DISCOVER_STALE_SESSION_TIMEOUT_SECONDS,
    ...(typeof noProgressTimeoutSeconds === "number" ? { noProgressTimeoutSeconds } : {}),
    ...(typeof options.timeoutSeconds === "number" ? { timeoutSeconds: options.timeoutSeconds } : {})
  });

  const rawFinal = await readBestEffortCodexOutput({ finalPath, stdoutPath, stderrPath });
  const delegate = normalizeDelegateResult(options.track.name, rawFinal, result.code, result.sessionId);
  const finalized: DiscoverDelegateResult = {
    ...delegate,
    delegateDir,
    artifactPath: finalPath,
    resultPath,
    sourcesPath
  };

  await writeJson(resultPath, finalized);
  await writeJson(sourcesPath, finalized.sources);
  options.recorder.markTrack(
    options.track.name,
    finalized.leaderDisposition === "discarded" ? "failed" : "completed"
  );
  return { delegate: finalized, result };
}

export async function runDiscoverExecution(options: DiscoverExecutionOptions): Promise<DiscoverExecutionResult> {
  const { cwd, runId, input, config, planningIssueNumber, paths } = options;
  await fs.mkdir(path.join(paths.stageDir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(paths.stageDir, "delegates"), { recursive: true });
  await fs.writeFile(paths.eventsPath, "", "utf8");

  const plan = inferTrackSelections(input, config, planningIssueNumber);
  const capabilityRecord = buildDiscoverCapabilityRecord({
    config,
    requested: plan.requestedCapabilities,
    selectedTracks: plan.tracks,
    webResearchAllowed: plan.webResearchAllowed
  });
  plan.requestedCapabilities = capabilityRecord.requested;
  plan.availableCapabilities = capabilityRecord.available;
  const researchPlanPath = path.join(paths.stageDir, "research-plan.json");
  const capabilityArtifactPath = path.join(paths.runDir, "artifacts", "capabilities.json");
  const discoveryReportPath = path.join(paths.stageDir, "artifacts", "discovery-report.md");
  await writeJson(researchPlanPath, plan);
  await writeJson(capabilityArtifactPath, capabilityRecord);

  const selectedTracks = plan.tracks.filter((track) => track.selected);
  const recorder = createDiscoverRecorder(runId, paths.eventsPath);
  const startedAt = Date.now();
  const discoverTimeoutSeconds = config.workflows.discover.timeoutSeconds;
  const leadReserveSeconds =
    typeof discoverTimeoutSeconds === "number" && discoverTimeoutSeconds > 0
      ? Math.min(DISCOVER_LEAD_RESERVE_SECONDS, Math.max(1, Math.floor(discoverTimeoutSeconds / 3)))
      : DISCOVER_LEAD_RESERVE_SECONDS;
  const notes: string[] = [];
  recorder.setTracks(selectedTracks.map((track) => track.name));
  await recorder.emit("starting", `Discover research plan: ${plan.summary}`);

  const delegates: DiscoverDelegateResult[] = [];
  for (const track of selectedTracks) {
    const trackBudget = remainingBudgetSeconds(startedAt, discoverTimeoutSeconds, leadReserveSeconds);
    if (typeof trackBudget === "number" && trackBudget <= 0) {
      const skippedDelegate: DiscoverDelegateResult = {
        track: track.name,
        status: "stalled",
        summary: `${track.name} was skipped because the shared discover budget was exhausted before the track started.`,
        filesInspected: [],
        commandsRun: [],
        sources: [],
        findings: [],
        confidence: "low",
        unresolved: [],
        leaderDisposition: "discarded",
        notes: "Shared discover budget exhausted before this delegated track began."
      };
      delegates.push(skippedDelegate);
      recorder.markTrack(track.name, "failed");
      await recorder.emit("failed", skippedDelegate.summary);
      notes.push(skippedDelegate.summary);
      continue;
    }

    const { delegate } = await runTrack({
      cwd,
      runId,
      input,
      config,
      stageDir: paths.stageDir,
      plan,
      track,
      recorder,
      ...(typeof trackBudget === "number" ? { timeoutSeconds: trackBudget } : {})
    });
    delegates.push(delegate);
    if (delegate.notes) {
      notes.push(delegate.notes);
    }
  }

  const { prompt, context } = await buildDiscoverLeadPrompt({
    cwd,
    input,
    plan,
    delegateResults: delegates
  });
  await fs.writeFile(paths.promptPath, prompt, "utf8");
  await fs.writeFile(paths.contextPath, `${context}\n`, "utf8");
  await recorder.emit("activity", "Running Research Lead synthesis");

  const leadBudget = remainingBudgetSeconds(startedAt, discoverTimeoutSeconds);
  const leadNoProgressTimeoutSeconds = resolveDiscoverNoProgressTimeoutSeconds(leadBudget);
  const leadResult: CodexRunResult =
    typeof leadBudget === "number" && leadBudget <= 0
      ? {
          code: 124,
          signal: null,
          command: [],
          timedOut: true,
          ...(typeof discoverTimeoutSeconds === "number" ? { timeoutSeconds: discoverTimeoutSeconds } : {}),
          lastActivity: "Shared discover budget was exhausted before Research Lead synthesis started."
        }
      : await runCodexExec({
          cwd,
          workflow: "discover",
          runId: `${runId}-research-lead`,
          prompt,
        finalPath: paths.finalPath,
        eventsPath: path.join(paths.stageDir, "lead-events.jsonl"),
        stdoutPath: paths.stdoutPath,
        stderrPath: paths.stderrPath,
        config,
        silentProgress: true,
        staleSessionTimeoutSeconds: DISCOVER_STALE_SESSION_TIMEOUT_SECONDS,
        ...(typeof leadNoProgressTimeoutSeconds === "number" ? { noProgressTimeoutSeconds: leadNoProgressTimeoutSeconds } : {}),
        ...(typeof leadBudget === "number" ? { timeoutSeconds: leadBudget } : {})
      });
  if (leadResult.sessionId) {
    await recorder.emit("session", leadResult.sessionId);
  }
  if (leadResult.stallReason) {
    notes.push(leadResult.stallReason);
  } else if (leadResult.lastActivity && leadResult.code !== 0) {
    notes.push(leadResult.lastActivity);
  }

  const rawLead = await readBestEffortCodexOutput({
    finalPath: paths.finalPath,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath
  });
  let leadJson = normalizeLeadJson(input, delegates, plan, rawLead);
  let recoveredFromHeuristicFallback = false;
  if (!hasUsableLeadArtifact(leadJson)) {
    const heuristicFallback = await buildBroadGapHeuristicFallback(cwd, input, plan, delegates);
    if (heuristicFallback) {
      leadJson = heuristicFallback;
      recoveredFromHeuristicFallback = true;
      notes.push("Discover recovered bounded fallback findings from representative repo files after delegated research failed to converge.");
    }
  }
  const finalizedDelegates = applyLeadDisposition(delegates, leadJson);
  const usableArtifact = hasUsableLeadArtifact(leadJson);
  const finalBody =
    usableArtifact && leadJson.reportMarkdown && leadJson.reportMarkdown.trim()
      ? leadJson.reportMarkdown
      : [
          "# Discovery Report",
          "",
          "## Request",
          input,
          "",
          "## Status",
          usableArtifact ? "partial" : "failed",
          "",
          "## Findings",
          "- none recovered",
          "",
          "## Blockers",
          ...(notes.length > 0 ? notes.map((note) => `- ${note}`) : ["- Discover did not recover usable findings before the stage ended."])
        ].join("\n") + "\n";
  const status: DiscoverExecutionResult["status"] = usableArtifact
    ? leadResult.code === 0 && !recoveredFromHeuristicFallback
      ? "completed"
      : "partial"
    : "failed";

  for (const delegate of finalizedDelegates) {
    if (delegate.resultPath) {
      await writeJson(delegate.resultPath, delegate);
    }
    if (delegate.sourcesPath) {
      await writeJson(delegate.sourcesPath, delegate.sources);
    }
  }

  await fs.writeFile(paths.finalPath, finalBody, "utf8");
  await fs.writeFile(paths.artifactPath, finalBody, "utf8");
  await fs.writeFile(discoveryReportPath, finalBody, "utf8");
  await recorder.emit(
    status === "failed" ? "failed" : "completed",
    status === "completed" ? "Discover run completed" : status === "partial" ? `Discover run completed with recovered partial output (exit ${leadResult.code})` : `Discover run failed with code ${leadResult.code}`
  );
  recorder.close();

  return {
    researchPlan: plan,
    delegates: finalizedDelegates,
    leadResult,
    finalBody,
    status,
    notes
  };
}
