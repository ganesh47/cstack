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

  it("classifies workspace permission failures as permission-blocked", () => {
    const result = classifyExecutionBlocker(
      "npm test",
      "EACCES: permission denied, open '/repo/.cstack/runs/2026-04-01/final.md'"
    );

    expect(result).toEqual({
      category: "permission-blocked",
      detail: "EACCES: permission denied, open '/repo/.cstack/runs/2026-04-01/final.md'"
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

  it("classifies better-sqlite3 native binding load failures as toolchain mismatch", () => {
    const result = classifyExecutionBlocker(
      "pnpm --dir packages/api exec vitest run tests/health.spec.ts tests/graph.spec.ts",
      [
        "Error: Could not locate the bindings file.",
        "Tried:",
        " -> /repo/packages/api/node_modules/better-sqlite3/build/better_sqlite3.node",
        "Error: The module '/repo/packages/api/node_modules/better-sqlite3/build/Release/better_sqlite3.node'",
        "was compiled against a different Node.js version using NODE_MODULE_VERSION 115."
      ].join("\n")
    );

    expect(result).toEqual({
      category: "toolchain-mismatch",
      detail: "Error: Could not locate the bindings file."
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
