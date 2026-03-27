import path from "node:path";
import { promises as fs } from "node:fs";
import { buildEvent, ProgressReporter } from "./progress.js";
import { runCodexExec, type CodexRunResult } from "./codex.js";
import { buildDiscoverLeadPrompt, buildDiscoverTrackPrompt } from "./prompt.js";
import type {
  CstackConfig,
  DiscoverDelegateResult,
  DiscoverResearchPlan,
  DiscoverSourceRecord,
  DiscoverTrackName,
  DiscoverTrackSelection,
  RunEvent
} from "./types.js";

const TRACK_ORDER: DiscoverTrackName[] = ["repo-explorer", "risk-researcher", "external-researcher"];

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
  paths: DiscoverPaths;
}

export interface DiscoverExecutionResult {
  researchPlan: DiscoverResearchPlan;
  delegates: DiscoverDelegateResult[];
  leadResult: CodexRunResult;
  finalBody: string;
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

function compact(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function inferTrackSelections(input: string, config: CstackConfig): DiscoverResearchPlan {
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
  if (selected.has("external-researcher")) {
    requestedCapabilities.push("web");
  }

  const limitations: string[] = [];
  if (!shouldDelegate) {
    limitations.push("Delegated research was suppressed because the prompt appears small, local, or not broad enough to justify fan-out.");
  }
  if (externalSignal && !allowWeb) {
    limitations.push("Web-backed external research was requested by the prompt signal but disabled by discover policy.");
  }

  return {
    prompt: input,
    decidedAt: new Date().toISOString(),
    mode: shouldDelegate && selected.size > 0 ? "research-team" : "single-agent",
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

function normalizeDelegateResult(
  track: DiscoverTrackName,
  rawText: string,
  code: number,
  sessionId?: string
): Omit<DiscoverDelegateResult, "delegateDir" | "artifactPath" | "resultPath" | "sourcesPath"> {
  const parsed = parseJson<Record<string, unknown>>(rawText);
  const summary = typeof parsed?.summary === "string" ? compact(parsed.summary) : compact(rawText.split("\n")[0] ?? "");
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

  return {
    track,
    status:
      status === "completed" || status === "failed" || status === "stalled" || status === "discarded"
        ? status
        : code === 0
          ? "completed"
          : "failed",
    summary: summary || `${track} completed without a structured summary.`,
    filesInspected,
    commandsRun,
    sources: rawSources.length > 0 ? rawSources : urlsFromText(rawText),
    findings: findings.length > 0 ? findings : [summary || `${track} completed.`],
    confidence: confidence === "low" || confidence === "medium" || confidence === "high" ? confidence : "medium",
    unresolved,
    leaderDisposition: code === 0 ? "accepted" : "discarded",
    ...(code !== 0 ? { notes: `${track} exited unsuccessfully and was discarded by default.` } : {}),
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

function normalizeLeadJson(input: string, delegates: DiscoverDelegateResult[], plan: DiscoverResearchPlan, rawText: string): DiscoverLeadJson {
  const parsed = parseJson<DiscoverLeadJson>(rawText);
  if (!parsed) {
    return synthesizeFallbackReport(input, delegates, plan);
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
    silentProgress: true
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
  options.recorder.markTrack(options.track.name, result.code === 0 ? "completed" : "failed");
  return { delegate: finalized, result };
}

export async function runDiscoverExecution(options: DiscoverExecutionOptions): Promise<DiscoverExecutionResult> {
  const { cwd, runId, input, config, paths } = options;
  await fs.mkdir(path.join(paths.stageDir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(paths.stageDir, "delegates"), { recursive: true });
  await fs.writeFile(paths.eventsPath, "", "utf8");

  const plan = inferTrackSelections(input, config);
  const researchPlanPath = path.join(paths.stageDir, "research-plan.json");
  const discoveryReportPath = path.join(paths.stageDir, "artifacts", "discovery-report.md");
  await writeJson(researchPlanPath, plan);

  const selectedTracks = plan.tracks.filter((track) => track.selected);
  const recorder = createDiscoverRecorder(runId, paths.eventsPath);
  recorder.setTracks(selectedTracks.map((track) => track.name));
  await recorder.emit("starting", `Discover research plan: ${plan.summary}`);

  const delegates: DiscoverDelegateResult[] = [];
  for (const track of selectedTracks) {
    const { delegate } = await runTrack({
      cwd,
      runId,
      input,
      config,
      stageDir: paths.stageDir,
      plan,
      track,
      recorder
    });
    delegates.push(delegate);
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

  const leadResult = await runCodexExec({
    cwd,
    workflow: "discover",
    runId: `${runId}-research-lead`,
    prompt,
    finalPath: paths.finalPath,
    eventsPath: path.join(paths.stageDir, "lead-events.jsonl"),
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
    config,
    silentProgress: true
  });
  if (leadResult.sessionId) {
    await recorder.emit("session", leadResult.sessionId);
  }

  const rawLead = await readBestEffortCodexOutput({
    finalPath: paths.finalPath,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath
  });
  const leadJson = normalizeLeadJson(input, delegates, plan, rawLead);
  const finalizedDelegates = applyLeadDisposition(delegates, leadJson);

  for (const delegate of finalizedDelegates) {
    if (delegate.resultPath) {
      await writeJson(delegate.resultPath, delegate);
    }
    if (delegate.sourcesPath) {
      await writeJson(delegate.sourcesPath, delegate.sources);
    }
  }

  await fs.writeFile(paths.finalPath, leadJson.reportMarkdown ?? rawLead, "utf8");
  await fs.writeFile(paths.artifactPath, leadJson.reportMarkdown ?? rawLead, "utf8");
  await fs.writeFile(discoveryReportPath, leadJson.reportMarkdown ?? rawLead, "utf8");
  await recorder.emit(
    leadResult.code === 0 ? "completed" : "failed",
    leadResult.code === 0 ? "Discover run completed" : `Discover run failed with code ${leadResult.code}`
  );
  recorder.close();

  return {
    researchPlan: plan,
    delegates: finalizedDelegates,
    leadResult,
    finalBody: leadJson.reportMarkdown ?? rawLead
  };
}
