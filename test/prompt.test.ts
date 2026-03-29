import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDiscoverLeadPrompt, buildDiscoverTrackPrompt, buildSpecPrompt } from "../src/prompt.js";
import type { CstackConfig, DiscoverResearchPlan, DiscoverDelegateResult } from "../src/types.js";

const config: CstackConfig = {
  codex: {
    command: "codex",
    sandbox: "workspace-write",
    extraArgs: []
  },
  workflows: {
    spec: { timeoutSeconds: 600, delegation: { enabled: false, maxAgents: 0 } },
    discover: {
      timeoutSeconds: 600,
      delegation: { enabled: true, maxAgents: 2 },
      research: { enabled: true, allowWeb: false }
    },
    build: { mode: "interactive", verificationCommands: [], allowDirty: false, timeoutSeconds: 900, delegation: { enabled: false, maxAgents: 0 } },
    review: { mode: "exec", verificationCommands: [], allowDirty: true, timeoutSeconds: 600, delegation: { enabled: true, maxAgents: 3 } },
    ship: { mode: "exec", verificationCommands: [], allowDirty: false, timeoutSeconds: 600, delegation: { enabled: false, maxAgents: 0 } },
    deliver: { mode: "interactive", verificationCommands: [], allowDirty: false, timeoutSeconds: 900, delegation: { enabled: true, maxAgents: 4 } }
  },
  verification: {
    defaultCommands: []
  }
};

describe("prompt builders", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-prompt-"));
    await fs.mkdir(path.join(repoDir, "specs", "001-plan-alignment"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "README.md"), "# External repo\n", "utf8");
    await fs.writeFile(path.join(repoDir, "AGENTS.md"), "# Repo guidance\n", "utf8");
    await fs.writeFile(path.join(repoDir, "specs", "001-plan-alignment", "spec.md"), "# External spec\n", "utf8");
    await fs.writeFile(path.join(repoDir, "specs", "001-plan-alignment", "research.md"), "# External research\n", "utf8");
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("uses existing repo context instead of leaking cstack-internal docs into spec prompts", async () => {
    const { prompt, context } = await buildSpecPrompt(repoDir, "Plan the first slice.", config);

    expect(prompt).not.toContain("docs/specs/cstack-spec-v0.1.md");
    expect(prompt).not.toContain("docs/research/gstack-codex-interaction-model.md");
    expect(prompt).toContain(path.join(repoDir, "specs", "001-plan-alignment", "spec.md"));
    expect(context).toContain("Reference files:");
  });

  it("adds explicit narrowing rules for broad gap-remediation spec prompts", async () => {
    const { prompt } = await buildSpecPrompt(repoDir, "What are the gaps in the current project and find them and fix them", config);

    expect(prompt).toContain("planning-only");
    expect(prompt).toContain("select exactly one slice to implement first");
    expect(prompt).toContain("one bounded change set");
    expect(prompt).toContain("avoid multi-epic roadmaps");
    expect(prompt).toContain("inspect at most 8 additional files");
    expect(prompt).toContain("run at most 6 shell commands");
    expect(prompt).toContain("## Required output headings");
    expect(prompt).toContain("## Selected First Slice");
    expect(prompt).toContain("## Files In Scope");
  });

  it("records linked planning issue context in spec prompts", async () => {
    const { prompt, context } = await buildSpecPrompt(repoDir, "Plan the first slice.", config, {
      planningIssueNumber: 123
    });

    expect(prompt).toContain("GitHub issue: #123");
    expect(context).toContain("Planning issue: #123");
  });

  it("omits missing cstack-specific references from discover prompts", async () => {
    const plan: DiscoverResearchPlan = {
      prompt: "Map the repo",
      decidedAt: new Date().toISOString(),
      mode: "research-team",
      delegationEnabled: true,
      maxTracks: 2,
      webResearchAllowed: false,
      requestedCapabilities: ["shell"],
      availableCapabilities: ["shell"],
      summary: "Research Lead with tracks: repo-explorer",
      tracks: [{ name: "repo-explorer", reason: "Inspect repo.", selected: true, requiresWeb: false }],
      limitations: []
    };

    const delegateResults: DiscoverDelegateResult[] = [
      {
        track: "repo-explorer",
        status: "completed",
        summary: "Repo mapped.",
        filesInspected: ["README.md"],
        commandsRun: ["rg --files"],
        sources: [{ title: "README", location: "README.md", kind: "file" }],
        findings: ["Repo structure mapped."],
        confidence: "high",
        unresolved: [],
        leaderDisposition: "accepted"
      }
    ];

    const trackPrompt = await buildDiscoverTrackPrompt({
      cwd: repoDir,
      input: "Map the repo",
      track: "repo-explorer",
      reason: "Inspect repo.",
      plan
    });
    const leadPrompt = await buildDiscoverLeadPrompt({
      cwd: repoDir,
      input: "Map the repo",
      plan,
      delegateResults
    });

    expect(trackPrompt.prompt).not.toContain("docs/specs/cstack-spec-v0.1.md");
    expect(trackPrompt.prompt).toContain(path.join(repoDir, "README.md"));
    expect(trackPrompt.prompt).toContain("inspect representative files only");
    expect(trackPrompt.prompt).toContain("top 3 gaps or first remediation candidates");
    expect(trackPrompt.prompt).toContain("after the first credible implementation-ready gap is supported by evidence");
    expect(trackPrompt.prompt).toContain("at most 6 commands");
    expect(trackPrompt.prompt).toContain("at most 8 files inspected");
    expect(trackPrompt.prompt).toContain("\"requestedCapabilities\"");
    expect(trackPrompt.prompt).toContain("\"availableCapabilities\"");
    expect(leadPrompt.prompt).not.toContain("docs/research/gstack-codex-interaction-model.md");
    expect(leadPrompt.prompt).toContain(path.join(repoDir, "specs", "001-plan-alignment", "research.md"));
    expect(leadPrompt.prompt).toContain("\"topFindings\"");
  });

  it("bounds single-agent discover lead prompts when no delegates are available", async () => {
    const plan: DiscoverResearchPlan = {
      prompt: "Map the repo",
      decidedAt: new Date().toISOString(),
      mode: "single-agent",
      delegationEnabled: true,
      maxTracks: 2,
      webResearchAllowed: false,
      requestedCapabilities: ["shell"],
      availableCapabilities: ["shell"],
      summary: "Research Lead only; delegated tracks suppressed",
      tracks: [{ name: "repo-explorer", reason: "Inspect repo.", selected: false, requiresWeb: false }],
      limitations: ["Delegated research was suppressed."]
    };

    const leadPrompt = await buildDiscoverLeadPrompt({
      cwd: repoDir,
      input: "Map the repo",
      plan,
      delegateResults: []
    });

    expect(leadPrompt.prompt).toContain("bounded first-pass discover sweep");
    expect(leadPrompt.prompt).toContain("top 3 gaps or first remediation candidates");
    expect(leadPrompt.prompt).toContain("after the first credible implementation-ready gap is supported by evidence");
    expect(leadPrompt.prompt).toContain("at most 6 commands");
    expect(leadPrompt.prompt).toContain("at most 8 files inspected");
  });
});
