import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("program update validate hook", () => {
  let repoDir: string;
  let binDir: string;
  let scriptPath: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-program-update-"));
    binDir = path.join(repoDir, "bin");
    scriptPath = path.resolve("scripts/program-update-validate.mjs");
    await fs.mkdir(binDir, { recursive: true });

    const fakeGh = path.join(binDir, "gh");
    const fakeNpm = path.join(binDir, "npm");

    await fs.writeFile(
      fakeGh,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "repo" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ nameWithOwner: "ganesh47/cstack" }));
  process.exit(0);
}
process.stderr.write("unsupported gh invocation\\n");
process.exit(1);
`,
      "utf8"
    );
    await fs.writeFile(
      fakeNpm,
      `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const prefixIndex = args.indexOf("--prefix");
const prefix = prefixIndex >= 0 ? args[prefixIndex + 1] : process.env.npm_config_prefix;
if (!prefix) {
  process.stderr.write("missing prefix\\n");
  process.exit(1);
}
const binDir = path.join(prefix, "bin");
fs.mkdirSync(binDir, { recursive: true });
const marker = path.join(prefix, ".updated");
const binaryPath = path.join(binDir, "cstack");
fs.writeFileSync(binaryPath, \`#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const marker = \${JSON.stringify(marker)};
const args = process.argv.slice(2);
if (args[0] === "update" && args[1] === "--check") {
  if (fs.existsSync(marker)) {
    process.stdout.write("Already current at v0.17.40\\\\n");
    process.exit(0);
  }
  process.stdout.write("Update available: v0.17.39 -> v0.17.40\\\\nCurrent: v0.17.39\\\\nTarget:  v0.17.40\\\\n");
  process.exit(1);
}
if (args[0] === "update" && args[1] === "--yes") {
  fs.writeFileSync(marker, "updated\\\\n");
  process.stdout.write("Updated cstack from v0.17.39 to v0.17.40.\\\\n");
  process.exit(0);
}
if (args[0] === "--version") {
  process.stdout.write(fs.existsSync(marker) ? "v0.17.40\\\\n" : "v0.17.39\\\\n");
  process.exit(0);
}
process.stderr.write("unsupported cstack invocation\\\\n");
process.exit(1);
\`, "utf8");
fs.chmodSync(binaryPath, 0o755);
process.exit(0);
`,
      "utf8"
    );
    chmodSync(fakeGh, 0o755);
    chmodSync(fakeNpm, 0o755);
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("accepts update-available precheck and writes a passing record", async () => {
    const iterationDir = path.join(repoDir, "iteration");
    await fs.mkdir(iterationDir, { recursive: true });

    await execFileAsync(process.execPath, [scriptPath], {
      cwd: repoDir,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        CSTACK_ITERATION_DIR: iterationDir,
        CSTACK_RELEASED_TAG: "v0.17.40",
        CSTACK_STARTING_RELEASE: "v0.17.39"
      },
      maxBuffer: 20 * 1024 * 1024
    });

    const record = JSON.parse(await fs.readFile(path.join(iterationDir, "update-validation.json"), "utf8"));
    expect(record.status).toBe("passed");
    expect(record.updateAvailable).toBe(true);
    expect(record.detectedCurrentVersion).toBe("v0.17.39");
    expect(record.detectedTargetVersion).toBe("v0.17.40");
    expect(record.checkAfter.code).toBe(0);
    expect(record.versionAfter.stdout).toContain("v0.17.40");
  });
});
