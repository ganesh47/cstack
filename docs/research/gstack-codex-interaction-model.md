# gstack Research and Codex CLI Interaction Model

## Bottom Line

`gstack` is not primarily a general-purpose multi-agent runtime. It is a compact workflow system made of:

- a small set of opinionated workflow prompts / skills
- clear invocation patterns (`/plan`, `/review`, `/ship`, `/retro`)
- one custom local browser tool because the host agent's browser options were too slow / fragile

For `cstack`, the right move is not to copy the Claude-specific skill packaging. The right move is to build a **Codex-native workflow wrapper** that:

- shells out to `codex` and `codex exec`
- standardizes prompts, config, artifacts, and delegation policy
- preserves Codex as the execution engine
- adds orchestration, replayability, and opinionated workflows on top

## What gstack Actually Is

Based on the public repo, `gstack` has two major parts:

1. Workflow skills
   - `plan-ceo-review`
   - `plan-eng-review`
   - `review`
   - `ship`
   - `retro`
   - `browse`

2. One local runtime tool
   - a compiled `browse` CLI built with Bun + Playwright
   - persistent local Chromium daemon
   - text-first command surface optimized for low token overhead

That means the transferable idea is not "many agents coordinating deeply in code." The transferable idea is:

- opinionated workflow entrypoints
- strict prompt framing per workflow
- local artifacts and state
- targeted custom tooling only where the host agent is weak

## What To Keep From gstack

- Small workflow surface instead of dozens of commands
- Strongly differentiated workflows mapped to user intent
- Tight operator posture: each workflow has a clear job and stopping condition
- Local-first execution
- Artifact-producing runs
- Prompt assets checked into the repo
- Fast path for repetitive engineering rituals like review and ship

## What Must Change For Codex CLI

### 1. Skills are not the product surface

`gstack` is shaped around Claude skill directories. `cstack` should not just emulate that folder structure and call it a product.

For Codex, the product surface should be:

- a wrapper CLI
- workflow manifests / prompt templates
- per-run artifacts
- a consistent contract for when to use interactive Codex versus `codex exec`

### 2. Delegation is already native

Codex already supports sub-agents and delegation in the agent runtime. So `cstack` should not invent fake roleplay agents as a first move.

Instead:

- define delegation policy
- define when a workflow allows delegation
- define how delegated work is summarized and persisted
- define when workflows must degrade to single-agent execution

### 3. Review is already partially native

Local inspection shows Codex CLI already exposes:

- `codex exec`
- `codex review`
- `codex resume`
- `codex fork`
- `codex apply`
- `codex mcp`

So v1 should reuse those primitives instead of rebuilding review or patch-application behavior from scratch.

### 4. A custom browser is not a day-one requirement

`gstack` needed `browse` because its host environment had clear browser/tooling pain. Codex already has web research available in some contexts, and local wrappers can add browser tooling later if needed.

So for `cstack` v1:

- do not build a browser subsystem first
- keep browser/tool augmentation as a later, evidence-driven extension

## What Should Be Rejected Entirely

- Claude-specific skill installation semantics as the primary UX
- Prompt-only "multi-agent" branding without real orchestration controls
- Over-abstracted role theater like six permanent human-sounding agents for every task
- A heavy daemonized control plane before there is proof the wrapper needs one
- A browser/runtime subsystem unless Codex-native flows demonstrably fail without it

## Codex CLI Capability Implications

From the local CLI help on this machine (`codex-cli 0.114.0`), the wrapper can rely on:

- interactive `codex` sessions
- non-interactive `codex exec`
- structured machine-readable output via `codex exec --json`
- schema-constrained final messages via `codex exec --output-schema`
- saved outputs via `codex exec --output-last-message`
- resumability via `codex resume`
- session branching via `codex fork`
- patch application via `codex apply`
- built-in review path via `codex review`
- MCP management via `codex mcp`

These are enough to justify a wrapper that is orchestration-first rather than model-runtime-first.

## Recommended cstack Interaction Model

### Thesis

`cstack` should behave like a **workflow router and run recorder** for Codex CLI.

This matches OpenAI's published Codex direction at a high level: real-time pairing and longer-running delegated work are complementary modes, not separate products.

The wrapper owns:

- workflow selection
- prompt assembly
- config resolution
- run directories
- structured artifacts
- delegation policy
- replay / resume commands

Codex owns:

- reasoning
- tool use
- code edits
- sub-agent execution
- review logic

### Two Execution Modes

#### 1. Deterministic workflow mode

Use `codex exec` for repeatable workflows where `cstack` needs predictable outputs.

Best for:

