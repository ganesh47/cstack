import path from "node:path";
import { promises as fs } from "node:fs";
import readline from "node:readline/promises";
import type {
  ArtifactEntry,
  BuildSessionRecord,
  BuildVerificationRecord,
  DiscoverDelegateResult,
  DiscoverResearchPlan,
  RoutingPlan,
  RunEvent,
  RunInspection,
  RunLedgerEntry,
  StageLineage
} from "./types.js";
import { listRunLedger, listRuns, readRun, runDirForId } from "./run.js";

async function readRecentEvents(eventsPath?: string): Promise<RunEvent[]> {
  if (!eventsPath) {
    return [];
  }

  try {
    const body = await fs.readFile(eventsPath, "utf8");
    return body
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-8)
      .map((line) => JSON.parse(line) as RunEvent);
  } catch {
    return [];
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const body = await fs.readFile(filePath, "utf8");
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function badge(name: string, status: string): string {
  return `[${name}:${status}]`;
}

function renderStageStrip(inspection: RunInspection): string {
  if (inspection.stageLineage) {
    return inspection.stageLineage.stages.map((stage) => badge(stage.name, stage.status)).join(" ");
  }
  if (inspection.routingPlan) {
    return inspection.routingPlan.stages.map((stage) => badge(stage.name, "plan")).join(" ");
  }
  return "[none]";
}

function renderSpecialistStrip(inspection: RunInspection): string {
  if (inspection.stageLineage?.specialists.length) {
    return inspection.stageLineage.specialists.map((specialist) => badge(specialist.name, specialist.status)).join(" ");
  }
  const planned = inspection.routingPlan?.specialists.filter((specialist) => specialist.selected) ?? [];
  return planned.length > 0 ? planned.map((specialist) => badge(specialist.name, "plan")).join(" ") : "[none]";
}

function renderSuggestedActions(inspection: RunInspection): string[] {
  const lines: string[] = [];
  const deferredStages = inspection.stageLineage?.stages.filter((stage) => stage.status === "deferred" || stage.status === "skipped") ?? [];

  if (inspection.run.workflow === "build") {
    lines.push("- review change summary with `show artifact artifacts/change-summary.md`");
    lines.push("- inspect verification with `show verification`");
  }
  for (const stage of deferredStages.slice(0, 2)) {
    lines.push(`- inspect why ${stage.name} is ${stage.status}`);
  }
  if (inspection.run.sessionId) {
    lines.push(`- resume with codex resume ${inspection.run.sessionId}`);
  }
  if (inspection.artifacts.some((artifact) => artifact.path === "routing-plan.json")) {
    lines.push("- review routing with `show routing`");
  }

  return lines.length > 0 ? lines : ["- no obvious follow-up recorded"];
}

function classifyArtifact(relativePath: string): ArtifactEntry["kind"] {
  if (relativePath.includes("/delegates/") || relativePath.startsWith("delegates/")) {
    return "delegate";
  }
  if (relativePath.startsWith("artifacts/")) {
    return "artifact";
  }
  if (relativePath.startsWith("stages/")) {
    return "stage";
  }
  if (relativePath.endsWith(".log") || relativePath.endsWith(".jsonl")) {
    return "log";
  }
  if (relativePath.endsWith(".json") || relativePath.endsWith(".md")) {
    return "metadata";
  }
  return "artifact";
}

async function walkArtifacts(root: string, current = root): Promise<ArtifactEntry[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const artifacts: ArtifactEntry[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...(await walkArtifacts(root, absolutePath)));
      continue;
    }
    artifacts.push({
      path: path.relative(root, absolutePath),
      kind: classifyArtifact(path.relative(root, absolutePath))
    });
  }

  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

