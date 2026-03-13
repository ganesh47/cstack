# cstack

`cstack` is a workflow-first wrapper around Codex CLI.

Current implemented surface:

- `cstack <intent>`
- `discover`
- `spec`
- `update`
- `runs`
- `inspect`
- repo-local config in `.cstack/config.toml`
- durable run artifacts in `.cstack/runs/<run-id>/`
- inferred routing plans and stage lineage for intent runs
- bounded specialist reviews for security, DevSecOps, traceability, audit, and release-pipeline concerns
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

- [Releases page](https://github.com/ganesh47/cstack/releases)
- [Release workflow](./.github/workflows/release.yml)
- [Prepare release workflow](./.github/workflows/prepare-release.yml)

Recommended install path:

```bash
npm install -g "https://github.com/ganesh47/cstack/releases/latest/download/cstack-latest.tgz"
```

<!-- release-version:start -->
Current release example version: `v0.7.0`
<!-- release-version:end -->

<!-- release-examples:start -->
Install directly from a published release tarball:

```bash
VERSION=v0.7.0
npm install -g "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"
```

Download first, then install locally:

```bash
VERSION=v0.7.0
curl -LO "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"
npm install -g "./cstack-${VERSION#v}.tgz"
```

Verify the downloaded tarball:

```bash
VERSION=v0.7.0
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
- executes the currently implemented deterministic stages inside one orchestrated run
- attaches bounded specialist reviews when the intent suggests they are justified

Current first-slice behavior:

- `discover` and `spec` are executed automatically inside the intent run
- `build`, `review`, and `ship` may still appear in the inferred plan but are recorded as deferred in this first release slice
- specialist reviews may run after the `spec` stage and are recorded under `delegates/`

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

[workflows.discover.delegation]
enabled = true
maxAgents = 2
EOF
```

Then use `cstack` from that repo root:

```bash
# 1. Start from the inferred front door for broader tasks
cstack "Add feature flags to the billing flow with audit logging"

# 2. Or use explicit stages when you want tighter control
cstack discover "Map the current architecture, key modules, and likely risk areas"
cstack spec "Design a safe migration plan for adding feature flags to the billing flow"

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

[workflows.discover.delegation]
enabled = true
maxAgents = 2
```

Notes:

- `command` can point at the installed `codex` binary or a script path for testing.
- `sandbox`, `profile`, `model`, and `extraArgs` are passed through to `codex exec`.
- delegation settings are currently recorded in prompt context and will become active policy in later slices.

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
- `artifacts-index.json` or equivalent artifact inventory derived by the inspector
- `artifacts/spec.md` for `spec`
- `artifacts/findings.md` for `discover`
- `delegates/<specialist>/request.md` for specialist reviews in intent runs
- `delegates/<specialist>/result.json` for specialist reviews in intent runs

`events.jsonl` records the live progress feed so `cstack inspect` can show recent activity after the run has finished. The interactive inspector also derives its artifact inventory from the saved run directory.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
node ./bin/cstack.js --help
```

The binary entrypoint is `bin/cstack.js`, which loads the built CLI from `dist/`.

## Releases

Tagged releases are built and published by GitHub Actions.

Release flow:

1. dispatch `Prepare Release` from the GitHub Actions UI or `gh workflow run`
2. the workflow updates `package.json`, `package-lock.json`, and the versioned README examples
3. the workflow commits to the default branch
4. the workflow creates and pushes a matching tag, for example `v0.1.0`
5. the workflow builds, tests, packs, and publishes the GitHub Release

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
- build, typecheck, and test pipeline

Not implemented yet:

- automatic execution of `build`
- automatic execution of `review`
- automatic execution of `ship`
- active multi-agent delegation policy
- `cstack`-native `resume` and `fork` wrappers
- GitHub issue sync helpers inside the CLI
