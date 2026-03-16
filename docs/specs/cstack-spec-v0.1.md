# Spec v0.1: `cstack`

## Thesis

`cstack` is a local-first workflow wrapper around Codex CLI. It turns ad hoc prompting into explicit engineering workflows with durable artifacts, inspectable lineage, bounded delegation, and GitHub-aware delivery.

The product is intentionally narrow:

- Codex remains the reasoning and editing engine.
- `cstack` owns workflow selection, prompt framing, artifact contracts, lineage, inspection, and GitHub-facing delivery policy.
- GTM and market-launch work are explicitly out of scope for the active product contract.

## Product Contract

The active contract is the shipped surface in this repository. The spec must not promise commands or workflow behavior that the product does not implement.

The repository validation contract is also part of the shipped surface:

- a required deterministic GitHub Actions lane validates the public CLI end to end with fake Codex and fake GitHub fixtures
- an optional live Codex smoke lane exists for manual or periodic checks on a self-hosted runner with an authenticated Codex CLI

Current top-level commands:

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
- `cstack runs [--active] [--workflow <name>] [--status <status>] [--recent <n>] [--json]`
- `cstack inspect [run-id] [--interactive]`
- `cstack update [--check] [--dry-run] [--yes] [--version <x>] [--channel stable]`

## Principles

1. Workflows are explicit even when the front door is intent-based.
2. Artifacts are first-class and outrank terminal scrollback.
3. Delegation is bounded, justified, and inspectable.
4. GitHub is the engineering control plane for delivery, not a passive remote.
5. Dirty-worktree repo mutation requires explicit operator consent.
6. The wrapper must distinguish requested behavior from observed behavior when Codex or GitHub telemetry is partial.
7. The active spec is a shipped contract, not a roadmap.

## Workflow Surface

### `discover`

Purpose:

- gather repo context
- map constraints and likely change boundaries
- optionally perform bounded external and risk research

Execution model:

- `codex exec`
- Research Lead first
- optional delegated discover tracks:
  - `repo-explorer`
  - `external-researcher`
  - `risk-researcher`

Key artifacts:

- `artifacts/findings.md`
- `stages/discover/research-plan.json`
- `stages/discover/artifacts/discovery-report.md`
- optional `stages/discover/delegates/<track>/request.md`
- optional `stages/discover/delegates/<track>/result.json`
- optional `stages/discover/delegates/<track>/sources.json`

### `spec`

Purpose:

- convert a request or upstream discovery artifact into an implementation-ready plan

Execution model:

- `codex exec`
- single-agent by default

Inputs:

- direct prompt, or
- `--from-run <run-id>` to link to an upstream artifact

Key artifacts:

- `artifacts/spec.md`
- `artifacts/plan.json`
- `artifacts/open-questions.md`
- `final.md`

### `build`

Purpose:

- execute an implementation task with session lineage and recorded verification

Execution model:

- interactive `codex` by default
- falls back to `codex exec` when no TTY is available
- `--exec` forces deterministic non-interactive mode

Inputs:

- direct prompt, or
- `--from-run <run-id>` to link upstream planning context

Safety:

- `build` requires a clean worktree unless `--allow-dirty` is set or repo policy enables dirty operation

Key artifacts:

- `session.json`
- `artifacts/change-summary.md`
- `artifacts/verification.json`
- `artifacts/build-transcript.log` when interactive transcript capture is observed
- `final.md`

### `review`

Purpose:

- critique a change or linked run
- surface risks, findings, and next actions
- support both analysis-style critique and readiness-style critique without conflating them

Execution model:

- `codex exec`
- Review Lead plus bounded specialist reviewers when the prompt justifies them

Inputs:

- direct prompt, or
- `--from-run <run-id>` to link build or deliver context

Semantics:

- standalone and intent-routed analysis prompts may run `review` in `analysis` mode
- analysis mode records gap clusters, likely root causes, confidence, and recommended next slices
- deliver-stage review remains `readiness` mode and continues to emit release-oriented `ready | changes-requested | blocked` outcomes
- analysis-mode review runs complete successfully when the analysis succeeds, even if the findings are severe
- delivery-gate phrasing such as `delivery is blocked` is reserved for readiness review, `ship`, and `deliver`