async function loadDiscoverDelegates(runDir: string): Promise<DiscoverDelegateResult[]> {
  const delegatesRoot = path.join(runDir, "stages", "discover", "delegates");
  try {
    const entries = await fs.readdir(delegatesRoot, { withFileTypes: true });
    const delegates: DiscoverDelegateResult[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const result = await readJsonFile<DiscoverDelegateResult>(path.join(delegatesRoot, entry.name, "result.json"));
      if (result) {
        delegates.push(result);
      }
    }
    return delegates.sort((left, right) => left.track.localeCompare(right.track));
  } catch {
    return [];
  }
}

function renderVerificationSummary(record: BuildVerificationRecord | null): string {
  if (!record) {
    return "not recorded";
  }
  if (record.status === "not-run" && record.notes) {
    return `${record.status} (${record.notes})`;
  }
  return record.status;
}

export async function loadRunInspection(cwd: string, runId?: string): Promise<RunInspection> {
  const targetId = runId ?? (await listRuns(cwd))[0]?.id;
  if (!targetId) {
    throw new Error("No runs found to inspect.");
  }

  const run = await readRun(cwd, targetId);
  const runDir = runDirForId(cwd, targetId);
  const [recentEvents, routingPlan, stageLineage, discoverResearchPlan, discoverDelegates, sessionRecord, verificationRecord, artifacts] = await Promise.all([
    readRecentEvents(run.eventsPath),
    readJsonFile<RoutingPlan>(path.join(runDir, "routing-plan.json")),
    readJsonFile<StageLineage>(path.join(runDir, "stage-lineage.json")),
    readJsonFile<DiscoverResearchPlan>(path.join(runDir, "stages", "discover", "research-plan.json")),
    loadDiscoverDelegates(runDir),
    readJsonFile<BuildSessionRecord>(path.join(runDir, "session.json")),
    readJsonFile<BuildVerificationRecord>(path.join(runDir, "artifacts", "verification.json")),
    walkArtifacts(runDir)
  ]);

  let finalBody = "";
  try {
    finalBody = await fs.readFile(run.finalPath, "utf8");
  } catch {}

  return {
    run,
    runDir,
    routingPlan,
    stageLineage,
    discoverResearchPlan,
    discoverDelegates,
    sessionRecord,
    verificationRecord,
    recentEvents,
    finalBody,
    artifacts
  };
}

function renderResearchSection(inspection: RunInspection): string[] {
  const { discoverResearchPlan } = inspection;
  if (!discoverResearchPlan) {
    return [];
  }

  const sourceCount = inspection.discoverDelegates.reduce((count, delegate) => count + delegate.sources.length, 0);

  return [
    "",
    "Research",
    `- mode: ${discoverResearchPlan.mode}`,
    `- web research allowed: ${discoverResearchPlan.webResearchAllowed ? "yes" : "no"}`,
    `- selected tracks: ${
      discoverResearchPlan.tracks.filter((track) => track.selected).map((track) => track.name).join(", ") || "none"
    }`,
    `- cited sources: ${sourceCount}`,
    ...inspection.discoverDelegates.map(
      (delegate) => `- ${delegate.track}: ${delegate.status}, disposition=${delegate.leaderDisposition}`
    ),
    ...discoverResearchPlan.limitations.map((limitation) => `- limitation: ${limitation}`)
  ];
}

function renderRoutingSection(inspection: RunInspection): string[] {
  const { routingPlan } = inspection;
  if (!routingPlan) {
    return [];
  }

  return [
    "",
    `Routing plan: ${path.relative(inspection.run.cwd, path.join(inspection.runDir, "routing-plan.json"))}`,
    "Planned stages:",
    ...routingPlan.stages.map((stage) => `  - ${stage.name}: ${stage.status} (${stage.rationale})`),
    "",
    "Selected specialists:",
    ...(routingPlan.specialists.some((specialist) => specialist.selected)
      ? routingPlan.specialists
          .filter((specialist) => specialist.selected)
          .map((specialist) => `  - ${specialist.name}: ${specialist.reason}`)
      : ["  - none"])
  ];
}

