import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runBuild = vi.fn(async () => undefined);
const runDeliver = vi.fn(async () => undefined);
const runDiscover = vi.fn(async () => undefined);
const runFork = vi.fn(async () => undefined);
const runIntentCommand = vi.fn(async () => undefined);
const runInspect = vi.fn(async () => undefined);
const runLoop = vi.fn(async () => undefined);
const runRerun = vi.fn(async () => undefined);
const runResume = vi.fn(async () => undefined);
const runReview = vi.fn(async () => undefined);
const runRuns = vi.fn(async () => undefined);
const runShip = vi.fn(async () => undefined);
const runSpec = vi.fn(async () => undefined);
const runUpdateCommand = vi.fn(async () => undefined);

vi.mock("../src/commands/build.js", () => ({ runBuild }));
vi.mock("../src/commands/deliver.js", () => ({ runDeliver }));
vi.mock("../src/commands/discover.js", () => ({ runDiscover }));
vi.mock("../src/commands/fork.js", () => ({ runFork }));
vi.mock("../src/commands/intent.js", () => ({ runIntentCommand }));
vi.mock("../src/commands/inspect.js", () => ({ runInspect }));
vi.mock("../src/commands/loop.js", () => ({ runLoop }));
vi.mock("../src/commands/rerun.js", () => ({ runRerun }));
vi.mock("../src/commands/resume.js", () => ({ runResume }));
vi.mock("../src/commands/review.js", () => ({ runReview }));
vi.mock("../src/commands/runs.js", () => ({ runRuns }));
vi.mock("../src/commands/ship.js", () => ({ runShip }));
vi.mock("../src/commands/spec.js", () => ({ runSpec }));
vi.mock("../src/commands/update.js", () => ({
  runUpdateCommand,
  UpdateCommandError: class MockUpdateCommandError extends Error {
    exitCode: number;
    constructor(message: string, exitCode = 1) {
      super(message);
      this.exitCode = exitCode;
    }
  },
}));

function normalizeWrites() {
  let stdout = "";
  let stderr = "";

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    restore() {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
  };
}

async function runCliCommand(argv: string[]): Promise<{ stdout: string; stderr: string }> {
  const writer = normalizeWrites();

  process.argv = ["node", "/tmp/cstack", ...argv];
  process.exitCode = undefined;

  try {
    await vi.resetModules();
    await import("../src/cli.js");
    await Promise.resolve();
    return {
      stdout: writer.stdout,
      stderr: writer.stderr,
    };
  } finally {
    writer.restore();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.exitCode = undefined;
});

