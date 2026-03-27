import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCodexExec, summarizeActivityLine, writePromptToChildStdin } from "../src/codex.js";
import type { CstackConfig } from "../src/types.js";

class FakeWritable extends EventEmitter {
  constructor(private readonly mode: "ok" | "epipe" | "fail") {
    super();
  }

  end(_chunk?: string): void {
    if (this.mode === "ok") {
      return;
    }

    const error = Object.assign(new Error(this.mode === "epipe" ? "broken pipe" : "write failed"), {
      code: this.mode === "epipe" ? "EPIPE" : "EIO"
    }) as NodeJS.ErrnoException;

    queueMicrotask(() => {
      this.emit("error", error);
    });
  }
}

afterEach(() => {
  delete process.env.FAKE_CODEX_STALL_AFTER_OUTPUT_MS;
  delete process.env.CSTACK_CODEX_COMPLETION_STALL_MS;
});

describe("writePromptToChildStdin", () => {
  it("swallows EPIPE from child stdin", async () => {
    const onError = vi.fn();
    const stream = new FakeWritable("epipe");
    const detach = writePromptToChildStdin(stream, "prompt body", onError);

    await new Promise((resolve) => setImmediate(resolve));

    expect(onError).not.toHaveBeenCalled();
    detach();
  });

  it("forwards non-EPIPE stream errors", async () => {
    const onError = vi.fn();
    const stream = new FakeWritable("fail");
    const detach = writePromptToChildStdin(stream, "prompt body", onError);

    await new Promise((resolve) => setImmediate(resolve));

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "EIO" }));
    detach();
  });
});

describe("summarizeActivityLine", () => {
  it("summarizes meaningful human-readable activity", () => {
    expect(summarizeActivityLine("reading repo context")).toBe("reading repo context");
    expect(summarizeActivityLine('exec /bin/bash -lc "pwd" in /tmp succeeded in 12ms:')).toBe('Tool succeeded: "pwd"');
  });

  it("drops code-like stderr noise", () => {
    expect(summarizeActivityLine('completed = store.complete_job("job-2", status="succeeded")')).toBeNull();
    expect(summarizeActivityLine("const result = await fn();")).toBeNull();
  });
});

describe("runCodexExec", () => {
  it("accepts completed output when Codex stalls after emitting the final payload", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-codex-stall-"));
    const fakeCodexPath = path.resolve("test/fixtures/fake-codex.mjs");
    chmodSync(fakeCodexPath, 0o755);
    const finalPath = path.join(cwd, "final.md");
    const eventsPath = path.join(cwd, "events.jsonl");
    const stdoutPath = path.join(cwd, "stdout.log");
    const stderrPath = path.join(cwd, "stderr.log");
    const config: CstackConfig = {
      codex: {
        command: fakeCodexPath,
        sandbox: "workspace-write"
      },
      workflows: {
        spec: {},
        discover: {},
        build: {},
        review: {},
        ship: {},
        deliver: {}
      }
    };

    process.env.FAKE_CODEX_STALL_AFTER_OUTPUT_MS = "4000";
    process.env.CSTACK_CODEX_COMPLETION_STALL_MS = "500";
    try {
      const result = await runCodexExec({
        cwd,
        workflow: "discover",
        runId: "discover-stalled-output",
        prompt: "You are the `Research Lead` for a bounded `cstack discover` run.",
        finalPath,
        eventsPath,
        stdoutPath,
        stderrPath,
        config,
        silentProgress: true,
        timeoutSeconds: 30
      });

      expect(result.code).toBe(0);
      await expect(fs.readFile(finalPath, "utf8")).resolves.toContain("Fake discover synthesis.");
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  }, 15_000);
});
