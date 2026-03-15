import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import type {
  DeliverGitHubConfig,
  DeliverTargetMode,
  GitHubActionRunRecord,
  GitHubCheckRunRecord,
  GitHubCodeScanningAlertRecord,
  GitHubDependabotAlertRecord,
  GitHubDeliveryRecord,
  GitHubGateEvaluation,
  GitHubGateStatus,
  GitHubIssueRecord,
  GitHubMutationRecord,
  GitHubPullRequestRecord,
  DeliverReviewVerdict,
  GitHubReleaseRecord
} from "./types.js";

const execFileAsync = promisify(execFile);
const INTERNAL_RUN_ARTIFACT_PREFIX = ".cstack/runs/";
const GIT_STATUS_PORCELAIN_ARGS = ["status", "--porcelain", "--untracked-files=all"] as const;

function isInternalRunArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  return normalized === ".cstack/runs" || normalized.startsWith(INTERNAL_RUN_ARTIFACT_PREFIX);
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface CollectGitHubDeliveryOptions {
  cwd: string;
  gitBranch: string;
  deliveryMode: DeliverTargetMode;
  issueNumbers: number[];
  policy: DeliverGitHubConfig;
  input?: string;
  linkedArtifactBody?: string;
  mutationRecord?: GitHubMutationRecord;
}

export interface CollectGitHubDeliveryResult {
  record: GitHubDeliveryRecord;
  artifacts: {
    githubState: Record<string, unknown>;
    mutation: GitHubMutationRecord;
    pullRequest: GitHubGateEvaluation<GitHubPullRequestRecord | null>;
    issues: GitHubGateEvaluation<GitHubIssueRecord[]>;
    checks: GitHubGateEvaluation<GitHubCheckRunRecord[]>;
    actions: GitHubGateEvaluation<GitHubActionRunRecord[]>;
    security: GitHubGateEvaluation<{
      dependabot: GitHubDependabotAlertRecord[];
      codeScanning: GitHubCodeScanningAlertRecord[];
    }>;
    release: GitHubGateEvaluation<GitHubReleaseRecord | null>;
  };
}

export interface PerformGitHubMutationOptions {
  cwd: string;
  gitBranch: string;
  runId: string;
  input: string;
  issueNumbers: number[];
  policy: DeliverGitHubConfig;
  buildSummary: string;
  reviewVerdict: DeliverReviewVerdict;
  verificationRecord: object;
  linkedRunId?: string;
  pullRequestBodyPath: string;
}

export interface PerformGitHubMutationResult {
  record: GitHubMutationRecord;
  branch: string;
}

function resolveCommand(command: string, args: string[]): { file: string; args: string[] } {
  if (/\.(mjs|cjs|js|ts)$/i.test(command)) {
    return {
      file: process.execPath,
      args: [command, ...args]
    };
  }

  return {
    file: command,
    args
  };
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  const invocation = resolveCommand(command, args);
  const result = await execFileAsync(invocation.file, invocation.args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
}

async function runGit(cwd: string, args: string[]): Promise<CommandResult> {
  return runCommand("git", args, cwd);
}

async function runGh(command: string, cwd: string, args: string[]): Promise<CommandResult> {
  return runCommand(command, args, cwd);
}

function parseGitHubRepository(remoteUrl: string): string | null {
  const match = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return match?.[1] ?? null;
}

async function detectRepository(cwd: string, configuredRepository?: string): Promise<{ repository: string | null; remoteUrl: string | null }> {
  if (configuredRepository) {
    return {
      repository: configuredRepository,
      remoteUrl: null
    };
  }

  try {
    const { stdout } = await runGit(cwd, ["remote", "get-url", "origin"]);
    const remoteUrl = stdout.trim();
    return {
      repository: parseGitHubRepository(remoteUrl),
      remoteUrl
    };
  } catch {
    return {
      repository: null,
      remoteUrl: null
    };
  }
}

async function detectHeadSha(cwd: string): Promise<string> {
  try {
    const { stdout } = await runGit(cwd, ["rev-parse", "HEAD"]);
    return stdout.trim();
  } catch {
    return "";
  }
}

async function detectDefaultBranch(ghCommand: string, cwd: string, repository: string | null): Promise<string | null> {
  if (!repository) {
    return null;
  }

  try {
    const { stdout } = await runGh(ghCommand, cwd, ["api", `repos/${repository}`]);
    const payload = JSON.parse(stdout) as { default_branch?: string };
    return payload.default_branch ?? null;
  } catch {
    return null;
  }
}

async function readPackageVersion(cwd: string): Promise<string | null> {
  try {
    const body = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    const payload = JSON.parse(body) as { version?: string };
    return payload.version ?? null;
  } catch {
    return null;
  }
}

function gate<T>(
  required: boolean,
  status: GitHubGateStatus,
  summary: string,
  observed: T,
  source: GitHubGateEvaluation<T>["source"],
  blockers: string[] = [],
  error?: string
): GitHubGateEvaluation<T> {
  return {
    required,
    status,
    summary,
    blockers,
    observedAt: new Date().toISOString(),
    source,
    observed,
    ...(error ? { error } : {})
  };
}

function issueNumbersFromPrompt(input: string): number[] {
  return [...input.matchAll(/(?:^|\s)#(\d+)\b/g)].map((match) => Number.parseInt(match[1]!, 10));
}

function truncateLine(value: string, maxLength = 72): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trimEnd()}...` : normalized;
}

function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildMutationBranchName(prefix: string, runId: string, input: string): string {
  const runSlug = runId.split("-").slice(-6).join("-").slice(0, 36);
  const inputSlug = slugifySegment(input).slice(0, 36);
  return `${prefix}/${inputSlug || runSlug || "deliver"}`.slice(0, 80);
}

async function listChangedFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await runGit(cwd, [...GIT_STATUS_PORCELAIN_ARGS]);
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

async function currentHeadSha(cwd: string): Promise<string | undefined> {
  const sha = await detectHeadSha(cwd);
  return sha || undefined;
}

function buildCommitMessage(input: string, issueNumbers: number[]): string {
  const prefix = issueNumbers.length > 0 ? `fix(#${issueNumbers[0]}): ` : "cstack deliver: ";
  return truncateLine(`${prefix}${input}`, 72);
}

function buildPullRequestTitle(input: string, issueNumbers: number[]): string {
  return truncateLine(issueNumbers.length > 0 ? `${input} (#${issueNumbers[0]})` : input, 72);
}

function buildPullRequestBody(options: {
  input: string;
  issueNumbers: number[];
  linkedRunId?: string;
  buildSummary: string;
  reviewVerdict: DeliverReviewVerdict;
  verificationRecord: object;
}): string {
  return [
    "# cstack deliver",
    "",
    "## Request",
    options.input,
    "",
    "## Linked run",
    options.linkedRunId ? `- ${options.linkedRunId}` : "- none",
    "",
    "## Issues",
    ...(options.issueNumbers.length > 0 ? options.issueNumbers.map((number) => `- closes #${number}`) : ["- none"]),
    "",
    "## Build summary",
    truncateLine(options.buildSummary, 400),
    "",
    "## Review verdict",
    `- status: ${options.reviewVerdict.status}`,
    `- summary: ${options.reviewVerdict.summary}`,
    ...options.reviewVerdict.recommendedActions.map((action) => `- action: ${action}`),
    "",
    "## Verification",
    "```json",
    JSON.stringify(options.verificationRecord, null, 2),
    "```"
  ].join("\n");
}

async function resolveRemoteForPush(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(cwd, ["remote"]);
    const remotes = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    return remotes.includes("origin") ? "origin" : remotes[0] ?? null;
  } catch {
    return null;
  }
}

async function readPullRequest(options: {
  ghCommand: string;
  cwd: string;
  repository: string | null;
  gitBranch: string;
}): Promise<GitHubPullRequestRecord | null> {
  const { ghCommand, cwd, repository, gitBranch } = options;
  if (!repository) {
    return null;
  }

  const { stdout } = await runGh(ghCommand, cwd, [
    "pr",
    "view",
    gitBranch,
    "--repo",
    repository,
    "--json",
    "number,title,state,isDraft,reviewDecision,url,headRefName,baseRefName,mergeStateStatus,closingIssuesReferences"
  ]);
  const raw = JSON.parse(stdout) as {
    number: number;
    title: string;
    state: string;
    isDraft: boolean;
    reviewDecision?: string | null;
    url: string;
    headRefName: string;
    baseRefName: string;
  };

  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    isDraft: raw.isDraft,
    reviewDecision: raw.reviewDecision ?? null,
    url: raw.url,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName
  };
}

