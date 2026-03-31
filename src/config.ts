import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import * as TOML from "@iarna/toml";
import type { ConfigProvenance, ConfigValueSource, CstackConfig } from "./types.js";

const DEFAULT_CONFIG: CstackConfig = {
  codex: {
    command: process.env.CSTACK_CODEX_BIN || "codex",
    sandbox: "danger-full-access",
    extraArgs: []
  },
  workflows: {
    spec: {
      timeoutSeconds: 600,
      capabilities: {
        allowed: ["shell", "github"],
        defaultRequested: ["shell"]
      },
      delegation: {
        enabled: false,
        maxAgents: 0
      }
    },
    discover: {
      capabilities: {
        allowed: ["shell", "web", "github", "browser"],
        defaultRequested: ["shell"]
      },
      delegation: {
        enabled: true,
        maxAgents: 2
      },
      research: {
        enabled: true,
        allowWeb: false
      },
      timeoutSeconds: 600
    },
    build: {
      mode: "interactive",
      verificationCommands: [],
      allowDirty: false,
      maxCodexAttempts: 3,
      timeoutSeconds: 900,
      capabilities: {
        allowed: ["shell", "github"],
        defaultRequested: ["shell"]
      },
      delegation: {
        enabled: false,
        maxAgents: 0
      }
    },
    review: {
      mode: "exec",
      verificationCommands: [],
      allowDirty: true,
      timeoutSeconds: 600,
      capabilities: {
        allowed: ["shell", "github"],
        defaultRequested: ["shell"]
      },
      delegation: {
        enabled: true,
        maxAgents: 3
      }
    },
    ship: {
      mode: "exec",
      verificationCommands: [],
      allowDirty: true,
      timeoutSeconds: 600,
      capabilities: {
        allowed: ["shell", "github"],
        defaultRequested: ["shell", "github"]
      },
      delegation: {
        enabled: false,
        maxAgents: 0
      }
    },
    deliver: {
      mode: "interactive",
      verificationCommands: [],
      allowDirty: true,
      timeoutSeconds: 900,
      capabilities: {
        allowed: ["shell", "github", "browser"],
        defaultRequested: ["shell", "github"]
      },
      stageTimeoutSeconds: {
        build: 900,
        validation: 300,
        review: 600,
        ship: 600
      },
      delegation: {
        enabled: true,
        maxAgents: 4
      },
      validation: {
        enabled: true,
        mode: "smart",
        requireCiParity: true,
        maxAgents: 5,
        allowWorkflowMutation: true,
        allowTestScaffolding: true,
        coverage: {
          requireSummary: true,
          minimumSignal: "strong"
        },
        mobile: {
          allowMacosRunners: true,
          allowAndroidEmulator: true,
          allowIosSimulator: true
        }
      },
      github: {
        enabled: false,
        mode: "merge-ready",
        pushBranch: false,
        branchPrefix: "cstack",
        commitChanges: false,
        createPullRequest: false,
        updatePullRequest: true,
        pullRequestBase: "main",
        pullRequestDraft: false,
        watchChecks: false,
        checkWatchTimeoutSeconds: 600,
        checkWatchPollSeconds: 15,
        prRequired: false,
        requireApprovedReview: false,
        linkedIssuesRequired: false,
        requiredIssueState: "linked",
        requiredChecks: [],
        requiredWorkflows: [],
        requireRelease: false,
        requireTag: false,
        requireVersionMatch: false,
        requireChangelog: false,
        changelogPaths: ["README.md"],
        security: {
          requireDependabot: false,
          requireCodeScanning: false,
          blockSeverities: ["high", "critical"]
        }
      }
    }
  },
  verification: {
    defaultCommands: []
  }
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasConfigPath(value: unknown, pathParts: string[]): boolean {
  let current = value;
  for (const pathPart of pathParts) {
    if (!isObject(current) || !(pathPart in current)) {
      return false;
    }
    current = current[pathPart];
  }
  return true;
}

function mergeObjects<T>(base: T, update: unknown): T {
  if (!isObject(base) || !isObject(update)) {
    return (update as T) ?? base;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(update)) {
    const current = merged[key];
    if (isObject(current) && isObject(value)) {
      merged[key] = mergeObjects(current, value);
      continue;
    }
    merged[key] = value;
  }
  return merged as T;
}

const WORKFLOW_NAMES = ["spec", "discover", "build", "review", "ship", "deliver"] as const;
const WORKFLOW_MODES = new Set(["exec", "interactive"]);
const CODEX_SANDBOXES = new Set(["read-only", "workspace-write", "danger-full-access"]);
const DELIVER_VALIDATION_MODES = new Set(["smart", "plan-only"]);
const COVERAGE_SIGNALS = new Set(["basic", "strong"]);
const DELIVER_TARGET_MODES = new Set(["merge-ready", "release"]);
const REQUIRED_ISSUE_STATES = new Set(["linked", "closed"]);
const STAGE_TIMEOUT_KEYS = new Set(["build", "validation", "review", "ship"]);
const BLOCK_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function describeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function formatConfigError(source: string, configPath: string, message: string): Error {
  return new Error(`Invalid config in ${source} at ${configPath}: ${message}`);
}

function expectObject(source: string, configPath: string, value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw formatConfigError(source, configPath, `expected table/object, received ${describeValue(value)}`);
  }
  return value;
}

