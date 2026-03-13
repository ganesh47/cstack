# cstack

`cstack` is a workflow-first wrapper around Codex CLI.

Current implemented slice:

- `cstack spec <prompt>`
- `cstack runs`
- `cstack inspect [run-id]`
- repo-local TOML config in `.cstack/config.toml`
- durable run artifacts in `.cstack/runs/<run-id>/`

## Development

```bash
npm install
npm run build
npm test
node dist/cli.js --help
```

## Commands

```bash
node dist/cli.js spec "Draft an implementation note for the next cstack slice"
node dist/cli.js runs
node dist/cli.js inspect
```

## Run artifacts

Each `spec` run writes:

- `run.json`
- `prompt.md`
- `context.md`
- `final.md`
- `artifacts/spec.md`
- `stdout.log`
- `stderr.log`

The first slice uses `codex exec --output-last-message` and records enough metadata for later `runs` and `inspect` support.
