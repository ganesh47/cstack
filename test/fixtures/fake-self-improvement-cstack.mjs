#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const scenarioPath = process.env.FAKE_SELF_IMPROVEMENT_SCENARIO;
const statePath = process.env.FAKE_SELF_IMPROVEMENT_STATE;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function main() {
  if (args[0] === "update" && args[1] === "--check") {
    process.stdout.write("Current: v0.1.0\n");
    return;
  }
  if (args[0] === "--version") {
    process.stdout.write("v0.1.0\n");
    return;
  }
  if (args[0] !== "loop") {
    throw new Error(`Unsupported command: ${args.join(" ")}`);
  }

  const scenario = await readJson(scenarioPath, { benchmarks: [] });
  const state = await readJson(statePath, { index: 0 });
  const benchmark = scenario.benchmarks[state.index] ?? scenario.benchmarks.at(-1);
  if (!benchmark) {
    throw new Error("Missing fake benchmark scenario");
  }
  state.index += 1;
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const repoIndex = args.indexOf("--repo");
  const repoDir = repoIndex >= 0 ? args[repoIndex + 1] : process.cwd();
  const loopId = `fake-loop-${String(state.index).padStart(2, "0")}`;
  const loopDir = path.join(repoDir, ".cstack", "program-test-loops", loopId);
  await fs.mkdir(loopDir, { recursive: true });

  await fs.writeFile(
    path.join(loopDir, "cycle-record.json"),
    `${JSON.stringify(
      {
        status: benchmark.status,
        latestSummary: benchmark.summary,
        primaryBlockerCluster: benchmark.primaryBlockerCluster
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(loopDir, "benchmark-outcome.json"),
    `${JSON.stringify(
      {
        status: benchmark.status,
        iterations: [
          {
            iteration: 1,
            deferredClusters: benchmark.deferredClusters ?? []
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  process.stdout.write(`Loop iteration: 1/1\n`);
  process.stdout.write(`Workspace: ${benchmark.workspace ?? "/tmp/fake-workspace"}\n`);
  process.stdout.write(`Intent: test intent\n`);
  process.stdout.write(`Result run: ${benchmark.runId}\n`);
  process.stdout.write(`Status: ${benchmark.status}\n`);
  process.stdout.write(`Final summary: ${benchmark.summary}\n`);
  process.stdout.write(`Loop artifacts: ${path.relative(process.cwd(), loopDir)}\n`);

  if (benchmark.status !== "completed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