function validateString(source: string, configPath: string, value: unknown): void {
  if (typeof value !== "string") {
    throw formatConfigError(source, configPath, `expected string, received ${describeValue(value)}`);
  }
}

function validateBoolean(source: string, configPath: string, value: unknown): void {
  if (typeof value !== "boolean") {
    throw formatConfigError(source, configPath, `expected boolean, received ${describeValue(value)}`);
  }
}

function validateStringArray(source: string, configPath: string, value: unknown): void {
  if (!Array.isArray(value)) {
    throw formatConfigError(source, configPath, `expected string array, received ${describeValue(value)}`);
  }
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      throw formatConfigError(source, `${configPath}[${index}]`, `expected string, received ${describeValue(entry)}`);
    }
  }
}

function validateInteger(source: string, configPath: string, value: unknown, options?: { minimum?: number }): void {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw formatConfigError(source, configPath, `expected integer, received ${describeValue(value)}`);
  }
  if (options?.minimum !== undefined && value < options.minimum) {
    throw formatConfigError(source, configPath, `expected integer >= ${options.minimum}, received ${value}`);
  }
}

function validateEnum(source: string, configPath: string, value: unknown, allowed: Set<string>): void {
  if (typeof value !== "string") {
    throw formatConfigError(source, configPath, `expected string enum, received ${describeValue(value)}`);
  }
  if (!allowed.has(value)) {
    throw formatConfigError(
      source,
      configPath,
      `expected one of ${Array.from(allowed).map((entry) => `"${entry}"`).join(", ")}, received "${value}"`
    );
  }
}

function validateDelegationConfig(source: string, configPath: string, value: unknown): void {
  const objectValue = expectObject(source, configPath, value);
  if ("enabled" in objectValue) {
    validateBoolean(source, `${configPath}.enabled`, objectValue.enabled);
  }
  if ("maxAgents" in objectValue) {
    validateInteger(source, `${configPath}.maxAgents`, objectValue.maxAgents, { minimum: 0 });
  }
}

function validateResearchConfig(source: string, configPath: string, value: unknown): void {
  const objectValue = expectObject(source, configPath, value);
  if ("enabled" in objectValue) {
    validateBoolean(source, `${configPath}.enabled`, objectValue.enabled);
  }
  if ("allowWeb" in objectValue) {
    validateBoolean(source, `${configPath}.allowWeb`, objectValue.allowWeb);
  }
}

function validateCapabilitiesConfig(source: string, configPath: string, value: unknown): void {
  const objectValue = expectObject(source, configPath, value);
  if ("allowed" in objectValue) {
    validateStringArray(source, `${configPath}.allowed`, objectValue.allowed);
  }
  if ("defaultRequested" in objectValue) {
    validateStringArray(source, `${configPath}.defaultRequested`, objectValue.defaultRequested);
  }
}