async function waitForRequiredChecks(options: {
  ghCommand: string;
  cwd: string;
  repository: string;
  pullRequestNumber: number;
  timeoutSeconds: number;
  pollSeconds: number;
}): Promise<{ polls: number; completed: boolean; summary: string }> {
  const startedAt = Date.now();
  let polls = 0;
  let summary = "Required checks were not observed.";

  while ((Date.now() - startedAt) / 1000 < options.timeoutSeconds) {
    polls += 1;
    try {
      const { stdout } = await runGh(options.ghCommand, options.cwd, [
        "pr",
        "checks",
        String(options.pullRequestNumber),
        "--repo",
        options.repository,
        "--required",
        "--json",
        "name,bucket,state,workflow,link"
      ]);
      const checks = JSON.parse(stdout) as Array<{ name: string; bucket: string; state: string }>;
      if (checks.length === 0) {
        summary = "No required checks were reported yet.";
      } else {
        const completed = checks.every((check) => check.state === "completed");
        const failing = checks.filter((check) => check.bucket !== "pass");
        summary = completed
          ? failing.length === 0
            ? `Observed ${checks.length} completed required checks.`
            : `Observed ${failing.length} non-passing required checks.`
          : `Waiting for ${checks.filter((check) => check.state !== "completed").length} required checks.`;
        if (completed) {
          return {
            polls,
            completed: true,
            summary
          };
        }
      }
    } catch (error) {
      summary = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, options.pollSeconds * 1000));
  }

  return {
    polls,
    completed: false,
    summary: `Timed out while waiting for required checks. Last observation: ${summary}`
  };
}

