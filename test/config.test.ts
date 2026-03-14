import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { loadConfig } from "../src/config.js";

const originalHome = process.env.HOME;

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("loadConfig", () => {
  let repoDir: string;
  let homeDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir("cstack-repo-");
    homeDir = await makeTempDir("cstack-home-");
    process.env.HOME = homeDir;
    await fs.mkdir(path.join(repoDir, ".cstack"), { recursive: true });
    await fs.mkdir(path.join(homeDir, ".config", "cstack"), { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it("merges user and repo config with repo taking precedence", async () => {
    await fs.writeFile(
      path.join(homeDir, ".config", "cstack", "config.toml"),
      `
[codex]
model = "gpt-5"
sandbox = "read-only"
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(repoDir, ".cstack", "config.toml"),
      `
[codex]
sandbox = "workspace-write"

[workflows.spec.delegation]
enabled = true
maxAgents = 2

[workflows.discover.research]
allowWeb = true

[workflows.build]
mode = "exec"
verificationCommands = ["npm test"]

[workflows.deliver]
mode = "exec"
verificationCommands = ["npm run release:check"]

[workflows.deliver.github]
enabled = true
command = "gh"
repository = "ganesh47/cstack"
mode = "release"
pushBranch = true
branchPrefix = "deliver"
commitChanges = true
createPullRequest = true
updatePullRequest = true
pullRequestBase = "main"
pullRequestDraft = false
watchChecks = true
checkWatchTimeoutSeconds = 120
checkWatchPollSeconds = 5
prRequired = true
requireApprovedReview = true
linkedIssuesRequired = true
requiredIssueState = "closed"
requiredChecks = ["deliver/test"]
requiredWorkflows = ["Release"]
requireRelease = true
requireTag = true
requireVersionMatch = true
requireChangelog = true
changelogPaths = ["README.md", "CHANGELOG.md"]

[workflows.deliver.github.security]
requireDependabot = true
requireCodeScanning = true
blockSeverities = ["medium", "high", "critical"]
`,
      "utf8"
    );

    const { config, sources } = await loadConfig(repoDir);
    expect(config.codex.model).toBe("gpt-5");
    expect(config.codex.sandbox).toBe("workspace-write");
    expect(config.workflows.spec.delegation?.enabled).toBe(true);
    expect(config.workflows.spec.delegation?.maxAgents).toBe(2);
    expect(config.workflows.discover.research?.enabled).toBe(true);
    expect(config.workflows.discover.research?.allowWeb).toBe(true);
    expect(config.workflows.build.mode).toBe("exec");
    expect(config.workflows.build.verificationCommands).toEqual(["npm test"]);
    expect(config.workflows.deliver.mode).toBe("exec");
    expect(config.workflows.deliver.verificationCommands).toEqual(["npm run release:check"]);
    expect(config.workflows.deliver.delegation?.enabled).toBe(true);
    expect(config.workflows.deliver.delegation?.maxAgents).toBe(4);
    expect(config.workflows.deliver.github?.enabled).toBe(true);
    expect(config.workflows.deliver.github?.repository).toBe("ganesh47/cstack");
    expect(config.workflows.deliver.github?.mode).toBe("release");
    expect(config.workflows.deliver.github?.pushBranch).toBe(true);
    expect(config.workflows.deliver.github?.branchPrefix).toBe("deliver");
    expect(config.workflows.deliver.github?.commitChanges).toBe(true);
    expect(config.workflows.deliver.github?.createPullRequest).toBe(true);
    expect(config.workflows.deliver.github?.updatePullRequest).toBe(true);
    expect(config.workflows.deliver.github?.pullRequestBase).toBe("main");
    expect(config.workflows.deliver.github?.watchChecks).toBe(true);
    expect(config.workflows.deliver.github?.checkWatchTimeoutSeconds).toBe(120);
    expect(config.workflows.deliver.github?.checkWatchPollSeconds).toBe(5);
    expect(config.workflows.deliver.github?.prRequired).toBe(true);
    expect(config.workflows.deliver.github?.requiredChecks).toEqual(["deliver/test"]);
    expect(config.workflows.deliver.github?.requiredWorkflows).toEqual(["Release"]);
    expect(config.workflows.deliver.github?.requireVersionMatch).toBe(true);
    expect(config.workflows.deliver.github?.requireChangelog).toBe(true);
    expect(config.workflows.deliver.github?.changelogPaths).toEqual(["README.md", "CHANGELOG.md"]);
    expect(config.workflows.deliver.github?.security?.requireDependabot).toBe(true);
    expect(config.workflows.deliver.github?.security?.blockSeverities).toEqual(["medium", "high", "critical"]);
    expect(sources).toHaveLength(2);
  });

  it("provides stable deliver GitHub defaults when no config is present", async () => {
    const { config, sources } = await loadConfig(repoDir);

    expect(sources).toHaveLength(0);
    expect(config.workflows.deliver.github?.enabled).toBe(false);
    expect(config.workflows.deliver.github?.mode).toBe("merge-ready");
    expect(config.workflows.deliver.github?.pushBranch).toBe(false);
    expect(config.workflows.deliver.github?.branchPrefix).toBe("cstack");
    expect(config.workflows.deliver.github?.commitChanges).toBe(false);
    expect(config.workflows.deliver.github?.createPullRequest).toBe(false);
    expect(config.workflows.deliver.github?.updatePullRequest).toBe(true);
    expect(config.workflows.deliver.github?.pullRequestBase).toBe("main");
    expect(config.workflows.deliver.github?.pullRequestDraft).toBe(false);
    expect(config.workflows.deliver.github?.watchChecks).toBe(false);
    expect(config.workflows.deliver.github?.checkWatchTimeoutSeconds).toBe(600);
    expect(config.workflows.deliver.github?.checkWatchPollSeconds).toBe(15);
    expect(config.workflows.deliver.github?.prRequired).toBe(false);
    expect(config.workflows.deliver.github?.requiredChecks).toEqual([]);
    expect(config.workflows.deliver.github?.requiredWorkflows).toEqual([]);
    expect(config.workflows.deliver.github?.requireRelease).toBe(false);
    expect(config.workflows.deliver.github?.requireTag).toBe(false);
    expect(config.workflows.deliver.github?.requireVersionMatch).toBe(false);
    expect(config.workflows.deliver.github?.requireChangelog).toBe(false);
    expect(config.workflows.deliver.github?.changelogPaths).toEqual(["README.md"]);
    expect(config.workflows.deliver.github?.security?.requireDependabot).toBe(false);
    expect(config.workflows.deliver.github?.security?.requireCodeScanning).toBe(false);
    expect(config.workflows.deliver.github?.security?.blockSeverities).toEqual(["high", "critical"]);
  });
});
