# Autonomous Workstream Kickoff Tracker

Historical note:

- This document started as a kickoff tracker and now remains as the kickoff-to-completion record for umbrella issue [#32](https://github.com/ganesh47/cstack/issues/32) and workstream issues [#33](https://github.com/ganesh47/cstack/issues/33) through [#38](https://github.com/ganesh47/cstack/issues/38).

## Completion Summary

- all six workstreams were completed and verified on 2026-03-28
- the active shipped contract is captured in `docs/specs/cstack-spec-v0.1.md`
- the issue threads now include implementation-complete status updates for the umbrella and each child slice

## Umbrella

- umbrella issue: [#32](https://github.com/ganesh47/cstack/issues/32)
- child issues:
  - [#33](https://github.com/ganesh47/cstack/issues/33) GitHub planning lineage
  - [#34](https://github.com/ganesh47/cstack/issues/34) Validation intelligence
  - [#35](https://github.com/ganesh47/cstack/issues/35) Post-ship feedback
  - [#36](https://github.com/ganesh47/cstack/issues/36) Initiative graph and run control plane
  - [#37](https://github.com/ganesh47/cstack/issues/37) Delivery checklist and deployment evidence
  - [#38](https://github.com/ganesh47/cstack/issues/38) Capability-pack governance

## Workstream [#33](https://github.com/ganesh47/cstack/issues/33): GitHub Planning Lineage

### Impacted files and modules

- `src/types.ts`
  - extend `RunRecord.inputs`
  - extend `RunLedgerEntry`
  - extend `RunInspection`
  - add issue-lineage and issue-draft record types
- `src/commands/spec.ts`
  - add `--issue <n>` support
  - write issue draft and issue-lineage artifacts
- `src/commands/discover.ts`
  - add optional issue linkage for upstream planning runs
- `src/run.ts`
  - surface linked issue in ledger entries
- `src/inspector.ts`
  - load and render issue-lineage artifacts
  - add `show issue-lineage` or equivalent summary output
- `src/github.ts`
  - reuse existing issue parsing and issue state collection logic instead of duplicating GitHub lookups
- tests:
  - `test/spec.test.ts`
  - `test/inspect.test.ts`
  - `test/runs.test.ts`
  - likely `test/deliver.test.ts` or `test/ship.test.ts` for downstream lineage continuity

### First independently shippable slice

- add `--issue <n>` to `spec`
- persist linked issue numbers into `run.json`
- synthesize `artifacts/issue-draft.md` from the spec output
- synthesize `artifacts/issue-lineage.json` with linked issue, source run, and placeholder downstream PR/release slots
- show linked issue and issue draft presence in `inspect`

This slice should not require GitHub mutation. It is useful even if the issue already exists and the user only wants durable linkage plus a draft body.

### Key risks and non-goals

- do not make GitHub the durable source of truth; the run directory stays primary
- do not broaden the first slice into initiative graph semantics
- do not require `discover`, `spec`, and `deliver` all to ship together; `spec` linkage is enough for v1
- avoid duplicating GitHub issue parsing already present in `src/github.ts`

### Tests to add

- `spec --issue 123` writes issue-linked run metadata and issue artifacts
- linked issue flows through `inspect`
- ledger JSON includes linked issue numbers when present
- no GitHub access required for local issue-draft generation

## Workstream [#34](https://github.com/ganesh47/cstack/issues/34): Validation Intelligence

### Impacted files and modules

- `src/validation.ts`
  - primary implementation surface
  - repo profiling, tool research, local validation records, coverage summaries
- `src/deliver.ts`
  - validation stage wiring and failure handling
- `src/prompt.ts`
  - validation lead and specialist prompt contracts
- `src/inspector.ts`
  - `show validation`, `show pyramid`, `show coverage`, `show ci-validation`, `show tool-research`
- `src/config.ts`
  - validation config validation and defaults
- tests:
  - `test/validation.test.ts`
  - `test/deliver.test.ts`
  - `test/inspect.test.ts`

### First independently shippable slice

- strengthen the existing validation stage by making workspace-aware validation selection first-class in the saved plan
- improve `validation-plan.json` and `local-validation.json` to distinguish:
  - root-native commands
  - workspace-specific inventory-only targets
  - deferred validation layers
- surface those distinctions in `inspect`

This stays inside `deliver` and does not require new top-level CLI surface.

### Key risks and non-goals

- do not attempt universal auto-generation of tests across all ecosystems in the first slice
- keep local and CI parity visible even when incomplete
- avoid hidden mutation of CI workflows without explicit artifact evidence
- keep failure summaries separated from build failure, which is already handled in `src/deliver.ts`

### Tests to add

- mixed-workspace repo yields a validation plan with explicit support levels
- inspector shows deferred versus supported layers clearly
- validation failure remains distinguishable from build failure
- tool research output remains deterministic for existing fixtures

## Workstream [#35](https://github.com/ganesh47/cstack/issues/35): Post-Ship Feedback

### Impacted files and modules

- `src/types.ts`
  - add post-ship evidence, status, and follow-up draft types
  - extend `RunInspection`
- `src/ship.ts`
  - write post-ship summary and evidence placeholders for standalone ship runs
- `src/deliver.ts`
  - write top-level post-ship artifacts after ship evidence is available
- `src/github.ts`
  - reuse existing issue, checks, actions, and release evidence already collected
- `src/inspector.ts`
  - load and render post-ship artifacts
  - add `show post-ship` or equivalent
- tests:
  - `test/ship.test.ts`
  - `test/deliver.test.ts`
  - `test/inspect.test.ts`

### First independently shippable slice

- add a passive post-ship artifact family:
  - `artifacts/post-ship-summary.md`
  - `artifacts/post-ship-evidence.json`
  - `artifacts/follow-up-draft.md`
- populate those artifacts purely from existing ship and GitHub evidence:
  - linked issue state
  - required checks state
  - release evidence
  - security gate state
- generate follow-up recommendations without mutating deployments or observability systems

### Key risks and non-goals

- do not attempt continuous monitoring
- do not add deployment orchestration
- keep observed evidence separate from inferred follow-up recommendations
- avoid coupling the first slice to initiative graph semantics

### Tests to add

- ready ship run still writes stable post-ship artifacts
- blocked ship run produces follow-up recommendations instead of silent failure
- inspector can render post-ship evidence from saved artifacts
- deliver writes the same post-ship artifact family at the top level

## Workstream [#36](https://github.com/ganesh47/cstack/issues/36): Initiative Graph And Run Control Plane

### Impacted files and modules

- `src/types.ts`
  - extend `RunRecord.inputs` with initiative metadata
  - extend `RunLedgerEntry`
  - add initiative graph record types
- `src/run.ts`
  - derive initiative-aware ledger entries
- `src/commands/runs.ts`
  - add filtering or grouping by initiative
- `src/inspector.ts`
  - load initiative graph artifacts
  - add grouped lineage summary in the inspection view
- likely `src/commands/spec.ts`, `src/commands/build.ts`, `src/commands/ship.ts`, `src/commands/deliver.ts`
  - accept initiative identifiers and persist them in runs
- tests:
  - `test/runs.test.ts`
  - `test/inspect.test.ts`
  - targeted command tests for one initiating workflow such as `spec`

### First independently shippable slice

- add optional `initiativeId` and `initiativeTitle` to one planning workflow first, ideally `spec`
- persist `artifacts/initiative-graph.json` and `artifacts/initiative-summary.md`
- extend `runs --json` and `inspect` to show initiative linkage
- support grouping only across local run metadata in v1

### Key risks and non-goals

- do not build a remote state service
- do not require every run to belong to an initiative
- do not broaden the first slice into issue mutation or post-ship follow-up generation
- keep grouping artifact-derived and rebuildable from local state

### Tests to add

- ledger filtering or grouping by initiative
- inspect summary shows initiative id and related local runs
- malformed initiative graph artifacts degrade gracefully
- runs without initiative metadata still render exactly as before

## Workstream [#37](https://github.com/ganesh47/cstack/issues/37): Delivery Checklist And Deployment Evidence

### Impacted files and modules

- `src/types.ts`
  - extend `DeliverShipRecord`
  - extend `GitHubDeliveryRecord` or add readiness-policy/deployment-evidence records
  - extend `RunInspection`
- `src/ship.ts`
  - write explicit readiness-policy and deployment-evidence artifacts
- `src/deliver.ts`
  - propagate those artifacts into deliver top-level and stage-local outputs
- `src/github.ts`
  - reuse existing checks, issue, action, release, and security evidence to evaluate explicit readiness dimensions
- `src/config.ts`
  - add optional policy flags for deployment evidence requirements
- `src/inspector.ts`
  - render readiness dimensions and deployment evidence
- tests:
  - `test/ship.test.ts`
  - `test/deliver.test.ts`
  - `test/inspect.test.ts`
  - possibly `test/config.test.ts`

### First independently shippable slice

- keep the current ship and deliver control flow
- add two new artifacts:
  - `artifacts/readiness-policy.json`
  - `artifacts/deployment-evidence.json`
- classify readiness dimensions explicitly:
  - review
  - checks
  - issues
  - actions
  - release
  - deployment evidence
- deployment evidence may be reference-only in v1, for example a URL, tag, environment name, or artifact note

### Key risks and non-goals

- do not run deployments
- do not force deployment evidence for repos that do not need it
- avoid duplicating summaries already present in `github-delivery.json`
- keep blocker classification stable and inspectable

### Tests to add

- ship run writes readiness-policy and deployment-evidence artifacts
- deliver surfaces missing deployment evidence as a distinct blocker when policy requires it
- inspect can show deployment evidence and readiness dimensions
- repos without deployment-evidence requirements remain backward compatible

## Workstream [#38](https://github.com/ganesh47/cstack/issues/38): Capability-Pack Governance

### Impacted files and modules

- `src/types.ts`
  - extend `WorkflowConfig`
  - add capability governance record types
  - extend `RunInspection`
- `src/config.ts`
  - parse and validate workflow capability config
- `src/prompt.ts`
  - include allowed/requested capability context in workflow prompts
- `src/discover.ts`
  - generalize the existing discover-only requested/available capability recording
- `src/validation.ts`
  - optionally record capability usage for validation specialists and GitHub/browser use
- `src/inspector.ts`
  - add capability-policy rendering
- tests:
  - `test/config.test.ts`
  - `test/prompt.test.ts`
  - `test/discover.test.ts`
  - `test/inspect.test.ts`

### First independently shippable slice

- add optional capability config to `discover` and `deliver` first
- write `artifacts/capabilities.json` and `artifacts/capability-policy.md`
- record:
  - allowed packs
  - requested packs
  - available packs
  - used packs
  - downgraded packs
- surface discover web-research policy through the same generalized contract rather than a discover-only special case

### Key risks and non-goals

- do not turn capability packs into unbounded prompt assembly
- do not assume capability availability is identical across environments
- keep silent fallback out of scope; denied or downgraded capability use must be visible
- avoid broad schema rollout across every workflow in the first slice

### Tests to add

- config validation for capability allowlists
- prompt context includes capability policy
- discover run records downgraded web capability when policy disables it
- inspect renders requested versus available versus used capabilities
