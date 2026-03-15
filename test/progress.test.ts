import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressReporter, buildEvent } from "../src/progress.js";

interface FakeStream {
  isTTY?: boolean;
  columns?: number;
  writes: string[];
  write(chunk: string): boolean;
}

function makeStream(isTTY: boolean): FakeStream {
  return {
    isTTY,
    columns: 80,
    writes: [],
    write(chunk: string) {
      this.writes.push(chunk);
      return true;
    }
  };
}

const originalTerm = process.env.TERM;

afterEach(() => {
  vi.useRealTimers();
  if (originalTerm === undefined) {
    delete process.env.TERM;
    return;
  }
  process.env.TERM = originalTerm;
});

describe("ProgressReporter", () => {
  it("writes plain progress lines for non-tty streams", () => {
    const stream = makeStream(false);
    const reporter = new ProgressReporter("spec", "run-123", stream);

    reporter.emit(buildEvent("starting", 0, "Running codex exec in repo"));
    reporter.emit(buildEvent("activity", 1000, "scanning repository context", "stdout"));

    const output = stream.writes.join("");
    expect(output).toContain("Starting Codex run");
    expect(output).toContain("Activity (stdout): scanning repository context");
  });

  it("falls back to plain progress lines when TERM is dumb", () => {
    process.env.TERM = "dumb";
    const stream = makeStream(true);
    const reporter = new ProgressReporter("spec", "run-dumb", stream);

    reporter.emit(buildEvent("starting", 0, "Running codex exec in repo"));
    reporter.emit(buildEvent("activity", 1000, "scanning repository context", "stdout"));

    const output = stream.writes.join("");
    expect(output).toContain("Starting Codex run");
    expect(output).toContain("Activity (stdout): scanning repository context");
    expect(output).not.toContain("\u001B[?25l");
  });

  it("renders a bounded dashboard for tty streams and restores the cursor", () => {
    process.env.TERM = "xterm-256color";
    const stream = makeStream(true);
    const reporter = new ProgressReporter("discover", "run-456", stream);

    reporter.emit(buildEvent("starting", 0, "Running codex exec in repo"));
    reporter.emit(buildEvent("session", 1000, "session-abc"));
    reporter.emit(buildEvent("activity", 2000, "scanning repository context", "stdout"));
    reporter.emit(buildEvent("completed", 3000, "Exit code 0"));

    const output = stream.writes.join("");
    expect(output).toContain("\u001B[?25l");
    expect(output).toContain("Stages");
    expect(output).toContain("✅ discover:done");
    expect(output).toContain("Observed");
    expect(output).toContain("Next");
    expect(output).toContain("Recent activity");
    expect(output).toContain("Footer");
    expect(output).toContain("session-abc");
    expect(output).toContain("scanning repository context");
    expect(output).toContain("\u001B[?25h");
    expect(output).toContain("\u001B[");
    expect(output).not.toContain("Activity (stdout):");
  });

  it("updates the elapsed timer while the dashboard is active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T06:30:00Z"));
    process.env.TERM = "xterm-256color";
    const stream = makeStream(true);
    const reporter = new ProgressReporter("build", "run-789", stream);

    reporter.emit(buildEvent("starting", 0, "Running codex in repo"));
    const initialOutput = stream.writes.join("");
    expect(initialOutput).toContain("⏱ elapsed");
    expect(initialOutput).toContain("0:00");

    vi.advanceTimersByTime(1250);
    const updatedOutput = stream.writes.join("");
    expect(updatedOutput).toContain("Pulse");
    expect(updatedOutput).toContain("alive");
    expect(updatedOutput).toContain("0:01");

    reporter.emit(buildEvent("completed", 2000, "Exit code 0"));
  });
});
