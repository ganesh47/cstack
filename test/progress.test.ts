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
    expect(output).toContain("Progress");
    expect(output).toContain("Next");
    expect(output).toContain("Recent milestones");
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
    expect(updatedOutput).toContain("last signal");
    expect(updatedOutput).toContain("0:01");

    reporter.emit(buildEvent("completed", 2000, "Exit code 0"));
  });

  it("coalesces bursty activity updates onto the ticker cadence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T06:30:00Z"));
    process.env.TERM = "xterm-256color";
    const stream = makeStream(true);
    const reporter = new ProgressReporter("review", "run-burst", stream);

    reporter.emit(buildEvent("starting", 0, "Starting review"));
    const writesAfterStart = stream.writes.length;

    reporter.emit(buildEvent("activity", 25, "first stderr event", "stderr"));
    reporter.emit(buildEvent("activity", 50, "second stdout event", "stdout"));
    reporter.emit(buildEvent("activity", 75, "third stderr event", "stderr"));

    expect(stream.writes.length).toBe(writesAfterStart);

    vi.advanceTimersByTime(500);
    expect(stream.writes.length).toBeGreaterThan(writesAfterStart);
    expect(stream.writes.join("")).toContain("third stderr event");

    reporter.emit(buildEvent("completed", 1000, "Exit code 0"));
  });

  it("can suspend and resume a tty dashboard around interactive prompts", () => {
    process.env.TERM = "xterm-256color";
    const stream = makeStream(true);
    const reporter = new ProgressReporter("update", "self-update", stream);

    reporter.emit(buildEvent("starting", 0, "Checking GitHub release v0.17.2"));
    reporter.emit(buildEvent("activity", 100, "Awaiting confirmation to update to v0.17.2"));
    reporter.suspend();
    const suspendedOutput = stream.writes.join("");

    expect(suspendedOutput).toContain("\u001B[");
    expect(suspendedOutput).toContain("\u001B[?25h");

    reporter.resume();
    reporter.emit(buildEvent("activity", 250, "Installing verified release tarball"));
    reporter.emit(buildEvent("completed", 500, "Installed v0.17.2"));

    const resumedOutput = stream.writes.join("");
    expect(resumedOutput).toContain("\u001B[?25l");
    expect(resumedOutput).toContain("Installing verified release tarball");
    expect(resumedOutput).toContain("Installed v0.17.2");
  });

  it("keeps a fixed-height milestone pane while activity changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T06:30:00Z"));
    process.env.TERM = "xterm-256color";
    const stream = makeStream(true);
    const reporter = new ProgressReporter("intent", "run-steady", stream);

    reporter.setStages(["discover", "spec", "review"]);
    reporter.emit(buildEvent("starting", 0, "Routing intent across discover -> spec -> review"));
    reporter.emit(buildEvent("activity", 100, "Running discover stage", "stdout"));
    vi.advanceTimersByTime(500);
    const output = stream.writes.join("");

    expect(output).toContain("Progress");
    expect(output).toContain("Recent milestones");
    expect(output).toContain("[+0:00] Routing intent across discover -> spec -> review");
    expect(output).toContain("[+0:00] Running discover stage");
    expect(output).toContain("…");
  });
});