- spec generation
- discovery / repo analysis
- structured review
- artifact generation
- CI-friendly automation

Wrapper behavior:

- assembles a workflow prompt from templates + user intent + repo context
- optionally supplies a JSON schema
- stores JSONL event stream, final output, prompt input, and metadata
- extracts machine-usable artifacts from the run

#### 2. Guided interactive mode

Use interactive `codex` when the user wants collaboration, branching, and iterative execution.

Best for:

- longer implementation sessions
- debugging
- handoff after plan approval
- branch-local exploration

Wrapper behavior:

- launches Codex with the correct initial prompt and config
- records session metadata
- exposes `resume` / `fork` affordances at the `cstack` layer
- links the interactive session to the current workflow run id

## Proposed V1 Workflow Set

Keep this small:

| Workflow | Purpose | Recommended Codex primitive |
|----------|---------|-----------------------------|
| `spec` | turn an idea into an implementation-ready spec | `codex exec` |
| `discover` | map repo context, constraints, risks, and existing code | `codex exec` |
| `build` | execute an approved task with optional delegation | interactive `codex` or `codex exec` |
| `review` | critique changes against policy and risk heuristics | `codex review` or `codex exec review` |
| `ship` | prepare final checks and release artifacts | wrapper + `codex review` + shell |

Optional later:

- `retro`
- `debug`
- `migrate`

## Agent Model Recommendation

Do not expose a large cast of named agents in v1.

Use a simple model:

- `primary`: the main Codex run
- `delegate`: spawned only when the workflow permits parallel work
- `reviewer`: a review posture, not a separate permanent character

The wrapper should configure:

- maximum delegate count
- whether delegation is allowed for a workflow
- whether delegates can edit or are analysis-only
- how delegate outputs are summarized into final artifacts

## Run Artifact Model

Every `cstack` run should create a local run directory, for example:

```text
.cstack/runs/2026-03-13T12-34-56Z-spec-user-auth/
  run.json
  prompt.md
  context.md
  events.jsonl
  final.md
  artifacts/
    spec.md
    plan.json
    findings.json
```

Minimum artifact contract:

- `run.json`: run id, workflow, cwd, git branch, timestamps, Codex version, config
- `prompt.md`: fully materialized prompt sent to Codex
- `events.jsonl`: streamed execution events when available
- `final.md`: final model response
- workflow-specific structured outputs in `artifacts/`

This is the main trust and debugging surface for the wrapper.

## Recommended Delegation Policy

Default to conservative delegation.

Rules:

- no delegation in `ship`
- optional limited delegation in `spec` and `discover`
- controlled delegation in `build` only for clearly separable subtasks
- `review` may use delegated analysis later, but not in v1 unless it improves signal measurably

Why: the failure mode for wrappers like this is noisy, expensive, low-accountability parallelism.

## Wrapper Boundary Recommendation

For v1, `cstack` should shell out to the installed `codex` binary rather than embedding a new runtime.

Good reasons:

- lower implementation cost
- inherits Codex improvements automatically
- avoids divergence from upstream behavior
- makes debugging simpler because the underlying primitive is visible

Only consider a deeper integration later if shelling out blocks needed features.

## Meta-Level UX Recommendation

The wrapper should answer one question for the user:

**"What workflow am I in, what is Codex doing, and where do I find the artifact?"**

That implies:

- one workflow per command invocation
- explicit run ids
- explicit artifact paths
- explicit session linkage for resume/fork
- stable summaries after each run

Bad UX to avoid:

- hidden prompt composition
- invisible delegation
- transient outputs only in terminal scrollback
- unclear distinction between planning, execution, and review

## Spec Direction For Next Pass

The next spec should define `cstack` as:

- a local wrapper CLI around Codex CLI
- workflow-driven, not agent-character-driven
- artifact-heavy and replayable
- delegation-aware but not delegation-obsessed
- thin by default, extensible later

The most important design question for Spec v0.1 is:

**How much of the product is just prompt-pack + run recorder, and how much is active orchestration logic?**

My recommendation: bias strongly toward prompt-pack + run recorder in v1, with only enough orchestration logic to make workflows reliable.

## Sources

- `gstack` repository: https://github.com/garrytan/gstack
- `gstack` README: https://raw.githubusercontent.com/garrytan/gstack/main/README.md
- `gstack` root skill: https://raw.githubusercontent.com/garrytan/gstack/main/SKILL.md
- `gstack` browser internals: https://raw.githubusercontent.com/garrytan/gstack/main/BROWSER.md
- OpenAI Codex announcement: https://openai.com/index/introducing-codex/
- OpenAI Codex GA / SDK note: https://openai.com/index/codex-now-generally-available/
