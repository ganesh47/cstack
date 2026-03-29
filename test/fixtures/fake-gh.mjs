#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const fixturePath = path.join(process.cwd(), ".cstack", "test-gh.json");
const statePath = path.join(process.cwd(), ".cstack", "test-gh-state.json");

async function loadFixture() {
  if (process.env.FAKE_GH_SCENARIO) {
    return JSON.parse(process.env.FAKE_GH_SCENARIO);
  }
  const raw = await readFile(fixturePath, "utf8");
  return JSON.parse(raw);
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function getArgValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function loadState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

async function saveState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function activeFixture(base, state) {
  return state ? { ...base, ...state } : base;
}

if (process.env.FAKE_GH_DELAY_MS) {
  await new Promise((resolve) => setTimeout(resolve, Number.parseInt(process.env.FAKE_GH_DELAY_MS, 10)));
}

const baseFixture = await loadFixture();
const state = await loadState();
const fixture = activeFixture(baseFixture, state);

if (args[0] === "repo" && args[1] === "view") {
  printJson(fixture.repoView ?? { nameWithOwner: "ganesh47/cstack", defaultBranchRef: { name: "main" } });
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "view") {
  const pullRequest = fixture.pullRequest ?? fixture.pr;
  if (!pullRequest) {
    fail("no pull request found");
  }
  printJson(pullRequest);
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "create") {
  if (fixture.prCreateError) {
    fail(fixture.prCreateError);
  }
  const title = getArgValue("--title") ?? "New PR";
  const headRefName = getArgValue("--head") ?? "cstack/test";
  const baseRefName = getArgValue("--base") ?? "main";
  const repo = getArgValue("--repo") ?? "ganesh47/cstack";
  const isDraft = args.includes("--draft");
  const bodyFile = getArgValue("--body-file");
  const body = bodyFile ? await readFile(bodyFile, "utf8") : "";
  const closingIssuesReferences = [...body.matchAll(/#(\d+)/g)].map((match) => ({ number: Number.parseInt(match[1], 10) }));
  const nextNumber = fixture.nextPullRequestNumber ?? 99;
  const pullRequest = {
    number: nextNumber,
    title,
    state: "OPEN",
    isDraft,
    reviewDecision: "APPROVED",
    url: `https://github.com/${repo}/pull/${nextNumber}`,
    headRefName,
    baseRefName,
    mergeStateStatus: "CLEAN",
    closingIssuesReferences,
    ...(fixture.createdPullRequest ?? {})
  };
  await saveState({
    ...fixture,
    nextPullRequestNumber: nextNumber + 1,
    pullRequest
  });
  process.stdout.write(`${pullRequest.url}\n`);
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "edit") {
  if (fixture.prEditError) {
    fail(fixture.prEditError);
  }
  const currentPr = fixture.pullRequest ?? fixture.pr;
  if (!currentPr) {
    fail("no pull request found");
  }
  const title = getArgValue("--title") ?? currentPr.title;
  const bodyFile = getArgValue("--body-file");
  const body = bodyFile ? await readFile(bodyFile, "utf8") : undefined;
  const closingIssuesReferences = body
    ? [...body.matchAll(/#(\d+)/g)].map((match) => ({ number: Number.parseInt(match[1], 10) }))
    : currentPr.closingIssuesReferences;
  const pullRequest = {
    ...currentPr,
    title,
    ...(body ? { body, closingIssuesReferences } : {})
  };
  await saveState({
    ...fixture,
    pullRequest
  });
  process.stdout.write(`${pullRequest.url}\n`);
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "checks") {
  if (fixture.prChecksError) {
    fail(fixture.prChecksError);
  }
  printJson(fixture.prChecks ?? fixture.checks ?? []);
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "view") {
  const issueNumber = Number.parseInt(args[2] ?? "", 10);
  const issueCollection = fixture.issues ?? [];
  const issue =
    Array.isArray(issueCollection)
      ? issueCollection.find((entry) => entry.number === issueNumber)
      : issueCollection[String(issueNumber)]
        ? { number: issueNumber, url: `https://example.com/issues/${issueNumber}`, ...issueCollection[String(issueNumber)] }
        : undefined;
  if (!issue) {
    fail(`issue ${issueNumber} not found`);
  }
  printJson(issue);
  process.exit(0);
}

if (args[0] === "run" && args[1] === "list") {
  if (fixture.actionsError) {
    fail(fixture.actionsError);
  }
  printJson(fixture.actions ?? []);
  process.exit(0);
}

if (args[0] === "release" && args[1] === "view") {
  const tagName = args[2];
  const release = fixture.release ?? fixture.releases?.[tagName];
  if (!release || ((release.tagName ?? tagName) !== tagName)) {
    fail(`release ${tagName} not found`);
  }
  printJson({ tagName, ...release });
  process.exit(0);
}

if (args[0] === "api") {
  const endpoint = args[1] ?? "";
  if (/^repos\/.+\/git\/ref\/tags\//.test(endpoint)) {
    const tagName = endpoint.split("/").at(-1);
    const tags = fixture.tags ?? Object.keys(fixture.releases ?? {});
    if (!tagName || !tags.includes(tagName)) {
      fail(`tag ${tagName} not found`);
    }
    printJson({ ref: `refs/tags/${tagName}` });
    process.exit(0);
  }
  if (/^repos\/.+\/dependabot\/alerts/.test(endpoint)) {
    if (fixture.security?.dependabotError) {
      fail(fixture.security.dependabotError);
    }
    printJson(fixture.security?.dependabot ?? fixture.dependabot ?? []);
    process.exit(0);
  }
  if (/^repos\/.+\/code-scanning\/alerts/.test(endpoint)) {
    if (fixture.security?.codeScanningError) {
      fail(fixture.security.codeScanningError);
    }
    printJson(fixture.security?.codeScanning ?? fixture.codeScanning ?? []);
    process.exit(0);
  }
  if (/^repos\/.+$/.test(endpoint)) {
    if (fixture.repoApiError) {
      fail(fixture.repoApiError);
    }
    printJson({ default_branch: fixture.repoView?.defaultBranchRef?.name ?? "main" });
    process.exit(0);
  }
}

fail(`unsupported fake gh invocation: ${args.join(" ")}`);
