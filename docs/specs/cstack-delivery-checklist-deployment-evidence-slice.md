# Delivery Checklist And Deployment Evidence Slice

Historical note:

- This document is a future slice spec, not part of the active shipped contract.
- The active shipped contract remains `docs/specs/cstack-spec-v0.1.md`.
- This slice defines how `ship` and `deliver` should grow a stronger final-delivery readiness contract.

## Thesis

`ship` and `deliver` should evaluate a stronger repo-aware readiness contract that includes deployment evidence references, explicit checklist policy, and clearer blocker classification without making `cstack` responsible for running deployments.

## Why This Slice Exists

Current `ship` and `deliver` already record:

- ship summaries
- release checklists
- unresolved blockers
- GitHub delivery evidence

What remains missing is a more explicit and inspectable final-delivery contract:

- which environments or deployment targets matter
- which evidence is required for handoff
- which checks or approvals are required by policy
- why a run is ready, blocked, or partial

## Product Decision

This slice strengthens readiness evaluation and artifact quality around final delivery.

It explicitly stops short of:

- deployment orchestration
- environment mutation
- remote release execution beyond what current ship or deliver policy already allows

## Scope

This slice owns:

- delivery checklist policy
- deployment evidence references
- required checks and approvals classification
- unresolved blocker taxonomy
- richer handoff artifacts for ship and deliver

This slice does not own:

- issue synthesis
- post-ship remediation generation beyond emitting handoff-ready data
- validation strategy design

## Independent Team Contract

The delivery checklist team is responsible for:

- readiness policy model
- deployment evidence references
- upgraded `ship` and `deliver` artifacts
- inspector views for final-delivery evidence and blockers

The team is explicitly not responsible for:

- executing deployments
- changing GitHub planning lineage
- initiative-level grouping logic

## Readiness Model

The first release should support explicit readiness dimensions such as:

- source change complete
- validation evidence complete
- review outcome acceptable
- required checks complete
- linked issue state acceptable
- release evidence complete when `--release` is active
- deployment evidence referenced when repo policy requires it

Recommended readiness outcomes:

- `ready`
- `changes-requested`
- `blocked`
- `partial`

## Artifact Contract

Recommended upgrades:

- `artifacts/release-checklist.md`
- `artifacts/ship-record.json`
- `artifacts/github-delivery.json`
- `artifacts/delivery-report.md`

Recommended additions:

- `artifacts/deployment-evidence.json`
- `artifacts/readiness-policy.json`

Recommended meanings:

- `deployment-evidence.json`
  - references to environment, deployment, or release evidence relevant to final handoff
- `readiness-policy.json`
  - normalized checklist requirements and evaluated status for the run

Recommended `readiness-policy.json` shape:

```json
{
  "mode": "release",
  "requirements": [
    {
      "name": "required-checks",
      "status": "satisfied"
    },
    {
      "name": "deployment-evidence",
      "status": "missing"
    }
  ],
  "overallStatus": "blocked"
}
```

## Inspector Expectations

`inspect` should be able to show:

- readiness dimensions
- unresolved blockers by category
- deployment evidence references
- whether readiness was blocked by missing evidence, failed checks, or policy mismatch

## Acceptance Criteria

This slice is complete when:

- `ship` and `deliver` can express a repo-aware readiness contract
- deployment evidence can be referenced and inspected without `cstack` owning deployment execution
- unresolved blockers are classified clearly
- final artifacts make handoff quality auditable

## Release Boundary

First release for this slice should include:

- upgraded `ship` and `deliver` readiness artifacts
- deployment evidence references
- explicit readiness-policy evaluation
- inspector support for final-delivery evidence and blockers

It should not require:

- deployment automation
- post-ship feedback support
- initiative graph support

## Non-Goals

This slice should not:

- claim that referencing deployment evidence equals executing deployments
- force environment-specific policy on repos that do not need it
- hide missing evidence inside vague readiness summaries
