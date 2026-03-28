# End-to-End Product Delivery Workstreams

Historical note:

- This document is a forward-looking decomposition spec, not part of the active shipped contract.
- The active shipped contract remains `docs/specs/cstack-spec-v0.1.md`.
- The purpose of this document is to split future `cstack` expansion into independently shippable workstreams with clear team ownership, artifact boundaries, and evaluation rules.

## Thesis

`cstack` should extend from engineering-complete delivery toward a stronger end-to-end product delivery loop by adding independent workstreams that can each ship behind their own workflow, artifact, and inspection boundary.

The intended boundary for this expansion is:

1. intent
2. planning
3. implementation
4. validation
5. review
6. ship
7. post-ship feedback

This umbrella does not include GTM execution, broad product operations, or long-running remote agent orchestration as part of the required contract.

## Why Split Into Workstreams

The current product already ships:

- `discover`, `spec`, `build`, `review`, `ship`, and `deliver`
- durable run artifacts and lineage
- GitHub-aware delivery
- bounded delegation and specialist review
- artifact-grounded inspection

The missing gap is not one monolithic feature. It is a set of adjacent control-plane capabilities that should be designed, implemented, evaluated, and released independently.

## Workstream Set

Recommended execution order:

1. GitHub planning lineage
2. Validation intelligence
3. Post-ship feedback
4. Initiative graph and run control plane
5. Delivery checklist and deployment evidence
6. Capability-pack governance

Each workstream must satisfy three conditions:

- first useful release is independently shippable
- artifact contracts are explicit
- inspector and ledger impact is defined

## Workstream Index

### 1. GitHub planning lineage

Goal:

- make GitHub part of the planning control plane, not only the delivery control plane

Primary doc:

- `docs/specs/cstack-github-planning-lineage-slice.md`

### 2. Validation intelligence

Goal:

- upgrade `deliver` validation into a first-class repo-aware validation system

Primary doc:

- `docs/specs/cstack-deliver-validation-intelligence-slice.md`

### 3. Post-ship feedback

Goal:

- capture bounded post-ship evidence and follow-up generation without entering GTM operations

Primary doc:

- `docs/specs/cstack-post-ship-feedback-slice.md`

### 4. Initiative graph and run control plane

Goal:

- lift lineage from single-run state into initiative-level orchestration across runs, issues, PRs, and follow-ups

Primary doc:

- `docs/specs/cstack-initiative-graph-slice.md`

### 5. Delivery checklist and deployment evidence

Goal:

- strengthen final-delivery readiness through explicit deployment evidence references and repo-aware checklist policy

Primary doc:

- `docs/specs/cstack-delivery-checklist-deployment-evidence-slice.md`

### 6. Capability-pack governance

Goal:

- make workflow-attached capabilities explicit, policy-visible, and inspectable

Primary doc:

- `docs/specs/cstack-capability-pack-governance-slice.md`

## Shared Operating Rules

All workstreams must preserve the current product posture:

- local-first artifacts remain the durable source of truth
- `cstack` records requested behavior separately from observed behavior
- no workstream claims shipped scope in the active spec until implementation lands
- every new artifact family must be visible in `inspect`
- every new grouping or lineage surface must be visible in `runs` or an equivalent ledger view

## Evaluation Model

Each workstream should be evaluated independently on:

### Product value

- does it close a real gap in the current contract

### Operational independence

- can it ship without another workstream being complete

### Inspection quality

- can a user reconstruct what happened from artifacts alone

## Release Gates

A workstream is release-ready when:

1. artifact schema is defined
2. ledger and inspector implications are defined
3. acceptance criteria are testable
4. non-goals are explicit
5. integration points with other workstreams are additive rather than blocking

## GitHub Spec Issue

The corresponding GitHub issue draft for this umbrella lives at:

- `docs/research/cstack-end-to-end-product-delivery-issue-draft.md`
- `docs/research/cstack-workstream-kickoff-tracker.md`

That issue should build on:

- [#1](https://github.com/ganesh47/cstack/issues/1)
- [#2](https://github.com/ganesh47/cstack/issues/2)
- [#3](https://github.com/ganesh47/cstack/issues/3)
- [#4](https://github.com/ganesh47/cstack/issues/4)

without reopening their shipped baseline scope.
