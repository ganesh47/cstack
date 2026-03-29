# cstack Workstream Execution Tracker

Historical note:

- This document started as a forward-looking execution tracker and now serves as the execution record for the six workstreams completed on 2026-03-28.
- The active shipped contract remains `docs/specs/cstack-spec-v0.1.md`.
- The purpose of this document is to map each independent workstream to concrete code touchpoints, shipped scope, and test coverage.

## Completion Summary

- verification status: `npm run typecheck && npm test` passing on the completion branch
- umbrella issue updated: [#32](https://github.com/ganesh47/cstack/issues/32)
- child implementation updates posted: [#33](https://github.com/ganesh47/cstack/issues/33) through [#38](https://github.com/ganesh47/cstack/issues/38)

## Active Threads

- Umbrella issue: [#32](https://github.com/ganesh47/cstack/issues/32)
- Workstream issue [#33](https://github.com/ganesh47/cstack/issues/33): GitHub planning lineage
- Workstream issue [#34](https://github.com/ganesh47/cstack/issues/34): Validation intelligence
- Workstream issue [#35](https://github.com/ganesh47/cstack/issues/35): Post-ship feedback
- Workstream issue [#36](https://github.com/ganesh47/cstack/issues/36): Initiative graph and run control plane
- Workstream issue [#37](https://github.com/ganesh47/cstack/issues/37): Delivery checklist and deployment evidence
- Workstream issue [#38](https://github.com/ganesh47/cstack/issues/38): Capability-pack governance

## 1. [#33](https://github.com/ganesh47/cstack/issues/33): GitHub Planning Lineage

Issue:

- [#33](https://github.com/ganesh47/cstack/issues/33)
- kickoff comment: [issuecomment-4143525289](https://github.com/ganesh47/cstack/issues/33#issuecomment-4143525289)

Impacted files and modules:

- `src/types.ts`
- `src/run.ts`
- `src/commands/spec.ts`
- `src/commands/discover.ts`
- `src/commands/ship.ts`
- `src/commands/deliver.ts`
- `src/github.ts`
- `src/inspector.ts`
- `src/prompt.ts`
- `test/prompt.test.ts`
- `test/discover.test.ts`
- `test/intent.test.ts`
- `test/deliver.test.ts`

First shippable slice:

- add optional linked issue metadata to `RunRecord.inputs`
- let `spec` emit `artifacts/issue-draft.md`
- carry issue linkage through `discover`, `spec`, `ship`, and `deliver`
- show linked issue and downstream PR/release references in `inspect`

Risks and non-goals:

- do not make GitHub writes mandatory
- do not treat GitHub as the durable source of truth
- do not introduce initiative-level grouping in this slice

Tests to add:

- issue-linked `spec` run writes issue-draft artifact
- linked issue numbers persist in `run.json`
- inspector summary renders linked issue and related GitHub lineage

## 2. [#34](https://github.com/ganesh47/cstack/issues/34): Validation Intelligence

Issue:

- [#34](https://github.com/ganesh47/cstack/issues/34)
- kickoff comment: [issuecomment-4143536037](https://github.com/ganesh47/cstack/issues/34#issuecomment-4143536037)

Impacted files and modules:

- `src/validation.ts`
- `src/deliver.ts`
- `src/config.ts`
- `src/types.ts`
- `src/prompt.ts`
- `src/inspector.ts`
- `test/deliver.test.ts`
- `test/prompt.test.ts`

First shippable slice:

- tighten repo-profile and validation-plan artifact quality
- distinguish build failure versus validation failure more explicitly
- improve validation summary and inspection output before adding new tool families

Risks and non-goals:

- do not expand into deployment or post-ship logic
- do not overfit to one ecosystem
- do not require every repo to mutate GitHub Actions in v1 of this slice

Tests to add:

- validation artifacts include repo profile, plan, and coverage summary
- blocked validation after build failure is surfaced distinctly
- inspector renders validation state, pyramid, and CI validation coherently

## 3. [#35](https://github.com/ganesh47/cstack/issues/35): Post-Ship Feedback

Issue:

- [#35](https://github.com/ganesh47/cstack/issues/35)
- kickoff comment: [issuecomment-4143536156](https://github.com/ganesh47/cstack/issues/35#issuecomment-4143536156)

Impacted files and modules:

- `src/ship.ts`
- `src/deliver.ts`
- `src/github.ts`
- `src/inspector.ts`
- `src/types.ts`
- `test/deliver.test.ts`
- `test/intent.test.ts`

First shippable slice:

- add post-ship artifacts driven from existing ship and deliver evidence
- synthesize `post-ship-summary.md`, `post-ship-evidence.json`, and `follow-up-draft.md`
- expose post-ship state in `inspect`

Risks and non-goals:

- do not run deployments
- do not require live observability integration
- do not conflate observed signals with inferred follow-up recommendations

Tests to add:

- shipped run can write post-ship artifacts from existing evidence
- inspector renders observed signals separately from inferred follow-ups
- follow-up draft generation works without external mutation

## 4. [#36](https://github.com/ganesh47/cstack/issues/36): Initiative Graph And Run Control Plane

Issue:

- [#36](https://github.com/ganesh47/cstack/issues/36)
- kickoff comment: [issuecomment-4143536258](https://github.com/ganesh47/cstack/issues/36#issuecomment-4143536258)

Impacted files and modules:

- `src/types.ts`
- `src/run.ts`
- `src/commands/runs.ts`
- `src/commands/inspect.ts`
- `src/inspector.ts`
- `test/session-commands.test.ts`
- `test/intent.test.ts`

First shippable slice:

- add optional `initiativeId` and `initiativeTitle` to run metadata
- derive grouped initiative views from existing run directories
- extend `runs` and `inspect` to show initiative context without adding a remote service

Risks and non-goals:

- do not require every run to belong to an initiative
- do not introduce hidden global state
- do not merge initiative logic with GitHub issue mutation logic

Tests to add:

- runs with shared initiative metadata group correctly in ledger output
- inspect renders initiative summary and related run ids
- artifact-derived grouping works without auxiliary storage

## 5. [#37](https://github.com/ganesh47/cstack/issues/37): Delivery Checklist And Deployment Evidence

Issue:

- [#37](https://github.com/ganesh47/cstack/issues/37)
- kickoff comment: [issuecomment-4143536371](https://github.com/ganesh47/cstack/issues/37#issuecomment-4143536371)

Impacted files and modules:

- `src/ship.ts`
- `src/deliver.ts`
- `src/github.ts`
- `src/inspector.ts`
- `src/config.ts`
- `src/types.ts`
- `test/deliver.test.ts`
- `test/prompt.test.ts`

First shippable slice:

- add explicit readiness-policy artifact and deployment-evidence references
- classify blockers by readiness dimension instead of relying on one summary string
- expose readiness dimensions in `inspect`

Risks and non-goals:

- do not execute deployments
- do not require environment-specific policy for every repo
- do not blur deployment evidence with deployment control

Tests to add:

- ship and deliver write readiness-policy and deployment-evidence artifacts
- missing deployment evidence blocks only when policy requires it
- inspector renders blocker categories and readiness dimensions

## 6. [#38](https://github.com/ganesh47/cstack/issues/38): Capability-Pack Governance

Issue:

- [#38](https://github.com/ganesh47/cstack/issues/38)
- kickoff comment: [issuecomment-4143536514](https://github.com/ganesh47/cstack/issues/38#issuecomment-4143536514)

Impacted files and modules:

- `src/config.ts`
- `src/types.ts`
- `src/discover.ts`
- `src/validation.ts`
- `src/prompt.ts`
- `src/inspector.ts`
- `test/discover.test.ts`
- `test/prompt.test.ts`

First shippable slice:

- add workflow capability policy in config
- record allowed, requested, available, and used capabilities in artifacts
- start with discover-time external research policy visibility and inspector output

Risks and non-goals:

- do not turn capability packs into arbitrary prompt concatenation
- do not assume capability availability is stable across environments
- do not silently downgrade disallowed capabilities

Tests to add:

- config accepts capability policy for a workflow
- discover writes capability artifact showing requested versus available packs
- inspector renders capability downgrades and reasons

## Suggested Execution Order

1. [#33](https://github.com/ganesh47/cstack/issues/33) GitHub planning lineage
2. [#34](https://github.com/ganesh47/cstack/issues/34) Validation intelligence
3. [#37](https://github.com/ganesh47/cstack/issues/37) Delivery checklist and deployment evidence
4. [#35](https://github.com/ganesh47/cstack/issues/35) Post-ship feedback
5. [#36](https://github.com/ganesh47/cstack/issues/36) Initiative graph and run control plane
6. [#38](https://github.com/ganesh47/cstack/issues/38) Capability-pack governance

## Release Rule

No workstream should update the active shipped spec until its implementation lands and the README, tests, and `docs/specs/cstack-spec-v0.1.md` are aligned.
