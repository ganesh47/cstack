#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid version: ${version}`);
  }
}

function replaceMarkedBlock(readme, marker, body) {
  const pattern = new RegExp(`(<!-- ${marker}:start -->\\n)([\\s\\S]*?)(\\n<!-- ${marker}:end -->)`);
  if (!pattern.test(readme)) {
    throw new Error(`Missing README marker block: ${marker}`);
  }
  return readme.replace(pattern, `$1${body}$3`);
}

function updateReadme(readme, tag) {
  let next = readme;
  next = replaceMarkedBlock(next, "release-version", `Current release example version: \`${tag}\``);
  next = replaceMarkedBlock(
    next,
    "release-examples",
    [
      "Install directly from a published release tarball:",
      "",
      "```bash",
      `VERSION=${tag}`,
      'npm install -g "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"',
      "```",
      "",
      "Download first, then install locally:",
      "",
      "```bash",
      `VERSION=${tag}`,
      'curl -LO "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"',
      'npm install -g "./cstack-${VERSION#v}.tgz"',
      "```",
      "",
      "Verify the downloaded tarball:",
      "",
      "```bash",
      `VERSION=${tag}`,
      'curl -LO "https://github.com/ganesh47/cstack/releases/download/${VERSION}/SHA256SUMS.txt"',
      "sha256sum -c SHA256SUMS.txt",
      "```"
    ].join("\n")
  );
  return next;
}

async function main() {
  const version = process.argv[2];
  if (!version) {
    throw new Error("Usage: node scripts/update-release-version.mjs <version>");
  }

  validateVersion(version);
  const tag = `v${version}`;
  const readmePath = new URL("../README.md", import.meta.url);
  const readme = await readFile(readmePath, "utf8");
  const updated = updateReadme(readme, tag);
  await writeFile(readmePath, updated, "utf8");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

export { updateReadme };
