# Spec: End-to-End Product Delivery Workstreams Beyond `gstack`

Builds on [#1](https://github.com/ganesh47/cstack/issues/1)
Related baseline: [#2](https://github.com/ganesh47/cstack/issues/2), [#3](https://github.com/ganesh47/cstack/issues/3), [#4](https://github.com/ganesh47/cstack/issues/4)
Informed by `docs/research/gstack-codex-interaction-model.md`  
Extends the forward-looking workstream decomposition in `docs/specs/cstack-end-to-end-workstreams-spec.md`

## Summary

`cstack` already ships a local-first Codex workflow wrapper with durable artifacts, lineage, bounded delegation, GitHub-aware delivery, and artifact-grounded inspection.

The next product question is not whether to copy `gstack`.

The next question is which workflow and control-plane capabilities from adjacent systems should extend `cstack` toward a more seamless end-to-end product delivery loop without breaking its local-first Codex-wrapper identity.

The intended boundary for this issue is:

1. intent
2. planning
3. implementation
4. validation
5. review
6. ship
7. post-ship feedback

This issue does not include GTM execution, broad product operations, or always-on remote agent orchestration.

## Why Now

The shipped workflow surface is strong at engineering-complete delivery:

- `discover`, `spec`, `build`, `review`, `ship`, `deliver`
- intent routing and stage lineage
- isolated execution for mutation workflows
- GitHub-aware readiness and mutation policy
- artifact-grounded inspection

What remains weaker is the control plane around that workflow:

- planning lineage across issues, runs, PRs, and releases
- validation intelligence as a first-class delivery surface
- bounded post-ship follow-up capture
- initiative-level grouping across many runs
- explicit capability policy for external research and attached tools

## Current `cstack` Baseline

Shipped baseline remains the active contract in `docs/specs/cstack-spec-v0.1.md`.

Important current capabilities:

- workflow-first operator model over Codex CLI
- durable local artifacts under `.cstack/runs/<run-id>/`
- bounded discover-team research and specialist review
- review and ship as first-class workflows
- deliver as umbrella workflow over build, validation, review, and ship
- GitHub-aware engineering delivery with PR, issue, checks, Actions, release, and mutation evidence

This issue should treat [#2](https://github.com/ganesh47/cstack/issues/2), [#3](https://github.com/ganesh47/cstack/issues/3), and [#4](https://github.com/ganesh47/cstack/issues/4) as shipped baseline rather than reopened scope.

## External Comparables

The comparison set should stay mixed and decision-oriented rather than turning into a generic competitor list.

For each comparable, capture:

- official URL
- execution posture: local-first, hybrid, or cloud-first
- what is genuinely comparable to `cstack`
- what is not comparable
- the transferable idea
- whether `cstack` should adopt, adapt, or reject it

Recommended comparison groups:

### Local-first workflow and coding tools

- `gstack`
- `aider`
- `Goose`
- `Claude Code` workflow patterns

### GitHub-centric delivery agents

- `GitHub Copilot coding agent`
- `Sweep`, only if the primary source clearly supports issue-to-PR workflow comparison

### Broader autonomous engineering systems

- `OpenHands`
- one additional tool only if the primary source clearly supports planning, execution, review, or artifact lineage comparison

## Transferable Patterns And Rejections

The synthesis should answer:

- which issue-to-PR or issue-to-run patterns transfer cleanly
- which artifact and inspection patterns transfer cleanly
- which validation and delivery-control patterns transfer cleanly
- which ideas should be rejected because they depend on cloud-first execution, hidden orchestration, or vague autonomous-company positioning

Default rejection set:

- permanent roleplay agent cast
- hidden orchestration that cannot be reconstructed from artifacts
- broad cloud control planes as the default product posture
- GTM or customer-ops execution inside the `cstack` workflow contract

## Proposed Workstreams

This issue should decompose the next expansion into six independently shippable workstreams:

1. GitHub planning lineage  
   `docs/specs/cstack-github-planning-lineage-slice.md`

2. Validation intelligence  
   `docs/specs/cstack-deliver-validation-intelligence-slice.md`

3. Post-ship feedback  
   `docs/specs/cstack-post-ship-feedback-slice.md`

4. Initiative graph and run control plane  
   `docs/specs/cstack-initiative-graph-slice.md`

5. Delivery checklist and deployment evidence  
   `docs/specs/cstack-delivery-checklist-deployment-evidence-slice.md`

6. Capability-pack governance  
   `docs/specs/cstack-capability-pack-governance-slice.md`

## Acceptance Criteria

This issue is complete when:

- the comparison catalog covers at least five real comparables grounded in primary sources
- each comparable clearly distinguishes transferable versus non-transferable patterns
- every proposed `cstack` expansion maps to a real current gap
- each workstream has its own artifact boundary, inspector impact, acceptance criteria, and release boundary
- the issue clearly separates shipped baseline from forward-looking scope
- follow-on implementation issues can be opened from the workstream slices without redefining the whole strategy

## Non-Goals

This issue should not:

- rewrite the active shipped spec as if these slices already exist
- reopen shipped closure work from [#2](https://github.com/ganesh47/cstack/issues/2), [#3](https://github.com/ganesh47/cstack/issues/3), or [#4](https://github.com/ganesh47/cstack/issues/4)
- collapse all six workstreams into one synchronized release
- redefine `cstack` as a generic autonomous platform

## Follow-On Issues

Each workstream should eventually become its own follow-on implementation issue or slice:

- issue-linked run metadata and issue synthesis
- deliver validation expansion
- post-ship feedback artifacts and follow-up generation
- initiative graph and grouped ledger views
- readiness policy and deployment evidence references
- capability-pack policy and capability visibility
