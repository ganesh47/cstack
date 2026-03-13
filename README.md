# cstack

`cstack` is a workflow-first wrapper around Codex CLI.

Current implemented surface:

- `discover`
- `spec`
- `runs`
- `inspect`
- repo-local config in `.cstack/config.toml`
- durable run artifacts in `.cstack/runs/<run-id>/`
- live in-progress activity output while Codex is running

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
Current release example version: `v0.2.0`
<!-- release-version:end -->

<!-- release-examples:start -->
Install directly from a published release tarball:

```bash
VERSION=v0.2.0
npm install -g "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"
```

Download first, then install locally:

```bash
VERSION=v0.2.0
curl -LO "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"
npm install -g "./cstack-${VERSION#v}.tgz"
```

Verify the downloaded tarball:

```bash
VERSION=v0.2.0
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
# Generate a discovery run
cstack discover "Map the current CLI surface and artifact model"

# Generate a spec run
cstack spec "Design a run artifact model for cstack"

# List saved runs
cstack runs

# Inspect the latest run or a specific run id
cstack inspect
cstack inspect <run-id>
```

If you are running from source without a global install, use `node ./bin/cstack.js ...`.

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
# 1. Map the repo before changing anything
cstack discover "Map the current architecture, key modules, and likely risk areas"

# 2. Turn that understanding into an implementation-ready plan
cstack spec "Design a safe migration plan for adding feature flags to the billing flow"

# 3. Inspect saved runs and artifacts
cstack runs
cstack inspect
```

While a run is active, `cstack` now prints live progress lines such as:

```text
[cstack discover <run-id> +0:00] Starting Codex run
[cstack discover <run-id> +0:01] Session: <session-id>
[cstack discover <run-id> +0:03] Activity (stdout): scanning repository context
```

This is an activity feed, not private chain-of-thought output. It shows what the wrapper can observe from the Codex process plus wrapper-generated heartbeat updates.

Recommended workflow in an existing codebase:

1. Start with `discover` to understand the repo shape, constraints, and likely hotspots.
2. Use `spec` to turn a concrete change request into an implementation-ready artifact.
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
- `artifacts/spec.md` for `spec`
- `artifacts/findings.md` for `discover`

`events.jsonl` records the live progress feed so `cstack inspect` can show recent activity after the run has finished.

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

- `discover`
- `spec`
- `runs`
- `inspect`
- config loading
- run creation and persistence
- Codex exec adapter
- live progress reporting and event logging
- build, typecheck, and test pipeline

Not implemented yet:

- `build`
- `review`
- `ship`
- active multi-agent delegation policy
- GitHub issue sync helpers inside the CLI
