#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runExec(command, args, cwd, env = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      maxBuffer: 50 * 1024 * 1024
    });
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const execError = error;
    return {
      code: typeof execError.code === "number" ? execError.code : 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? execError.message ?? String(error)
    };
  }
}

async function runShell(command, cwd, env = {}) {
  const shell = process.env.SHELL || "/bin/sh";
  return runExec(shell, ["-lc", command], cwd, env);
}

function stripLeadingV(version) {
  return version.startsWith("v") ? version.slice(1) : version;
}

function bumpPatch(version) {
  const clean = stripLeadingV(version || "0.0.0");
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) {
    throw new Error(`Cannot derive next patch version from ${version}`);
  }
  return `${match[1]}.${match[2]}.${Number.parseInt(match[3], 10) + 1}${match[4] ?? ""}`;
}

async function ghRepo(cwd) {
  const result = await runExec("gh", ["repo", "view", "--json", "nameWithOwner"], cwd);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "failed to resolve GitHub repository");
  }
  return JSON.parse(result.stdout).nameWithOwner;
}

async function ghApiJson(cwd, endpoint) {
  const result = await runExec("gh", ["api", endpoint], cwd);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `failed gh api call for ${endpoint}`);
  }
  return JSON.parse(result.stdout);
}

async function maxRunId(cwd, repo, workflowFile) {
  const payload = await ghApiJson(cwd, `repos/${repo}/actions/workflows/${workflowFile}/runs?per_page=20`);
  return Math.max(0, ...((payload.workflow_runs ?? []).map((run) => run.id)));
}

async function waitForNewRun(cwd, repo, workflowFile, previousId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const payload = await ghApiJson(cwd, `repos/${repo}/actions/workflows/${workflowFile}/runs?per_page=20`);
    const run = (payload.workflow_runs ?? []).find((entry) => entry.id > previousId);
    if (run) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`timed out waiting for ${workflowFile} run`);
}

async function waitForReleaseTag(cwd, tag) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const view = await runExec("gh", ["release", "view", tag, "--json", "tagName,url,isDraft,assets"], cwd);
    if (view.code === 0) {
      return JSON.parse(view.stdout);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`timed out waiting for GitHub release ${tag}`);
}

async function main() {
  const resultPath = process.env.CSTACK_RELEASE_RESULT_PATH;
  if (!resultPath) {
    throw new Error("Missing CSTACK_RELEASE_RESULT_PATH");
  }

  const customCommand = process.env.CSTACK_PROGRAM_RELEASE_COMMAND;
  if (customCommand) {
    const result = await runShell(customCommand, process.cwd(), process.env);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "program release hook failed");
    }
    process.stdout.write(`${process.env.CSTACK_RELEASED_TAG ?? ""}\n`);
    return;
  }

  const startingRelease = process.env.CSTACK_STARTING_RELEASE ?? "v0.0.0";
  const nextVersion = process.env.CSTACK_NEXT_VERSION ?? bumpPatch(startingRelease);
  const releasedTag = `v${stripLeadingV(nextVersion)}`;
  const repo = await ghRepo(process.cwd());

  const previousPrepareId = await maxRunId(process.cwd(), repo, "prepare-release.yml");
  const previousReleaseId = await maxRunId(process.cwd(), repo, "release.yml");
  const dispatch = await runExec("gh", ["workflow", "run", "prepare-release.yml", "-f", `version=${stripLeadingV(nextVersion)}`], process.cwd());
  if (dispatch.code !== 0) {
    throw new Error(dispatch.stderr.trim() || dispatch.stdout.trim() || "failed to dispatch prepare-release workflow");
  }

  const prepareRun = await waitForNewRun(process.cwd(), repo, "prepare-release.yml", previousPrepareId);
  const watchedPrepare = await runExec("gh", ["run", "watch", String(prepareRun.id), "--exit-status"], process.cwd());
  if (watchedPrepare.code !== 0) {
    throw new Error(watchedPrepare.stderr.trim() || watchedPrepare.stdout.trim() || "prepare-release workflow failed");
  }

  const releaseRun = await waitForNewRun(process.cwd(), repo, "release.yml", previousReleaseId);
  const watchedRelease = await runExec("gh", ["run", "watch", String(releaseRun.id), "--exit-status"], process.cwd());
  if (watchedRelease.code !== 0) {
    throw new Error(watchedRelease.stderr.trim() || watchedRelease.stdout.trim() || "release workflow failed");
  }

  const release = await waitForReleaseTag(process.cwd(), releasedTag);
  const record = {
    schemaVersion: 1,
    mode: "gh",
    startingRelease,
    releasedTag,
    prepareReleaseWorkflow: "prepare-release.yml",
    releaseWorkflow: "release.yml",
    status: "released",
    prepareRunId: prepareRun.id,
    releaseRunId: releaseRun.id,
    release
  };
  await fs.writeFile(resultPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(`${releasedTag}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