function validateDeliverValidationConfig(source: string, configPath: string, value: unknown): void {
  const objectValue = expectObject(source, configPath, value);
  if ("enabled" in objectValue) {
    validateBoolean(source, `${configPath}.enabled`, objectValue.enabled);
  }
  if ("mode" in objectValue) {
    validateEnum(source, `${configPath}.mode`, objectValue.mode, DELIVER_VALIDATION_MODES);
  }
  if ("requireCiParity" in objectValue) {
    validateBoolean(source, `${configPath}.requireCiParity`, objectValue.requireCiParity);
  }
  if ("maxAgents" in objectValue) {
    validateInteger(source, `${configPath}.maxAgents`, objectValue.maxAgents, { minimum: 0 });
  }
  if ("allowWorkflowMutation" in objectValue) {
    validateBoolean(source, `${configPath}.allowWorkflowMutation`, objectValue.allowWorkflowMutation);
  }
  if ("allowTestScaffolding" in objectValue) {
    validateBoolean(source, `${configPath}.allowTestScaffolding`, objectValue.allowTestScaffolding);
  }
  if ("coverage" in objectValue) {
    const coverage = expectObject(source, `${configPath}.coverage`, objectValue.coverage);
    if ("requireSummary" in coverage) {
      validateBoolean(source, `${configPath}.coverage.requireSummary`, coverage.requireSummary);
    }
    if ("minimumSignal" in coverage) {
      validateEnum(source, `${configPath}.coverage.minimumSignal`, coverage.minimumSignal, COVERAGE_SIGNALS);
    }
  }
  if ("mobile" in objectValue) {
    const mobile = expectObject(source, `${configPath}.mobile`, objectValue.mobile);
    if ("allowMacosRunners" in mobile) {
      validateBoolean(source, `${configPath}.mobile.allowMacosRunners`, mobile.allowMacosRunners);
    }
    if ("allowAndroidEmulator" in mobile) {
      validateBoolean(source, `${configPath}.mobile.allowAndroidEmulator`, mobile.allowAndroidEmulator);
    }
    if ("allowIosSimulator" in mobile) {
      validateBoolean(source, `${configPath}.mobile.allowIosSimulator`, mobile.allowIosSimulator);
    }
  }
}

