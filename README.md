# cstack

`cstack` is a workflow-first wrapper around Codex CLI.

Current implemented surface:

- `cstack <intent>`
- `discover`
- `spec`
- `build`
- `review`
- `ship`
- `deliver`
- `rerun`
- `resume`
- `fork`
- `update`
- `loop`
- `runs`
- `inspect`
- repo-local config in `.cstack/config.toml`
- durable run artifacts in `.cstack/runs/<run-id>/`
- inferred routing plans and stage lineage for intent runs
- bounded specialist reviews for security, DevSecOps, traceability, audit, and release-pipeline concerns
- bounded discover-time research delegation with a research lead and optional repo, external, and risk tracks
- run ledger views across active and historical runs
- interactive post-run inspection for artifact-grounded follow-up in TTYs
- live in-progress activity output while Codex is running
- ANSI-first operator console for active runs, with plain-line fallback for logs and non-interactive shells

## Install

Requirements:

- Node.js 24+
- Codex CLI installed and available on `PATH`

### Install from a GitHub release

Pre-v1 public installs are published through GitHub Releases.

Links:

- [CI workflow](./.github/workflows/ci.yml)
- [Live Codex smoke workflow](./.github/workflows/live-codex-smoke.yml)
- [Releases page](https://github.com/ganesh47/cstack/releases)
- [Release workflow](./.github/workflows/release.yml)
- [Prepare release workflow](./.github/workflows/prepare-release.yml)

Recommended install path:

```bash
npm install -g "https://github.com/ganesh47/cstack/releases/latest/download/cstack-latest.tgz"
```

<!-- release-version:start -->
Current release example version: `v0.17.44`
<!-- release-version:end -->

<!-- release-examples:start -->
Install directly from a published release tarball:

```bash
VERSION=v0.17.44
npm install -g "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"
```

Download first, then install locally:

```bash
VERSION=v0.17.44
curl -LO "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"
npm install -g "./cstack-${VERSION#v}.tgz"
```

Verify the downloaded tarball:

```bash
VERSION=v0.17.44
curl -LO "https://github.com/ganesh47/cstack/releases/download/${VERSION}/SHA256SUMS.txt"
sha256sum -c SHA256SUMS.txt
```
<!-- release-examples:end -->

### Install from source

```bash
git clone https://github.com/ganesh47/cstack.git
cd cstack
npm install
npm run build
npm install -g .
```

## Current Commands

```bash
# Route a high-level task through the inferred front door
cstack "Introduce SSO with audit logging and hardened release checks"
cstack run "Plan a compliance-safe billing migration" --dry-run

# Generate a discovery run
cstack discover "Map the current CLI surface and artifact model"
cstack discover --issue 123 "Map the current CLI surface and artifact model"

# Generate a spec run
cstack spec "Design a run artifact model for cstack"
cstack spec --from-run <discover-run-id>
cstack spec --from-run <discover-run-id> --issue 123

# Launch a build run directly or from a saved planning run
cstack build "Implement the queued billing retry cleanup"
cstack build --from-run <run-id>
cstack build --from-run <run-id> --exec
cstack build --from-run <run-id> --allow-dirty

# Run standalone review and ship workflows
cstack review --from-run <build-run-id> "Review the billing retry cleanup"
cstack ship --from-run <review-run-id> --issue 123 "Ship the billing retry cleanup"

# Launch the umbrella delivery workflow across build, validation, review, and ship
cstack deliver "Implement the queued billing retry cleanup"
cstack deliver --from-run <run-id>
cstack deliver --from-run <run-id> --release --issue 123
# with repo policy enabled, this can push a branch and open or update a PR

# Continue, fork, or replay prior runs
cstack resume <run-id>
cstack fork <run-id> --workflow build
cstack rerun <run-id>

# Check for the latest stable GitHub release or apply it
cstack update --check
cstack update --yes

# Run repeated intent-improvement loops in the current repo or a temp clone
cstack loop "What are the gaps in this project? Can you work on closing the gaps?"
cstack loop --repo git@github.com:ganesh47/sqlite-metadata-proposal.git --iterations 3 "What are the gaps in this project? Can you work on closing the gaps?"

# List saved runs
cstack runs
cstack runs --active
cstack runs --workflow intent --json

# Inspect the latest run or a specific run id
cstack inspect
cstack inspect <run-id>
cstack inspect <run-id> --interactive
```

If you are running from source without a global install, use `node ./bin/cstack.js ...`.

## Route by Intent

`cstack <intent>` is now the primary front door for higher-level tasks.

What it does today:

- accepts a natural-language task
- infers an internal stage plan
- persists `routing-plan.json`, canonical `machine-state.json`, and derived `stage-lineage.json`
- auto-executes downstream `review`, `ship`, or `deliver` when the inferred plan warrants it
- keeps bounded specialist reviews inside the intent run only when the router stops after planning

Current intent behavior:

- implementation and planning prompts still execute `discover` and `spec` automatically inside the intent run
- broad analysis prompts like `What are the gaps in this project` can route directly to downstream `review` to avoid paying full planning overhead first
- mixed prompts that also ask `cstack` to close or remediate the gaps stay on the implementation path and continue through planning and delivery stages
- `routing-plan.json` now records both the winning routing decision and the matched prompt signals so `cstack inspect` can explain why a broad or mixed prompt took its chosen path
- review-shaped analysis prompts auto-run standalone `review`
- implementation-shaped prompts auto-run `deliver`, which carries the work through internal `build -> validation -> review -> ship`
- explicit `build`, `review`, `ship`, and `deliver` commands still exist when you want a narrower workflow than the routed front door
- intent-level specialist delegates are only used when the router stops after planning instead of handing off into a downstream review-capable workflow

Examples:

```bash
# quoted single-argument intent
cstack "Introduce SSO with audit logging and hardened release checks"

# explicit subcommand form
cstack run "Plan a compliance-safe billing migration" --dry-run
```

How to inspect it:

- `cstack inspect <run-id>` now shows the routing plan, machine-derived stage lineage, specialist dispositions, and recent activity for intent runs
- `cstack inspect <run-id> --interactive` opens an artifact-grounded console for follow-up questions
- the run directory includes `routing-plan.json`, `machine-state.json`, derived `stage-lineage.json`, and specialist artifacts under `delegates/`

## Isolated Execution Checkouts

`build` and `deliver` now use an isolated execution checkout by default.

Current contract:

- the executed source snapshot is the current committed `HEAD`
- uncommitted local source changes are ignored by default
- `git worktree add` is the preferred isolation path
- `cstack` falls back to a temporary clone from `origin` when worktree creation is not possible
- if no safe isolated checkout can be prepared, the mutation workflow fails closed

What gets recorded:

- `execution-context.json` with source repo path, source branch, source commit, execution checkout kind, execution checkout path, and cleanup status
- build and deliver console summaries that state when local dirt was intentionally ignored
- `inspect` home view lines for the execution checkout and source snapshot

Current limitation:

- uncommitted local source changes are not copied into the isolated checkout
- `--allow-dirty` remains the explicit opt-in for source-repo dirty execution

## Build Recovery

`build` and the internal build stage inside `deliver` now use bounded recovery before giving up.

Current contract:

- `cstack` first inventories likely repo requirements from the isolated execution checkout
- supported workspace bootstrap is bounded and recorded, currently centered on root `pnpm` workspaces and detected `uv` Python workspaces
- if Codex exits before leaving a usable session, transcript, or final artifact, `cstack` retries once before failing the stage
- verification failure counts as a build failure for workflow purposes
- final failure summaries now prefer a classified root cause over a raw `exit code 1`
- when a retry detects missing host tools, `cstack` now tries multiple bounded remediation commands before giving up

## Feedback Loops

`cstack loop` runs repeated intent cycles against either the current repository or a fresh temporary clone.

Current contract:

- each iteration runs the same intent with optional failure context from the previous iteration
- broad gap-remediation prompts remain bounded to a top-3 first slice, and overflow gaps are treated as deferred follow-up work
- `--repo` clones a fresh temp checkout so each attempt starts from a clean baseline
- the loop stops early once the intent run completes without failed downstream stages

Build recovery artifacts:

- `artifacts/recovery-attempts.json`
- `artifacts/recovery-summary.md`
- `artifacts/failure-diagnosis.json` when the build or verification path still fails

What `inspect` now shows for failed builds:

- the classified build-failure summary
- bounded recovery attempts that were tried
- session/transcript/final-artifact visibility
- verification status
- recommended next actions instead of only a low-level process exit code

## Runs and Inspection

`cstack runs` is now the run ledger, not just a raw directory listing.

Useful views:

```bash
# all known runs, newest first
cstack runs

# currently active runs only
cstack runs --active

# only intent runs
cstack runs --workflow intent

# recent runs as JSON for scripts
cstack runs --recent 10 --json
```

Each row shows the run id, workflow, current status, active stage when known, active specialists when known, and a short summary.

`cstack inspect` works at two levels:

- `cstack inspect <run-id>` prints a one-shot summary of the run, its artifacts, routing, lineage, and recent events
- `cstack inspect <run-id> --interactive` opens a structured terminal inspector

The interactive inspector is artifact-grounded. It does not silently continue the original Codex reasoning session.

When launched in a TTY, the inspector now opens on a compact home view with:

- an `Observed` section for facts from saved artifacts
- a `Plan` section with stage and specialist strips
- a `Suggested next actions` section
- a persistent shortcut footer

Useful inspector commands:

- `summary`
- `stages`
- `specialists`
- `artifacts`
- `show final`
- `show routing`
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
- `show child <stage>`
- `show delegate <track>`
- `show sources <track>`
- `mitigate`
- `mitigate <n>`
- `mitigate <workflow>`
- `mitigate <workflow> <n>`
- `show stage <name>`
- `show specialist <name>`
- `show artifact <relative-path>`
- `gaps`
- `why deferred <stage>`

Failed build inspection is now root-cause-first:

- parent `intent` inspection prefers the linked child build failure summary over the aggregate downstream deliver error
- failed `deliver` inspection shows direct build evidence, including exit code, session visibility, transcript availability, verification status, and fallback-summary status when Codex did not leave a normal final markdown file
- later `validation`, `review`, and `ship` blockage is shown as a consequence of the failed build instead of being repeated as if it were the original cause
- `what remains`
- `resume`
- `fork`
- `exit`

Shortcuts:

- `1` summary
- `2` stages
- `3` specialists
- `4` artifacts
- `g` gaps
- `f` final output
- `r` routing
- `q` exit

For TTY runs, `cstack` may offer `Inspect this run now? [Y/n]` after the summary. Non-interactive shells skip that prompt.

Interactive inspector quality-of-life:

- tab completion for commands and common `show ...` targets
- dynamic completion for stage names, specialists, artifact paths, delegate tracks, and linked child stages
- typo suggestions for unknown commands
- analysis-mode reviews surface gap clusters and recommended next slices directly in the summary

## Update cstack

`cstack update` is a GitHub-release self-update command for the installed CLI.

Supported surface:

```bash
# Check only
cstack update --check

# Show the exact plan without mutating
cstack update --dry-run

# Apply the latest stable release
cstack update --yes

# Install a specific stable release
cstack update --yes --version 0.3.0
```

Default behavior:

- in a normal interactive terminal, `cstack update` checks the latest stable GitHub release and prompts before applying it
- in non-interactive shells, `cstack update` refuses mutation unless you pass `--yes`
- the command downloads the exact versioned tarball plus `SHA256SUMS.txt`, verifies the checksum locally, and then installs through `npm`

Important limits:

- `cstack update` updates the installed CLI package only
- it does not rewrite `.cstack/config.toml`, prompt assets, or repo files
- if you are running `cstack` directly from a source checkout, self-update is intentionally unsupported in this first version

Manual fallback:

```bash
npm install -g "https://github.com/ganesh47/cstack/releases/latest/download/cstack-latest.tgz"
```

## Use cstack in an Existing Repo

`cstack` is designed to be run from inside the repository you want to work on.

Minimal setup in an existing repo:

```bash
cd /path/to/your-repo
mkdir -p .cstack/prompts
cat > .cstack/config.toml <<'EOF'
[codex]
command = "codex"

[workflows.spec.delegation]
enabled = false
maxAgents = 0

[workflows.build]
mode = "interactive"
verificationCommands = ["npm test"]
allowDirty = false
maxCodexAttempts = 3
timeoutSeconds = 900

[workflows.review]
mode = "exec"

[workflows.ship]
mode = "exec"

[workflows.deliver.validation]
enabled = true
mode = "smart"
requireCiParity = true
allowWorkflowMutation = true
allowTestScaffolding = true

[workflows.deliver.stageTimeoutSeconds]
build = 900
validation = 600
review = 600
ship = 600

[workflows.discover.delegation]
enabled = true
maxAgents = 2

[workflows.discover.research]
enabled = true
allowWeb = false
EOF
```

Then use `cstack` from that repo root:

```bash
# 1. Start from the inferred front door for broader tasks
cstack "Add feature flags to the billing flow with audit logging"

# 2. Or use explicit stages when you want tighter control
cstack discover "Map the current architecture, key modules, and likely risk areas"
cstack spec "Design a safe migration plan for adding feature flags to the billing flow"
cstack build --from-run <spec-run-id>

# 3. Inspect saved runs and artifacts
cstack runs
cstack inspect
cstack inspect <run-id> --interactive
```

By default, `cstack` uses `danger-full-access` and allows direct source execution for `build`, `ship`, and `deliver`. Use `--safe` on a run when you want that invocation to fall back to `workspace-write` plus clean-worktree execution for defaulted dirty-worktree settings.

While a run is active in a normal terminal, `cstack` renders a bounded ANSI dashboard instead of endlessly appending log lines.

The live dashboard shows:

- a header with workflow, run id, status, current stage, live elapsed time, and session
- a stage breadcrumb path
- a specialist strip when relevant
- a single live progress line that summarizes current stdout/stderr/heartbeat signals
- a visible pulse/liveness indicator so you know the run is still moving
- a fixed-height recent milestones pane so the frame stays steady while the run is active
- a footer with artifact and inspection hints

The elapsed timer keeps ticking while the run is active. Color and a few emoji improve scanability in TTYs, but the dashboard still includes text labels so state remains understandable without color.

In non-interactive shells, CI logs, or redirected output, it falls back to plain append-only progress lines such as:

```text
[cstack discover <run-id> +0:00] Starting Codex run
[cstack discover <run-id> +0:01] Session: <session-id>
[cstack discover <run-id> +0:03] Activity (stdout): scanning repository context
```

This is an activity feed, not private chain-of-thought output. It shows what the wrapper can observe from the Codex process plus wrapper-generated heartbeat updates.

Recommended workflow in an existing codebase:

1. Start with `cstack <intent>` when the task is broad enough that routing and specialist selection are useful.
2. Use explicit `discover` and `spec` commands when you want to force a specific stage yourself.
3. Read the saved outputs in `.cstack/runs/<run-id>/` before moving on to manual implementation or later `cstack` workflows.

Useful repo-local files:

- `.cstack/config.toml`
- `.cstack/prompts/spec.md`
- `.cstack/prompts/discover.md`

Practical notes:

- run `cstack` from the repo root so artifact paths and repo docs resolve correctly
- keep `.cstack/runs/` out of version control; this repo already ignores it
- commit `.cstack/config.toml` and prompt assets if you want shared team defaults
- point `[codex].command` at a custom Codex binary/script only if you need a local wrapper for testing

## Local Config

Repo config lives at `.cstack/config.toml`.

Current supported settings:

```toml
[codex]
command = "codex"
profile = "default"
model = "gpt-5.4"

[workflows.spec.delegation]
enabled = false
maxAgents = 0

[workflows.build]
mode = "interactive"
verificationCommands = ["npm test"]
allowDirty = false
maxCodexAttempts = 3

[workflows.review]
mode = "exec"

[workflows.ship]
mode = "exec"

[workflows.deliver.validation]
enabled = true
mode = "smart"
requireCiParity = true
allowWorkflowMutation = true
allowTestScaffolding = true

[workflows.discover.delegation]
enabled = true
maxAgents = 2

[workflows.discover.research]
enabled = true
allowWeb = false
```

Notes:

- `command` can point at the installed `codex` binary or a script path for testing.
- `sandbox`, `profile`, `model`, and `extraArgs` are passed through to Codex launches.
- By default, `sandbox` resolves to `danger-full-access`, and `workflows.build.allowDirty`, `workflows.ship.allowDirty`, and `workflows.deliver.allowDirty` resolve to `true`.
- Use `--safe` when you want one run to fall back to `workspace-write` and clean-worktree execution for defaulted `allowDirty` values.
- If repo or user config explicitly sets `sandbox` or `allowDirty`, that explicit config wins over `--safe`.
- `--allow-all` is deprecated and currently accepted as a temporary no-op.
- `workflows.build.mode` selects `interactive` or `exec`; interactive is the default for build runs.
- `workflows.build.maxCodexAttempts` sets the bounded retry budget for build attempts.
- `workflows.build.verificationCommands` provides default verification commands recorded into build artifacts.
- `workflows.build.timeoutSeconds` time-boxes the Codex-backed build stage.
- `workflows.deliver.stageTimeoutSeconds` can time-box internal `deliver` stages such as `build`, `review`, and `ship`.
- discover delegation settings are now used to bound discover-time research fan-out.
- discover web research stays opt-in through `[workflows.discover.research].allowWeb`.

## Run Artifacts

Each run writes to `.cstack/runs/<run-id>/`.

Current artifact set:

- `run.json`
- `events.jsonl`
- `prompt.md`
- `context.md`
- `final.md`
- `stdout.log`
- `stderr.log`
- `machine-state.json` for machine-backed workflows; this is the canonical runtime snapshot for new `review`, `ship`, `deliver`, and `intent` runs
- `routing-plan.json` for intent runs
- `stage-lineage.json` as a compatibility projection for stage-oriented workflows
- `execution-context.json` for `build` and `deliver` source-vs-execution lineage
- `session.json` for build runs and any workflow with recorded interactive session lineage
- `artifacts-index.json` or equivalent artifact inventory derived by the inspector
- `artifacts/spec.md` for `spec`
- `artifacts/findings.md` for `discover`
- `artifacts/issue-lineage.json` for issue-linked `discover` and `spec` runs
- `artifacts/issue-draft.md` for issue-linked `spec` runs
- `artifacts/build-transcript.log` for best-effort interactive build capture
- `artifacts/change-summary.md` for `build`
- `artifacts/verification.json` for `build`
- `artifacts/findings.md`, `artifacts/findings.json`, and `artifacts/verdict.json` for `review`
- `artifacts/ship-summary.md`, `artifacts/release-checklist.md`, `artifacts/unresolved.md`, and `artifacts/ship-record.json` for `ship`
- `artifacts/delivery-report.md` for `deliver`
- `artifacts/github-delivery.json` for GitHub-scoped deliver evidence
- `artifacts/github-mutation.json` for `ship` and `deliver`
- `artifacts/rerun.json` for rerun lineage
- `stages/build/...`, `stages/validation/...`, `stages/review/...`, and `stages/ship/...` for deliver stage-local artifacts
- `stages/validation/repo-profile.json`, `validation-plan.json`, and `tool-research.json` for deliver validation intelligence
- `stages/validation/artifacts/test-pyramid.md`, `coverage-summary.json`, `coverage-gaps.md`, `local-validation.json`, `ci-validation.json`, and `github-actions-plan.md` for deliver validation outcomes
- `stages/ship/artifacts/github-state.json`, `pull-request.json`, `issues.json`, `checks.json`, `actions.json`, `security.json`, and `release.json` for deliver GitHub evidence
- `stages/discover/artifacts/discovery-report.md` for discover-team synthesis
- `stages/discover/research-plan.json` for discover-team activation, capability, and track decisions
- `stages/discover/delegates/<track>/request.md` for discover-team delegated research requests
- `stages/discover/delegates/<track>/result.json` for discover-team delegated research results
- `stages/discover/delegates/<track>/sources.json` for discover-team source provenance
- `delegates/<specialist>/request.md` for specialist reviews in intent runs
- `delegates/<specialist>/result.json` for specialist reviews in intent runs

For machine-backed workflows, `run.json.currentStage`, `run.json.status`, and `run.json.activeSpecialists` are derived from `machine-state.json` rather than being mutated independently.

`events.jsonl` records the live progress feed so `cstack inspect` can show recent activity after the run has finished. The interactive inspector also derives its artifact inventory from the saved run directory.

Discover-team notes:

- `repo-explorer` stays local to the repo
- `external-researcher` is only activated when the prompt implies external or unstable facts and web research is allowed
- `risk-researcher` is only activated when the prompt implies a concrete risk domain
- the research lead synthesizes the final discover output; delegated tracks remain advisory until accepted
- `discover --issue <n>` records planning issue linkage in `run.json` and `artifacts/issue-lineage.json` so later `spec` and `inspect` steps can reuse it

Spec planning-linkage notes:

- `spec --issue <n>` writes `artifacts/issue-draft.md` and `artifacts/issue-lineage.json`
- `spec --from-run <discover-run-id>` now inherits the planning issue automatically when the linked discover run already recorded one
- `cstack inspect <run-id>` supports `show issue` for issue-linked discover and spec runs

Build notes:

- `build` is interactive by default and records the observed Codex session id in `session.json`
- if `build` is requested in a non-TTY shell, `cstack` falls back to `exec` and records both requested and observed mode in `session.json`
- `build` uses bounded Codex retries (default 3, configurable via `workflows.build.maxCodexAttempts`) and alternates modes when recovering from missing session/transcript/final output.
- `build --from-run <run-id>` links a prior `spec` or `intent` run into the build context without mutating the source run
- `build` executes from an isolated checkout by default and ignores uncommitted local dirt unless `--allow-dirty` or repo policy opts into source-repo dirty execution
- when `workflows.build.timeoutSeconds` is set or left at the shipped default, a stalled Codex-backed build fails with an explicit timeout instead of lingering indefinitely
- verification commands are recorded even when they fail so inspection can explain what still remains
- best-effort interactive transcripts are stored at `artifacts/build-transcript.log` when the interactive path is used

Review notes:

- `review` is a standalone critique workflow with `findings.md`, `findings.json`, and `verdict.json`
- `review --from-run <run-id>` links an upstream build or deliver artifact into the critique context
- analysis prompts like `What are the gaps in this project` run `review` in analysis mode and produce gap clusters, likely root causes, confidence, and recommended next slices instead of release-gate phrasing
- readiness phrasing like `ready`, `changes-requested`, and `blocked` is reserved for deliver-stage review and ship-oriented readiness checks
- bounded specialist reviewers may run when the prompt implies security, audit, traceability, DevSecOps, or release-pipeline risk

Ship notes:

- `ship` is a standalone GitHub-aware handoff and release-readiness workflow
- `ship --from-run <review-run-id>` is the cleanest narrow path when build and review already happened separately
- if linked review evidence is missing or blocked, `ship` records that as a blocker rather than pretending readiness
- `ship` requires a clean worktree unless `--allow-dirty` or repo policy allows otherwise

Deliver notes:

- `deliver` is the operator-facing umbrella workflow over internal `build`, `validation`, `review`, and `ship` stages
- the validation stage profiles the repo, inventories nested workspace targets, chooses a layered validation strategy, records OSS tool research, and runs the selected local validation commands
- validation command inference is still root-biased by default; nested packages, Python targets, and container folders are surfaced explicitly in the profile and gaps when they are not backed by deterministic repo-level commands
- stage-local artifacts live under `stages/build`, `stages/validation`, `stages/review`, and `stages/ship`
- `deliver` executes those mutation-capable stages from an isolated checkout by default and records the source-vs-execution lineage in `execution-context.json`
- if the internal `build` stage fails, `deliver` now stops immediately and marks `validation`, `review`, and `ship` as blocked/deferred instead of continuing to run them
- failed or timed-out build stages now become the root cause shown in both deliver summaries and parent intent inspection
- when repo policy enables it, `deliver` can create or reuse a working branch, auto-commit the deliver change set, push it to `origin`, and create or update the GitHub pull request
- `deliver` now evaluates GitHub-scoped engineering completion, including PR, checks, Actions, issue linkage, release evidence, and security gates when policy requires them
- GitHub delivery failures stay root-cause-first: default-branch discovery failures and required-check watch failures are reported with their specific GitHub failure class, and the raw `gh` detail remains in the recorded blocker evidence
- `deliver` fails closed when required GitHub evidence is missing or blocked
- `deliver --release` switches the run into release-bearing mode and expects tag and release evidence
- `deliver --issue <n>` links a specific GitHub issue into deliver evaluation
- uncommitted local source edits are ignored by default for `deliver`; `--allow-dirty` remains the explicit opt-in for source-repo dirty execution
- `cstack inspect <run-id>` supports `show validation`, `show pyramid`, `show coverage`, `show ci-validation`, `show tool-research`, `show review`, `show ship`, `show mutation`, and `show github` for deliver runs
- `show validation` now summarizes workspace targets and support levels before the raw plan so mixed repos are easier to reason about
- when a deliver build fails, `cstack inspect` now separates the root-cause build failure from later blocked stages and surfaces timeout/session/transcript evidence when available

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run ci:e2e
node ./bin/cstack.js --help
```

The binary entrypoint is `bin/cstack.js`, which loads the built CLI from `dist/`.

## GitHub Actions

The repo now uses two validation lanes:

- `CI` is the required lane for pull requests and `main`. It runs `typecheck`, `test`, `build`, and a deterministic CLI end-to-end pass with the fake Codex and fake GitHub fixtures.
- `Live Codex Smoke` is a manual, non-blocking lane intended for a self-hosted runner that already has Codex CLI installed and authenticated. It clones `sqlite-metadata-proposal`, uses real Codex plus fake GitHub, and smoke-tests the wrapper against a realistic repo without mutating GitHub state.

Useful commands:

```bash
npm run ci:e2e
npm run smoke:live
```

## Releases

Tagged releases are built and published by GitHub Actions.

Release flow:

1. dispatch `Prepare Release` from the GitHub Actions UI or `gh workflow run`
2. the workflow updates `package.json`, `package-lock.json`, and the versioned README examples
3. it creates a release prep branch from the default branch and commits there
4. it pushes the prep branch and dispatches required checks (`CI`, `CodeQL`, `Gitleaks`) for that commit
5. it waits for all required checks on the prep branch commit to pass
6. it creates and pushes a matching tag, for example `v0.1.0`
7. `Prepare Release` dispatches `Release`
8. `Release` reruns validation, smoke-tests the packaged install, and publishes the GitHub Release

Browser dispatch:

1. open `Actions`
2. choose `Prepare Release`
3. click `Run workflow`
4. enter a version like `0.1.0`

CLI dispatch:

```bash
gh workflow run prepare-release.yml --repo ganesh47/cstack -f version=0.1.0
gh run watch --repo ganesh47/cstack
```

Published release assets:

- `cstack-<version>.tgz`
- `cstack-latest.tgz`
- `SHA256SUMS.txt`

## Current Scope

Implemented:

- `cstack <intent>`
- `discover`
- `spec`
- `build`
- `review`
- `ship`
- `deliver`
- `rerun`
- `resume`
- `fork`
- `update`
- `runs`
- `inspect`
- config loading
- run creation and persistence
- Codex exec adapter
- inferred routing plans and stage lineage
- bounded specialist review artifacts
- run ledger filtering and JSON output
- interactive post-run inspection
- live progress reporting and event logging
- bounded discover-time research delegation with artifact provenance
- GitHub-scoped deliver policy and evidence artifacts
- standalone review and ship artifacts
- wrapper-native session continuation and rerun wrappers
- dirty-worktree consent for mutation workflows
- build, typecheck, and test pipeline

## Forward-Looking Design Notes

These documents are planning artifacts only. They are not part of the active shipped contract until implementation lands and `docs/specs/cstack-spec-v0.1.md` is updated:

- `docs/specs/cstack-end-to-end-workstreams-spec.md`
- `docs/specs/cstack-github-planning-lineage-slice.md`
- `docs/specs/cstack-deliver-validation-intelligence-slice.md`
- `docs/specs/cstack-post-ship-feedback-slice.md`
- `docs/specs/cstack-initiative-graph-slice.md`
- `docs/specs/cstack-delivery-checklist-deployment-evidence-slice.md`
- `docs/specs/cstack-capability-pack-governance-slice.md`
- `docs/research/cstack-end-to-end-product-delivery-issue-draft.md`
- `docs/research/cstack-workstream-kickoff-tracker.md`
- `docs/research/cstack-workstream-execution-tracker.md`
- `docs/research/cstack-end-to-end-workstream-tracker.md`
- `docs/research/cstack-workstream-kickoff-tracker.md`
- `docs/research/cstack-workstream-execution-tracker.md`
