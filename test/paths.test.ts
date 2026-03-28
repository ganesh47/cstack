import { describe, expect, it } from "vitest";
import path from "node:path";
import { cstackRoot, runsRoot } from "../src/paths.js";

describe("paths", () => {
  it("resolves the cstack root relative to cwd", () => {
    expect(cstackRoot("/tmp/repo" )).toBe(path.join("/tmp/repo", ".cstack"));
  });

  it("resolves the runs root under cstack root", () => {
    expect(runsRoot("/tmp/repo" )).toBe(path.join("/tmp/repo", ".cstack", "runs"));
  });
});
