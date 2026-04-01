import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runCodexExec, runCodexInteractive } from "./codex.js";
import type { CodexRunResult } from "./codex.js";
import { classifyExecutionBlocker, uniqueBlockerCategories } from "./blockers.js";
import { buildBuildPrompt } from "./prompt.js";
import { readRun } from "./run.js";
import type {
  BuildFailureCategory,
  BuildFailureDiagnosisRecord,
  BuildRecoveryAttemptRecord,
  BuildSessionRecord,
  BuildVerificationCommandRecord,
  BuildVerificationRecord,
  CstackConfig,
  EnvironmentBlockerCategory,
  RunRecord,
  WorkflowMode
} from "./types.js";

const execFileAsync = promisify(execFile);
const INTERNAL_RUN_ARTIFACT_PREFIX = ".cstack/runs/";
const GIT_STATUS_PORCELAIN_ARGS = ["status", "--porcelain", "--untracked-files=all"] as const;
const TRANSIENT_FAILURE_PATTERNS = [
  /eai_again/i,
  /timed?\s*out/i,
  /etimedout/i,
  /econreset/i,
  /temporary failure/i,
  /network is unreachable/i,
  /registry/i,
  /service unavailable/i,
  /\b5\d\d\b/
] as const;
const BUILD_NO_PROGRESS_TIMEOUT_SECONDS = 120;
const DEFAULT_MAX_CODEX_ATTEMPTS = 3;
const MAX_CODEX_ATTEMPTS = 8;
const MISSING_TOOL_REMEDIATION_FILTER: Set<string> = new Set(["sh", "bash", "dash", "env", "command", "script"]);
const TOOL_INSTALL_HINTS: Record<string, string[]> = {
  node: [
    "if command -v nvm >/dev/null 2>&1; then nvm install --lts && nvm use --lts; else exit 127; fi",
    "if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y nodejs npm; else exit 127; fi",
    "if command -v brew >/dev/null 2>&1; then brew install node; else exit 127; fi"
  ],
  npm: [
    "if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y npm; else exit 127; fi",
    "if command -v brew >/dev/null 2>&1; then brew install npm; else exit 127; fi"
  ],
  pnpm: [
    "if command -v corepack >/dev/null 2>&1; then corepack enable && corepack prepare pnpm@latest --activate; else exit 127; fi",
    "if command -v npm >/dev/null 2>&1; then npm i -g pnpm@latest; else exit 127; fi"
  ],
  corepack: ["if command -v npm >/dev/null 2>&1; then npm i -g corepack && corepack enable; else exit 127; fi"],
  uv: [
    "if command -v python3 >/dev/null 2>&1; then python3 -m pip install --user --upgrade uv; else exit 127; fi",
    "if command -v curl >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | sh; else exit 127; fi"
  ],
  mvn: [
    "if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y maven; else exit 127; fi",
    "if command -v brew >/dev/null 2>&1; then brew install maven; else exit 127; fi"
  ],
  python: [
    "if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y python3 python3-pip; else exit 127; fi",
    "if command -v brew >/dev/null 2>&1; then brew install python; else exit 127; fi"
  ]
};

function isInternalRunArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  return normalized === ".cstack/runs" || normalized.startsWith(INTERNAL_RUN_ARTIFACT_PREFIX);
}

export interface LinkedBuildContext {
  run: RunRecord;
  artifactPath: string | null;
  artifactBody: string;
}

export interface BuildPaths {
  runDir: string;
  promptPath: string;
  contextPath: string;
  finalPath: string;
  eventsPath: string;
  stdoutPath: string;
  stderrPath: string;
  sessionPath: string;
  transcriptPath: string;
  changeSummaryPath: string;
  verificationPath: string;
  recoveryAttemptsPath: string;
  recoverySummaryPath: string;
  failureDiagnosisPath: string;
}

export interface BuildExecutionOptions {
  cwd: string;
  executionCwd?: string;
  runId: string;
  input: string;
  config: CstackConfig;
  paths: BuildPaths;
  requestedMode: WorkflowMode;
  linkedContext?: LinkedBuildContext | undefined;
  verificationCommands: string[];
  timeoutSeconds?: number;
}

export interface BuildExecutionResult {
  result: CodexRunResult;
  finalBody: string;
  requestedMode: WorkflowMode;
  observedMode: WorkflowMode;
  sessionRecord: BuildSessionRecord;
  verificationRecord: BuildVerificationRecord;
  recoveryAttempts: BuildRecoveryAttemptRecord[];
  failureDiagnosis: BuildFailureDiagnosisRecord | null;
}

interface BuildBootstrapAction {
  label: string;
  cwd: string;
  command: string;
  rationale: string;
}

interface BuildEnvironmentAssessment {
  summary: string;
  requiredTools: string[];
  missingTools: string[];
  bootstrapActions: BuildBootstrapAction[];
  evidence: string[];
  notes: string[];
}

interface CodexRetryContext {
  attemptNumber: number;
  maxAttempts: number;
  reason: string;
  missingTools: string[];
  remediationCommands: string[];
  failureHints: string[];
}

interface CodexAttemptOutcome {
  result: CodexRunResult;
  observedMode: WorkflowMode;
  fallbackReason?: string;
  notes: string[];
  finalBody: string;
  transcriptBody: string;
  stderrTail: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function truncateLine(value: string, max = 220): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed;
}

function firstMeaningfulErrorLine(stderrTail: string): string {
  return (
    stderrTail
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !/^session id:/i.test(line)) ?? ""
  );
}

function uniqueLines(values: string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const value of values.map((entry) => truncateLine(entry)).filter(Boolean)) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    lines.push(value);
  }
  return lines;
}

function isTransientFailure(output: string): boolean {
  return TRANSIENT_FAILURE_PATTERNS.some((pattern) => pattern.test(output));
}

function resolveMaxCodexAttempts(config: CstackConfig): number {
  const configured = config.workflows.build.maxCodexAttempts;
  if (typeof configured === "number" && Number.isInteger(configured)) {
    return Math.max(1, Math.min(MAX_CODEX_ATTEMPTS, configured));
  }
  return DEFAULT_MAX_CODEX_ATTEMPTS;
}

function resolveBuildAttemptMode(requestedMode: WorkflowMode, canUseInteractive: boolean, attemptNumber: number): WorkflowMode {
  if (requestedMode === "interactive" && !canUseInteractive) {
    return "exec";
  }
  if (attemptNumber <= 1) {
    return requestedMode;
  }
  return attemptNumber % 2 === 0
    ? requestedMode === "interactive"
      ? "exec"
      : "interactive"
    : requestedMode;
}

