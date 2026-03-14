# Build Slice v1

## Goal

Implement the first usable `cstack build` workflow as the handoff from planning into execution.

This slice is intentionally narrower than the full long-term build vision in `cstack-spec-v0.1.md`.

## Command Surface

Supported commands in this slice:

```bash
cstack build "<task>"
cstack build --from-run <run-id>
cstack build --from-run <run-id> --exec
```

Behavior:

- `cstack build "<task>"` starts a build run from a direct task description
- `cstack build --from-run <run-id>` links a prior `spec` or `intent` run into the build context
- `cstack build --exec` uses `codex exec` as a conservative non-interactive fallback
- default mode is `interactive`

Rejected in this slice:

- wrapper-native `cstack resume`
- wrapper-native `cstack fork`
- automatic build execution from `cstack <intent>`
- multi-agent build fan-out beyond what Codex itself may choose internally

## Design Principles

- `build` is a first-class workflow, not a side effect of `intent`
- interactive Codex is the default because implementation work is stateful
- the wrapper must record observed session lineage, not pretend to know more than Codex exposes
- every build run must leave behind enough artifacts for `inspect`
- if linked from a prior run, the source run is read-only and remains immutable

## Run Inputs

Normalized build inputs:

- `userPrompt`
- `mode`: `interactive` or `exec`
- `fromRunId` when linked
- `sourceWorkflow` when linked
- `linkedArtifacts`
- `verificationCommands`

Direct prompts and linked-run prompts should both materialize into:

- `prompt.md`
- `context.md`

## Artifact Contract

Each build run should write:

- `run.json`
- `prompt.md`
- `context.md`
- `final.md`
- `events.jsonl` when available
- `stdout.log`
- `stderr.log`
- `session.json`
- `artifacts/change-summary.md`
- `artifacts/verification.json`

### `session.json`

Purpose:

- map the `cstack` run to the observed Codex interactive session
- preserve enough lineage for future wrapper-native `resume` and `fork`

Recommended shape:

```json
{
  "runId": "2026-03-14T12-00-00-build-example",
  "workflow": "build",
  "mode": "interactive",
  "sessionId": "uuid-or-session-token",
  "parentRunId": "optional-upstream-run-id",
  "sourceRunId": "optional-linked-run-id",
  "sourceWorkflow": "spec",
  "requestedAt": "2026-03-14T12:00:00.000Z",
  "observedAt": "2026-03-14T12:00:05.000Z",
  "resumeCommand": "codex resume <session-id>",
  "forkCommand": "codex fork <session-id>"
}
```

The wrapper should only record what it directly observed or derived from its own invocation.

### `artifacts/change-summary.md`

Purpose:

- summarize the implementation work in a stable human-readable artifact

Expected contents:

- what changed
- where it changed
- what was intentionally left undone
- what verification was attempted

### `artifacts/verification.json`

Purpose:

- record requested and observed verification results

Recommended shape:

```json
{
  "commands": [
    {
      "command": "npm test",
      "status": "passed",
      "exitCode": 0,
      "summary": "all tests passed"
    }
  ],
  "overallStatus": "passed"
}
```

Hard rule:

- failed verification must be recorded explicitly
- the wrapper must not silently upgrade a build run to success if verification failed

## Linked Run Behavior

`--from-run <run-id>` should:

- read the source `run.json`
- pull in the most relevant saved artifact body, usually:
  - `artifacts/spec.md` from a `spec` run
  - `final.md` or `stages/spec/artifacts/spec.md` from an `intent` run
- record source linkage in `run.json.inputs` and `session.json`
- not modify the source run

## Intent Integration

This slice keeps `intent` conservative.

Behavior in this slice:

- `intent` still executes deterministic `discover` and `spec`
- if `build` appears in the inferred plan, `intent` records it in lineage
- the final summary may recommend `cstack build --from-run <run-id>`
- `intent` does not auto-launch interactive build sessions yet

Why:

- the handoff from deterministic orchestration into interactive execution is a real boundary
- that boundary should be explicit and inspectable

## Inspector Expectations

`cstack inspect <run-id>` for build runs should show:

- workflow and status
- linked source run when present
- observed session id
- `resume` and `fork` suggestions derived from `session.json`
- presence of `change-summary.md`
- presence and result of `verification.json`

Useful commands should include:

- `show artifact artifacts/change-summary.md`
- `show artifact artifacts/verification.json`
- `resume`
- `fork`

## Runtime Strategy

This slice needs two execution paths:

- `interactive` build runner
- `exec` build runner

Interactive runner:

- invokes bare `codex`
- passes the initial build prompt
- captures stdout/stderr logs
- extracts `session id:` when observed
- records `session.json`

Exec runner:

- reuses `codex exec`
- still records `session.json` if a session id is emitted
- is mainly for smaller batch-friendly build runs and tests

## Known Limitations

- Codex interactive transcript capture is only best-effort
- the wrapper may know the session id without knowing the full conversation history
- wrapper-native `resume` and `fork` commands are deferred even though build artifacts prepare for them
- automatic build execution from `intent` is deferred until the interactive boundary is proven stable

## Acceptance For This Slice

This slice is complete when:

- `cstack build` exists and works
- linked-run build works
- `session.json`, `change-summary.md`, and `verification.json` are written
- `inspect` can explain build state
- tests cover direct build and linked build
- docs and release guidance are updated
