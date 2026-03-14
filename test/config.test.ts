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
    expect(sources).toHaveLength(2);
  });
});