function makeCodexRetryHint(attemptNumber: number, maxAttempts: number, previousOutcome?: CodexAttemptOutcome): string {
  const priorFailure = previousOutcome?.stderrTail || previousOutcome?.finalBody || "";
  const summaryLine = firstMeaningfulErrorLine(priorFailure);
  return [
    `Recovery attempt ${attemptNumber} of ${maxAttempts}:`,
    previousOutcome ? "previous attempt exited before cstack observed a usable session, transcript, or final artifact." : "",
    summaryLine ? `signal: ${truncateLine(summaryLine)}` : "Keep changes focused and prioritize emitting a final artifact quickly."
  ]
    .filter(Boolean)
    .join(" ");
}

function extractFailureHintsFromText(text: string): string[] {
  const hints: string[] = [];
  if (/apply_patch verification failed/i.test(text)) {
    hints.push("Prior attempt hit apply_patch verification failures; do not retry the same hunk unchanged.");
  }
  if (/failed to find expected lines/i.test(text)) {
    hints.push("Patch context drifted; re-read the exact file slice and use a scripted replacement or full-file rewrite if needed.");
  }
  if (/\bmixed line endings\b|\bcrlf\b|\blf\b/i.test(text)) {
    hints.push("The target file may have mixed line endings; detect and normalize EOLs before editing.");
  }
  return uniqueLines(hints);
}

function normalizeToolName(tool: string): string {
  return tool
    .toLowerCase()
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/[`]/g, "");
}

function extractMissingToolsFromText(text: string): string[] {
  const patterns = [
    /(?:^|[\s"`'([])([A-Za-z0-9._-]+): command not found/gi,
    /(?:\[\w+\]: )?([A-Za-z0-9._-]+): not found/gi,
    /No such file or directory:?[\s"`']?([A-Za-z0-9._-]+)/gi,
    /\b([A-Za-z0-9._-]+)\s+command not found/gi
  ] as const;

  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const tool = normalizeToolName(match[1] ?? "");
      if (!tool || MISSING_TOOL_REMEDIATION_FILTER.has(tool) || tool.length > 32) {
        continue;
      }
      found.push(tool);
    }
  }
  return uniqueLines(found);
}

function getRemediationCommands(missingTools: string[]): string[] {
  const commands: string[] = [];
  for (const tool of uniqueLines(missingTools.map((value) => normalizeToolName(value)))) {
    const hints = TOOL_INSTALL_HINTS[tool];
    if (hints) {
      commands.push(...hints);
      continue;
    }
    commands.push(`Install ${tool} in the execution environment before continuing this attempt.`);
  }
  return uniqueLines(commands);
}

function inferRetryRemediation(
  assessment: BuildEnvironmentAssessment,
  previousOutcome: CodexAttemptOutcome | null
): { missingTools: string[]; remediationCommands: string[]; failureHints: string[] } {
  const previousSignals = `${previousOutcome?.stderrTail ?? ""}\n${previousOutcome?.finalBody ?? ""}`;
  const outcomeBasedTools = extractMissingToolsFromText(previousSignals);
  const missingTools = uniqueLines([...assessment.missingTools, ...outcomeBasedTools]).filter((tool) =>
    !MISSING_TOOL_REMEDIATION_FILTER.has(normalizeToolName(tool))
  );

  return {
    missingTools,
    remediationCommands: getRemediationCommands(missingTools),
    failureHints: extractFailureHintsFromText([previousSignals, ...assessment.notes, ...assessment.evidence].join("\n"))
  };
}

function buildAttemptRecord(input: {
  kind: BuildRecoveryAttemptRecord["kind"];
  label: string;
  status: BuildRecoveryAttemptRecord["status"];
  startedAt: string;
  cwd: string;
  summary: string;
  command?: string;
  exitCode?: number;
  evidence?: string[];
}): BuildRecoveryAttemptRecord {
  return {
    kind: input.kind,
    label: input.label,
    status: input.status,
    startedAt: input.startedAt,
    endedAt: nowIso(),
    cwd: input.cwd,
    summary: input.summary,
    ...(input.command ? { command: input.command } : {}),
    ...(typeof input.exitCode === "number" ? { exitCode: input.exitCode } : {}),
    ...(input.evidence && input.evidence.length > 0 ? { evidence: uniqueLines(input.evidence) } : {})
  };
}

function renderRecoverySummary(diagnosis: BuildFailureDiagnosisRecord | null, attempts: BuildRecoveryAttemptRecord[]): string {
  return [
    "# Build Recovery Summary",
    "",
    diagnosis
      ? `## Diagnosis\n- category: ${diagnosis.category}\n${diagnosis.blockerCategory ? `- blocker: ${diagnosis.blockerCategory}\n` : ""}- summary: ${diagnosis.summary}`
      : "## Diagnosis\n- Build completed without recovery blockers.",
    ...(diagnosis?.recommendedActions?.length
      ? ["", "## Recommended actions", ...diagnosis.recommendedActions.map((action) => `- ${action}`)]
      : []),
    "",
    "## Attempts",
    ...(attempts.length > 0
      ? attempts.map((attempt) =>
          `- [${attempt.kind}/${attempt.status}] ${attempt.label}: ${attempt.summary}${attempt.command ? ` (${attempt.command})` : ""}`
        )
      : ["- No recovery or bootstrap attempts were recorded."])
  ].join("\n") + "\n";
}

async function readPackageManager(cwd: string): Promise<string | null> {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8")) as { packageManager?: string };
    return packageJson.packageManager ?? null;
  } catch {
    return null;
  }
}

