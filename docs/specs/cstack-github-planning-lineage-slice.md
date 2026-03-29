# GitHub Planning Lineage Slice

Historical note:

- This document was originally written as a future slice spec and now records the GitHub planning-lineage workstream that shipped on 2026-03-28.
- The active shipped contract remains `docs/specs/cstack-spec-v0.1.md`.
- This slice records how GitHub became part of the planning control plane for `cstack`.

## Thesis

`cstack` should treat GitHub issues as first-class planning anchors that can be linked to `discover`, `spec`, `build`, `review`, `ship`, and `deliver` runs through durable local artifacts.

## Why This Slice Exists

Current `cstack` already uses GitHub as part of delivery:

- issue linkage during ship and deliver
- PR and release evidence
- GitHub-aware readiness evaluation

What is still missing is planning lineage:

- explicit run-to-issue relationships
- issue-aware spec synthesis
- inspector views that show issue, PR, and release lineage together
- artifact contracts that let the user reconstruct the planning graph locally

## Product Decision

This slice makes GitHub part of the planning control plane without making GitHub the durable source of truth.

The durable source of truth remains the local run directory. GitHub linkage is recorded as referenced external state.

## Scope

This slice owns:

- issue-to-run linkage in run metadata
- spec issue synthesis from saved planning artifacts
- issue references inside run artifacts
- issue and PR lineage views in `inspect`
- local artifact schemas for issue linkage and planning lineage

This slice does not own:

- deployment evidence
- post-ship monitoring loops
- validation strategy generation

## Independent Team Contract

The GitHub planning lineage team is responsible for:

- run metadata additions for issue linkage
- issue-aware `spec` and planning outputs
- artifact storage for linked issue state
- inspector support for upstream and downstream GitHub planning lineage

The team is explicitly not responsible for:

- introducing a new deployment workflow
- changing the validation stage logic
- building initiative-level grouping beyond issue-scoped lineage

## Command and Workflow Impact

Likely future surface:

- `spec --issue <n>`
- `discover --issue <n>`
- `deliver --issue <n>` continues to exist, but records richer linkage
- optional issue synthesis or issue-update step from `spec`

Hard rule:

- any GitHub write must remain optional and policy-driven
- the local run must still be useful even when GitHub mutation is disabled

## Artifact Contract

Recommended additions:

- `artifacts/github-planning.json`
- `artifacts/issue-draft.md`
- `artifacts/issue-lineage.json`

Recommended meanings:

- `github-planning.json`
  - normalized issue linkage and planning state observed or requested for the run
- `issue-draft.md`
  - proposed issue body synthesized from `discover` or `spec` artifacts
- `issue-lineage.json`
  - issue, run, PR, and release references connected to this run

Recommended `issue-lineage.json` shape:

```json
{
  "linkedIssue": {
    "number": 123,
    "repo": "ganesh47/cstack",
    "state": "open"
  },
  "sourceRuns": [
    {
      "runId": "discover-20260327-120000",
      "workflow": "discover"
    }
  ],
  "derivedRuns": [
    {
      "runId": "spec-20260327-121500",
      "workflow": "spec"
    }
  ],
  "pullRequests": [
    {
      "number": 45,
      "state": "open"
    }
  ],
  "releases": [
    {
      "tag": "v0.18.0",
      "state": "draft"
    }
  ]
}
```

## Inspector and Ledger Expectations

`inspect` should be able to show:

- linked issue
- source planning runs
- downstream PR and release references
- whether issue linkage was requested, observed, created, updated, or unavailable

`runs` should be able to filter or summarize by linked issue when this slice ships.

## Acceptance Criteria

This slice is complete when:

- a run can be explicitly tied to a GitHub issue
- `spec` can emit a structured issue draft artifact
- `inspect` can show upstream and downstream issue and PR lineage
- all issue lineage is reconstructable from local artifacts alone

## Release Boundary

First release for this slice should include:

- issue-linked run metadata
- issue draft synthesis capability
- issue-aware inspector support

It should not require:

- post-ship feedback support
- initiative graph support
- deployment evidence support

## Non-Goals

This slice should not:

- make GitHub the only planning surface
- require issue mutation for local planning workflows
- hide GitHub API gaps behind fake certainty
- introduce broad project-management abstractions beyond issue-scoped lineage