Key artifacts:

- `artifacts/findings.md`
- `artifacts/findings.json`
- `artifacts/verdict.json`
- `stage-lineage.json`
- optional `delegates/<specialist>/...`
- `final.md`

### `ship`

Purpose:

- produce final engineering handoff or release-readiness artifacts
- evaluate GitHub delivery state
- optionally mutate branch / commit / pull-request state when repo policy enables it

Execution model:

- `codex exec` for ship synthesis
- `git`, `gh`, and GitHub APIs for mutation and evidence collection

Inputs:

- direct prompt, or
- `--from-run <run-id>` to link review, build, or deliver context
- `--release` for release-bearing delivery
- `--issue <n>` to bind issue linkage explicitly

Safety:

- `ship` requires a clean worktree unless `--allow-dirty` is set or repo policy enables dirty operation
- if review evidence is missing or blocked, `ship` may run but must mark readiness `blocked`

Key artifacts:

- `artifacts/ship-summary.md`
- `artifacts/release-checklist.md`
- `artifacts/unresolved.md`
- `artifacts/ship-record.json`
- `artifacts/github-mutation.json`
- `artifacts/github-delivery.json`
- `artifacts/github-state.json`
- `artifacts/pull-request.json`
- `artifacts/issues.json`
- `artifacts/checks.json`
- `artifacts/actions.json`
- `artifacts/security.json`
- `artifacts/release.json`
- `artifacts/pull-request-body.md`
- `stage-lineage.json`
- `final.md`

### `deliver`

Purpose:

- carry a linked or direct task through internal `build -> validation -> review -> ship` inside one durable run

Execution model:

- build stage: interactive `codex` by default, `exec` fallback or `--exec`
- validation stage: repo-aware validation planning plus bounded validation specialists and local command execution
- review stage: `codex exec` plus bounded specialist reviewers
- ship stage: `codex exec` plus GitHub mutation and delivery evidence collection

Inputs:

- direct prompt, or
- `--from-run <run-id>`
- `--release`
- `--issue <n>`

Safety:

- `deliver` requires a clean worktree unless `--allow-dirty` is set or repo policy enables dirty operation
- GitHub completion is fail-closed

Key artifacts:

- `stage-lineage.json`
- `stages/build/...`
- `stages/validation/...`
- `stages/review/...`
- `stages/ship/...`
- `artifacts/delivery-report.md`
- `artifacts/github-mutation.json`
- `artifacts/github-delivery.json`
- `final.md`

## Intent Routing

`cstack <intent>` and `cstack run <intent>` are routing front doors, not vague autonomous runtime commands.

Current intent behavior:

- infer a stage plan
- persist `routing-plan.json`
- persist `stage-lineage.json`
- auto-execute downstream `review`, `ship`, or `deliver` when the inferred plan warrants it
- keep bounded specialist reviews inside the intent run only when the router stops after planning

The active intent contract is:

- broad analysis prompts may route directly into downstream `review` when planning overhead is unlikely to add value
- implementation and planning prompts still execute deterministic `discover` and `spec` stages first
- auto-carry analysis prompts into `review`
- auto-carry implementation prompts into `deliver`
- preserve child workflow lineage in the parent intent run

## GitHub-Scoped Engineering Delivery

GitHub is the engineering control plane for `ship` and `deliver`.

When repo policy enables GitHub delivery enforcement, the wrapper evaluates:

- branch state
- pull request state
- review approval state
- linked issues
- required checks
- required GitHub Actions workflows
- release-bearing requirements such as tag and GitHub Release existence
- security gates such as Dependabot or code-scanning alerts when configured

When repo policy enables GitHub mutation, the wrapper may:

- create a delivery branch
- create a commit for the current deliver or ship change set
- push the branch
- create or update the pull request
- watch required checks

The wrapper does not currently promise to:

- merge pull requests automatically
- close issues automatically
- perform GTM or launch work
- orchestrate remote production deployment beyond repo-declared GitHub release automation

