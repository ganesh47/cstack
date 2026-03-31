#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  await fs.access(path.join(repoRoot, "dist", "cli.js"));
  await fs.access(path.join(repoRoot, "bin", "cstack.js"));
  await fs.access(path.join(repoRoot, "README.md"));

  const helpResult = await execFileAsync(process.execPath, [path.join(repoRoot, "bin", "cstack.js"), "--help"], {
    cwd: repoRoot,
    maxBuffer: 10 * 1024 * 1024
  });
  assert.match(helpResult.stdout, /cstack loop <intent>/, "built CLI help is missing the loop command");

  const packResult = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    maxBuffer: 10 * 1024 * 1024
  });
  const packOutput = JSON.parse(packResult.stdout);
  assert.ok(Array.isArray(packOutput) && packOutput.length > 0, "npm pack --dry-run returned no package metadata");
  const files = new Set(
    (packOutput[0]?.files ?? [])
      .map((entry) => (entry && typeof entry.path === "string" ? entry.path : ""))
      .filter(Boolean)
  );

  for (const expectedPath of ["README.md", "bin/cstack.js", "dist/cli.js"]) {
    assert.ok(files.has(expectedPath), `packaged output is missing ${expectedPath}`);
  }
}

await main();
