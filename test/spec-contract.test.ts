import { describe, expect, it } from "vitest";
import { buildBoundedSpecInput, deriveBoundedFirstSliceSeed } from "../src/spec-contract.js";

describe("spec contract helpers", () => {
  const broadPrompt = "What are the gaps in the current project and find them and fix them";
  const discoverFindings = [
    "# Discovery Report",
    "",
    "## Observed Local Findings",
    "- Delivery artifacts are not yet truthful. Both compose files still run placeholder commands rather than the application processes they describe.",
    "- The implemented API is only a subset of the published contract.",
    "- CI is permissive in places where the spec implies enforcement.",
    "",
    "## Recommended Focus For Spec Stage",
    "1. Make delivery artifacts truthful: either replace placeholder compose commands with real entrypoints or explicitly mark those flows as not yet supported.",
    "2. Tighten validation expectations: decide whether CI should fail hard on API, CLI, and connector checks.",
    "3. Reconcile target scope versus implemented scope.",
    ""
  ].join("\n");

  it("preselects a bounded first slice from discover findings for broad remediation prompts", () => {
    const seed = deriveBoundedFirstSliceSeed(broadPrompt, discoverFindings);

    expect(seed).not.toBeNull();
    expect(seed?.selectedSlice).toContain("delivery artifacts truthful");
    expect(seed?.filesInScope).toContain("docker/api/compose.yml");
    expect(seed?.outOfScope).toContain("Implementing ingest-job or connector-heartbeat endpoints.");
  });

  it("builds a narrowed spec input that fixes one slice instead of re-opening the full repo", () => {
    const input = buildBoundedSpecInput(broadPrompt, discoverFindings);

    expect(input).toContain("## Preselected First Slice");
    expect(input).toContain("docker/compose.stack.yml");
    expect(input).toContain("## Explicitly Out Of Scope");
    expect(input).toContain("## Linked Discover Findings");
    expect(input).toContain("Original User Request");
  });
});
