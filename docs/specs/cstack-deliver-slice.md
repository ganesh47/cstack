# Deliver Slice v1

## Goal

Implement a first-class `cstack deliver` workflow as the umbrella execution phase for:

- `build`
- `review`
- `ship`

This slice keeps those internal stages explicit in artifacts and inspection, even though the operator enters through one top-level command.

For the `cstack` repo and other GitHub-native repos, `deliver` should be specified as engineering-complete delivery inside GitHub. It should stop only at GTM or broader market launch work.

## Command Surface

Supported commands in this slice:

```bash
cstack deliver "<task>"
cstack deliver --from-run <run-id>
cstack deliver --from-run <run-id> --exec
```

Behavior:

- `cstack deliver "<task>"` starts a delivery run from a direct implementation request
- `cstack deliver --from-run <run-id>` links a prior `spec`, `intent`, or `build`-ready run into the delivery context
- `cstack deliver --exec` forces the build sub-stage to use `codex exec`
- default mode is interactive for the internal build sub-stage when a TTY is available
- `review` and `ship` remain deterministic `codex exec`-backed sub-stages in this slice

Rejected in this slice:

- remote deployment orchestration
- wrapper-native GTM or market-launch workflows
- unbounded multi-agent swarms
- implicit release mutation outside the local repo, GitHub, and saved artifacts

## Design Principles

- `deliver` is the operator-facing umbrella workflow
- `build`, `review`, and `ship` remain explicit internal stages
- each stage must leave inspectable artifacts
- stage failure must stop the later stages unless the wrapper records an explicit skip/defer decision
- stage lineage must be reconstructable from saved files alone
- `deliver` must fail closed: if GitHub-complete engineering delivery cannot be proven from artifacts, the run is not complete

## Internal Stage Model

`deliver` runs:

1. `build`
2. `review`
3. `ship`

Stage contracts:

- `build` edits code, runs bounded verification, and records session lineage
- `review` critiques the produced change set and build artifacts
- `ship` produces final GitHub completion and release artifacts from the build and review outputs

## Delivery Guarantee

Within the GitHub assumption, `deliver` is successful only when all required engineering gates are complete and evidenced in artifacts.

At minimum, a successful `deliver` run should prove:

- implementation work is complete relative to the approved spec or the remaining gap is explicitly recorded as non-blocking
- required local verification commands passed
- required reviewer and specialist findings are resolved or accepted with policy-backed rationale
- the branch and pull request state satisfy repo policy
- required GitHub checks succeeded
- versioning, changelog, release notes, and packaging state satisfy repo policy when the task is release-bearing
- a tag and GitHub Release exist when the workflow target is a published release
- blocking unresolved items are empty at the end of the run

`deliver` does not own GTM, announcements, support readiness, or broader market launch work.

## Multi-Agent Topology

The durable workflow is one `Delivery Lead`.

Bounded roles in this slice:

- `implementation-lead`
- `security-review`
- `devsecops-review`
- `audit-review`
- `release-pipeline-review`

Rules:

- do not run all specialists by default
- choose specialists only when the prompt or linked artifacts justify them
- specialist outputs stay advisory until accepted by the lead
- preserve the acceptance or discard disposition in artifacts

## Artifact Contract

Top-level deliver artifacts:

- `run.json`
- `prompt.md`
- `context.md`
- `final.md`
- `events.jsonl`
- `stdout.log`
- `stderr.log`
- `stage-lineage.json`
- `artifacts/delivery-report.md`
- `artifacts/github-delivery.json`

Build sub-stage:

- `stages/build/prompt.md`
- `stages/build/context.md`
- `stages/build/final.md`
- `stages/build/events.jsonl`
- `stages/build/session.json`
- `stages/build/artifacts/change-summary.md`
- `stages/build/artifacts/verification.json`
- `stages/build/artifacts/build-transcript.log` when interactive capture exists

Review sub-stage:

- `stages/review/prompt.md`
- `stages/review/context.md`
- `stages/review/final.md`
- `stages/review/events.jsonl`
- `stages/review/artifacts/findings.md`
- `stages/review/artifacts/verdict.json`

Ship sub-stage:

- `stages/ship/prompt.md`
- `stages/ship/context.md`
- `stages/ship/final.md`
- `stages/ship/events.jsonl`
- `stages/ship/artifacts/ship-summary.md`
- `stages/ship/artifacts/release-checklist.md`
- `stages/ship/artifacts/unresolved.md`
- `stages/ship/artifacts/github-state.json`
- `stages/ship/artifacts/pull-request.json`
- `stages/ship/artifacts/checks.json`
- `stages/ship/artifacts/release.json`

## Intent Integration

This slice changes the recommended handoff:

- `intent` may still infer `build`, `review`, and `ship`
- if those stages are implied together, the handoff recommendation should prefer `cstack deliver --from-run <run-id>`
- `intent` still does not auto-launch the delivery workflow in this slice

## Inspector Expectations

`cstack inspect <run-id>` for deliver runs should show:

- stage strip for `build`, `review`, and `ship`
- build session and verification state when present
- GitHub delivery evidence and blocking gaps when present
- stage-specific artifacts through `show artifact <path>`
- resume and fork guidance derived from the build stage session record

Useful artifact paths:

- `stages/build/artifacts/change-summary.md`
- `stages/build/artifacts/verification.json`
- `stages/review/artifacts/findings.md`
- `stages/review/artifacts/verdict.json`
- `stages/ship/artifacts/ship-summary.md`
- `stages/ship/artifacts/release-checklist.md`
- `stages/ship/artifacts/unresolved.md`
- `stages/ship/artifacts/github-state.json`
- `stages/ship/artifacts/pull-request.json`
- `stages/ship/artifacts/checks.json`
- `stages/ship/artifacts/release.json`

## Known Limitations

- `deliver` owns GitHub-complete engineering delivery, not GTM or broader launch execution
- remote production deployment remains out of scope unless the repo explicitly defines it as a GitHub-driven release action
- specialist review remains bounded and prompt-driven rather than a separate scheduler
- wrapper-native GTM remains a later workflow after `deliver`
- wrapper-native `resume` and `fork` are still recommendations, not first-class commands

## Acceptance For This Slice

This slice is complete when:

- `cstack deliver` exists and works
- linked-run delivery works
- `build`, `review`, and `ship` artifacts are written inside one deliver run
- GitHub delivery evidence is written for branch, PR, checks, and release state when applicable
- inspector can explain stage progression and build-session lineage
- the run only reports `completed` when all required GitHub-scoped gates are satisfied
- tests cover direct deliver and linked deliver flows
- docs and release guidance are updated