### Completion Rule

`ship` and `deliver` must fail closed when required GitHub-scoped gates are unsatisfied.

A successful GitHub-complete engineering delivery run means:

- implementation artifacts exist
- verification status supports the run
- validation status supports the run
- review status supports the run
- required GitHub gates are ready
- unresolved blocking items are empty

The guarantee is repo-policy-complete, not universal. Repos choose which GitHub gates are required through configuration.

## Support Commands

### `rerun`

`cstack rerun <run-id>` re-executes a previously recorded workflow using its saved normalized inputs and writes a fresh run with a new id.

Current supported rerun workflows:

- `discover`
- `spec`
- `build`
- `review`
- `ship`
- `deliver`
- `intent`

The new run records `rerunOfRunId` and writes `artifacts/rerun.json`.

### `resume`

`cstack resume <run-id>` resolves the saved Codex session from the run and calls `codex resume <session-id>`.

This is a wrapper-owned ergonomic command. It does not create a new workflow run by itself.

### `fork`

`cstack fork <run-id> [--workflow <name>]` resolves the saved Codex session and calls `codex fork <session-id>`.

When a child session id is observed, the wrapper records that observation back into the parent session metadata. `--workflow` records intended follow-on workflow context when provided.

## Run Ledger and Inspection

## Active TTY Dashboard

Active TTY runs use a bounded dashboard rather than an endlessly growing log tail.

The dashboard contract is:

- observable state only
- bounded repainting
- explicit header, body, and footer regions
- live elapsed-time updates while the run is active
- color and emoji as scanability aids, not as the only signal
- readable plain-line fallback outside TTYs

### Header

The header must show at minimum:

- workflow
- run id or compact run id
- current status
- current stage when known
- live elapsed time that visibly updates while work is still running
- session id when relevant

The elapsed counter must not remain static during active execution. A repaint-only dashboard that updates events but leaves elapsed time frozen is out of contract.

### Body

The body must show at minimum:

- a stage progress strip
- a specialist strip when relevant
- bounded recent activity
- a clear liveness signal so the operator knows the run is still alive

The liveness signal may use:

- an animated status glyph
- a heartbeat indicator
- a rotating progress marker
- a freshness hint tied to recent activity

It must remain:

- bounded
- readable
- obviously alive
- not spammy

### Footer

The footer must show at minimum:

- artifact or inspection hints
- the next useful operator action when appropriate
- interactive hinting when a TTY-only follow-up is available

### Visual Design

TTY dashboards should be more expressive than plain logs, but still operationally trustworthy.

Required design rules:

- richer ANSI color is allowed and encouraged in TTYs
- emoji may be used when they improve scanability or mood without obscuring meaning
- status must remain understandable even with color disabled
- the dashboard should feel alive, not noisy
- the product must not display fake thought traces or fake internal reasoning

### Non-TTY Behavior

Non-interactive shells, CI logs, and redirected output must continue to use readable append-only progress lines.

Non-TTY output must not depend on:

- live repainting
- emoji-only signaling
- color-only signaling

### `runs`

`cstack runs` is the run ledger over saved run directories.

It supports:

- `--active`
- `--workflow <name>`
- `--status <status>`
- `--recent <n>`
- `--json`

### `inspect`

`cstack inspect <run-id>` reads saved artifacts and renders an artifact-grounded summary.

`cstack inspect <run-id> --interactive` opens a TTY inspector over the saved run state.

The inspector is artifact-grounded. It does not silently continue Codex reasoning. It may surface explicit escalation commands such as `resume` or `fork`.

Current inspector views include:

- summary
- stages
- specialists
- artifacts
- gaps
- routing
- research
- session
- verification
- validation
- pyramid
- coverage
- CI validation
- tool research
- review
- ship
- GitHub mutation and delivery views
- child-run drilldowns
- delegate and artifact drilldowns
- `what remains`

Interactive inspector ergonomics:

- tab completion for command names and common `show ...` targets
- dynamic completion for stage names, specialist names, artifact paths, delegate tracks, and linked child stages
- typo recovery with nearest-command suggestions
- mode-aware review summaries so analysis runs show gaps and next slices while readiness runs show blocker/readiness state