function renderLineageSection(inspection: RunInspection): string[] {
  const { stageLineage } = inspection;
  if (!stageLineage) {
    return [];
  }

  return [
    "",
    "Stage lineage:",
    ...stageLineage.stages.map((stage) => `  - ${stage.name}: ${stage.status}${stage.executed ? " (executed)" : ""}`),
    "",
    "Specialists:",
    ...(stageLineage.specialists.length > 0
      ? stageLineage.specialists.map(
          (specialist) =>
            `  - ${specialist.name}: ${specialist.status}, disposition=${specialist.disposition}, reason=${specialist.reason}`
        )
      : ["  - none"])
  ];
}

export function renderInspectionSummary(cwd: string, inspection: RunInspection): string {
  const { run, recentEvents, finalBody } = inspection;

  return (
    [
      `cstack inspect  ${run.id}`,
      `workflow ${run.workflow}  |  status ${run.status}  |  updated ${run.updatedAt}`,
      "",
      "Observed",
      `- summary: ${run.summary ?? run.inputs.userPrompt}`,
      `- branch: ${run.gitBranch}`,
      run.currentStage ? `- current stage: ${run.currentStage}` : undefined,
      run.activeSpecialists && run.activeSpecialists.length > 0 ? `- active specialists: ${run.activeSpecialists.join(", ")}` : undefined,
      `- final: ${path.relative(cwd, run.finalPath)}`,
      run.eventsPath ? `- events: ${path.relative(cwd, run.eventsPath)}` : undefined,
      run.sessionId ? `- session: ${run.sessionId}` : undefined,
      run.lastActivity ? `- last activity: ${run.lastActivity}` : undefined,
      inspection.sessionRecord ? `- mode: requested ${inspection.sessionRecord.requestedMode}, observed ${inspection.sessionRecord.mode}` : undefined,
      inspection.sessionRecord?.linkedRunId ? `- linked run: ${inspection.sessionRecord.linkedRunId}` : undefined,
      inspection.verificationRecord ? `- verification: ${renderVerificationSummary(inspection.verificationRecord)}` : undefined,
      "",
      "Plan",
      `- stages: ${renderStageStrip(inspection)}`,
      `- specialists: ${renderSpecialistStrip(inspection)}`,
      ...renderResearchSection(inspection),
      ...renderRoutingSection(inspection),
      ...renderLineageSection(inspection),
      "",
      "Suggested next actions",
      ...renderSuggestedActions(inspection),
      recentEvents.length > 0 ? "" : undefined,
      recentEvents.length > 0 ? "Recent activity" : undefined,
      ...recentEvents.map((event) => `  [${event.type}] +${Math.floor(event.elapsedMs / 1000)}s ${event.message}`),
      "",
      "Shortcuts",
      "- 1 summary  2 stages  3 specialists  4 artifacts  f final  r routing  q exit",
      "",
      "Final output",
      finalBody || "(missing)"
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
}

function renderArtifacts(inspection: RunInspection): string {
  const artifactLines = inspection.artifacts.map((artifact) => `- ${artifact.path} (${artifact.kind})`);
  return ["Artifacts:", ...(artifactLines.length > 0 ? artifactLines : ["- none found"])].join("\n");
}

function renderSession(inspection: RunInspection): string {
  if (!inspection.sessionRecord) {
    return "No build session record was recorded for this run.";
  }

  return `${JSON.stringify(inspection.sessionRecord, null, 2)}\n`;
}

function renderVerification(inspection: RunInspection): string {
  if (!inspection.verificationRecord) {
    return "No verification record was recorded for this run.";
  }

  return `${JSON.stringify(inspection.verificationRecord, null, 2)}\n`;
}

function renderStages(inspection: RunInspection): string {
  if (!inspection.stageLineage) {
    return "No stage lineage recorded for this run.";
  }

  return [
    "Stages:",
    ...inspection.stageLineage.stages.map((stage) => {
      const details: string[] = [stage.status];
      if (stage.executed) {
        details.push("executed");
      }
      if (stage.notes) {
        details.push(stage.notes);
      }
      return `- ${stage.name}: ${details.join(" | ")}`;
    })
  ].join("\n");
}

function renderSpecialists(inspection: RunInspection): string {
  const planned = inspection.routingPlan?.specialists.filter((specialist) => specialist.selected) ?? [];
  const executed = inspection.stageLineage?.specialists ?? [];

  return [
    "Planned specialists:",
    ...(planned.length > 0 ? planned.map((specialist) => `- ${specialist.name}: ${specialist.reason}`) : ["- none"]),
    "",
    "Executed specialists:",
    ...(executed.length > 0
      ? executed.map((specialist) => `- ${specialist.name}: ${specialist.status}, disposition=${specialist.disposition}`)
      : ["- none"])
  ].join("\n");
}

function renderDiscoverDelegates(inspection: RunInspection): string {
  if (!inspection.discoverResearchPlan) {
    return "No discover research plan was recorded for this run.";
  }

  const planned = inspection.discoverResearchPlan.tracks.filter((track) => track.selected);
  return [
    "Planned discover tracks:",
    ...(planned.length > 0 ? planned.map((track) => `- ${track.name}: ${track.reason}`) : ["- none"]),
    "",
    "Executed discover tracks:",
    ...(inspection.discoverDelegates.length > 0
      ? inspection.discoverDelegates.map(
          (delegate) =>
            `- ${delegate.track}: ${delegate.status}, disposition=${delegate.leaderDisposition}, sources=${delegate.sources.length}`
        )
      : ["- none"])
  ].join("\n");
}

function renderWhatRemains(inspection: RunInspection): string {
  const outstandingStages = inspection.stageLineage?.stages.filter((stage) => stage.status !== "completed") ?? [];
  const skippedSpecialists =
    inspection.routingPlan?.specialists.filter(
      (specialist) => specialist.selected && !(inspection.stageLineage?.specialists.some((entry) => entry.name === specialist.name) ?? false)
    ) ?? [];

  const lines = ["Remaining work:"];
  if (outstandingStages.length === 0 && skippedSpecialists.length === 0) {
    lines.push("- no deferred or missing work recorded");
    return lines.join("\n");
  }

  for (const stage of outstandingStages) {
    lines.push(`- stage ${stage.name}: ${stage.status}${stage.notes ? ` (${stage.notes})` : ""}`);
  }
  for (const specialist of skippedSpecialists) {
    lines.push(`- specialist ${specialist.name}: planned but not executed`);
  }
  return lines.join("\n");
}

function renderWhyDeferred(inspection: RunInspection, stageName: string): string {
  const stage = inspection.stageLineage?.stages.find((entry) => entry.name === stageName);
  if (!stage) {
    return `No stage named \`${stageName}\` was recorded for this run.`;
  }
  if (stage.status !== "deferred" && stage.status !== "skipped") {
    return `Stage \`${stageName}\` was not deferred. Current status: ${stage.status}.`;
  }
  return `Stage \`${stageName}\` is ${stage.status}: ${stage.notes ?? "No additional explanation was recorded."}`;
}

async function readRelativeArtifact(inspection: RunInspection, relativePath: string): Promise<string> {
  const normalized = relativePath.replaceAll("\\", "/");
  const artifact = inspection.artifacts.find((entry) => entry.path === normalized);
  if (!artifact) {
    return `Artifact \`${relativePath}\` was not found in this run.`;
  }

  try {
    return await fs.readFile(path.join(inspection.runDir, artifact.path), "utf8");
  } catch {
    return `Artifact \`${relativePath}\` could not be read as text.`;
  }
}

function helpText(): string {
  return [
    "Inspector commands:",
    "- 1 (summary)",
    "- 2 (stages)",
    "- 3 (specialists)",
    "- 4 (artifacts)",
    "- f (show final)",
    "- r (show routing)",
    "- q (exit)",
    "- summary",
    "- stages",
    "- specialists",
    "- artifacts",
    "- show final",
    "- show routing",
    "- show research",
    "- show session",
    "- show verification",
    "- show delegate <track>",
    "- show sources <track>",
    "- show stage <name>",
    "- show specialist <name>",
    "- show artifact <relative-path>",
    "- why deferred <stage>",
    "- what remains",
    "- resume",
    "- fork",
    "- help",
    "- exit"
  ].join("\n");
}

export async function handleInspectorCommand(cwd: string, inspection: RunInspection, input: string): Promise<string | null> {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === "1" || trimmed === "summary") {
    return renderInspectionSummary(cwd, inspection).trimEnd();
  }
  if (trimmed === "2" || trimmed === "stages") {
    return renderStages(inspection);
  }
  if (trimmed === "3" || trimmed === "specialists") {
    return renderSpecialists(inspection);
  }
  if (trimmed === "4" || trimmed === "artifacts") {
    return renderArtifacts(inspection);
  }
  if (trimmed === "f" || trimmed === "show final") {
    return inspection.finalBody || "(missing)";
  }
  if (trimmed === "r" || trimmed === "show routing") {
    return inspection.routingPlan ? `${JSON.stringify(inspection.routingPlan, null, 2)}\n` : "No routing plan recorded for this run.";
  }
  if (trimmed === "show research") {
    if (!inspection.discoverResearchPlan) {
      return "No discover research plan was recorded for this run.";
    }
    return [
      JSON.stringify(inspection.discoverResearchPlan, null, 2),
      "",
      renderDiscoverDelegates(inspection)
    ].join("\n");
  }
  if (trimmed === "show session") {
    return renderSession(inspection);
  }
  if (trimmed === "show verification") {
    return renderVerification(inspection);
  }
  if (trimmed === "what remains") {
    return renderWhatRemains(inspection);
  }
  if (trimmed === "resume") {
    return inspection.run.sessionId
      ? `Resume this run with:\n\ncodex resume ${inspection.run.sessionId}`
      : "This run has no recorded session id, so resume is unavailable.";
  }
  if (trimmed === "fork") {
    return inspection.run.sessionId
      ? `Fork this run with:\n\ncodex fork ${inspection.run.sessionId}`
      : "This run has no recorded session id, so fork is unavailable.";
  }
  if (trimmed === "help") {
    return helpText();
  }
  if (trimmed === "q" || trimmed === "exit" || trimmed === "quit") {
    return "__EXIT__";
  }
  if (trimmed.startsWith("why deferred ")) {
    return renderWhyDeferred(inspection, trimmed.slice("why deferred ".length).trim());
  }
  if (trimmed.startsWith("show stage ")) {
    const stageName = trimmed.slice("show stage ".length).trim();
    const stage = inspection.stageLineage?.stages.find((entry) => entry.name === stageName);
    return stage ? `${JSON.stringify(stage, null, 2)}\n` : `No stage named \`${stageName}\` was recorded for this run.`;
  }
  if (trimmed.startsWith("show specialist ")) {
    const specialistName = trimmed.slice("show specialist ".length).trim();
    const specialist = inspection.stageLineage?.specialists.find((entry) => entry.name === specialistName);
    if (specialist) {
      return `${JSON.stringify(specialist, null, 2)}\n`;
    }
    const planned = inspection.routingPlan?.specialists.find((entry) => entry.name === specialistName);
    return planned ? `${JSON.stringify(planned, null, 2)}\n` : `No specialist named \`${specialistName}\` was recorded for this run.`;
  }
  if (trimmed.startsWith("show delegate ")) {
    const track = trimmed.slice("show delegate ".length).trim();
    const delegate = inspection.discoverDelegates.find((entry) => entry.track === track);
    return delegate ? `${JSON.stringify(delegate, null, 2)}\n` : `No discover delegate named \`${track}\` was recorded for this run.`;
  }
  if (trimmed.startsWith("show sources ")) {
    const track = trimmed.slice("show sources ".length).trim();
    const delegate = inspection.discoverDelegates.find((entry) => entry.track === track);
    if (!delegate) {
      return `No discover delegate named \`${track}\` was recorded for this run.`;
    }
    return `${JSON.stringify(delegate.sources, null, 2)}\n`;
  }
  if (trimmed.startsWith("show artifact ")) {
    const relativePath = trimmed.slice("show artifact ".length).trim();
    return readRelativeArtifact(inspection, relativePath);
  }

  return `Unknown inspector command: ${trimmed}\n\n${helpText()}`;
}

export async function runInteractiveInspector(
  cwd: string,
  inspection: RunInspection,
  io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = { input: process.stdin, output: process.stdout }
): Promise<void> {
  if (!("isTTY" in io.input) || !io.input.isTTY || !("isTTY" in io.output) || !io.output.isTTY) {
    throw new Error("Interactive inspection requires a TTY.");
  }

  const rl = readline.createInterface({
    input: io.input,
    output: io.output,
    terminal: true
  });

  try {
    io.output.write("Entering cstack run inspector. Type `help` for commands.\n");
    io.output.write(renderInspectionSummary(cwd, inspection));
    while (true) {
      let answer: string;
      try {
        answer = await rl.question("inspect> ");
      } catch {
        io.output.write("Leaving inspector.\n");
        return;
      }
      const commands = answer
        .split(/[\r\n]+/)
        .map((command) => command.trim())
        .filter(Boolean);

      if (commands.length === 0) {
        continue;
      }

      for (const command of commands) {
        const response = await handleInspectorCommand(cwd, inspection, command);
        if (!response) {
          continue;
        }
        if (response === "__EXIT__") {
          io.output.write("Leaving inspector.\n");
          return;
        }
        io.output.write(`${response}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

export async function maybeOfferInteractiveInspect(cwd: string, runId: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI || process.env.CSTACK_NO_POSTRUN_INSPECT === "1") {
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  try {
    const answer = (await rl.question("Inspect this run now? [Y/n] ")).trim().toLowerCase();
    if (answer === "n" || answer === "no") {
      return;
    }
  } finally {
    rl.close();
  }

  const inspection = await loadRunInspection(cwd, runId);
  await runInteractiveInspector(cwd, inspection);
}

function formatLedgerTimestamp(value: string): string {
  return value.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function pad(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  return `${value}${" ".repeat(width - value.length)}`;
}

export function renderRunLedger(entries: RunLedgerEntry[]): string {
  if (entries.length === 0) {
    return "No cstack runs found.\n";
  }

  const headers = ["run_id", "workflow", "status", "stage", "updated_at", "specialists", "summary"];
  const rows = entries.map((entry) => [
    entry.id,
    entry.workflow,
    entry.status,
    entry.currentStage ?? "-",
    formatLedgerTimestamp(entry.updatedAt),
    entry.activeSpecialists.join(",") || "-",
    entry.summary
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]!.length))
  );

  const lines = [
    headers.map((header, index) => pad(header, widths[index]!)).join("  "),
    ...rows.map((row) => row.map((value, index) => pad(value, widths[index]!)).join("  "))
  ];
  return `${lines.join("\n")}\n`;
}

export async function loadRunLedger(cwd: string, options: {
  activeOnly?: boolean;
  workflow?: RunLedgerEntry["workflow"];
  status?: RunLedgerEntry["status"];
  recent?: number;
}): Promise<RunLedgerEntry[]> {
  const query: {
    activeOnly?: boolean;
    workflow?: RunLedgerEntry["workflow"];
    status?: RunLedgerEntry["status"];
    recent?: number;
  } = {};

  if (typeof options.activeOnly === "boolean") {
    query.activeOnly = options.activeOnly;
  }
  if (options.workflow) {
    query.workflow = options.workflow;
  }
  if (options.status) {
    query.status = options.status;
  }
  if (typeof options.recent === "number") {
    query.recent = options.recent;
  }

  return listRunLedger(cwd, query);
}
