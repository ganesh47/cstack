# Post-Ship Feedback Slice

Historical note:

- This document was originally written as a future slice spec and now records the post-ship feedback workstream that shipped on 2026-03-28.
- The active shipped contract remains `docs/specs/cstack-spec-v0.1.md`.
- This slice records how `cstack` grew from shipping readiness into bounded post-ship feedback capture.

## Thesis

`cstack` should extend past `ship` with a bounded post-ship feedback surface that records deployment-adjacent evidence, follow-up recommendations, and linked remediation work without turning into an operations platform.

## Why This Slice Exists

Current `ship` and `deliver` workflows can prove readiness and record delivery evidence.

What is still missing is a structured answer to:

- what happened after ship
- whether the shipped outcome triggered follow-up work
- which signals were observed versus inferred
- which new tasks should be created from those signals

## Product Decision

This slice adds a bounded post-ship phase or artifact family focused on evidence and follow-up generation.

It does not add:

- deployment orchestration
- incident response automation
- product analytics ownership
- customer support workflows

## Scope

This slice owns:

- post-ship artifact schemas
- deployment status references
- release state, check state, and issue-reopen signal capture
- production error or rollback references when available
- follow-up issue or task draft generation
- inspector views for post-ship state

This slice does not own:

- running deployments
- deep observability integrations as a required baseline
- non-engineering post-launch operations

## Independent Team Contract

The post-ship feedback team is responsible for:

- bounded evidence collection after `ship`
- clear observed-versus-inferred recording
- follow-up synthesis artifacts
- post-ship inspector views

The team is explicitly not responsible for:

- GitHub planning lineage
- validation strategy design
- initiative-wide grouping logic

## Outcome Model

A post-ship outcome should distinguish:

- observed external evidence
- inferred impact or recommendation
- unresolved follow-up work
- whether new issues or tasks should be created

Recommended statuses:

- `stable`
- `follow-up-required`
- `signal-unavailable`

Current implementation note:

- shipped post-ship evidence records explicit observed signals for ship readiness, GitHub delivery, issues, checks, actions, release, and security
- specialized rollback or issue-reopen handling is represented today through observed-signal summaries and follow-up recommendations rather than dedicated remote polling contracts

## Artifact Contract

Recommended additions:

- `artifacts/post-ship-summary.md`
- `artifacts/post-ship-evidence.json`
- `artifacts/follow-up-draft.md`
- `artifacts/follow-up-lineage.json`

Recommended meanings:

- `post-ship-summary.md`
  - human-readable summary of what happened after ship
- `post-ship-evidence.json`
  - structured observed evidence references and classification
- `follow-up-draft.md`
  - draft issue or task text created from post-ship signals
- `follow-up-lineage.json`
  - linkage from shipped run to newly created or recommended follow-up work

Recommended `post-ship-evidence.json` shape:

```json
{
  "status": "follow-up-required",
  "observedSignals": [
    {
      "kind": "release-state",
      "summary": "Release published successfully"
    },
    {
      "kind": "issue-reopened",
      "summary": "Linked issue #123 was reopened after release"
    }
  ],
  "inferredRecommendations": [
    "Create a follow-up investigation slice for regression in issue #123"
  ],
  "followUpRequired": true
}
```

## Inspector and Ledger Expectations

`inspect` should be able to show:

- post-ship status
- evidence references
- follow-up recommendations
- linked follow-up issue or task drafts

`runs` should be able to surface whether a shipped run later accumulated post-ship follow-up state.

## Acceptance Criteria

This slice is complete when:

- a shipped run can record post-ship evidence
- post-ship artifacts distinguish observed signals from inferred recommendations
- follow-up drafts can be generated from post-ship findings
- the slice stops at evidence and follow-up rather than operational execution

## Release Boundary

First release for this slice should include:

- post-ship artifact schema
- post-ship summary and evidence capture
- follow-up draft generation
- inspector support for post-ship state

It should not require:

- deployment orchestration
- mandatory observability vendor integrations
- initiative graph support

## Non-Goals

This slice should not:

- claim to monitor production continuously
- mutate external systems without explicit operator or policy control
- absorb support, sales, or GTM follow-up into the `cstack` workflow contract