function validateDeliverGitHubConfig(source: string, configPath: string, value: unknown): void {
  const objectValue = expectObject(source, configPath, value);
  if ("enabled" in objectValue) {
    validateBoolean(source, `${configPath}.enabled`, objectValue.enabled);
  }
  if ("command" in objectValue) {
    validateString(source, `${configPath}.command`, objectValue.command);
  }
  if ("repository" in objectValue) {
    validateString(source, `${configPath}.repository`, objectValue.repository);
  }
  if ("mode" in objectValue) {
    validateEnum(source, `${configPath}.mode`, objectValue.mode, DELIVER_TARGET_MODES);
  }
  if ("pushBranch" in objectValue) {
    validateBoolean(source, `${configPath}.pushBranch`, objectValue.pushBranch);
  }
  if ("branchPrefix" in objectValue) {
    validateString(source, `${configPath}.branchPrefix`, objectValue.branchPrefix);
  }
  if ("commitChanges" in objectValue) {
    validateBoolean(source, `${configPath}.commitChanges`, objectValue.commitChanges);
  }
  if ("createPullRequest" in objectValue) {
    validateBoolean(source, `${configPath}.createPullRequest`, objectValue.createPullRequest);
  }
  if ("updatePullRequest" in objectValue) {
    validateBoolean(source, `${configPath}.updatePullRequest`, objectValue.updatePullRequest);
  }
  if ("pullRequestBase" in objectValue) {
    validateString(source, `${configPath}.pullRequestBase`, objectValue.pullRequestBase);
  }
  if ("pullRequestDraft" in objectValue) {
    validateBoolean(source, `${configPath}.pullRequestDraft`, objectValue.pullRequestDraft);
  }
  if ("watchChecks" in objectValue) {
    validateBoolean(source, `${configPath}.watchChecks`, objectValue.watchChecks);
  }
  if ("checkWatchTimeoutSeconds" in objectValue) {
    validateInteger(source, `${configPath}.checkWatchTimeoutSeconds`, objectValue.checkWatchTimeoutSeconds, { minimum: 0 });
  }
  if ("checkWatchPollSeconds" in objectValue) {
    validateInteger(source, `${configPath}.checkWatchPollSeconds`, objectValue.checkWatchPollSeconds, { minimum: 0 });
  }
  if ("prRequired" in objectValue) {
    validateBoolean(source, `${configPath}.prRequired`, objectValue.prRequired);
  }
  if ("requireApprovedReview" in objectValue) {
    validateBoolean(source, `${configPath}.requireApprovedReview`, objectValue.requireApprovedReview);
  }
  if ("linkedIssuesRequired" in objectValue) {
    validateBoolean(source, `${configPath}.linkedIssuesRequired`, objectValue.linkedIssuesRequired);
  }
  if ("requiredIssueState" in objectValue) {
    validateEnum(source, `${configPath}.requiredIssueState`, objectValue.requiredIssueState, REQUIRED_ISSUE_STATES);
  }
  if ("requiredChecks" in objectValue) {
    validateStringArray(source, `${configPath}.requiredChecks`, objectValue.requiredChecks);
  }
  if ("requiredWorkflows" in objectValue) {
    validateStringArray(source, `${configPath}.requiredWorkflows`, objectValue.requiredWorkflows);
  }
  if ("requireRelease" in objectValue) {
    validateBoolean(source, `${configPath}.requireRelease`, objectValue.requireRelease);
  }
  if ("requireTag" in objectValue) {
    validateBoolean(source, `${configPath}.requireTag`, objectValue.requireTag);
  }
  if ("requireVersionMatch" in objectValue) {
    validateBoolean(source, `${configPath}.requireVersionMatch`, objectValue.requireVersionMatch);
  }
  if ("requireChangelog" in objectValue) {
    validateBoolean(source, `${configPath}.requireChangelog`, objectValue.requireChangelog);
  }
  if ("changelogPaths" in objectValue) {
    validateStringArray(source, `${configPath}.changelogPaths`, objectValue.changelogPaths);
  }
  if ("security" in objectValue) {
    const security = expectObject(source, `${configPath}.security`, objectValue.security);
    if ("requireDependabot" in security) {
      validateBoolean(source, `${configPath}.security.requireDependabot`, security.requireDependabot);
    }
    if ("requireCodeScanning" in security) {
      validateBoolean(source, `${configPath}.security.requireCodeScanning`, security.requireCodeScanning);
    }
    if ("blockSeverities" in security) {
      validateStringArray(source, `${configPath}.security.blockSeverities`, security.blockSeverities);
      const blockSeverities = security.blockSeverities as string[];
      for (const [index, entry] of blockSeverities.entries()) {
        validateEnum(source, `${configPath}.security.blockSeverities[${index}]`, entry, BLOCK_SEVERITIES);
      }
    }
  }
}

function validateWorkflowConfig(source: string, workflowName: string, value: unknown): void {
  const configPath = `workflows.${workflowName}`;
  const objectValue = expectObject(source, configPath, value);
  if ("mode" in objectValue) {
    validateEnum(source, `${configPath}.mode`, objectValue.mode, WORKFLOW_MODES);
  }
  if ("verificationCommands" in objectValue) {
    validateStringArray(source, `${configPath}.verificationCommands`, objectValue.verificationCommands);
  }
  if ("allowDirty" in objectValue) {
    validateBoolean(source, `${configPath}.allowDirty`, objectValue.allowDirty);
  }
  if ("timeoutSeconds" in objectValue) {
    validateInteger(source, `${configPath}.timeoutSeconds`, objectValue.timeoutSeconds, { minimum: 1 });
  }
  if ("maxCodexAttempts" in objectValue) {
    validateInteger(source, `${configPath}.maxCodexAttempts`, objectValue.maxCodexAttempts, { minimum: 1 });
  }
  if ("stageTimeoutSeconds" in objectValue) {
    const stageTimeouts = expectObject(source, `${configPath}.stageTimeoutSeconds`, objectValue.stageTimeoutSeconds);
    for (const [stageName, timeout] of Object.entries(stageTimeouts)) {
      if (!STAGE_TIMEOUT_KEYS.has(stageName)) {
        throw formatConfigError(
          source,
          `${configPath}.stageTimeoutSeconds.${stageName}`,
          `unknown stage timeout key "${stageName}"`
        );
      }
      validateInteger(source, `${configPath}.stageTimeoutSeconds.${stageName}`, timeout, { minimum: 1 });
    }
  }
  if ("delegation" in objectValue) {
    validateDelegationConfig(source, `${configPath}.delegation`, objectValue.delegation);
  }
  if ("research" in objectValue) {
    validateResearchConfig(source, `${configPath}.research`, objectValue.research);
  }
  if ("capabilities" in objectValue) {
    validateCapabilitiesConfig(source, `${configPath}.capabilities`, objectValue.capabilities);
  }
  if ("validation" in objectValue) {
    validateDeliverValidationConfig(source, `${configPath}.validation`, objectValue.validation);
  }
  if ("github" in objectValue) {
    validateDeliverGitHubConfig(source, `${configPath}.github`, objectValue.github);
  }
}