async function detectPullRequest(options: {
  ghCommand: string;
  cwd: string;
  repository: string | null;
  gitBranch: string;
  requireApprovedReview: boolean;
  prRequired: boolean;
}): Promise<GitHubGateEvaluation<GitHubPullRequestRecord | null>> {
  const { ghCommand, cwd, repository, gitBranch, requireApprovedReview, prRequired } = options;
  if (!repository) {
    return gate(prRequired, prRequired ? "blocked" : "not-applicable", "GitHub repository could not be resolved.", null, "none", [
      "GitHub repository could not be resolved from origin remote or config."
    ]);
  }

  try {
    const raw = await readPullRequest({
      ghCommand,
      cwd,
      repository,
      gitBranch
    });
    if (!raw) {
      throw new Error("No pull request could be resolved for the current branch.");
    }

    const blockers: string[] = [];
    if (raw.state !== "OPEN") {
      blockers.push(`Pull request #${raw.number} is not open.`);
    }
    if (raw.isDraft) {
      blockers.push(`Pull request #${raw.number} is still a draft.`);
    }
    if (requireApprovedReview && raw.reviewDecision !== "APPROVED") {
      blockers.push(`Pull request #${raw.number} does not have an approved review decision.`);
    }

    return gate(
      prRequired,
      blockers.length === 0 ? "ready" : "blocked",
      blockers.length === 0 ? `Pull request #${raw.number} satisfies the current policy.` : blockers[0]!,
      raw,
      "gh",
      blockers
    );
  } catch (error) {
    return gate(
      prRequired,
      prRequired ? "blocked" : "not-applicable",
      prRequired ? "A pull request is required but none could be resolved for the current branch." : "Pull request checks were not required.",
      null,
      "gh",
      prRequired ? ["No pull request could be resolved for the current branch."] : [],
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function detectIssues(options: {
  ghCommand: string;
  cwd: string;
  repository: string | null;
  requestedNumbers: number[];
  pr: GitHubPullRequestRecord | null;
  linkedIssuesRequired: boolean;
  requiredIssueState: DeliverGitHubConfig["requiredIssueState"];
  input: string;
}): Promise<GitHubGateEvaluation<GitHubIssueRecord[]>> {
  const { ghCommand, cwd, repository, requestedNumbers, pr, linkedIssuesRequired, requiredIssueState, input } = options;
  const issueNumbers = [...new Set([...requestedNumbers, ...issueNumbersFromPrompt(input)])];
  if (linkedIssuesRequired && issueNumbers.length === 0) {
    return gate(linkedIssuesRequired, "blocked", "Linked issues are required but none were supplied or inferred.", [], "config", [
      "Linked issues are required but none were supplied or inferred."
    ]);
  }
  if (!repository) {
    return gate(linkedIssuesRequired, linkedIssuesRequired ? "blocked" : "not-applicable", "GitHub repository could not be resolved.", [], "none", [
      "GitHub repository could not be resolved from origin remote or config."
    ]);
  }
  if (issueNumbers.length === 0) {
    return gate(false, "not-applicable", "No linked issues were required for this deliver run.", [], "none");
  }

  const issues: GitHubIssueRecord[] = [];
  const blockers: string[] = [];
  for (const number of issueNumbers) {
    try {
      const { stdout } = await runGh(ghCommand, cwd, ["issue", "view", String(number), "--repo", repository, "--json", "number,title,state,url,closedAt"]);
      const raw = JSON.parse(stdout) as {
        number: number;
        title: string;
        state: string;
        url: string;
        closedAt?: string | null;
      };
      issues.push({
        number: raw.number,
        title: raw.title,
        state: raw.state,
        url: raw.url,
        closedAt: raw.closedAt ?? null
      });
      if (requiredIssueState === "closed" && raw.state !== "CLOSED") {
        blockers.push(`Issue #${raw.number} is ${raw.state} but closed issues are required.`);
      }
    } catch (error) {
      blockers.push(`Issue #${number} could not be inspected.`);
      issues.push({
        number,
        title: `Issue #${number}`,
        state: "UNKNOWN",
        url: ""
      });
      if (error instanceof Error) {
        blockers.push(error.message);
      }
    }
  }

  const required = linkedIssuesRequired || requiredIssueState === "closed";
  return gate(
    required,
    blockers.length === 0 ? "ready" : "blocked",
    blockers.length === 0 ? `Tracked ${issues.length} linked issue${issues.length === 1 ? "" : "s"}.` : blockers[0]!,
    issues,
    "gh",
    blockers
  );
}

async function detectChangelogPaths(cwd: string, version: string, paths: string[]): Promise<string[]> {
  const matches: string[] = [];
  for (const relativePath of paths) {
    try {
      const body = await fs.readFile(path.join(cwd, relativePath), "utf8");
      if (body.includes(version)) {
        matches.push(relativePath);
      }
    } catch {}
  }
  return matches;
}

async function detectChecks(options: {
  ghCommand: string;
  cwd: string;
  repository: string | null;
  gitBranch: string;
  requiredChecks: string[];
  pr: GitHubPullRequestRecord | null;
}): Promise<GitHubGateEvaluation<GitHubCheckRunRecord[]>> {
  const { ghCommand, cwd, repository, gitBranch, requiredChecks, pr } = options;
  const required = requiredChecks.length > 0 || Boolean(pr);
  if (!pr || !repository) {
    return gate(required, required ? "blocked" : "not-applicable", "Checks require an observable pull request.", [], "gh", required ? [
      "Required checks could not be evaluated because no pull request was available."
    ] : []);
  }

  try {
    const { stdout } = await runGh(ghCommand, cwd, [
      "pr",
      "checks",
      String(pr.number),
      "--repo",
      repository,
      "--required",
      "--json",
      "name,bucket,state,workflow,link"
    ]);
    const raw = JSON.parse(stdout) as Array<{
      name: string;
      bucket: string;
      state: string;
      workflow?: string;
      link?: string;
    }>;
    const checks = raw.map((entry) => ({
      name: entry.name,
      status: entry.state,
      conclusion: entry.bucket,
      detailsUrl: entry.link ?? null
    }));
    const blockers: string[] = [];
    const requiredSet = new Set(requiredChecks);
    for (const check of checks) {
      if (check.conclusion !== "pass") {
        blockers.push(`Required check ${check.name} is ${check.conclusion}.`);
      }
      requiredSet.delete(check.name);
    }
    for (const missing of requiredSet) {
      blockers.push(`Required check ${missing} was not observed on the pull request.`);
    }

    return gate(
      required,
      blockers.length === 0 ? "ready" : "blocked",
      blockers.length === 0 ? `Observed ${checks.length} required check${checks.length === 1 ? "" : "s"}.` : blockers[0]!,
      checks,
      "gh",
      blockers
    );
  } catch (error) {
    return gate(
      required,
      required ? "blocked" : "not-applicable",
      required ? "Required checks could not be inspected." : "Checks were not required for this deliver run.",
      [],
      "gh",
      required ? ["Required checks could not be inspected."] : [],
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function detectActions(options: {
  ghCommand: string;
  cwd: string;
  repository: string | null;
  gitBranch: string;
  headSha: string;
  requiredWorkflows: string[];
}): Promise<GitHubGateEvaluation<GitHubActionRunRecord[]>> {
  const { ghCommand, cwd, repository, gitBranch, headSha, requiredWorkflows } = options;
  const required = requiredWorkflows.length > 0;
  if (!repository) {
    return gate(required, required ? "blocked" : "not-applicable", "GitHub repository could not be resolved.", [], "none", required ? [
      "GitHub repository could not be resolved from origin remote or config."
    ] : []);
  }
  if (!required) {
    return gate(false, "not-applicable", "No GitHub Actions workflows were required by policy.", [], "config");
  }

  try {
    const { stdout } = await runGh(ghCommand, cwd, [
      "run",
      "list",
      "--repo",
      repository,
      "--branch",
      gitBranch,
      "--json",
      "databaseId,workflowName,status,conclusion,url,headSha,headBranch,event,displayTitle",
      "--limit",
      "50"
    ]);
    const raw = JSON.parse(stdout) as Array<{
      databaseId: number;
      workflowName: string;
      status: string;
      conclusion?: string | null;
      url?: string;
      headSha?: string;
      headBranch?: string;
      event?: string;
      displayTitle?: string;
    }>;
    const runs = raw
      .filter((entry) => !headSha || !entry.headSha || entry.headSha === headSha)
      .map((entry) => ({
        databaseId: entry.databaseId,
        workflowName: entry.workflowName,
        status: entry.status,
        conclusion: entry.conclusion ?? null,
        ...(entry.url ? { url: entry.url } : {}),
        ...(entry.headSha ? { headSha: entry.headSha } : {}),
        ...(entry.headBranch ? { headBranch: entry.headBranch } : {}),
        ...(entry.event ? { event: entry.event } : {}),
        ...(entry.displayTitle ? { displayTitle: entry.displayTitle } : {})
      }));

    const blockers: string[] = [];
    for (const workflowName of requiredWorkflows) {
      const match = runs.find((entry) => entry.workflowName === workflowName);
      if (!match) {
        blockers.push(`Required workflow ${workflowName} was not observed for the current branch.`);
        continue;
      }
      if (match.status !== "completed" || match.conclusion !== "success") {
        blockers.push(`Required workflow ${workflowName} finished with status=${match.status} conclusion=${match.conclusion ?? "null"}.`);
      }
    }

    return gate(
      true,
      blockers.length === 0 ? "ready" : "blocked",
      blockers.length === 0 ? `Observed required workflows: ${requiredWorkflows.join(", ")}.` : blockers[0]!,
      runs,
      "gh",
      blockers
    );
  } catch (error) {
    return gate(
      true,
      "blocked",
      "Required GitHub Actions workflows could not be inspected.",
      [],
      "gh",
      ["Required GitHub Actions workflows could not be inspected."],
      error instanceof Error ? error.message : String(error)
    );
  }
}

function normalizeSeverity(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function severityBlocked(severity: string | null | undefined, blockSeverities: string[]): boolean {
  return blockSeverities.map((entry) => entry.toLowerCase()).includes(normalizeSeverity(severity));
}

async function detectSecurity(options: {
  ghCommand: string;
  cwd: string;
  repository: string | null;
  config: DeliverGitHubConfig["security"];
}): Promise<GitHubGateEvaluation<{ dependabot: GitHubDependabotAlertRecord[]; codeScanning: GitHubCodeScanningAlertRecord[] }>> {
  const { ghCommand, cwd, repository, config } = options;
  const requireDependabot = Boolean(config?.requireDependabot);
  const requireCodeScanning = Boolean(config?.requireCodeScanning);
  const required = requireDependabot || requireCodeScanning;
  const blockSeverities = config?.blockSeverities ?? ["high", "critical"];

  if (!repository) {
    return gate(required, required ? "blocked" : "not-applicable", "GitHub repository could not be resolved.", { dependabot: [], codeScanning: [] }, "none", required ? [
      "GitHub repository could not be resolved from origin remote or config."
    ] : []);
  }
  if (!required) {
    return gate(false, "not-applicable", "No GitHub security gates were required by policy.", { dependabot: [], codeScanning: [] }, "config");
  }

  const blockers: string[] = [];
  const dependabot: GitHubDependabotAlertRecord[] = [];
  const codeScanning: GitHubCodeScanningAlertRecord[] = [];

  if (requireDependabot) {
    try {
      const { stdout } = await runGh(ghCommand, cwd, ["api", `repos/${repository}/dependabot/alerts?state=open&per_page=100`]);
      const raw = JSON.parse(stdout) as Array<Record<string, unknown>>;
      for (const entry of raw) {
        const severity = normalizeSeverity(
          typeof entry.security_advisory === "object" && entry.security_advisory !== null
            ? (entry.security_advisory as Record<string, unknown>).severity as string | undefined
            : undefined
        );
        const record: GitHubDependabotAlertRecord = {
          number: Number(entry.number),
          severity,
          state: typeof entry.state === "string" ? entry.state : null,
          packageName:
            typeof entry.dependency === "object" && entry.dependency !== null
              ? (((entry.dependency as Record<string, unknown>).package as Record<string, unknown> | undefined)?.name as string | undefined) ?? null
              : null,
          ...(typeof entry.html_url === "string" ? { url: entry.html_url } : {})
        };
        dependabot.push(record);
        if (severityBlocked(severity, blockSeverities)) {
          blockers.push(`Dependabot alert #${record.number} is open at severity ${severity || "unknown"}.`);
        }
      }
    } catch (error) {
      blockers.push("Dependabot alerts could not be inspected.");
      return gate(required, "blocked", "Dependabot alerts could not be inspected.", { dependabot, codeScanning }, "gh", blockers, error instanceof Error ? error.message : String(error));
    }
  }

  if (requireCodeScanning) {
    try {
      const { stdout } = await runGh(ghCommand, cwd, ["api", `repos/${repository}/code-scanning/alerts?state=open&per_page=100`]);
      const raw = JSON.parse(stdout) as Array<Record<string, unknown>>;
      for (const entry of raw) {
        const rule = typeof entry.rule === "object" && entry.rule !== null ? (entry.rule as Record<string, unknown>) : {};
        const severity = normalizeSeverity((rule.security_severity_level as string | undefined) ?? (rule.severity as string | undefined));
        const record: GitHubCodeScanningAlertRecord = {
          number: Number(entry.number),
          severity,
          state: typeof entry.state === "string" ? entry.state : null,
          ruleId: typeof rule.id === "string" ? rule.id : null,
          ...(typeof entry.html_url === "string" ? { url: entry.html_url } : {})
        };
        codeScanning.push(record);
        if (severityBlocked(severity, blockSeverities)) {
          blockers.push(`Code scanning alert #${record.number} is open at severity ${severity || "unknown"}.`);
        }
      }
    } catch (error) {
      blockers.push("Code scanning alerts could not be inspected.");
      return gate(required, "blocked", "Code scanning alerts could not be inspected.", { dependabot, codeScanning }, "gh", blockers, error instanceof Error ? error.message : String(error));
    }
  }

  return gate(
    true,
    blockers.length === 0 ? "ready" : "blocked",
    blockers.length === 0 ? "GitHub security gates passed." : blockers[0]!,
    { dependabot, codeScanning },
    "gh",
    blockers
  );
}

async function detectRelease(options: {
  ghCommand: string;
  cwd: string;
  repository: string | null;
  deliveryMode: DeliverTargetMode;
  requireRelease: boolean;
  requireTag: boolean;
  requireVersionMatch: boolean;
  requireChangelog: boolean;
  changelogPaths: string[];
}): Promise<GitHubGateEvaluation<GitHubReleaseRecord | null>> {
  const { ghCommand, cwd, repository, deliveryMode, requireRelease, requireTag, requireVersionMatch, requireChangelog, changelogPaths } =
    options;
  const required = requireRelease || requireTag || requireVersionMatch || requireChangelog || deliveryMode === "release";
  if (!required) {
    return gate(false, "not-applicable", "Release artifacts were not required for this deliver run.", null, "config");
  }

  const packageVersion = await readPackageVersion(cwd);
  const expectedTag = packageVersion ? `v${packageVersion}` : null;
  const matchedChangelogPaths =
    requireChangelog && packageVersion ? await detectChangelogPaths(cwd, packageVersion, changelogPaths) : [];
  const blockers: string[] = [];
  let tagExists = false;

  if (!expectedTag) {
    blockers.push("package.json version could not be read, so no expected release tag was available.");
  }
  if (requireVersionMatch && !packageVersion) {
    blockers.push("package.json version could not be read for release verification.");
  }
  if (requireChangelog && matchedChangelogPaths.length === 0) {
    blockers.push(`Configured changelog paths do not mention version ${packageVersion ?? "(missing version)"}.`);
  }

  if (!repository || !expectedTag) {
    return gate(required, "blocked", blockers[0] ?? "Release state could not be inspected.", null, repository ? "git" : "none", blockers);
  }

  try {
    await runGit(cwd, ["rev-parse", `refs/tags/${expectedTag}`]);
    tagExists = true;
  } catch (error) {
    if (requireTag) {
      blockers.push(`Expected release tag ${expectedTag} was not found locally.`);
      if (error instanceof Error) {
        blockers.push(error.message);
      }
    }
  }

  try {
    const { stdout } = await runGh(ghCommand, cwd, ["release", "view", expectedTag, "--repo", repository, "--json", "tagName,name,url,isDraft,isPrerelease,publishedAt"]);
    const raw = JSON.parse(stdout) as {
      tagName: string;
      name?: string | null;
      url?: string;
      isDraft?: boolean;
      isPrerelease?: boolean;
      publishedAt?: string | null;
    };
    const release: GitHubReleaseRecord = {
      tagName: raw.tagName,
      name: raw.name ?? null,
      ...(raw.url ? { url: raw.url } : {}),
      isDraft: raw.isDraft ?? false,
      isPrerelease: raw.isPrerelease ?? false,
      publishedAt: raw.publishedAt ?? null,
      version: packageVersion,
      changelogPaths: matchedChangelogPaths,
      tagExists,
      releaseExists: true
    };
    if (requireRelease && release.isDraft) {
      blockers.push(`GitHub release ${expectedTag} is still a draft.`);
    }

    return gate(
      true,
      blockers.length === 0 ? "ready" : "blocked",
      blockers.length === 0 ? `Release evidence found for ${expectedTag}.` : blockers[0]!,
      release,
      "gh",
      blockers
    );
  } catch (error) {
    const release: GitHubReleaseRecord = {
      tagName: expectedTag,
      version: packageVersion,
      changelogPaths: matchedChangelogPaths,
      tagExists,
      releaseExists: false
    };
    if (requireRelease) {
      blockers.push(`GitHub release ${expectedTag} was not found.`);
    }
    return gate(
      true,
      blockers.length === 0 ? "ready" : "blocked",
      blockers.length === 0 ? `Release tag ${expectedTag} exists and no GitHub release was required.` : blockers[0]!,
      release,
      requireRelease ? "gh" : "git",
      blockers,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function performGitHubDeliverMutations(options: PerformGitHubMutationOptions): Promise<PerformGitHubMutationResult> {
  const policy = options.policy;
  const enabled = Boolean(
    policy.pushBranch ||
      policy.commitChanges ||
      policy.createPullRequest ||
      policy.watchChecks ||
      (policy.updatePullRequest && (policy.pushBranch || policy.createPullRequest || policy.commitChanges))
  );
  const remote = await resolveRemoteForPush(options.cwd);
  const { repository } = await detectRepository(options.cwd, policy.repository);
  const ghCommand = policy.command || "gh";
  const defaultBranch = await detectDefaultBranch(ghCommand, options.cwd, repository);
  let branch = options.gitBranch;
  let createdBranch = false;
  let pushed = false;
  let commitCreated = false;
  let commitSha: string | undefined;
  let commitMessage: string | undefined;
  let pullRequestCreated = false;
  let pullRequestUpdated = false;
  let pullRequestRecord: GitHubPullRequestRecord | null = null;
  const blockers: string[] = [];

  if (!enabled) {
    return {
      branch,
      record: {
        enabled: false,
        branch: {
          initial: options.gitBranch,
          current: options.gitBranch,
          created: false,
          pushed: false,
          remote
        },
        commit: {
          created: false,
          changedFiles: await listChangedFiles(options.cwd)
        },
        pullRequest: {
          created: false,
          updated: false
        },
        checks: {
          watched: false,
          polls: 0,
          completed: false,
          summary: "GitHub mutations are disabled by policy."
        },
        blockers: [],
        summary: "GitHub mutations are disabled by policy."
      }
    };
  }

  const baseBranch = policy.pullRequestBase || defaultBranch || "main";
  const changedFiles = await listChangedFiles(options.cwd);

  try {
    if (policy.pushBranch && (branch === baseBranch || branch === defaultBranch)) {
      branch = buildMutationBranchName(policy.branchPrefix || "cstack", options.runId, options.input);
      await runGit(options.cwd, ["checkout", "-b", branch]);
      createdBranch = true;
    }
  } catch (error) {
    blockers.push(`Failed to create branch ${branch}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (policy.commitChanges && blockers.length === 0) {
    const dirtyFiles = await listChangedFiles(options.cwd);
    if (dirtyFiles.length > 0) {
      try {
        commitMessage = buildCommitMessage(options.input, options.issueNumbers);
        await runGit(options.cwd, ["add", "-A"]);
        try {
          await runGit(options.cwd, ["reset", "--", ".cstack/runs"]);
        } catch {}
        await runGit(options.cwd, ["commit", "-m", commitMessage]);
        commitCreated = true;
        commitSha = await currentHeadSha(options.cwd);
      } catch (error) {
        blockers.push(`Failed to commit deliver changes: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (policy.pushBranch && blockers.length === 0) {
    if (!remote) {
      blockers.push("No git remote is configured for pushing deliver branches.");
    } else {
      try {
        await runGit(options.cwd, ["push", "--set-upstream", remote, branch]);
        pushed = true;
      } catch (error) {
        blockers.push(`Failed to push branch ${branch}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const prTitle = buildPullRequestTitle(options.input, options.issueNumbers);
  const prBody = buildPullRequestBody({
    input: options.input,
    issueNumbers: options.issueNumbers,
    buildSummary: options.buildSummary,
    reviewVerdict: options.reviewVerdict,
    verificationRecord: options.verificationRecord,
    ...(options.linkedRunId ? { linkedRunId: options.linkedRunId } : {})
  });
  await fs.writeFile(options.pullRequestBodyPath, `${prBody}\n`, "utf8");

  if ((policy.createPullRequest || policy.updatePullRequest) && blockers.length === 0) {
    if (!repository) {
      blockers.push("GitHub repository could not be resolved for PR mutation.");
    } else if (branch === baseBranch) {
      blockers.push(`Cannot create or update a pull request when head branch ${branch} matches base branch ${baseBranch}.`);
    } else {
      try {
        pullRequestRecord = await readPullRequest({
          ghCommand,
          cwd: options.cwd,
          repository,
          gitBranch: branch
        });
      } catch {}

      try {
        if (!pullRequestRecord && policy.createPullRequest) {
          await runGh(ghCommand, options.cwd, [
            "pr",
            "create",
            "--repo",
            repository,
            "--base",
            baseBranch,
            "--head",
            branch,
            "--title",
            prTitle,
            "--body-file",
            options.pullRequestBodyPath,
            ...(policy.pullRequestDraft ? ["--draft"] : [])
          ]);
          pullRequestCreated = true;
        } else if (pullRequestRecord && policy.updatePullRequest) {
          await runGh(ghCommand, options.cwd, [
            "pr",
            "edit",
            String(pullRequestRecord.number),
            "--repo",
            repository,
            "--title",
            prTitle,
            "--body-file",
            options.pullRequestBodyPath
          ]);
          pullRequestUpdated = true;
        }
      } catch (error) {
        blockers.push(`Failed to create or update the pull request: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        pullRequestRecord = await readPullRequest({
          ghCommand,
          cwd: options.cwd,
          repository,
          gitBranch: branch
        });
      } catch (error) {
        if (policy.createPullRequest || policy.updatePullRequest) {
          blockers.push(`Failed to load pull request state after mutation: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  let checksSummary = "Required checks were not watched.";
  let checksCompleted = false;
  let checkPolls = 0;
  if (policy.watchChecks && blockers.length === 0 && repository && pullRequestRecord) {
    const watchResult = await waitForRequiredChecks({
      ghCommand,
      cwd: options.cwd,
      repository,
      pullRequestNumber: pullRequestRecord.number,
      timeoutSeconds: policy.checkWatchTimeoutSeconds ?? 600,
      pollSeconds: policy.checkWatchPollSeconds ?? 15
    });
    checkPolls = watchResult.polls;
    checksCompleted = watchResult.completed;
    checksSummary = watchResult.summary;
  }

  return {
    branch,
    record: {
      enabled: true,
      branch: {
        initial: options.gitBranch,
        current: branch,
        created: createdBranch,
        pushed,
        remote
      },
      commit: {
        created: commitCreated,
        ...(commitSha ? { sha: commitSha } : {}),
        ...(commitMessage ? { message: commitMessage } : {}),
        changedFiles
      },
      pullRequest: {
        created: pullRequestCreated,
        updated: pullRequestUpdated,
        ...(pullRequestRecord?.number ? { number: pullRequestRecord.number } : {}),
        ...(pullRequestRecord?.url ? { url: pullRequestRecord.url } : {}),
        ...(prTitle ? { title: prTitle } : {}),
        ...(pullRequestRecord?.baseRefName ? { baseRefName: pullRequestRecord.baseRefName } : {}),
        ...(pullRequestRecord?.headRefName ? { headRefName: pullRequestRecord.headRefName } : {}),
        ...(typeof policy.pullRequestDraft === "boolean" ? { draft: policy.pullRequestDraft } : {})
      },
      checks: {
        watched: Boolean(policy.watchChecks && pullRequestRecord),
        polls: checkPolls,
        completed: checksCompleted,
        summary: checksSummary
      },
      blockers,
      summary:
        blockers.length === 0
          ? pullRequestRecord?.url
            ? `Branch ${branch} is pushed and PR ${pullRequestRecord.url} is available.`
            : `Branch ${branch} prepared without GitHub blockers.`
          : blockers[0]!
    }
  };
}

export async function collectGitHubDeliveryEvidence(options: CollectGitHubDeliveryOptions): Promise<CollectGitHubDeliveryResult> {
  const policy = structuredClone(options.policy);
  const inferredIssueNumbers = [
    ...options.issueNumbers,
    ...issueNumbersFromPrompt(options.input ?? ""),
    ...issueNumbersFromPrompt(options.linkedArtifactBody ?? "")
  ];
  const enabled = Boolean(
    policy.enabled ||
      options.deliveryMode === "release" ||
      inferredIssueNumbers.length > 0 ||
      policy.pushBranch ||
      policy.commitChanges ||
      policy.createPullRequest ||
      (policy.updatePullRequest && (policy.prRequired || policy.pushBranch || policy.createPullRequest || policy.commitChanges)) ||
      policy.watchChecks ||
      policy.prRequired ||
      policy.linkedIssuesRequired ||
      (policy.requiredChecks?.length ?? 0) > 0 ||
      (policy.requiredWorkflows?.length ?? 0) > 0 ||
      policy.requireTag ||
      policy.requireRelease ||
      policy.requireVersionMatch ||
      policy.requireChangelog ||
      policy.security?.requireDependabot ||
      policy.security?.requireCodeScanning
  );

  if (!enabled) {
    const observedAt = new Date().toISOString();
    const mutationRecord =
      options.mutationRecord ??
      ({
        enabled: false,
        branch: {
          initial: options.gitBranch,
          current: options.gitBranch,
          created: false,
          pushed: false
        },
        commit: {
          created: false,
          changedFiles: []
        },
        pullRequest: {
          created: false,
          updated: false
        },
        checks: {
          watched: false,
          polls: 0,
          completed: false,
          summary: "GitHub mutations are disabled by policy."
        },
        blockers: [],
        summary: "GitHub mutations are disabled by policy."
      } satisfies GitHubMutationRecord);
    return {
      record: {
        repository: null,
        mode: options.deliveryMode,
        branch: {
          name: options.gitBranch,
          headSha: ""
        },
        requestedPolicy: policy,
        issueReferences: [],
        branchState: {
          required: false,
          status: "not-applicable",
          summary: "GitHub delivery policy is disabled for this run.",
          blockers: [],
          observedAt,
          source: "config",
          observed: {
            current: options.gitBranch,
            headSha: ""
          }
        },
        pullRequest: gate(false, "not-applicable", "Pull request policy is disabled for this run.", null, "config"),
        issues: gate(false, "not-applicable", "Issue policy is disabled for this run.", [], "config"),
        checks: gate(false, "not-applicable", "Check policy is disabled for this run.", [], "config"),
        actions: gate(false, "not-applicable", "Actions policy is disabled for this run.", [], "config"),
        release: gate(false, "not-applicable", "Release policy is disabled for this run.", null, "config"),
        security: gate(false, "not-applicable", "Security policy is disabled for this run.", { dependabot: [], codeScanning: [] }, "config"),
        overall: {
          status: "ready",
          summary: "GitHub delivery policy is disabled for this run.",
          blockers: [],
          observedAt
        },
        mutation: mutationRecord,
        limitations: ["GitHub delivery evidence was skipped because the deliver GitHub policy is disabled."]
      },
      artifacts: {
        githubState: {
          policyEnabled: false
        },
        mutation: mutationRecord,
        pullRequest: gate(false, "not-applicable", "Pull request policy is disabled for this run.", null, "config"),
        issues: gate(false, "not-applicable", "Issue policy is disabled for this run.", [], "config"),
        checks: gate(false, "not-applicable", "Check policy is disabled for this run.", [], "config"),
        actions: gate(false, "not-applicable", "Actions policy is disabled for this run.", [], "config"),
        security: gate(false, "not-applicable", "Security policy is disabled for this run.", { dependabot: [], codeScanning: [] }, "config"),
        release: gate(false, "not-applicable", "Release policy is disabled for this run.", null, "config")
      }
    };
  }

  const ghCommand = policy.command || "gh";
  const { repository, remoteUrl } = await detectRepository(options.cwd, policy.repository);
  const headSha = await detectHeadSha(options.cwd);
  const defaultBranch = await detectDefaultBranch(ghCommand, options.cwd, repository);

  const branchState = gate(
    true,
    repository && options.gitBranch && headSha ? "ready" : "blocked",
    repository && options.gitBranch && headSha
      ? `Resolved ${repository} on branch ${options.gitBranch}.`
      : "GitHub repository, branch, or HEAD SHA could not be resolved.",
    {
      current: options.gitBranch,
      headSha,
      defaultBranch
    },
    repository ? "git" : "none",
    repository && options.gitBranch && headSha ? [] : ["GitHub repository, branch, or HEAD SHA could not be resolved."]
  );

  const pullRequest = await detectPullRequest({
    ghCommand,
    cwd: options.cwd,
    repository,
    gitBranch: options.gitBranch,
    requireApprovedReview: Boolean(policy.requireApprovedReview),
    prRequired: options.deliveryMode === "merge-ready" ? Boolean(policy.prRequired) : false
  });

  const issues = await detectIssues({
    ghCommand,
    cwd: options.cwd,
    repository,
    requestedNumbers: options.issueNumbers,
    pr: pullRequest.observed,
    linkedIssuesRequired: Boolean(policy.linkedIssuesRequired),
    requiredIssueState: policy.requiredIssueState,
    input: `${options.input ?? ""}\n${options.linkedArtifactBody ?? ""}`
  });

  const checks = await detectChecks({
    ghCommand,
    cwd: options.cwd,
    repository,
    gitBranch: options.gitBranch,
    requiredChecks: policy.requiredChecks ?? [],
    pr: pullRequest.observed
  });

  const actions = await detectActions({
    ghCommand,
    cwd: options.cwd,
    repository,
    gitBranch: options.gitBranch,
    headSha,
    requiredWorkflows: policy.requiredWorkflows ?? []
  });

  const security = await detectSecurity({
    ghCommand,
    cwd: options.cwd,
    repository,
    config: policy.security
  });

  const release = await detectRelease({
    ghCommand,
    cwd: options.cwd,
    repository,
    deliveryMode: options.deliveryMode,
    requireRelease: Boolean(policy.requireRelease || options.deliveryMode === "release"),
    requireTag: Boolean(policy.requireTag || options.deliveryMode === "release"),
    requireVersionMatch: Boolean(policy.requireVersionMatch || options.deliveryMode === "release"),
    requireChangelog: Boolean(policy.requireChangelog),
    changelogPaths: policy.changelogPaths && policy.changelogPaths.length > 0 ? policy.changelogPaths : ["README.md"]
  });

  const mutationRecord =
    options.mutationRecord ??
    ({
      enabled: false,
      branch: {
        initial: options.gitBranch,
        current: options.gitBranch,
        created: false,
        pushed: false
      },
      commit: {
        created: false,
        changedFiles: []
      },
      pullRequest: {
        created: false,
        updated: false
      },
      checks: {
        watched: false,
        polls: 0,
        completed: false,
        summary: "GitHub mutations were not requested for this run."
      },
      blockers: [],
      summary: "GitHub mutations were not requested for this run."
    } satisfies GitHubMutationRecord);

  const blockers = [
    ...mutationRecord.blockers,
    ...branchState.blockers,
    ...pullRequest.blockers,
    ...issues.blockers,
    ...checks.blockers,
    ...actions.blockers,
    ...security.blockers,
    ...release.blockers
  ];

  const record: GitHubDeliveryRecord = {
    repository,
    mode: options.deliveryMode,
    branch: {
      name: options.gitBranch,
      headSha,
      defaultBranch
    },
    requestedPolicy: policy,
    issueReferences: issues.observed.map((issue) => issue.number),
    branchState,
    pullRequest,
    issues,
    checks,
    actions,
    release,
    security,
    mutation: mutationRecord,
    overall: {
      status: blockers.length === 0 ? "ready" : "blocked",
      summary:
        blockers.length === 0
          ? `GitHub delivery policy passed for ${repository ?? "unknown repository"}.`
          : blockers[0]!,
      blockers,
      observedAt: new Date().toISOString()
    },
    limitations: [
      remoteUrl ? `origin remote: ${remoteUrl}` : "origin remote could not be resolved",
      "GitHub evidence is based on current observable git and gh state; unavailable permissions are reported as blockers when the policy requires those checks."
    ]
  };

  return {
    record,
    artifacts: {
      githubState: {
        repository,
        remoteUrl,
        branch: options.gitBranch,
        defaultBranch,
        headSha,
        policy
      },
      mutation: mutationRecord,
      pullRequest,
      issues,
      checks,
      actions,
      security,
      release
    }
  };
}

export async function collectGitHubDeliveryRecord(options: {
  cwd: string;
  input: string;
  policy: DeliverGitHubConfig;
  mode: DeliverTargetMode;
  explicitIssueNumbers: number[];
  linkedArtifactBody?: string;
}): Promise<GitHubDeliveryRecord> {
  const gitBranch = (
    await runGit(options.cwd, ["branch", "--show-current"]).catch(() => ({
      stdout: "",
      stderr: ""
    }))
  ).stdout.trim();

  const result = await collectGitHubDeliveryEvidence({
    cwd: options.cwd,
    gitBranch: gitBranch || "unknown",
    deliveryMode: options.mode,
    issueNumbers: options.explicitIssueNumbers,
    policy: options.policy,
    input: options.input,
    ...(options.linkedArtifactBody ? { linkedArtifactBody: options.linkedArtifactBody } : {})
  });

  return result.record;
}