For failed `ship` and `deliver` runs, and for `review` verdicts that are `blocked` or `changes-requested`, the interactive inspector may also surface explicit mitigation commands. Those commands must derive their prompts from recorded artifacts, link the new run back to the inspected run, and switch the inspector to the newly started workflow once it exists.

## Artifacts and Storage

Run directories live under:

```text
.cstack/runs/<run-id>/
```

Every run stores at least:

- `run.json`
- `prompt.md`
- `context.md`
- `final.md`
- `stdout.log`
- `stderr.log`
- `events.jsonl` when available
- workflow-specific artifacts under `artifacts/`

Additional workflow-owned files include:

- `routing-plan.json` for intent runs
- `stage-lineage.json` for multi-stage or stage-oriented runs
- `session.json` for build sessions and nested deliver build sessions
- `repo-profile.json`, `validation-plan.json`, and `tool-research.json` for deliver validation stages
- `delegates/` for specialist or discover-track outputs

Runs are immutable. `rerun` creates a new run id rather than mutating prior run state.

## Config Contract

Repo-local config lives at:

```text
.cstack/config.toml
```

The wrapper loads user config first, then repo config, with repo config taking precedence.

Current workflow config areas:

- `[codex]`
- `[workflows.spec]`
- `[workflows.discover]`
- `[workflows.build]`
- `[workflows.review]`
- `[workflows.ship]`
- `[workflows.deliver]`
- `[workflows.deliver.validation]`
- `[verification]`

Important repo-policy knobs include:

- workflow mode
- delegation enablement and caps
- discover web-research policy
- dirty-worktree allowance
- verification commands
- validation-stage parity and workflow-mutation policy
- GitHub delivery policy for ship and deliver

## Repository Validation

The repo must keep two distinct automation lanes:

- required deterministic CI for branch protection and release confidence
- optional live Codex smoke validation that does not block merges

Deterministic CI must:

- run `npm run typecheck`
- run `npm test`
- run `npm run build`
- run a CLI-level end-to-end workflow pass through the public entrypoint
- use fixture-backed Codex and GitHub binaries rather than live external services

The live smoke lane may:

- clone a public sample repository
- use real Codex for bounded smoke prompts
- keep GitHub interactions fake or read-only
- run only on explicit dispatch or another non-blocking trigger

Release preparation must not publish the GitHub release directly. It prepares version state, pushes the release-prep commit, dispatches and waits for required CI on that pushed commit, then pushes the tag and hands off to `Release`; `Release` is the sole publisher.

## Delegation Policy

Delegation is bounded and workflow-specific.

Current durable patterns:

- discover: Research Lead plus up to three bounded research tracks
- intent: specialist reviews after planning when heuristics justify them
- review: Review Lead plus up to three bounded specialist reviewers
- deliver validation: Validation Lead plus bounded validation specialists for browser, container, contract, workflow-security, or mobile concerns when the repo profile justifies them
- deliver review: Review Lead plus up to three bounded specialist reviewers

Delegation should be suppressed when:

- the task is small enough for a single coherent pass
- overlapping edits create high merge risk
- the workflow is safety-critical and benefits more from synthesis discipline than parallelism

Every delegated output must be attributable in artifacts.

## Dirty Worktree Safety

`build`, `ship`, and `deliver` are mutation-capable workflows.

Default rule:

- they require a clean worktree

Override rule:

- the operator may pass `--allow-dirty`, or
- repo policy may set `allowDirty = true`

This rule exists to prevent the wrapper from silently sweeping unrelated edits into GitHub mutation flows.

## Non-Goals

The active product contract does not include:

- GTM, launch marketing, enablement, or support readiness
- autonomous long-running remote agent clusters
- opaque swarm orchestration
- automatic PR merge or issue closure
- deployment orchestration beyond repo-declared GitHub release automation

## Closure Statement

This active spec is complete when the repository matches the command surface and behavior defined above.

Anything not described here belongs in historical slice docs, workflow notes, or future planning, not in the active shipped contract.
