# Initiative Graph And Run Control Plane Slice

Historical note:

- This document was originally written as a future slice spec and now records the initiative-graph workstream that shipped on 2026-03-28.
- The active shipped contract remains `docs/specs/cstack-spec-v0.1.md`.
- This slice records how `cstack` moved from single-run lineage into initiative-level grouping and inspection.

## Thesis

`cstack` should support a higher-level initiative graph that groups issues, runs, pull requests, releases, mitigations, and follow-up work into one local-first control plane without introducing a remote scheduler or database as the source of truth.

## Why This Slice Exists

Current lineage is strong inside one run and across direct parent-child run relationships.

What remains missing is a durable answer to:

- which runs belong to one initiative
- which PRs and issues are part of the same product effort
- how follow-up mitigations connect back to the originating work
- how operators inspect one initiative rather than one run at a time

## Product Decision

This slice adds initiative-level metadata and inspection while keeping run directories as the source of truth.

The first release should use artifact-derived grouping, not a separate service or hidden state store.

## Scope

This slice owns:

- initiative or epic identifiers in run metadata
- initiative graph artifacts
- grouped inspection over related runs, issues, PRs, releases, and follow-ups
- initiative-aware run ledger views
- parent-child work item linkage above the single-run level

This slice does not own:

- validation internals
- deployment evidence collection
- GitHub mutation semantics already handled by ship or deliver

## Independent Team Contract

The initiative graph team is responsible for:

- initiative metadata model
- cross-run graph artifact model
- initiative-aware `runs` output
- grouped `inspect` surfaces

The team is explicitly not responsible for:

- adding new workflow stages
- changing review or ship policy
- replacing local artifacts with a persistent service

## Metadata Model

Recommended additions to run metadata:

- `initiativeId`
- `initiativeTitle`
- `parentWorkItem`
- `relatedWorkItems`

Recommended work item kinds:

- `issue`
- `run`
- `pull-request`
- `release`
- `follow-up`
- `mitigation`

## Artifact Contract

Recommended additions:

- `artifacts/initiative-graph.json`
- `artifacts/initiative-summary.md`

Recommended meanings:

- `initiative-graph.json`
  - normalized relationship graph for the current initiative
- `initiative-summary.md`
  - operator-readable summary of current initiative state, open branches, and remaining work

Recommended `initiative-graph.json` shape:

```json
{
  "initiative": {
    "id": "initiative-identity-hardening",
    "title": "Identity hardening"
  },
  "nodes": [
    {
      "kind": "issue",
      "id": "issue-123",
      "label": "#123"
    },
    {
      "kind": "run",
      "id": "spec-20260327-120000",
      "label": "spec"
    }
  ],
  "edges": [
    {
      "from": "issue-123",
      "to": "spec-20260327-120000",
      "type": "planned-by"
    }
  ]
}
```

## Ledger and Inspector Expectations

`runs` should be able to:

- group by initiative
- summarize initiative status
- show recent runs within one initiative

`inspect` should be able to:

- show the initiative summary
- show related issues, PRs, releases, and follow-ups
- explain how a mitigation or follow-up connects back to the originating initiative

## Acceptance Criteria

This slice is complete when:

- multiple runs can be grouped under one initiative
- `runs` and `inspect` can surface initiative-level state
- initiative lineage remains artifact-derived and local-first
- follow-up and mitigation work can be connected back to the originating initiative

## Release Boundary

First release for this slice should include:

- initiative metadata in runs
- initiative graph artifacts
- initiative-aware ledger and inspector views

It should not require:

- GitHub issue mutation
- post-ship feedback support
- capability-pack policy support

## Non-Goals

This slice should not:

- become a generic PM tool
- require every run to belong to an initiative
- introduce opaque global state that cannot be rebuilt from artifacts
