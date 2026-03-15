# cstack Working Workflow

## Purpose

This document is the practical working context for the current repo state.

It answers:

- what is actually shipped now
- how to use the workflow stack coherently
- which commands to prefer for common work
- how the recent git history maps to the current product shape

## Current Shipped Surface

Implemented commands:

- `cstack <intent>`
- `cstack run <intent> [--dry-run]`
- `cstack discover <prompt>`
- `cstack spec <prompt> [--from-run <run-id>]`
- `cstack build <prompt> [--from-run <run-id>] [--exec] [--allow-dirty]`
- `cstack review <prompt> [--from-run <run-id>]`
- `cstack ship <prompt> [--from-run <run-id>] [--release] [--issue <n>] [--allow-dirty]`
- `cstack deliver <prompt> [--from-run <run-id>] [--exec] [--release] [--issue <n>] [--allow-dirty]`
- `cstack rerun <run-id>`
- `cstack resume <run-id>`
- `cstack fork <run-id> [--workflow <name>]`
- `cstack runs`
- `cstack inspect [run-id] [--interactive]`
- `cstack update`

Implemented behavior:

- `discover` supports a bounded discover-team model with a Research Lead and optional delegated tracks
- `spec` emits `spec.md`, `plan.json`, and `open-questions.md`
- `build` records requested vs observed mode, session lineage, change summaries, and verification artifacts
- `review` is a standalone critique workflow with verdict artifacts and bounded specialist reviewers
- `ship` is a standalone GitHub-aware handoff and release-readiness workflow
- `deliver` runs internal `build -> validation -> review -> ship` inside one durable run
- `deliver` validation profiles the repo, records OSS tool research, writes a test pyramid, and runs selected local validation commands
- `deliver` and `ship` can publish branches and create or update pull requests when repo policy enables it
- `rerun` replays supported workflows into fresh run ids
- `resume` and `fork` resolve run ids to Codex sessions
- `intent` executes `discover` and `spec`, then auto-runs downstream `review`, `ship`, or `deliver` when the inferred plan warrants it
- `runs` is the run ledger
- `inspect` is the artifact-grounded inspector
- GitHub Actions has a required deterministic `CI` lane plus an optional live Codex smoke lane

## Recommended Operator Loop

Use this order by default:

1. `cstack discover` when the codebase area or external context is unclear.
2. `cstack spec` when you need an implementation-ready plan.
3. `cstack build` when you want a focused implementation-only workflow.
4. `cstack review` when you want a narrow critique pass.
5. `cstack ship` when you want a narrow GitHub-complete handoff or release-readiness pass.
6. `cstack deliver` when the work clearly spans implementation, critique, and GitHub-complete engineering delivery.

Recommended commands:

```bash
# Explore unfamiliar areas
cstack discover "Map the billing retry pipeline and release touchpoints"

# Turn context into a plan
cstack spec --from-run <discover-run-id> "Design the billing retry cleanup"

# Implement from planning context
cstack build --from-run <spec-run-id>

# Review the implementation directly
cstack review --from-run <build-run-id> "Review billing cleanup for release safety"

# Prepare GitHub-complete handoff
cstack ship --from-run <review-run-id> --issue 123 "Ship billing cleanup"

# Or run the umbrella path
cstack deliver --from-run <spec-or-intent-run-id> --issue 123
```

## Intent Front Door

`cstack <intent>` is the orchestration front door.

Current behavior:

- infer a stage plan
- persist `routing-plan.json`
- run `discover`
- run `spec`
- auto-run standalone `review` for review-shaped prompts
- auto-run `deliver` for implementation-shaped prompts that imply engineering completion
- keep bounded intent-level specialist reviews only when the router stops after planning

Use `intent` when you want routing plus end-to-end execution when the prompt warrants it.
Use explicit workflows when you already know the narrow stage you want.

## Inspection and Continuation

Key inspector commands:

- `summary`
- `stages`
- `specialists`
- `artifacts`
- `show research`
- `show session`
- `show verification`
- `show validation`
- `show pyramid`
- `show coverage`
- `show ci-validation`
- `show tool-research`
- `show review`
- `show mitigations`
- `show ship`
- `show mutation`
- `show github`
- `show branch`
- `show pr`
- `mitigate`
- `mitigate <n>`
- `mitigate <workflow>`
- `mitigate <workflow> <n>`
- `show issues`
- `show checks`
- `show actions`
- `show security`
- `show release`
- `what remains`
- `resume`
- `fork`

Continuation commands:

- `cstack resume <run-id>` resolves the saved session and calls `codex resume`
- `cstack fork <run-id>` resolves the saved session and calls `codex fork`
- `cstack rerun <run-id>` replays supported workflows into a fresh run id

## Safety Rules

- treat `.cstack/runs/<run-id>/` as the durable source of truth
- update inspector behavior whenever you introduce a new artifact family
- `build`, `ship`, and `deliver` require a clean worktree unless `--allow-dirty` or repo policy allows otherwise
- GitHub mutation and GitHub delivery evidence must remain reconstructable from artifacts alone

## CI And Validation

GitHub Actions is split into two lanes:

- `CI`: required on pull requests and `main`; runs `npm run typecheck`, `npm test`, `npm run build`, and `npm run ci:e2e`
- `Live Codex Smoke`: manual and non-blocking; intended for a self-hosted runner with a logged-in Codex CLI and runs `npm run smoke:live`

The deterministic lane uses the fake Codex and fake GitHub fixtures and should stay stable enough for branch protection.
The live smoke lane is only for periodic reality checks against the real Codex CLI.
Release prep pushes the version bump commit, dispatches and waits for the required `CI` run on that exact pushed SHA, then tags and dispatches `Release` so workflow-owned tags still publish correctly.

## Recent Git Timeline

Condensed progression:

- `7174b57`: initial `spec` workflow slice
- `381ac24`: initial `discover` workflow
- `4f1dfd9`: live workflow progress reporting
- `97bf4f8`: TTY progress dashboard
- `38f3021`: GitHub release workflow
- `e278e91`: `cstack update`
- `a08f7b3`: intent routing and specialist reviews
- `9de455c`: run ledger and interactive inspector
- `2e592a4`: richer dashboard and inspector
- `v0.8.0`: discover research delegation
- `v0.9.0`: build workflow and session lineage
- `v0.10.0`: deliver umbrella workflow
- `v0.11.0`: GitHub-complete deliver gating
- `v0.12.0`: deliver GitHub mutation for branch and PR publication
- `v0.13.0`: active spec closure with standalone review/ship and wrapper-native resume/fork/rerun
- `v0.14.0`: intent auto-executes downstream review and deliver workflows
- current branch: deterministic GitHub Actions e2e CI plus optional live Codex smoke validation

## Working Rule

If a change affects:

- command surface
- artifacts
- GitHub mutation or delivery policy
- inspection output
- workflow continuation

then update all of:

- `README.md`
- `docs/specs/cstack-spec-v0.1.md`
- this workflow guide
- tests

The repo is healthy when the code, tests, README, and active spec describe the same product.
