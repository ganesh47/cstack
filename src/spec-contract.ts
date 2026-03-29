function compact(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeHeading(input: string): string {
  return compact(input).toLowerCase();
}

function parseMarkdownSections(input: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = input.split("\n");
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentHeading) {
      return;
    }
    sections.set(currentHeading, currentLines.join("\n").trim());
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch?.[1]) {
      flush();
      currentHeading = normalizeHeading(headingMatch[1]);
      currentLines = [];
      continue;
    }
    if (currentHeading) {
      currentLines.push(line);
    }
  }

  flush();
  return sections;
}

function parseSectionItems(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^[0-9]+\.\s+/, "").trim())
    .filter(Boolean);
}

function firstNonHeadingLine(input: string): string {
  return (
    input
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ?? ""
  );
}

function uniqueItems(items: string[], limit = items.length): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const item of items.map((entry) => compact(entry)).filter(Boolean)) {
    const normalized = item.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(item);
    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

export interface SpecContractValidation {
  required: boolean;
  status: "not-required" | "valid" | "invalid";
  violations: string[];
  gapClusters: string[];
  selectedSlice: string;
  filesInScope: string[];
  validation: string[];
  outOfScope: string[];
}

export interface BoundedFirstSliceSeed {
  gapClusters: string[];
  selectedSlice: string;
  rationale: string;
  filesInScope: string[];
  validation: string[];
  outOfScope: string[];
}

export function isBroadGapRemediationPrompt(input: string): boolean {
  const lower = input.toLowerCase();
  const gapSignal =
    /\b(what are the gaps|gaps in (?:this|the current) project|what is missing|what's missing|gap|gaps|missing)\b/i.test(lower);
  const remediationSignal =
    /\b(fix|close(?:ing)? the gaps|remediate|resolve|address|implement|work on|repair)\b/i.test(lower);
  const broadScopeSignal =
    /\b(current project|this project|repository|repo|codebase|current state|find them)\b/i.test(lower) ||
    lower.split(/\s+/).filter(Boolean).length >= 10;

  return gapSignal && remediationSignal && broadScopeSignal;
}

function collectDiscoverGapCandidates(discoverFindings: string): string[] {
  const sections = parseMarkdownSections(discoverFindings);
  return uniqueItems([
    ...parseSectionItems(sections.get("recommended focus for spec stage") ?? ""),
    ...parseSectionItems(sections.get("observed local findings") ?? ""),
    ...parseSectionItems(sections.get("risks") ?? "")
  ]);
}

function pickBoundedFirstSlice(candidates: string[]): BoundedFirstSliceSeed {
  const joined = candidates.join("\n");
  const lower = joined.toLowerCase();

  if (/(placeholder|compose|docker|entrypoint|delivery artifacts|runnable compose|sbom|signing)/i.test(lower)) {
    return {
      gapClusters: uniqueItems(
        candidates.filter((candidate) =>
          /(placeholder|compose|docker|entrypoint|delivery artifacts|sbom|signing|docs describe)/i.test(candidate)
        ),
        3
      ),
      selectedSlice: "Make delivery artifacts truthful by reconciling placeholder compose entrypoints with documented runnable flows.",
      rationale:
        "This is a bounded operator-trust slice across compose and docs, and it avoids expanding immediately into missing API or connector feature work.",
      filesInScope: [
        "docker/api/compose.yml",
        "docker/compose.stack.yml",
        "docker/README.md",
        "specs/001-plan-alignment/quickstart.md"
      ],
      validation: [
        "Verify the compose files no longer advertise placeholder commands as runnable application flows.",
        "Verify the quickstart and Docker docs match the actual compose entrypoints and supported stack startup path.",
        "Record any still-unsupported flows explicitly instead of implying they already work."
      ],
      outOfScope: [
        "Implementing ingest-job or connector-heartbeat endpoints.",
        "Fastify major-version migration.",
        "Java connector feature completion.",
        "CI enforcement changes."
      ]
    };
  }

  if (/(ci|workflow|lint|test step|permissive|branch)/i.test(lower)) {
    return {
      gapClusters: uniqueItems(candidates.filter((candidate) => /(ci|workflow|lint|test|permissive)/i.test(candidate)), 3),
      selectedSlice: "Tighten one CI workflow so the documented validation checks fail closed instead of remaining permissive.",
      rationale:
        "This is a bounded reliability slice in one workflow file and provides clearer branch protection without requiring deeper product implementation.",
      filesInScope: [".github/workflows/stack-build.yml", "packages/api/package.json", "packages/cli/pyproject.toml"],
      validation: [
        "Verify the selected workflow no longer allows the targeted validation step to fail silently.",
        "Verify the workflow still matches the repo's runnable API and CLI commands.",
        "Document any remaining intentionally non-blocking checks."
      ],
      outOfScope: [
        "Adding new product features.",
        "Large-scale workflow restructuring.",
        "Docker/runtime entrypoint changes."
      ]
    };
  }

  if (/(fastify 5|fastify 4|stack is not fully reconciled|version)/i.test(lower)) {
    return {
      gapClusters: uniqueItems(candidates.filter((candidate) => /(fastify|stack|version)/i.test(candidate)), 3),
      selectedSlice: "Reconcile the documented Fastify target with the actual API dependency and document the chosen version truthfully.",
      rationale:
        "This is a narrow dependency-and-doc alignment slice that reduces planning drift before the build stage touches larger feature gaps.",
      filesInScope: ["packages/api/package.json", "packages/api/README.md", "specs/001-plan-alignment/spec.md"],
      validation: [
        "Verify the package manifest and docs now agree on the Fastify version expectation.",
        "Verify no remaining spec text promises a different API runtime baseline.",
        "Record follow-up migration work separately if a major-version move is deferred."
      ],
      outOfScope: [
        "Implementing missing endpoints.",
        "Compose/runtime fixes.",
        "Connector integration changes."
      ]
    };
  }

  if (/(contract|endpoint|heartbeat|integration test|api source)/i.test(lower)) {
    return {
      gapClusters: uniqueItems(candidates.filter((candidate) => /(contract|endpoint|heartbeat|integration test|api source)/i.test(candidate)), 3),
      selectedSlice: "Align one contract-facing integration path so the documented API surface and the exercised tests stop disagreeing.",
      rationale:
        "This is smaller than implementing the full missing feature set and gives the build stage a single contract-truth target to close first.",
      filesInScope: [
        "specs/001-plan-alignment/contracts/api.yaml",
        "packages/connectors/java/integration-tests/src/test/java/com/sqlite/metadata/integration/ApiContractTest.java",
        "packages/api/src/routes/graph.ts"
      ],
      validation: [
        "Verify the selected contract path and test fixture agree on route shape and payload expectations.",
        "Verify the API implementation matches the chosen contract slice or explicitly defers it.",
        "Leave broader endpoint backlog items as explicit follow-ups."
      ],
      outOfScope: [
        "Full API feature completion.",
        "Compose/documentation remediation.",
        "CI policy changes."
      ]
    };
  }

  const fallbackClusters = uniqueItems(candidates, 3);
  return {
    gapClusters: fallbackClusters,
    selectedSlice: fallbackClusters[0] ?? "Align one documented gap with the current implementation before broader remediation.",
    rationale:
      "The first slice should be a single repo-local correction with clear files, validation, and boundaries rather than a multi-epic implementation plan.",
    filesInScope: ["README.md", "docs/project-readme.md", "specs/001-plan-alignment/spec.md"],
    validation: [
      "Verify the selected slice leaves one truth-aligned artifact set behind.",
      "Verify the resulting plan stays within one bounded change set."
    ],
    outOfScope: [
      "Repo-wide rewrites.",
      "Parallel remediation workstreams.",
      "Unbounded feature implementation."
    ]
  };
}

export function deriveBoundedFirstSliceSeed(userPrompt: string, discoverFindings: string): BoundedFirstSliceSeed | null {
  if (!isBroadGapRemediationPrompt(userPrompt)) {
    return null;
  }

  const candidates = collectDiscoverGapCandidates(discoverFindings);
  if (candidates.length === 0) {
    return null;
  }

  return pickBoundedFirstSlice(candidates);
}

export function buildBoundedSpecInput(userPrompt: string, discoverFindings: string): string | null {
  const seed = deriveBoundedFirstSliceSeed(userPrompt, discoverFindings);
  if (!seed) {
    return null;
  }

  return [
    "Plan exactly one bounded first remediation slice for the broad request below.",
    "",
    "## Preselected First Slice",
    seed.selectedSlice,
    "",
    "## Why This Slice First",
    `- ${seed.rationale}`,
    "",
    "## Gap Clusters From Discover",
    ...seed.gapClusters.map((cluster) => `- ${cluster}`),
    "",
    "## Files Likely In Scope",
    ...seed.filesInScope.map((file) => `- ${file}`),
    "",
    "## Validation Expectations",
    ...seed.validation.map((item) => `- ${item}`),
    "",
    "## Explicitly Out Of Scope",
    ...seed.outOfScope.map((item) => `- ${item}`),
    "",
    "## Original User Request",
    userPrompt,
    "",
    "## Linked Discover Findings",
    discoverFindings.trim()
  ].join("\n");
}

export function validateSpecOutput(userPrompt: string, finalBody: string): SpecContractValidation {
  if (!isBroadGapRemediationPrompt(userPrompt)) {
    return {
      required: false,
      status: "not-required",
      violations: [],
      gapClusters: [],
      selectedSlice: "",
      filesInScope: [],
      validation: [],
      outOfScope: []
    };
  }

  const sections = parseMarkdownSections(finalBody);
  const gapClusters = parseSectionItems(sections.get("gap clusters") ?? "");
  const selectedSlice = compact(sections.get("selected first slice") ?? "");
  const filesInScope = parseSectionItems(sections.get("files in scope") ?? "");
  const validation = parseSectionItems(sections.get("validation") ?? "");
  const outOfScope = parseSectionItems(sections.get("out of scope") ?? "");
  const violations: string[] = [];

  if (gapClusters.length === 0) {
    violations.push("missing required section: ## Gap Clusters");
  } else if (gapClusters.length > 3) {
    violations.push("## Gap Clusters must list at most 3 entries");
  }
  if (!selectedSlice) {
    violations.push("missing required section: ## Selected First Slice");
  }
  if (filesInScope.length === 0) {
    violations.push("missing required section: ## Files In Scope");
  }
  if (validation.length === 0) {
    violations.push("missing required section: ## Validation");
  }
  if (outOfScope.length === 0) {
    violations.push("missing required section: ## Out Of Scope");
  }

  return {
    required: true,
    status: violations.length > 0 ? "invalid" : "valid",
    violations,
    gapClusters,
    selectedSlice,
    filesInScope,
    validation,
    outOfScope
  };
}

export function deriveSpecPlanArtifact(
  finalBody: string,
  contract: SpecContractValidation
): Record<string, unknown> {
  const lines = finalBody
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines.filter((line) => line.startsWith("- ") || /^[0-9]+\.\s/.test(line)).slice(0, 12);
  const questions = lines.filter((line) => line.includes("?"));

  return {
    summary: firstNonHeadingLine(finalBody),
    steps: bullets.map((line) => line.replace(/^-\s+/, "").replace(/^[0-9]+\.\s+/, "")),
    openQuestions: questions,
    contractStatus: contract.status,
    ...(contract.required
      ? {
          gapClusters: contract.gapClusters,
          selectedSlice: contract.selectedSlice,
          filesInScope: contract.filesInScope,
          validation: contract.validation,
          outOfScope: contract.outOfScope,
          violations: contract.violations
        }
      : {})
  };
}

export function buildSpecContractError(contract: SpecContractValidation): string {
  return `spec output did not satisfy bounded first-slice contract for a broad prompt: ${contract.violations.join("; ")}`;
}
