import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { resolveSessionTarget, recordForkObservation } from "../src/session.js";
import type { BuildSessionRecord, RunRecord } from "../src/types.js";

function timestamp(index: number): string {
  return `2026-03-14T11:00:${String(index).padStart(2, "0")}.000Z`;
}

function runPayload(runId: string, cwd: string, sessionId?: string): RunRecord {
  return {
    id: runId,
    workflow: "build",
    createdAt: timestamp(0),
    updatedAt: timestamp(1),
    status: "completed",
    cwd,
    gitBranch: "main",
    codexVersion: "fake",
    codexCommand: ["codex", "exec"],
    promptPath: path.join(cwd, ".cstack", "runs", runId, "prompt.md"),
    finalPath: path.join(cwd, ".cstack", "runs", runId, "final.md"),
    contextPath: path.join(cwd, ".cstack", "runs", runId, "context.md"),
    stdoutPath: path.join(cwd, ".cstack", "runs", runId, "stdout.log"),
    stderrPath: path.join(cwd, ".cstack", "runs", runId, "stderr.log"),
    configSources: [],
    inputs: {
      userPrompt: "Improve session support"
    },
    ...(sessionId ? { sessionId } : {})
  };
}

function sessionPayload(sessionId = "session-build-1"): BuildSessionRecord {
  return {
    workflow: "build",
    requestedMode: "interactive",
    mode: "interactive",
    startedAt: timestamp(2),
    endedAt: timestamp(3),
    sessionId,
    codexCommand: ["codex", "exec"],
    observability: {
      sessionIdObserved: true,
      transcriptObserved: true,
      finalArtifactObserved: true
    }
  };
}

describe("session helpers", () => {
  let cwd: string;
  let runId: string;
  let runDir: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-session-"));
    runId = "2026-03-14T11-00-00-build-session";
    runDir = path.join(cwd, ".cstack", "runs", runId);
    await fs.mkdir(runDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("resolves session id from linked session metadata first", async () => {
    await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(runPayload(runId, cwd), null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(runDir, "session.json"), `${JSON.stringify(sessionPayload("build-session-session-json"), null, 2)}\n`, "utf8");

    const resolved = await resolveSessionTarget(cwd, runId);
    expect(resolved.runId).toBe(runId);
    expect(resolved.workflow).toBe("build");
    expect(resolved.sessionId).toBe("build-session-session-json");
  });

  it("falls back to run session id when session metadata is missing", async () => {
    await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(runPayload(runId, cwd, "run-session-id"), null, 2)}\n`, "utf8");

    const resolved = await resolveSessionTarget(cwd, runId);
    expect(resolved.sessionId).toBe("run-session-id");
  });

  it("throws when no session id can be resolved", async () => {
    await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(runPayload(runId, cwd), null, 2)}\n`, "utf8");
    await expect(resolveSessionTarget(cwd, runId)).rejects.toThrow("has no recorded Codex session id");
  });

  it("records fork observation details into existing session metadata", async () => {
    await fs.writeFile(path.join(runDir, "session.json"), `${JSON.stringify(sessionPayload("build-session-parent"), null, 2)}\n`, "utf8");

    await recordForkObservation({
      cwd,
      runId,
      childSessionId: "child-session-789",
      childRunId: "2026-03-14T11-00-10-build-child",
      childWorkflow: "build"
    });

    const updated = JSON.parse(await fs.readFile(path.join(runDir, "session.json"), "utf8")) as Record<string, unknown>;
    expect(updated.sessionId).toBe("build-session-parent");
    expect(updated.childSessionId).toBe("child-session-789");
    expect(updated.childRunId).toBe("2026-03-14T11-00-10-build-child");
    expect(updated.childWorkflow).toBe("build");
  });

  it("does nothing when session metadata is not present", async () => {
    await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(runPayload(runId, cwd), null, 2)}\n`, "utf8");
    await recordForkObservation({
      cwd,
      runId,
      childSessionId: "child-session-missing"
    });

    await expect(fs.access(path.join(runDir, "session.json"))).rejects.toBeTruthy();
  });
});