async function findFiles(root: string, names: Set<string>, maxDepth = 4, current = root, depth = 0): Promise<string[]> {
  if (depth > maxDepth) {
    return [];
  }

  let entries;
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return [];
  }

  const matches: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".cstack" || entry.name === "node_modules" || entry.name === ".venv") {
      continue;
    }
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findFiles(root, names, maxDepth, absolute, depth + 1)));
      continue;
    }
    if (names.has(entry.name)) {
      matches.push(absolute);
    }
  }
  return matches;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(command: string, cwd: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-lc", `command -v ${command}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function resolveBuildEnvironmentAssessment(cwd: string): Promise<BuildEnvironmentAssessment> {
  const packageManager = await readPackageManager(cwd);
  const foundFiles = await findFiles(cwd, new Set(["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "pyproject.toml", "uv.lock", "pom.xml"]));
  const evidence: string[] = [];
  const notes: string[] = [];
  const requiredTools = new Set<string>();
  const missingTools: string[] = [];
  const bootstrapActions: BuildBootstrapAction[] = [];

  const hasRootNodeWorkspace =
    (await pathExists(path.join(cwd, "package.json"))) ||
    (await pathExists(path.join(cwd, "pnpm-lock.yaml"))) ||
    (await pathExists(path.join(cwd, "pnpm-workspace.yaml")));
  if (hasRootNodeWorkspace) {
    requiredTools.add("node");
    evidence.push("Detected a Node workspace from package.json / pnpm lockfiles.");
    if ((packageManager ?? "").startsWith("pnpm@") || (await pathExists(path.join(cwd, "pnpm-lock.yaml")))) {
      requiredTools.add("pnpm");
      requiredTools.add("corepack");
      evidence.push(`Root package manager: ${packageManager ?? "pnpm (inferred from lockfile)"}.`);
      if (!(await pathExists(path.join(cwd, "node_modules")))) {
        bootstrapActions.push({
          label: "bootstrap root pnpm workspace",
          cwd,
          command: "corepack pnpm install --frozen-lockfile",
          rationale: "The workspace uses pnpm and has not been bootstrapped yet."
        });
      }
    }
  }

  const pyprojectDirs = Array.from(
    new Set(
      foundFiles
        .filter((filePath) => path.basename(filePath) === "pyproject.toml")
        .map((filePath) => path.dirname(filePath))
        .filter((dir) => foundFiles.some((candidate) => path.dirname(candidate) === dir && path.basename(candidate) === "uv.lock"))
    )
  ).slice(0, 3);
  if (pyprojectDirs.length > 0) {
    requiredTools.add("uv");
    evidence.push(`Detected ${pyprojectDirs.length} uv-managed Python workspace${pyprojectDirs.length > 1 ? "s" : ""}.`);
    for (const dir of pyprojectDirs) {
      if (!(await pathExists(path.join(dir, ".venv")))) {
        bootstrapActions.push({
          label: `bootstrap uv environment (${path.relative(cwd, dir) || "."})`,
          cwd: dir,
          command: "uv sync --frozen",
          rationale: "The Python workspace uses uv and does not have a local environment yet."
        });
      }
    }
  }

  const pomDirs = Array.from(
    new Set(foundFiles.filter((filePath) => path.basename(filePath) === "pom.xml").map((filePath) => path.dirname(filePath)))
  );
  if (pomDirs.length > 0) {
    requiredTools.add("mvn");
    evidence.push(`Detected ${pomDirs.length} Maven module${pomDirs.length > 1 ? "s" : ""}.`);
    notes.push("Maven support is inventory-first in build recovery; cstack records the requirement but does not pre-resolve the full dependency tree.");
  }

  const toolChecks = await Promise.all(
    [...requiredTools].map(async (tool) => ({ tool, available: await commandExists(tool, cwd) }))
  );
  for (const check of toolChecks) {
    if (check.available) {
      evidence.push(`Tool available in execution checkout: ${check.tool}`);
    } else {
      missingTools.push(check.tool);
      notes.push(`Required tool not currently available in execution checkout: ${check.tool}`);
    }
  }

  return {
    summary:
      bootstrapActions.length > 0
        ? `Prepared ${bootstrapActions.length} bootstrap action${bootstrapActions.length > 1 ? "s" : ""} for the execution checkout.`
        : "No pre-build bootstrap actions were required for the execution checkout.",
    requiredTools: [...requiredTools],
    missingTools,
    bootstrapActions,
    evidence: uniqueLines(evidence),
    notes: uniqueLines(notes)
  };
}

async function runBootstrapAction(action: BuildBootstrapAction): Promise<BuildRecoveryAttemptRecord> {
  const startedAt = nowIso();
  const shell = process.env.SHELL || "/bin/bash";
  try {
    const { stdout, stderr } = await execFileAsync(shell, ["-lc", action.command], {
      cwd: action.cwd,
      maxBuffer: 20 * 1024 * 1024
    });
    return buildAttemptRecord({
      kind: "bootstrap",
      label: action.label,
      status: "completed",
      startedAt,
      cwd: action.cwd,
      command: action.command,
      summary: `${action.rationale} Bootstrap completed successfully.`,
      evidence: [stdout, stderr].filter(Boolean)
    });
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    const combined = `${execError.stderr ?? ""}\n${execError.stdout ?? ""}\n${execError.message ?? ""}`;
    return buildAttemptRecord({
      kind: "bootstrap",
      label: action.label,
      status: "failed",
      startedAt,
      cwd: action.cwd,
      command: action.command,
      exitCode: typeof execError.code === "number" ? execError.code : 1,
      summary: isTransientFailure(combined)
        ? `${action.rationale} Bootstrap failed because of a likely transient dependency or network issue.`
        : `${action.rationale} Bootstrap failed before build could start.`,
      evidence: [combined]
    });
  }
}

async function runRemediationCommand(cwd: string, command: string, label: string): Promise<BuildRecoveryAttemptRecord> {
  const startedAt = nowIso();
  const shell = process.env.SHELL || "/bin/bash";
  try {
    const { stdout, stderr } = await execFileAsync(shell, ["-lc", command], {
      cwd,
      maxBuffer: 20 * 1024 * 1024
    });
    return buildAttemptRecord({
      kind: "remediation",
      label,
      status: "completed",
      startedAt,
      cwd,
      command,
      summary: `${label} completed successfully.`,
      evidence: [stdout, stderr].filter(Boolean)
    });
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return buildAttemptRecord({
      kind: "remediation",
      label,
      status: "failed",
      startedAt,
      cwd,
      command,
      exitCode: typeof execError.code === "number" ? execError.code : 1,
      summary: `${label} failed.`,
      evidence: [execError.stdout ?? "", execError.stderr ?? "", execError.message ?? ""]
    });
  }
}

export async function resolveLinkedBuildContext(cwd: string, runId: string): Promise<LinkedBuildContext> {
  const run = await readRun(cwd, runId);
  for (const candidate of resolveCandidateArtifacts(run)) {
    try {
      const artifactBody = await fs.readFile(candidate, "utf8");
      return {
        run,
        artifactPath: candidate,
        artifactBody
      };
    } catch {}
  }

  return {
    run,
    artifactPath: null,
    artifactBody: ""
  };
}

function resolveCandidateArtifacts(run: RunRecord): string[] {
  const runDir = path.dirname(run.finalPath);
  switch (run.workflow) {
    case "spec":
      return [path.join(runDir, "artifacts", "spec.md"), run.finalPath];
    case "intent":
      return [path.join(runDir, "stages", "spec", "artifacts", "spec.md"), run.finalPath];
    case "discover":
      return [
        path.join(runDir, "stages", "discover", "artifacts", "discovery-report.md"),
        path.join(runDir, "artifacts", "findings.md"),
        run.finalPath
      ];
    case "build":
      return [path.join(runDir, "artifacts", "change-summary.md"), run.finalPath];
    case "deliver":
      return [
        path.join(runDir, "stages", "ship", "artifacts", "ship-summary.md"),
        path.join(runDir, "stages", "build", "artifacts", "change-summary.md"),
        run.finalPath
      ];
    default:
      return [run.finalPath];
  }
}

export async function detectDirtyWorktree(cwd: string): Promise<boolean> {
  try {
    const dirtyFiles = await listDirtyWorktreeFiles(cwd);
    return dirtyFiles.length > 0;
  } catch {
    return false;
  }
}

export async function listDirtyWorktreeFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", [...GIT_STATUS_PORCELAIN_ARGS], { cwd });
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
      .filter((filePath) => !isInternalRunArtifactPath(filePath));
  } catch {
    return [];
  }
}

export async function ensureCleanWorktreeForWorkflow(cwd: string, workflow: "build" | "ship" | "deliver", allowDirty: boolean): Promise<void> {
  if (allowDirty) {
    return;
  }

  const dirtyFiles = await listDirtyWorktreeFiles(cwd);
  if (dirtyFiles.length === 0) {
    return;
  }

  const preview = dirtyFiles.slice(0, 5).join(", ");
  throw new Error(
    `\`cstack ${workflow}\` requires a clean worktree unless \`--allow-dirty\` is set. Dirty files: ${preview}${dirtyFiles.length > 5 ? ", ..." : ""}`
  );
}

function canUseInteractiveBuild(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY);
}

