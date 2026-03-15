import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { writePromptToChildStdin } from "../src/codex.js";

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
