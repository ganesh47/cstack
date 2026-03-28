import { afterEach, describe, expect, it, vi } from "vitest";
import * as intentModule from "../src/intent.js";
import { runIntentCommand } from "../src/commands/intent.js";

describe("runIntentCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards parsed intent and options to runIntent", async () => {
    const runIntentSpy = vi.spyOn(intentModule, "runIntent").mockResolvedValue("run-id");

    await runIntentCommand("/tmp/repo", ["Implement", "SSO", "--dry-run"], "run");

    expect(runIntentSpy).toHaveBeenCalledWith("/tmp/repo", "Implement SSO", {
      dryRun: true,
      entrypoint: "run"
    });
  });

  it("rejects unknown options", async () => {
    await expect(runIntentCommand("/tmp/repo", ["Implement", "SSO", "--missing"], "bare")).rejects.toThrow("Unknown intent option: --missing");
  });

  it("requires an intent prompt", async () => {
    await expect(runIntentCommand("/tmp/repo", ["--dry-run"], "run")).rejects.toThrow("`cstack <intent>` requires a task description.");
  });
});
