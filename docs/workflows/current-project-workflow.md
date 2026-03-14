# cstack Working Workflow

## Purpose

This document is the working context for future development on `cstack`.

It answers:

- what the spec says the product should become
- what is actually implemented in `v0.7.0`
- how we should work on the project from here without confusing spec intent with shipped behavior
- what changed recently in git

## Product Thesis

The core spec in `docs/specs/cstack-spec-v0.1.md` positions `cstack` as a local-first workflow wrapper around Codex CLI:

- runs should be artifact-backed and inspectable
- the external front door can be intent-based
- the internal execution model should stay workflow-based
- delegation should stay bounded and justified
- `discover -> spec -> build -> review -> ship` is the intended long-term path

The current codebase is an early vertical slice of that model, not the full workflow set.

## Current Reality In Code

Implemented commands:

- `cstack <intent>`
- `cstack run <intent> [--dry-run]`
- `cstack discover <prompt>`
- `cstack spec <prompt>`
- `cstack runs`
- `cstack inspect [run-id] [--interactive]`
- `cstack update`

Implemented behavior:

- `discover` and `spec` execute through `codex exec`
- `discover` is evolving toward a bounded research-team model with a research lead and optional delegated tracks
- each run persists prompts, context, logs, events, final output, and `run.json` under `.cstack/runs/<run-id>/`
- discover-team artifacts live under `stages/discover/` so they stay distinct from intent-level specialist reviews
- `intent` infers a stage plan and specialist set, executes `discover` and `spec`, and records later stages as deferred
- specialist reviews are bounded follow-on runs saved under `delegates/`
- `runs` provides a ledger view over saved run records
- `inspect` provides both a one-shot summary and a TTY inspector over saved artifacts
- `update` is a separate GitHub-release self-update workflow

Not implemented yet, even though the spec defines them:

- `cstack build`
- `cstack review`
- `cstack ship`
- `cstack rerun`
- `cstack resume`
- `cstack fork`
- true workflow-native wrappers around interactive Codex session lineage

Important implementation constraint:

- in `src/intent.ts`, only `discover` and `spec` are executable stages today
- inferred `build`, `review`, and `ship` stages are intentionally written to lineage as `deferred`

## How To Work On This Repo Now

Use this as the default development loop until `build`, `review`, and `ship` exist as first-class commands.

### 1. Start From Spec, Then Confirm Against Code

Read these first:

- `docs/specs/cstack-spec-v0.1.md`
- `README.md`
- `src/cli.ts`
- `src/intent.ts`
- `src/inspector.ts`
- `src/update.ts`

Reason:

- the spec is aspirational in places
- the source and tests define the real current contract

### 2. For Any New Feature, Decide Whether It Is:

- a shipped-surface refinement
- the next milestone from the spec
- a doc-only clarification

Recommended rule:

- if the README claims it, tests should cover it
- if the spec claims it but the README says it is deferred, treat it as planned work, not a regression

### 3. Use The Existing Workflow Stack For Planning

For repo exploration:

```bash
cstack discover "Map the command and artifact model for <area>"
```

For turning that into execution scope:

```bash
cstack spec "Design the next vertical slice for <feature>"
```

For broader tasks:

```bash
cstack "Implement <feature> with <risk constraints>"
```

Current expectation for intent runs:

- they should produce routing artifacts
- they should execute `discover` and `spec`
- they should preserve deferred lineage for later stages
- they may attach specialist review artifacts when the heuristic selects them

### 4. Implement Manually After Spec Artifacts

Because `build/review/ship` are not real commands yet, the practical workflow is:

1. use `discover` or `intent` to gather context
2. use `spec` or the `intent`-generated spec stage artifact to shape the change
3. edit the code directly in the repo
4. run `npm run typecheck`
5. run `npm test`
6. use `cstack runs` and `cstack inspect` to review saved workflow artifacts

### 5. Keep Artifacts First-Class

When adding or changing workflows:

- preserve `.cstack/runs/<run-id>/` as the source of truth
- prefer adding explicit files over relying on terminal-only behavior
- keep `run.json`, `events.jsonl`, `final.md`, and workflow-specific artifacts coherent
- update inspector behavior when new artifact types are introduced

### 6. Treat Tests As Product Contract

The most important tests for current product shape are:

- `test/intent.test.ts`
- `test/inspect.test.ts`
- `test/runs.test.ts`
- `test/update.test.ts`
- `test/progress.test.ts`

When extending the workflow model:

- add tests first for run artifacts and CLI-visible behavior
- verify inspector and ledger output when new lineage fields are introduced

## Current Slice

The active slice is `discover v2`:

- add a `Research Lead` for discover
- add bounded `repo-explorer`, `external-researcher`, and `risk-researcher` tracks
- keep web research explicit and capability-gated
- persist `stages/discover/research-plan.json` plus bounded track artifacts under `stages/discover/delegates/`
- preserve artifact-grounded inspection for all delegated outputs

This is a targeted delegation slice inside `discover`, not a general-purpose multi-agent runtime.

## Recommended Next Milestones

The cleanest next sequence is:

1. finish `discover v2` bounded research delegation
2. implement `cstack build`
3. add session lineage artifacts needed for `resume` and `fork`
4. implement `cstack review`
5. implement `cstack ship`
6. add `rerun` after workflow contracts stabilize

Why this order:

- discover is the safest place to add bounded parallelism and capability-gated web research
- `intent` already plans `build/review/ship`, so `build` is the biggest current gap between planned and executable stages
- `resume` and `fork` depend on build-session lineage being real
- `review` and `ship` are easier to ground once build artifacts exist
- `rerun` should come after the workflow artifacts stop shifting

## Recent Git Timeline

This is the condensed progression reconstructed from recent commits.

### Foundation

- `7174b57`: scaffolded the initial `spec` workflow slice
- `381ac24`: added the `discover` workflow
- `4f1dfd9`: added live workflow progress reporting
- `97bf4f8`: added the TTY progress dashboard

### Release And Distribution

- `38f3021`: added GitHub release workflow
- `c336124`: added dispatchable release-prep workflow
- `1e3df54`: fixed release prep for the current package version
- `80d7d01`: standardized on Node 24
- `e278e91`: added `cstack update` as a GitHub-release self-updater

### Workflow Expansion

- `ca9da91`: expanded the spec to include intent routing and specialists
- `a08f7b3`: implemented the intent router, inferred stages, and specialist reviews
- `9de455c`: added the run ledger and interactive inspector
- `80e0739`: refined the TTY UX direction in the spec
- `2e592a4`: upgraded the TTY dashboard and inspector implementation

### Release Tags

- `v0.1.0`: release pipeline stabilization
- `v0.2.0`: live progress reporting available
- `v0.3.0`: TTY dashboard available
- `v0.4.0`: self-update available
- `v0.5.0`: intent routing and specialists available
- `v0.6.0`: run ledger and inspector available
- `v0.7.0`: richer dashboard and inspector available

## Practical Read Of The Repo Today

The project is no longer a simple `spec` wrapper. It now has three strong foundations:

- artifact-backed deterministic runs
- an intent router with bounded specialist follow-ups
- an operator-oriented ledger and inspector

The main missing piece is execution continuity after planning:

- the product can already discover, plan, inspect, and update itself
- it still cannot natively drive the planned implementation/review/ship loop end to end

That makes the next development question straightforward:

- continue polishing inspection and routing, or
- close the largest product gap by implementing `build`

The spec and current code both point to `build` as the next highest-value workflow.
