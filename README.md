# cstack

`cstack` is a workflow-first wrapper around Codex CLI.

Current implemented surface:

- `discover`
- `spec`
- `runs`
- `inspect`
- repo-local config in `.cstack/config.toml`
- durable run artifacts in `.cstack/runs/<run-id>/`

## Install

Requirements:

- Node.js 22+
- Codex CLI installed and available on `PATH`

### Install from a GitHub release

Pre-v1 public installs are published through GitHub Releases.

Links:

- [Releases page](https://github.com/ganesh47/cstack/releases)
- [Release workflow](./.github/workflows/release.yml)

Install directly from a published release tarball:

```bash
VERSION=v0.1.0
npm install -g "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"
```

Download first, then install locally:

```bash
VERSION=v0.1.0
curl -LO "https://github.com/ganesh47/cstack/releases/download/${VERSION}/cstack-${VERSION#v}.tgz"
npm install -g "./cstack-${VERSION#v}.tgz"
```

Verify the downloaded tarball:

```bash
VERSION=v0.1.0
curl -LO "https://github.com/ganesh47/cstack/releases/download/${VERSION}/SHA256SUMS.txt"
sha256sum -c SHA256SUMS.txt
```

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
- `prompt.md`
- `context.md`
- `final.md`
- `stdout.log`
- `stderr.log`
- `artifacts/spec.md` for `spec`
- `artifacts/findings.md` for `discover`

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

1. update `package.json` version
2. commit and push the version change
3. create and push a matching tag, for example `v0.1.0`
4. GitHub Actions runs build, typecheck, tests, `npm pack`, checksum generation, and GitHub Release publishing

Published release assets:

- `cstack-<version>.tgz`
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
- build, typecheck, and test pipeline

Not implemented yet:

- `build`
- `review`
- `ship`
- active multi-agent delegation policy
- GitHub issue sync helpers inside the CLI