function shouldFallbackLaunchError(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException | undefined;
  return err?.code === "ENOENT";
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function tailText(filePath: string, maxLines = 24): Promise<string> {
  const body = await readTextFile(filePath);
  if (!body.trim()) {
    return "";
  }
  return body
    .trim()
    .split("\n")
    .slice(-maxLines)
    .join("\n");
}

function renderVerificationSummary(record: BuildVerificationRecord): string {
  if (record.status === "not-run") {
    return record.notes ?? "Verification did not run.";
  }
  if (record.status === "failed") {
    const failed = record.results.find((result) => result.status === "failed");
    if (failed) {
      const blockerPrefix = failed.blockerCategory ? `${failed.blockerCategory}: ` : "";
      return `${blockerPrefix}${failed.command} failed with exit ${failed.exitCode}.`;
    }
  }
  return "Verification passed.";
}

function classifyBuildFailure(options: {
  result: CodexRunResult;
  sessionRecord: BuildSessionRecord;
  verificationRecord: BuildVerificationRecord;
  finalBody: string;
  stderrTail: string;
  assessment: BuildEnvironmentAssessment;
  recoveryAttempts: BuildRecoveryAttemptRecord[];
}): BuildFailureDiagnosisRecord | null {
  if (options.result.code === 0 && options.verificationRecord.status !== "failed") {
    return null;
  }

  const evidence = uniqueLines([
    ...options.assessment.evidence,
    ...options.assessment.notes,
    ...options.recoveryAttempts.flatMap((attempt) => attempt.evidence ?? []),
    options.stderrTail,
    options.finalBody
  ]);
  const recommendedActions: string[] = [];
  let category: BuildFailureCategory = "unknown";
  let blockerCategory: EnvironmentBlockerCategory | undefined;
  let summary = "Build failed for an unspecified reason.";
  let detail = "cstack could not recover a higher-confidence cause from the build artifacts.";
  const failedVerification = options.verificationRecord.results.find((result) => result.status === "failed");
  const inferredBlocker =
    failedVerification?.blockerCategory
      ? { category: failedVerification.blockerCategory, detail: failedVerification.blockerDetail ?? renderVerificationSummary(options.verificationRecord) }
      : classifyExecutionBlocker("codex build", [options.stderrTail, options.finalBody, ...options.assessment.notes].join("\n"));
  const missingRequiredTool = options.assessment.notes.find((note) => /Required tool not currently available/i.test(note));
  const opaqueEarlyExit =
    !options.sessionRecord.observability.sessionIdObserved &&
    (!options.sessionRecord.observability.transcriptObserved || /interactive codex exited with code/i.test(options.stderrTail)) &&
    (!options.sessionRecord.observability.finalArtifactObserved ||
      options.result.synthesizedFinalArtifact ||
      /interactive codex exited with code/i.test(options.stderrTail));

  const failedBootstrap = [...options.recoveryAttempts].reverse().find((attempt) => attempt.kind === "bootstrap" && attempt.status === "failed");
  if ((options.result.timedOut || options.result.stalled) && options.result.timeoutSeconds) {
    category = "timeout";
    blockerCategory = "orchestration-timeout";
    summary = options.result.stalled
      ? `Build stalled for ${options.result.timeoutSeconds}s before the implementation stage completed.`
      : `Build timed out after ${options.result.timeoutSeconds}s before the implementation stage completed.`;
    detail = "The Codex-backed build exceeded the configured stage timeout, so downstream deliver stages were blocked.";
    recommendedActions.push("Increase the build timeout or narrow the requested implementation scope before rerunning.");
  } else if (failedBootstrap) {
    const combinedEvidence = (failedBootstrap.evidence ?? []).join("\n");
    category = isTransientFailure(combinedEvidence) ? "transient-external" : "bootstrap-failure";
    blockerCategory = classifyExecutionBlocker(failedBootstrap.command ?? failedBootstrap.label, combinedEvidence)?.category;
    summary = failedBootstrap.summary;
    detail = `cstack attempted ${failedBootstrap.label} before rerunning build, but bootstrap did not complete successfully.`;
    recommendedActions.push("Inspect the recovery attempts artifact to see which bootstrap command failed.");
    if (category === "transient-external") {
      recommendedActions.push("Retry once network or registry access is stable.");
    }
  } else if (missingRequiredTool) {
    category = "missing-tool";
    blockerCategory = "host-tool-missing";
    summary = "Build failed because a required host tool was missing from the execution environment.";
    detail = missingRequiredTool;
    recommendedActions.push("Install or expose the missing tool in the execution environment, then rerun build.");
  } else if (options.verificationRecord.status === "failed") {
    category = "verification-failure";
    blockerCategory = failedVerification?.blockerCategory;
    summary = `Build completed, but verification failed: ${renderVerificationSummary(options.verificationRecord)}`;
    detail =
      failedVerification?.blockerDetail ??
      "The implementation stage produced output, but the requested verification commands did not all pass.";
    recommendedActions.push(
      blockerCategory && blockerCategory !== "repo-test-failure"
        ? "Resolve the execution environment blocker, then rerun build."
        : "Fix the failing verification command and rerun build."
    );
  } else if (
    opaqueEarlyExit ||
    !options.sessionRecord.observability.sessionIdObserved &&
    !options.sessionRecord.observability.transcriptObserved &&
    (!options.sessionRecord.observability.finalArtifactObserved || options.result.synthesizedFinalArtifact)
  ) {
    category = "codex-process-failure";
    blockerCategory = inferredBlocker?.category;
    summary =
      options.assessment.bootstrapActions.length > 0
        ? `Build failed before Codex produced a usable session, even after ${options.assessment.bootstrapActions.length} bounded environment preparation step${options.assessment.bootstrapActions.length > 1 ? "s" : ""}.`
        : "Build failed because Codex exited before producing a usable session or final artifact.";
    detail =
      "The Codex process terminated before cstack observed a session id, transcript, or usable final artifact, so the wrapper could not recover a repo-level build failure from the generated output.";
    recommendedActions.push("Inspect stderr and the recovery attempts artifact to confirm whether the failure is environmental or inside Codex itself.");
    recommendedActions.push("Retry with a narrower remediation prompt if the repo scope is very large.");
  } else if (/command not found|not found/i.test(options.stderrTail)) {
    category = "missing-tool";
    blockerCategory = "host-tool-missing";
    summary = "Build failed because a required tool was missing during execution.";
    detail = `The captured build stderr suggests a missing command while operating on a repo that requires: ${options.assessment.requiredTools.join(", ") || "unknown tools"}.`;
    recommendedActions.push("Install or expose the missing tool in the execution environment, then rerun build.");
  } else {
    const firstErrorLine = firstMeaningfulErrorLine(options.stderrTail);
    category = "build-script-failure";
    blockerCategory = inferredBlocker?.category;
    summary = firstErrorLine
      ? `Build failed after Codex started work: ${truncateLine(firstErrorLine)}`
      : `Build failed with exit code ${options.result.code}${options.result.signal ? ` (${options.result.signal})` : ""}.`;
    detail = "The failure appears to be inside the repo build or implementation flow rather than an immediately recoverable environment bootstrap problem.";
    recommendedActions.push("Inspect the build final summary and stderr tail for the concrete repo-level failure.");
  }

  if (options.assessment.requiredTools.length > 0) {
    recommendedActions.push(`Required tools observed for this repo: ${options.assessment.requiredTools.join(", ")}.`);
  }

  return {
    category,
    ...(blockerCategory ? { blockerCategory } : {}),
    summary,
    detail,
    evidence,
    recommendedActions: uniqueLines(recommendedActions),
    recoveryAttempts: options.recoveryAttempts,
    ...(typeof options.result.code === "number" ? { exitCode: options.result.code } : {}),
    ...(options.result.signal ? { signal: options.result.signal } : {}),
    ...(options.result.timedOut ? { timedOut: true } : {}),
    ...(options.result.timeoutSeconds ? { timeoutSeconds: options.result.timeoutSeconds } : {}),
    verificationStatus: options.verificationRecord.status
  };
}

function buildFallbackFinalBody(options: {
  input: string;
  requestedMode: WorkflowMode;
  observedMode: WorkflowMode;
  linkedContext?: LinkedBuildContext;
  result: CodexRunResult;
  verificationRecord: BuildVerificationRecord;
  transcriptPath: string;
  notes: string[];
  diagnosis: BuildFailureDiagnosisRecord | null;
  recoveryAttempts: BuildRecoveryAttemptRecord[];
}): string {
  const linked = options.linkedContext;
  const relativeTranscript = linked ? options.transcriptPath : options.transcriptPath;

  return [
    "# Build Run Summary",
    "",
    "## Request",
    options.input,
    "",
    "## Run",
    `- requested mode: ${options.requestedMode}`,
    `- observed mode: ${options.observedMode}`,
    linked ? `- linked run: ${linked.run.id}` : "- linked run: none",
    linked ? `- linked workflow: ${linked.run.workflow}` : "- linked workflow: none",
    linked?.artifactPath ? `- linked artifact: ${linked.artifactPath}` : "- linked artifact: none",
    "",
    "## Codex session",
    options.result.sessionId ? `- session id: ${options.result.sessionId}` : "- session id: not observed",
    `- exit code: ${options.result.code}${options.result.signal ? ` (${options.result.signal})` : ""}`,
    options.observedMode === "interactive" ? `- transcript: ${relativeTranscript}` : "- transcript: not captured",
    "",
    "## Verification",
    `- status: ${options.verificationRecord.status}`,
    ...(options.verificationRecord.results.length > 0
      ? options.verificationRecord.results.map(
          (result) => `- ${result.command}: ${result.status} (exit ${result.exitCode}, ${result.durationMs}ms)`
        )
      : ["- no verification results recorded"]),
    "",
    "## Recovery",
    ...(options.recoveryAttempts.length > 0
      ? options.recoveryAttempts.map((attempt) => `- [${attempt.kind}/${attempt.status}] ${attempt.label}: ${attempt.summary}`)
      : ["- no bounded recovery attempts were recorded"]),
    "",
    "## Diagnosis",
    ...(options.diagnosis
      ? [
          `- category: ${options.diagnosis.category}`,
          ...(options.diagnosis.blockerCategory ? [`- blocker: ${options.diagnosis.blockerCategory}`] : []),
          `- summary: ${options.diagnosis.summary}`,
          `- detail: ${options.diagnosis.detail}`
        ]
      : ["- Build completed without a classified failure diagnosis."]),
    "",
    "## Notes",
    ...(options.notes.length > 0 ? options.notes.map((note) => `- ${note}`) : ["- Codex did not leave a final markdown summary."])
  ].join("\n") + "\n";
}

async function runVerificationCommands(
  cwd: string,
  runDir: string,
  commands: string[]
): Promise<{ record: BuildVerificationRecord; attempts: BuildRecoveryAttemptRecord[] }> {
  if (commands.length === 0) {
    return {
      record: {
        status: "not-run",
        requestedCommands: [],
        results: [],
        notes: "No verification commands were requested."
      },
      attempts: []
    };
  }

  const verificationDir = path.join(runDir, "artifacts", "verification");
  await fs.mkdir(verificationDir, { recursive: true });
  const shell = process.env.SHELL || "/bin/sh";
  const results: BuildVerificationCommandRecord[] = [];
  const attempts: BuildRecoveryAttemptRecord[] = [];

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    const stdoutPath = path.join(verificationDir, `${index + 1}.stdout.log`);
    const stderrPath = path.join(verificationDir, `${index + 1}.stderr.log`);
    const startedAt = nowIso();
    try {
      const { stdout, stderr } = await execFileAsync(shell, ["-lc", command], { cwd, maxBuffer: 10 * 1024 * 1024 });
      await fs.writeFile(stdoutPath, stdout, "utf8");
      await fs.writeFile(stderrPath, stderr, "utf8");
      results.push({
        command,
        exitCode: 0,
        status: "passed",
        durationMs: Date.now() - Date.parse(startedAt),
        stdoutPath,
        stderrPath
      });
      attempts.push(
        buildAttemptRecord({
          kind: "verification",
          label: `verification ${index + 1}`,
          status: "completed",
          startedAt,
          cwd,
          command,
          summary: `Verification command passed: ${command}`,
          evidence: [stdout, stderr]
        })
      );
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
      await fs.writeFile(stdoutPath, execError.stdout ?? "", "utf8");
      await fs.writeFile(stderrPath, execError.stderr ?? execError.message, "utf8");
      const exitCode = typeof execError.code === "number" ? execError.code : 1;
      const blocker = classifyExecutionBlocker(command, `${execError.stderr ?? ""}\n${execError.stdout ?? ""}\n${execError.message ?? ""}`);
      results.push({
        command,
        exitCode,
        status: "failed",
        durationMs: Date.now() - Date.parse(startedAt),
        stdoutPath,
        stderrPath,
        ...(blocker?.category ? { blockerCategory: blocker.category } : {}),
        ...(blocker?.detail ? { blockerDetail: blocker.detail } : {})
      });
      attempts.push(
        buildAttemptRecord({
          kind: "verification",
          label: `verification ${index + 1}`,
          status: "failed",
          startedAt,
          cwd,
          command,
          exitCode,
          summary: `Verification command failed: ${command}`,
          evidence: [execError.stdout ?? "", execError.stderr ?? execError.message]
        })
      );
    }
  }

  return {
    record: {
      status: results.every((result) => result.status === "passed") ? "passed" : "failed",
      requestedCommands: commands,
      results,
      blockerCategories: uniqueBlockerCategories(results.map((result) => result.blockerCategory))
    },
    attempts
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runCodexBuildAttempt(options: {
  executionCwd: string;
  requestedMode: WorkflowMode;
  attemptNumber: number;
  promptBuilder: (
    mode: WorkflowMode,
    attemptNumber: number,
    retryContext?: CodexRetryContext
  ) => Promise<{ prompt: string; context: string }>;
  paths: BuildPaths;
  config: CstackConfig;
  runId: string;
  timeoutSeconds?: number;
  noProgressTimeoutSeconds?: number;
  retryContext?: CodexRetryContext;
}): Promise<CodexAttemptOutcome> {
  let observedMode = options.requestedMode;
  let fallbackReason: string | undefined;
  const notes: string[] = [];
  await fs.writeFile(options.paths.finalPath, "", "utf8");

  if (observedMode === "interactive" && !canUseInteractiveBuild()) {
    observedMode = "exec";
    fallbackReason = "Interactive build requested but no TTY was available, so cstack fell back to exec mode.";
    notes.push(fallbackReason);
  }

  let { prompt, context } = await options.promptBuilder(observedMode, options.attemptNumber, options.retryContext);
  await fs.writeFile(options.paths.promptPath, prompt, "utf8");
  await fs.writeFile(options.paths.contextPath, `${context}\n`, "utf8");

  let result: CodexRunResult;

  if (observedMode === "interactive") {
    try {
      result = await runCodexInteractive({
        cwd: options.executionCwd,
        workflow: "build",
        runId: options.runId,
        prompt,
        transcriptPath: options.paths.transcriptPath,
        eventsPath: options.paths.eventsPath,
        stdoutPath: options.paths.stdoutPath,
        stderrPath: options.paths.stderrPath,
        config: options.config,
        ...(typeof options.timeoutSeconds === "number" ? { timeoutSeconds: options.timeoutSeconds } : {})
      });
    } catch (error) {
      if (!shouldFallbackLaunchError(error)) {
        throw error;
      }
      observedMode = "exec";
      fallbackReason = "Interactive build launch failed because the local `script` utility was unavailable; cstack fell back to exec mode.";
      notes.push(fallbackReason);
      ({ prompt, context } = await options.promptBuilder(observedMode, options.attemptNumber, options.retryContext));
      await fs.writeFile(options.paths.promptPath, prompt, "utf8");
      await fs.writeFile(options.paths.contextPath, `${context}\n`, "utf8");
      result = await runCodexExec({
        cwd: options.executionCwd,
        workflow: "build",
        runId: options.runId,
        prompt,
        finalPath: options.paths.finalPath,
        eventsPath: options.paths.eventsPath,
        stdoutPath: options.paths.stdoutPath,
        stderrPath: options.paths.stderrPath,
        config: options.config,
        ...(typeof options.timeoutSeconds === "number" ? { timeoutSeconds: options.timeoutSeconds } : {}),
        ...(typeof options.noProgressTimeoutSeconds === "number" ? { noProgressTimeoutSeconds: options.noProgressTimeoutSeconds } : {})
      });
    }
  } else {
      result = await runCodexExec({
        cwd: options.executionCwd,
        workflow: "build",
        runId: options.runId,
        prompt,
      finalPath: options.paths.finalPath,
      eventsPath: options.paths.eventsPath,
        stdoutPath: options.paths.stdoutPath,
        stderrPath: options.paths.stderrPath,
        config: options.config,
        ...(typeof options.timeoutSeconds === "number" ? { timeoutSeconds: options.timeoutSeconds } : {}),
        ...(typeof options.noProgressTimeoutSeconds === "number" ? { noProgressTimeoutSeconds: options.noProgressTimeoutSeconds } : {})
      });
  }

  return {
    result,
    observedMode,
    ...(fallbackReason ? { fallbackReason } : {}),
    notes,
    finalBody: await readTextFile(options.paths.finalPath),
    transcriptBody: observedMode === "interactive" ? await readTextFile(options.paths.transcriptPath) : "",
    stderrTail: await tailText(options.paths.stderrPath)
  };
}

function shouldRetryCodexAttempt(outcome: CodexAttemptOutcome, attemptNumber: number, maxAttempts: number): boolean {
  if (attemptNumber >= maxAttempts || outcome.result.code === 0 || outcome.result.timedOut) {
    return false;
  }
  if (outcome.result.sessionId) {
    return false;
  }
  if (outcome.transcriptBody.trim()) {
    return false;
  }
  if (outcome.result.synthesizedFinalArtifact) {
    return true;
  }
  const finalBodyUsable = Boolean(outcome.finalBody.trim());
  const stderrTail = outcome.stderrTail.trim();
  if (!finalBodyUsable && !stderrTail) {
    return true;
  }
  if (!finalBodyUsable && /interactive codex exited with code/i.test(stderrTail)) {
    return true;
  }
  if (
    /interactive codex exited with code/i.test(stderrTail) &&
    /no build transcript|no final markdown/i.test(outcome.finalBody)
  ) {
    return true;
  }
  return false;
}

export async function runBuildExecution(options: BuildExecutionOptions): Promise<BuildExecutionResult> {
  const executionCwd = options.executionCwd ?? options.cwd;
  const dirtyWorktree = await detectDirtyWorktree(executionCwd);
  const requestedMode = options.requestedMode;
  const startedAt = nowIso();
  const recoveryAttempts: BuildRecoveryAttemptRecord[] = [];

  let assessment = await resolveBuildEnvironmentAssessment(executionCwd);
  recoveryAttempts.push(
    buildAttemptRecord({
      kind: "assessment",
      label: "inspect repo requirements",
      status: "completed",
      startedAt,
      cwd: executionCwd,
      summary: assessment.summary,
      evidence: [...assessment.evidence, ...assessment.notes]
    })
  );

  for (const action of assessment.bootstrapActions) {
    const attempt = await runBootstrapAction(action);
    recoveryAttempts.push(attempt);
    if (attempt.status === "failed" && !isTransientFailure((attempt.evidence ?? []).join("\n"))) {
      break;
    }
  }

  const noProgressTimeoutSeconds = Math.min(
    typeof options.timeoutSeconds === "number" && options.timeoutSeconds > 0 ? options.timeoutSeconds : BUILD_NO_PROGRESS_TIMEOUT_SECONDS,
    BUILD_NO_PROGRESS_TIMEOUT_SECONDS
  );

  const maxCodexAttempts = resolveMaxCodexAttempts(options.config);
  const canUseInteractive = canUseInteractiveBuild();
  const promptBuilder = async (mode: WorkflowMode, attemptNumber: number, retryContext?: CodexRetryContext) =>
    buildBuildPrompt({
      cwd: executionCwd,
      input: options.input,
      config: options.config,
      mode,
      finalArtifactPath: options.paths.finalPath,
      verificationCommands: options.verificationCommands,
      dirtyWorktree,
      ...(options.linkedContext?.artifactPath ? { linkedArtifactPath: options.linkedContext.artifactPath } : {}),
      ...(options.linkedContext?.artifactBody ? { linkedArtifactBody: options.linkedContext.artifactBody } : {}),
      ...(options.linkedContext?.run.id ? { linkedRunId: options.linkedContext.run.id } : {}),
      ...(options.linkedContext?.run.workflow ? { linkedWorkflow: options.linkedContext.run.workflow } : {}),
      ...(retryContext
        ? {
            retryAttempt: {
              attemptNumber,
              maxAttempts: retryContext.maxAttempts,
              reason: retryContext.reason,
              ...(retryContext.missingTools.length ? { missingTools: retryContext.missingTools } : {}),
              ...(retryContext.remediationCommands.length ? { remediationCommands: retryContext.remediationCommands } : {}),
              ...(retryContext.failureHints.length ? { failureHints: retryContext.failureHints } : {})
            }
          }
        : {})
    });

  let attemptNumber = 0;
  let codexOutcome: CodexAttemptOutcome | null = null;
  let previousOutcome: CodexAttemptOutcome | null = null;
  do {
    attemptNumber += 1;
    const attemptStartedAt = nowIso();
    const attemptMode = resolveBuildAttemptMode(requestedMode, canUseInteractive, attemptNumber);
    const remediation = inferRetryRemediation(assessment, previousOutcome);
    const retryContext =
      attemptNumber > 1 && previousOutcome
        ? {
            attemptNumber,
            maxAttempts: maxCodexAttempts,
            reason: makeCodexRetryHint(attemptNumber, maxCodexAttempts, previousOutcome),
            ...(remediation.missingTools.length ? { missingTools: remediation.missingTools } : { missingTools: [] }),
            ...(remediation.remediationCommands.length
              ? { remediationCommands: remediation.remediationCommands }
              : { remediationCommands: [] }),
            ...(remediation.failureHints.length ? { failureHints: remediation.failureHints } : { failureHints: [] })
          }
        : undefined;
    if (attemptNumber > 1 && remediation.remediationCommands.length > 0) {
      for (const [index, command] of remediation.remediationCommands.entries()) {
        const remediationAttempt = await runRemediationCommand(
          executionCwd,
          command,
          `environment remediation ${index + 1}`
        );
        recoveryAttempts.push(remediationAttempt);
      }
      assessment = await resolveBuildEnvironmentAssessment(executionCwd);
      recoveryAttempts.push(
        buildAttemptRecord({
          kind: "assessment",
          label: `re-assess repo requirements after remediation ${attemptNumber - 1}`,
          status: "completed",
          startedAt: nowIso(),
          cwd: executionCwd,
          summary: assessment.summary,
          evidence: [...assessment.evidence, ...assessment.notes]
        })
      );
    }
    codexOutcome = await runCodexBuildAttempt({
      executionCwd,
      requestedMode: attemptMode,
      attemptNumber,
      promptBuilder,
      paths: options.paths,
      config: options.config,
      runId: options.runId,
      ...(typeof retryContext?.attemptNumber === "number" ? { retryContext } : {}),
      ...(typeof options.timeoutSeconds === "number" ? { timeoutSeconds: options.timeoutSeconds } : {}),
      ...(typeof noProgressTimeoutSeconds === "number" ? { noProgressTimeoutSeconds } : {})
    });
    previousOutcome = codexOutcome;
    const retrying = shouldRetryCodexAttempt(codexOutcome, attemptNumber, maxCodexAttempts);
    recoveryAttempts.push(
      buildAttemptRecord({
        kind: "codex-run",
        label: `codex build attempt ${attemptNumber} (${attemptMode})`,
        status: retrying ? "retrying" : codexOutcome.result.code === 0 ? "completed" : "failed",
        startedAt: attemptStartedAt,
        cwd: executionCwd,
        summary:
          codexOutcome.result.code === 0
            ? "Codex build attempt completed successfully."
            : retrying
              ? `Codex exited before producing a usable session; retrying with ${attemptMode} mode (attempt ${attemptNumber + 1}/${maxCodexAttempts}).`
              : `Codex build attempt failed with exit code ${codexOutcome.result.code}.`,
        command: codexOutcome.result.command.join(" "),
        exitCode: codexOutcome.result.code,
        evidence: [codexOutcome.stderrTail, codexOutcome.finalBody, ...codexOutcome.notes]
      })
    );
    if (!retrying) {
      break;
    }
  } while (attemptNumber < maxCodexAttempts);

  if (!codexOutcome) {
    throw new Error("Build execution did not produce a Codex attempt outcome.");
  }

  const verificationOutcome =
    codexOutcome.result.code === 0
      ? await runVerificationCommands(executionCwd, options.paths.runDir, options.verificationCommands)
      : {
          record: {
            status: "not-run" as const,
            requestedCommands: options.verificationCommands,
            results: [],
            notes: "Verification was skipped because the build run did not complete successfully."
          },
          attempts: [] as BuildRecoveryAttemptRecord[]
        };
  recoveryAttempts.push(...verificationOutcome.attempts);
  await writeJson(options.paths.verificationPath, verificationOutcome.record);

  const sessionRecord: BuildSessionRecord = {
    workflow: "build",
    requestedMode,
    mode: codexOutcome.observedMode,
    startedAt,
    endedAt: nowIso(),
    ...(codexOutcome.result.sessionId ? { sessionId: codexOutcome.result.sessionId } : {}),
    ...(options.linkedContext?.run.id ? { linkedRunId: options.linkedContext.run.id } : {}),
    ...(options.linkedContext?.run.workflow ? { linkedRunWorkflow: options.linkedContext.run.workflow } : {}),
    ...(options.linkedContext?.artifactPath ? { linkedArtifactPath: options.linkedContext.artifactPath } : {}),
    ...(codexOutcome.observedMode === "interactive" ? { transcriptPath: options.paths.transcriptPath } : {}),
    codexCommand: codexOutcome.result.command,
    ...(codexOutcome.result.sessionId ? { resumeCommand: `codex resume ${codexOutcome.result.sessionId}` } : {}),
    ...(codexOutcome.result.sessionId ? { forkCommand: `codex fork ${codexOutcome.result.sessionId}` } : {}),
    observability: {
      sessionIdObserved: Boolean(codexOutcome.result.sessionId),
      transcriptObserved: Boolean(codexOutcome.transcriptBody.trim()),
      finalArtifactObserved: !codexOutcome.result.synthesizedFinalArtifact && Boolean(codexOutcome.finalBody.trim()),
      ...(codexOutcome.result.stalled ? { stalled: true } : {}),
      ...(codexOutcome.result.stallReason ? { stallReason: codexOutcome.result.stallReason } : {}),
      ...(codexOutcome.result.timedOut ? { timedOut: true } : {}),
      ...(codexOutcome.result.timeoutSeconds ? { timeoutSeconds: codexOutcome.result.timeoutSeconds } : {}),
      ...(codexOutcome.fallbackReason ? { fallbackReason: codexOutcome.fallbackReason } : {})
    },
    notes: uniqueLines([...codexOutcome.notes, ...assessment.notes])
  };

  let finalBody = codexOutcome.finalBody;
  const failureDiagnosis = classifyBuildFailure({
    result: codexOutcome.result,
    sessionRecord,
    verificationRecord: verificationOutcome.record,
    finalBody,
    stderrTail: codexOutcome.stderrTail,
    assessment,
    recoveryAttempts
  });
  await writeJson(options.paths.recoveryAttemptsPath, recoveryAttempts);
  if (failureDiagnosis) {
    await writeJson(options.paths.failureDiagnosisPath, failureDiagnosis);
  }
  await fs.writeFile(options.paths.recoverySummaryPath, renderRecoverySummary(failureDiagnosis, recoveryAttempts), "utf8");

  if (!finalBody.trim()) {
    finalBody = buildFallbackFinalBody({
      input: options.input,
      requestedMode,
      observedMode: codexOutcome.observedMode,
      result: codexOutcome.result,
      verificationRecord: verificationOutcome.record,
      transcriptPath: path.relative(options.cwd, options.paths.transcriptPath),
      notes: executionCwd !== options.cwd ? [...codexOutcome.notes, `Execution checkout: ${executionCwd}`] : codexOutcome.notes,
      diagnosis: failureDiagnosis,
      recoveryAttempts,
      ...(options.linkedContext ? { linkedContext: options.linkedContext } : {})
    });
    await fs.writeFile(options.paths.finalPath, finalBody, "utf8");
    sessionRecord.observability.finalArtifactObserved = true;
  }

  if (failureDiagnosis && !/## Diagnosis/.test(finalBody)) {
    finalBody +=
      [
        "",
        "## Diagnosis",
        `- category: ${failureDiagnosis.category}`,
        `- summary: ${failureDiagnosis.summary}`,
        `- detail: ${failureDiagnosis.detail}`,
        ...failureDiagnosis.recommendedActions.map((action) => `- action: ${action}`)
      ].join("\n") + "\n";
    await fs.writeFile(options.paths.finalPath, finalBody, "utf8");
  }

  await fs.writeFile(options.paths.changeSummaryPath, finalBody, "utf8");
  await writeJson(options.paths.sessionPath, sessionRecord);

  return {
    result: codexOutcome.result,
    finalBody,
    requestedMode,
    observedMode: codexOutcome.observedMode,
    sessionRecord,
    verificationRecord: verificationOutcome.record,
    recoveryAttempts,
    failureDiagnosis
  };
}
