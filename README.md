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
Current release example version: `v0.15.1`
<!-- release-version:end -->

<!-- release-examples:start -->
Install directly from a published release tarball:

```bash
VERSION=v0.15.1
npm install -g "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"
```

Download first, then install locally:

```bash
VERSION=v0.15.1
curl -LO "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"
npm install -g "./cstack-${VERSION#v}.tgz"
```

Verify the downloaded tarball:

```bash
VERSION=v0.15.1
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

# Generate a spec run
cstack spec "Design a run artifact model for cstack"
cstack spec --from-run <discover-run-id>

# Launch a build run directly or from a saved planning run
cstack build "Implement the queued billing retry cleanup"
cstack build --from-run <run-id>
cstack build --from-run <run-id> --exec
cstack build --from-run <run-id> --allow-dirty

# Run standalone review and ship workflows
cstack review --from-run <build-run-id> "Review the billing retry cleanup"
cstack ship --from-run <review-run-id> --issue 123 "Ship the billing retry cleanup"

# Launch the umbrella delivery workflow across build, review, and ship
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
- persists `routing-plan.json` and `stage-lineage.json`
- executes `discover` and `spec` inside one orchestrated run
- auto-executes downstream `review`, `ship`, or `deliver` when the inferred plan warrants it
- keeps bounded specialist reviews inside the intent run only when the router stops after planning

Current intent behavior:

- `discover` and `spec` are executed automatically inside the intent run
- review-shaped analysis prompts auto-run standalone `review`
- implementation-shaped prompts auto-run `deliver`, which carries the work through internal `build -> review -> ship`
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

- `cstack inspect <run-id>` now shows the routing plan, stage lineage, specialist dispositions, and recent activity for intent runs
- `cstack inspect <run-id> --interactive` opens an artifact-grounded console for follow-up questions
- the run directory includes `routing-plan.json`, `stage-lineage.json`, and specialist artifacts under `delegates/`

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
- `show review`
- `show ship`
- `show mutation`
- `show github`
- `show delegate <track>`
- `show sources <track>`
- `show stage <name>`
- `show specialist <name>`
- `show artifact <relative-path>`
- `why deferred <stage>`
- `what remains`
- `resume`
- `fork`
- `exit`

Shortcuts:

- `1` summary
- `2` stages
- `3` specialists
- `4` artifacts
- `f` final output
- `r` routing
- `q` exit

For TTY runs, `cstack` may offer `Inspect this run now? [Y/n]` after the summary. Non-interactive shells skip that prompt.

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
sandbox = "workspace-write"

[workflows.spec.delegation]
enabled = false
maxAgents = 0

[workflows.build]
mode = "interactive"
verificationCommands = ["npm test"]
allowDirty = false

[workflows.review]
mode = "exec"

[workflows.ship]
mode = "exec"
allowDirty = false

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

While a run is active in a normal terminal, `cstack` now renders a bounded ANSI dashboard instead of endlessly appending log lines.

The live dashboard shows:

- workflow, status, elapsed time, and session
- stage strip
- specialist strip when relevant
- observed activity
- inferred next step
- bounded recent activity

In non-interactive shells, CI logs, or redirected output, it falls back to plain progress lines such as:

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
sandbox = "workspace-write"
profile = "default"
model = "gpt-5.4"

[workflows.spec.delegation]
enabled = false
maxAgents = 0

[workflows.build]
mode = "interactive"
verificationCommands = ["npm test"]
allowDirty = false

[workflows.review]
mode = "exec"

[workflows.ship]
mode = "exec"
allowDirty = false

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
- `workflows.build.mode` selects `interactive` or `exec`; interactive is the default for build runs.
- `workflows.build.verificationCommands` provides default verification commands recorded into build artifacts.
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
- `routing-plan.json` for intent runs
- `stage-lineage.json` for intent runs
- `session.json` for build runs and any workflow with recorded interactive session lineage
- `artifacts-index.json` or equivalent artifact inventory derived by the inspector
- `artifacts/spec.md` for `spec`
- `artifacts/findings.md` for `discover`
- `artifacts/build-transcript.log` for best-effort interactive build capture
- `artifacts/change-summary.md` for `build`
- `artifacts/verification.json` for `build`
- `artifacts/findings.md`, `artifacts/findings.json`, and `artifacts/verdict.json` for `review`
- `artifacts/ship-summary.md`, `artifacts/release-checklist.md`, `artifacts/unresolved.md`, and `artifacts/ship-record.json` for `ship`
- `artifacts/delivery-report.md` for `deliver`
- `artifacts/github-delivery.json` for GitHub-scoped deliver evidence
- `artifacts/github-mutation.json` for `ship` and `deliver`
- `artifacts/rerun.json` for rerun lineage
- `stages/build/...`, `stages/review/...`, and `stages/ship/...` for deliver stage-local artifacts
- `stages/ship/artifacts/github-state.json`, `pull-request.json`, `issues.json`, `checks.json`, `actions.json`, `security.json`, and `release.json` for deliver GitHub evidence
- `stages/discover/artifacts/discovery-report.md` for discover-team synthesis
- `stages/discover/research-plan.json` for discover-team activation, capability, and track decisions
- `stages/discover/delegates/<track>/request.md` for discover-team delegated research requests
- `stages/discover/delegates/<track>/result.json` for discover-team delegated research results
- `stages/discover/delegates/<track>/sources.json` for discover-team source provenance
- `delegates/<specialist>/request.md` for specialist reviews in intent runs
- `delegates/<specialist>/result.json` for specialist reviews in intent runs

`events.jsonl` records the live progress feed so `cstack inspect` can show recent activity after the run has finished. The interactive inspector also derives its artifact inventory from the saved run directory.

Discover-team notes:

- `repo-explorer` stays local to the repo
- `external-researcher` is only activated when the prompt implies external or unstable facts and web research is allowed
- `risk-researcher` is only activated when the prompt implies a concrete risk domain
- the research lead synthesizes the final discover output; delegated tracks remain advisory until accepted

Build notes:

- `build` is interactive by default and records the observed Codex session id in `session.json`
- if `build` is requested in a non-TTY shell, `cstack` falls back to `exec` and records both requested and observed mode in `session.json`
- `build --from-run <run-id>` links a prior `spec` or `intent` run into the build context without mutating the source run
- `build` requires a clean worktree unless `--allow-dirty` or repo policy allows otherwise
- verification commands are recorded even when they fail so inspection can explain what still remains
- best-effort interactive transcripts are stored at `artifacts/build-transcript.log` when the interactive path is used

Review notes:

- `review` is a standalone critique workflow with `findings.md`, `findings.json`, and `verdict.json`
- `review --from-run <run-id>` links an upstream build or deliver artifact into the critique context
- bounded specialist reviewers may run when the prompt implies security, audit, traceability, DevSecOps, or release-pipeline risk

Ship notes:

- `ship` is a standalone GitHub-aware handoff and release-readiness workflow
- `ship --from-run <review-run-id>` is the cleanest narrow path when build and review already happened separately
- if linked review evidence is missing or blocked, `ship` records that as a blocker rather than pretending readiness
- `ship` requires a clean worktree unless `--allow-dirty` or repo policy allows otherwise

Deliver notes:

- `deliver` is the operator-facing umbrella workflow over internal `build`, `review`, and `ship` stages
- stage-local artifacts live under `stages/build`, `stages/review`, and `stages/ship`
- when repo policy enables it, `deliver` can create or reuse a working branch, auto-commit the deliver change set, push it to `origin`, and create or update the GitHub pull request
- `deliver` now evaluates GitHub-scoped engineering completion, including PR, checks, Actions, issue linkage, release evidence, and security gates when policy requires them
- `deliver` fails closed when required GitHub evidence is missing or blocked
- `deliver --release` switches the run into release-bearing mode and expects tag and release evidence
- `deliver --issue <n>` links a specific GitHub issue into deliver evaluation
- `deliver` requires a clean worktree unless `--allow-dirty` or repo policy allows otherwise
- `cstack inspect <run-id>` supports `show review`, `show ship`, `show mutation`, and `show github` for deliver runs

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
3. the workflow commits to the default branch
4. the workflow creates and pushes a matching tag, for example `v0.1.0`
5. `Prepare Release` pushes the release-prep commit to the default branch
6. `Prepare Release` dispatches `CI` for that pushed commit and waits for it to succeed
7. `Prepare Release` pushes the tag and then dispatches `Release`
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