describe("src/cli.ts", () => {
  const cwd = process.cwd();

  it("prints usage for no args", async () => {
    const output = await runCliCommand([]);
    expect(output.stdout).toContain("Usage:");
    expect(process.exitCode).toBeUndefined();
  });

  it("prints usage for --help", async () => {
    const output = await runCliCommand(["--help"]);
    expect(output.stdout).toContain("Usage:");
    expect(process.exitCode).toBeUndefined();
  });

  it("dispatches discover", async () => {
    await runCliCommand(["discover", "Investigate auth flow"]);
    expect(runDiscover).toHaveBeenCalledWith(cwd, ["Investigate auth flow"]);
  });

  it("dispatches run", async () => {
    await runCliCommand(["run", "Ship first release"]);
    expect(runIntentCommand).toHaveBeenCalledWith(cwd, ["Ship first release"], "run");
  });

  it("dispatches workflow commands with --allow-all intact", async () => {
    await runCliCommand(["run", "--allow-all", "Ship first release"]);
    expect(runIntentCommand).toHaveBeenCalledWith(cwd, ["--allow-all", "Ship first release"], "run");

    await runCliCommand(["discover", "--allow-all", "Investigate auth flow"]);
    expect(runDiscover).toHaveBeenCalledWith(cwd, ["--allow-all", "Investigate auth flow"]);

    await runCliCommand(["spec", "--allow-all", "Draft plan"]);
    expect(runSpec).toHaveBeenCalledWith(cwd, "--allow-all Draft plan");

    await runCliCommand(["build", "--allow-all", "Migrate API"]);
    expect(runBuild).toHaveBeenCalledWith(cwd, ["--allow-all", "Migrate API"]);

    await runCliCommand(["review", "--allow-all", "Fix race condition"]);
    expect(runReview).toHaveBeenCalledWith(cwd, ["--allow-all", "Fix race condition"]);

    await runCliCommand(["ship", "--allow-all", "Add endpoint"]);
    expect(runShip).toHaveBeenCalledWith(cwd, ["--allow-all", "Add endpoint"]);

    await runCliCommand(["deliver", "--allow-all", "Bundle release"]);
    expect(runDeliver).toHaveBeenCalledWith(cwd, ["--allow-all", "Bundle release"]);

    runIntentCommand.mockClear();
    await runCliCommand(["--allow-all", "Implement", "observability"]);
    expect(runIntentCommand).toHaveBeenCalledWith(cwd, ["--allow-all", "Implement", "observability"], "bare");
  });

  it("dispatches spec", async () => {
    await runCliCommand(["spec", "Draft plan"]);
    expect(runSpec).toHaveBeenCalledWith(cwd, "Draft plan");
  });

  it("dispatches build", async () => {
    await runCliCommand(["build", "Migrate API"]);
    expect(runBuild).toHaveBeenCalledWith(cwd, ["Migrate API"]);
  });

  it("dispatches review", async () => {
    await runCliCommand(["review", "Fix race condition"]);
    expect(runReview).toHaveBeenCalledWith(cwd, ["Fix race condition"]);
  });

  it("dispatches ship", async () => {
    await runCliCommand(["ship", "Add endpoint"]);
    expect(runShip).toHaveBeenCalledWith(cwd, ["Add endpoint"]);
  });

  it("dispatches deliver", async () => {
    await runCliCommand(["deliver", "Bundle release"]);
    expect(runDeliver).toHaveBeenCalledWith(cwd, ["Bundle release"]);
  });

  it("dispatches rerun", async () => {
    await runCliCommand(["rerun", "run-123"]);
    expect(runRerun).toHaveBeenCalledWith(cwd, ["run-123"]);
  });

  it("dispatches resume", async () => {
    await runCliCommand(["resume", "run-123"]);
    expect(runResume).toHaveBeenCalledWith(cwd, ["run-123"]);
  });

  it("dispatches fork", async () => {
    await runCliCommand(["fork", "run-123"]);
    expect(runFork).toHaveBeenCalledWith(cwd, ["run-123"]);
  });

  it("dispatches runs", async () => {
    await runCliCommand(["runs", "--active"]);
    expect(runRuns).toHaveBeenCalledWith(cwd, ["--active"]);
  });

  it("dispatches update", async () => {
    await runCliCommand(["update", "--check"]);
    expect(runUpdateCommand).toHaveBeenCalledWith(cwd, ["--check"]);
  });

  it("dispatches inspect", async () => {
    await runCliCommand(["inspect", "run-123"]);
    expect(runInspect).toHaveBeenCalledWith(cwd, ["run-123"]);
  });

  it("dispatches loop", async () => {
    await runCliCommand(["loop", "Close", "coverage", "--repo", "https://example.com/repo.git", "--branch", "main", "--iterations", "2", "--safe"]);
    expect(runLoop).toHaveBeenCalledWith(cwd, [
      "Close",
      "coverage",
      "--repo",
      "https://example.com/repo.git",
      "--branch",
      "main",
      "--iterations",
      "2",
      "--safe",
    ]);
  });

  it("dispatches bare intent", async () => {
    await runCliCommand(["Implement", "observability"]);
    expect(runIntentCommand).toHaveBeenCalledWith(cwd, ["Implement", "observability"], "bare");
  });

  it("renders unknown command errors", async () => {
    const output = await runCliCommand(["mystery"]);
    expect(process.exitCode).toBe(1);
    expect(output.stderr).toContain("Unknown command: mystery");
    expect(output.stderr).toContain("Usage:");
  });
});
