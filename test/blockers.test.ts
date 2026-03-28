import { describe, expect, it } from "vitest";
import { classifyExecutionBlocker, uniqueBlockerCategories } from "../src/blockers.js";

describe("classifyExecutionBlocker", () => {
  it("classifies missing commands as host-tool-missing", () => {
    const result = classifyExecutionBlocker("npm test", "command not found: npm\n");

    expect(result).toEqual({
      category: "host-tool-missing",
      detail: "command not found: npm"
    });
  });

  it("classifies registry failures as registry-unreachable", () => {
    const result = classifyExecutionBlocker(
      "npm install",
      "npm ERR! request to https://registry.npmjs.org failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org"
    );

    expect(result).toEqual({
      category: "registry-unreachable",
      detail: "npm ERR! request to https://registry.npmjs.org failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org"
    });
  });

  it("classifies command-not-found while extracting a useful detail line", () => {
    const result = classifyExecutionBlocker(
      "pytest",
      "session id: 9b7e1f\nTraceback (most recent call last):\n  File\"\"\"\n"
    );

    expect(result?.category).toBe("repo-test-failure");
    expect(result?.detail).toBe("Traceback (most recent call last):");
  });

  it("classifies repository checks as repo-test-failure", () => {
    const result = classifyExecutionBlocker(
      "npm test",
      "AssertionError: expected response status 200 to equal 201\n  at Test.test (spec.js:12:4)"
    );

    expect(result).toEqual({
      category: "repo-test-failure",
      detail: "AssertionError: expected response status 200 to equal 201"
    });
  });

  it("returns null for unrelated terminal output", () => {
    expect(classifyExecutionBlocker("echo", "done writing files\n")).toBeNull();
  });
});

describe("uniqueBlockerCategories", () => {
  it("deduplicates categories and filters empty values", () => {
    expect(uniqueBlockerCategories(["network-blocked", undefined, "network-blocked", "toolchain-mismatch", "network-blocked", undefined])).toEqual([
      "network-blocked",
      "toolchain-mismatch"
    ]);
  });
});
