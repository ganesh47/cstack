import { describe, expect, it } from "vitest";
import { makeRunId } from "../src/run.js";

describe("makeRunId", () => {
  it("creates stable workflow-prefixed ids", () => {
    const id = makeRunId("spec", "Design a better run artifact model", new Date("2026-03-13T12:34:56.000Z"));
    expect(id).toContain("2026-03-13T12-34-56-000Z-spec-design-a-better-run-artifact-model");
  });
});
