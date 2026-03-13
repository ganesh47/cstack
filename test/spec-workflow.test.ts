import { beforeEach, afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runSpec } from "../src/commands/spec.js";

const originalBin = process.env.CSTACK_CODEX_BIN;

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("spec workflow", () => {
  let repoDir: string;
  let fakeCodex: string;

  beforeEach(async () => {
    repoDir = await makeTempDir("cstack-spec-");
    await fs.mkdir(path.join(repoDir, ".cstack", "prompts"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "specs"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docs", "research"), { recursive: true });
    await fs.writeFile(path.join(repoDir, ".cstack", "config.toml"), "[codex]\nsandbox = \"workspace-write\"\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".cstack", "prompts", "spec.md"), "Spec workflow prompt asset", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "specs", "cstack-spec-v0.1.md"), "# spec\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docs", "research", "gstack-codex-interaction-model.md"), "# research\n", "utf8");
    fakeCodex = path.join(repoDir, "fake-codex");
    await fs.writeFile(
      fakeCodex,
      `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then
  echo "codex-cli fake"
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then
    out="$arg"
  fi
  prev="$arg"
done
cat >/dev/null
printf 'session id: fake-session\\n' >&1
printf '# Generated spec\\n\\nStub output.\\n' >"$out"
`,
      "utf8"
    );
    await fs.chmod(fakeCodex, 0o755);
    process.env.CSTACK_CODEX_BIN = fakeCodex;
  });

  afterEach(async () => {
    if (originalBin === undefined) {
      delete process.env.CSTACK_CODEX_BIN;
    } else {
      process.env.CSTACK_CODEX_BIN = originalBin;
    }
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("creates run artifacts for a spec execution", async () => {
    await runSpec(repoDir, "Draft the first slice");

    const runsDir = path.join(repoDir, ".cstack", "runs");
    const runIds = await fs.readdir(runsDir);
    expect(runIds).toHaveLength(1);

    const runDir = path.join(runsDir, runIds[0]!);
    const run = JSON.parse(await fs.readFile(path.join(runDir, "run.json"), "utf8")) as { status: string; sessionId?: string };
    const finalBody = await fs.readFile(path.join(runDir, "final.md"), "utf8");
    const artifactBody = await fs.readFile(path.join(runDir, "artifacts", "spec.md"), "utf8");

    expect(run.status).toBe("completed");
    expect(run.sessionId).toBe("fake-session");
    expect(finalBody).toContain("Generated spec");
    expect(artifactBody).toContain("Generated spec");
  });
});
