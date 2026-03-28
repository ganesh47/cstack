import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as updateModule from "../src/update.js";
import { runUpdateCommand } from "../src/commands/update.js";

describe("runUpdateCommand", () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards parsed options to runUpdate", async () => {
    const runUpdateSpy = vi.spyOn(updateModule, "runUpdate").mockResolvedValue({ status: "available", exitCode: 20 } as never);

    await runUpdateCommand("/tmp/repo", ["--check", "--yes", "--version", "0.4.0"]);

    expect(runUpdateSpy).toHaveBeenCalledWith(
      "/tmp/repo",
      expect.objectContaining({
        check: true,
        yes: true,
        version: "0.4.0"
      })
    );
    expect(process.exitCode).toBe(20);
  });

  it("does not set exitCode when update succeeds", async () => {
    const runUpdateSpy = vi.spyOn(updateModule, "runUpdate").mockResolvedValue({ status: "current", exitCode: 0 } as never);

    await runUpdateCommand("/tmp/repo", ["--check"]);

    expect(process.exitCode).toBeUndefined();
    expect(runUpdateSpy).toHaveBeenCalledWith("/tmp/repo", expect.objectContaining({ check: true }));
  });
});