function validateConfigDocument(source: string, value: unknown): void {
  const root = expectObject(source, "<root>", value);
  if ("codex" in root) {
    const codex = expectObject(source, "codex", root.codex);
    if ("command" in codex) {
      validateString(source, "codex.command", codex.command);
    }
    if ("model" in codex) {
      validateString(source, "codex.model", codex.model);
    }
    if ("profile" in codex) {
      validateString(source, "codex.profile", codex.profile);
    }
    if ("sandbox" in codex) {
      validateEnum(source, "codex.sandbox", codex.sandbox, CODEX_SANDBOXES);
    }
    if ("extraArgs" in codex) {
      validateStringArray(source, "codex.extraArgs", codex.extraArgs);
    }
  }
  if ("workflows" in root) {
    const workflows = expectObject(source, "workflows", root.workflows);
    for (const workflowName of WORKFLOW_NAMES) {
      if (workflowName in workflows) {
        validateWorkflowConfig(source, workflowName, workflows[workflowName]);
      }
    }
  }
  if ("verification" in root) {
    const verification = expectObject(source, "verification", root.verification);
    if ("defaultCommands" in verification) {
      validateStringArray(source, "verification.defaultCommands", verification.defaultCommands);
    }
  }
}

function createDefaultProvenance(): ConfigProvenance {
  return {
    codexSandbox: { source: "default" },
    workflowAllowDirty: {
      build: { source: "default" },
      ship: { source: "default" },
      deliver: { source: "default" }
    }
  };
}

function updateProvenanceFromDocument(
  provenance: ConfigProvenance,
  parsed: unknown,
  sourceKind: ConfigValueSource,
  sourcePath: string
): void {
  if (hasConfigPath(parsed, ["codex", "sandbox"])) {
    provenance.codexSandbox = { source: sourceKind, sourcePath };
  }
  for (const workflowName of ["build", "ship", "deliver"] as const) {
    if (hasConfigPath(parsed, ["workflows", workflowName, "allowDirty"])) {
      provenance.workflowAllowDirty[workflowName] = { source: sourceKind, sourcePath };
    }
  }
}

export async function loadConfig(cwd: string): Promise<{ config: CstackConfig; sources: string[]; provenance: ConfigProvenance }> {
  const repoPath = path.join(cwd, ".cstack", "config.toml");
  const userPath = path.join(os.homedir(), ".config", "cstack", "config.toml");
  let config = structuredClone(DEFAULT_CONFIG);
  const sources: string[] = [];
  const provenance = createDefaultProvenance();

  for (const [source, sourceKind] of [
    [userPath, "user"],
    [repoPath, "repo"]
  ] as const) {
    try {
      const raw = await fs.readFile(source, "utf8");
      const parsed = TOML.parse(raw) as unknown;
      validateConfigDocument(source, parsed);
      updateProvenanceFromDocument(provenance, parsed, sourceKind, source);
      config = mergeObjects(config, parsed);
      sources.push(source);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        if (error instanceof Error && error.message.startsWith("Invalid config in ")) {
          throw error;
        }
        throw new Error(`Failed to load config from ${source}: ${err.message}`);
      }
    }
  }

  return { config, sources, provenance };
}
