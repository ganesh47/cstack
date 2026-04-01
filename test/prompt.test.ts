import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { buildBuildPrompt } from "../src/prompt.js";
import type { CstackConfig } from "../src/types.js";

describe("buildBuildPrompt", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-prompt-"));
    await fs.mkdir(path.join(repoDir, ".cstack", "prompts"), { recursive: true });
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "build.md"), "# build prompt asset\n", "utf8");
    await fs.writeFile(path.join(repoDir, "README.md"), "# fixture\n", "utf8");
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("adds patch resilience guidance for retry attempts with patch failure hints", async () => {
    const config = {
      workflows: {
        build: {},
        deliver: {}
      }
    } as CstackConfig;

    const { prompt, context } = await buildBuildPrompt({
      cwd: repoDir,
      input: "Fix the workflow hardening slice.",
      config,
      mode: "exec",
      finalArtifactPath: path.join(repoDir, ".cstack", "runs", "final.md"),
      verificationCommands: [],
      dirtyWorktree: false,
      retryAttempt: {
        attemptNumber: 2,
        maxAttempts: 3,
        reason: "Previous attempt failed while editing a workflow file.",
        failureHints: [
          "Prior attempt hit apply_patch verification failures; do not retry the same hunk unchanged.",
          "The target file may have mixed line endings; detect and normalize EOLs before editing."
        ]
      }
    });

    expect(prompt).toContain("### Patch resilience");
    expect(prompt).toContain("If `apply_patch` fails once, do not retry the same hunk unchanged");
    expect(prompt).toContain("If the file has mixed line endings, normalize them once before editing");
    expect(context).toContain("Retry failure hints:");
  });
});
