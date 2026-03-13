# Spec v0.1: `cstack`

## 1. **One-Line Thesis**

`cstack` is a local-first workflow wrapper around Codex CLI that turns ad hoc prompting into replayable, artifact-backed engineering runs, using small-team delegation only when it reduces wall-clock time more than it increases coordination cost.

## 2. **Premise Check**

### What should be kept from the `gstack` idea

| Keep | Why it matters in `cstack` |
| --- | --- |
| Small workflow surface | Users need a short list of repeatable entrypoints, not a framework with dozens of verbs. |
| Opinionated workflow framing | The product value is not raw model access; it is a clearer starting posture for common engineering work. |
| Strong stopping conditions | Each workflow should have a defined output contract so runs do not sprawl. |
| Local-first execution | Repo context, shell access, patches, and artifacts are strongest when the tool runs beside the code. |
| Artifact-heavy runs | Trust comes from saved prompts, outputs, and run metadata, not terminal scrollback. |
| Prompt assets checked into the repo | Teams need versioned workflow behavior they can inspect and override. |

### What must change for Codex CLI

| Change | Decision |
| --- | --- |
| Skills are not the primary UX | The product surface is a wrapper CLI plus workflow manifests, not a skill directory exposed directly to users. |
| Delegation is already native | `cstack` should define delegation policy and reporting, not invent fake agent theater. |
| Review, resume, and fork already exist | V1 should wrap `codex review`, `codex resume`, and `codex fork` instead of rebuilding them. |
| Deterministic and guided modes must be separate | `codex exec` is the default for repeatable workflows; interactive `codex` is the default for longer build sessions. |
| Browser tooling is not day-one | Web research and MCP fit as optional capability packs. A custom browser runtime is deferred until Codex-native paths prove insufficient. |

### What should be rejected entirely

- A large cast of permanent named personas.
- Claude-specific packaging or terminology as the product mental model.
- Hidden orchestration that spawns agents without clear user-facing records.
- A daemonized control plane for v1.
- “Autonomous company” positioning or long-running remote agent clusters.
- Prompt accumulation from many unrelated skills, MCP tools, and role files without a workflow-level contract.

## 3. **Problem Statement**

An engineer can already prompt Codex CLI directly. That is not enough for the job `cstack` is meant to solve.

Manual prompting fails in predictable ways:

- the prompt framing is inconsistent across runs and across engineers
- the artifact trail is weak or missing
- terminal output is transient and hard to audit
- interactive sessions are powerful but easy to lose track of
- delegation can help, but without policy it becomes noisy, expensive, and hard to trust
- there is no standard way to move from discovery to spec to build to review while keeping state and intent coherent

`cstack` should exist because it standardizes the outer workflow while leaving reasoning and execution inside Codex. The value is not “more intelligence.” The value is a repeatable operator model:

- deterministic run envelopes
- stable artifact contracts
- explicit workflow selection
- clear rules for when to stay single-agent versus when to use a small team
- inspectable linkage between prompts, Codex sessions, delegated work, and final output

The product succeeds if a user can stop manually re-explaining their working style to Codex and instead start each run from a known workflow with known outputs.

## 4. **Target Users and Jobs To Be Done**

| User | Jobs to be done | Pain today | What `cstack` should improve |
| --- | --- | --- | --- |
| Senior IC | Understand a codebase area, plan a change, implement it, review it, and leave an artifact trail | Context assembly is repetitive; good prompts are not reusable enough; interactive runs are hard to replay | Faster setup, better run records, conservative delegation for bounded parallel work |
| Founder / technical lead | Turn vague product intent into a scoped spec and implementation run | Prompting is high leverage but inconsistent; output quality depends too much on operator discipline | Repeatable workflows with clear artifacts and reviewable plans |
| Small team | Share repo-local AI workflows without building a platform team | Every engineer invents a different prompt stack; review and handoff are inconsistent | Repo-owned prompt packs, config, and run artifacts that others can inspect and reuse |

### Week-one success for a single engineer

Success in week one is modest and concrete:

- they run `discover` on an unfamiliar area and get a saved context map
- they run `spec` and receive an implementation-ready plan with open questions called out
- they launch `build` from that spec, resume it later, and optionally fork it for an alternative approach
- they run `review` and get a saved critique rather than a one-off chat response
- they can inspect every run on disk without relying on memory

If that loop works for one engineer in one repo, the product is doing the right first job.

## 5. **Product Principles**

1. `cstack` is a thin wrapper, not a new agent runtime. It should shell out to the installed `codex` binary in v1.
2. Workflow beats roleplay. Users may start from a single high-level intent, but the system must still route that intent through explicit internal stages rather than a fictional cast of permanent personas.
3. Artifacts are first-class. Every run must leave behind enough material to inspect, replay, and debug it.
4. A lead agent is the default. Delegation must be justified by separable work, not by branding.
5. Deterministic configuration should define the run envelope; flexible prompting should define the task details.
6. Local-first is a hard assumption. Repo context, config, prompt assets, and artifacts live in the repo or adjacent local state.
7. The wrapper should be honest about what it can and cannot observe from Codex CLI.
8. The product should degrade gracefully when delegation, MCP, or structured event capture is unavailable.

### Deterministic configuration vs flexible prompting

| Deterministic in v1 | Flexible in v1 |
| --- | --- |
| Workflow names and modes | Task description |
| Prompt skeletons and artifact contracts | Acceptance criteria supplied by the user |
| Delegation caps and default topology | Extra repo context files or run references |
| Output schemas for structured workflows | Optional workflow-specific instructions |
| Allowed capability packs per workflow | User choice to force single-agent or allow delegation |
| Run directory layout | Human-written notes attached to the run |

## 6. **V1 Product Surface**

The minimum lovable workflow set for v1 is four workflows: `discover`, `spec`, `build`, and `review`. V1 should ship a fifth workflow, `ship`, because it is a small extension that closes the handoff loop without major runtime complexity.

### Unified front door

The product should expose a simple top-level entrypoint in addition to explicit workflow commands:

| Entry | Meaning |
| --- | --- |
| `cstack <intent>` | Accept a natural-language task, infer the likely workflow sequence, show the inferred plan, and then execute it through explicit internal stages |
| `cstack run <intent>` | Optional explicit alias for the same behavior if bare-argument CLI parsing becomes awkward |

This is the recommended product shape because it preserves workflow discipline internally while reducing front-door UX friction. The important rule is that intent inference is not a replacement for workflows. It is a router onto them.

The inferred entrypoint should:

- classify the likely task shape
- choose one stage or a sequence such as `discover -> spec -> build -> review -> ship`
- print or persist the inferred plan before substantial mutation
- choose a lead agent
- decide whether specialist delegates are justified
- record which stages actually ran and why

This means the external UX can be simple without collapsing the internal system into a vague “just do the thing” runtime.

### Proposed top-level workflows

| Workflow | Default Codex mode | Agent posture | Intent | Trigger | Inputs | Outputs | When not to use it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cstack discover` | `codex exec` | Single-agent first, delegate-optional | Map code, dependencies, constraints, and risks before planning or coding | New repo area, unclear ownership, incident triage, design kickoff | Question, path scope, optional files, optional prior run ids | `context.md`, `facts.json`, `risks.md`, `final.md` | Do not use it when the task is already well-scoped and the needed context is obvious |
| `cstack spec` | `codex exec` | Single-agent first, delegate-optional | Convert intent into an implementation-ready spec and execution plan | Feature request, refactor proposal, migration plan, bug-fix plan | Goal, acceptance criteria, constraints, linked `discover` run, optional schema | `spec.md`, `plan.json`, `open-questions.md`, `final.md` | Do not use it for trivial edits that can be implemented faster than they can be specified |
| `cstack build` | Interactive `codex` | Delegate-optional | Execute an approved task with repo-aware editing and verification | Approved spec, bounded task, debugging or implementation session | Task or spec run id, constraints, target paths, test commands, delegation mode | `session.json`, `change-summary.md`, `verification.json`, `final.md` | Do not use it for pure critique or when a non-interactive batch run is required |
| `cstack review` | `codex review` or `codex exec` | Single-agent by default | Critique changes, surface risks, and recommend next actions | Before merge, after build, before handoff | Git diff, branch, run id, review policy, optional severity thresholds | `findings.md`, `findings.json`, `verdict.json`, `final.md` | Do not use it as a replacement for implementation or as a general planning step |
| `cstack ship` | `codex exec` plus shell | Single-agent only | Prepare a branch for handoff or release with final checks and artifacts | Ready-to-merge branch, release candidate, founder handoff | Branch or diff, linked run ids, checklist template, verification commands | `ship-summary.md`, `release-checklist.md`, `unresolved.md`, `final.md` | Do not use it for deployment orchestration or CI/CD automation beyond local prep |

### Support commands that are not workflows

| Command | Purpose |
| --- | --- |
| `cstack <intent>` | Infer the likely workflow sequence from the task and route into one or more internal stages |
| `cstack inspect <run-id>` | Show run metadata, linked Codex session ids, artifact paths, and delegate ledger |
| `cstack rerun <run-id>` | Re-execute a deterministic workflow from saved prompt and input materials, creating a new run id |
| `cstack resume <run-id>` | Resolve the linked interactive Codex session from `session.json` and call `codex resume` |
| `cstack fork <run-id> [--workflow <name>]` | Branch an interactive Codex session, create a child run, and record lineage |

### Workflow intent boundaries

- `discover` is for context gathering, not for deciding implementation details prematurely.
- `spec` is for shaping work and tradeoffs, not for editing code.
- `build` is for editing and validating code, not for broad repo archaeology.
- `review` is for critique, not for silent code rewriting.
- `ship` is for last-mile clarity and release readiness, not for remote deployment control.

## 7. **Agent Model**

### Roles in v1

| Role | Durable concept or temporary preset | Can edit code | Primary job |
| --- | --- | --- | --- |
| Intent Router | Durable workflow concept | No | Infer the workflow sequence, specialist needs, and capability attachments from the user request and repo context |
| Leader | Durable workflow concept | Yes in `build`; no in `review` by default | Own the workflow, decide whether to delegate, synthesize outputs, and produce the final artifact |
| Explorer | Temporary preset | No | Gather facts, map code, inspect risks, summarize a bounded area |
| Implementer | Temporary preset | Yes, but only in bounded build tasks | Make code changes in a disjoint file scope and report exactly what changed |
| Reviewer | Durable workflow concept, often implemented as a leader posture | No by default | Critique changes, rank risks, and recommend disposition |
| Security Reviewer | Temporary specialist preset | No by default | Look for security flaws, misuse of secrets, auth gaps, and exploit paths |
| DevSecOps Reviewer | Temporary specialist preset | No by default | Review CI/CD, supply chain, secret handling, runtime hardening, and operational guardrails |
| Traceability Reviewer | Temporary specialist preset | No | Check linkage between intent, spec, implementation, tests, and release artifacts |
| Audit Reviewer | Temporary specialist preset | No | Check auditability, compliance-facing evidence, logging completeness, and change record quality |
| Release Pipeline Reviewer | Temporary specialist preset | No by default | Check release workflows, packaging, versioning, rollout steps, and failure handling |

The agent model is intentionally small at the durable-core level. The system needs a stable router and lead model, plus a bounded library of specialist presets that can be attached when justified. That keeps prompts stable, makes artifact inspection easier, and avoids false precision about agent specialization while still allowing high-value specialist reviews.

### When the primary agent delegates

The leader may delegate only when all of the following are true:

- the work splits into independent subtasks
- each subtask has a bounded output contract
- the merge or synthesis cost is lower than the expected time saved
- the workflow policy allows delegation
- the user has not forced single-agent mode

The intent router may request specialists only when all of the following are true:

- the task or repo context implies a meaningful risk domain
- the specialist has a clear bounded review contract
- the resulting output will materially change decisions or acceptance
- the extra review cost is proportionate to the task

The wrapper should suppress delegation entirely when:

- the task is small enough for one agent to finish quickly
- the problem is ambiguous and needs one coherent line of reasoning first
- the work touches overlapping files with high merge risk
- the workflow is `review` or `ship`
- Codex-native delegation is unavailable or unobservable enough to make the run untrustworthy

### Delegation contract

Every delegate request in v1 should specify:

- objective
- scope boundaries
- allowed files or path prefix
- mode: `analyze` or `edit`
- required output schema
- max expected duration
- acceptance rule for the leader

Every delegate response should return, at minimum:

- `status`: `completed`, `failed`, `stalled`, or `discarded`
- short summary
- files inspected or changed
- commands run
- findings or patch summary
- confidence and unresolved issues

The wrapper should persist this in `delegates/<delegate-id>/request.md` and `delegates/<delegate-id>/result.json` when that data is available from the run. If full delegate telemetry is not available from Codex CLI, the leader must emit a delegate ledger into the final artifact.

### Default topologies by workflow

| Workflow | Default topology | Notes |
| --- | --- | --- |
| `intent` | Intent Router + one Leader | The router chooses stages, specialists, and capability packs before major execution |
| `discover` | Leader + up to 3 explorers | Best use of parallelism because codebase slices are easy to separate |
| `spec` | Leader only by default; optionally leader + up to 2 explorers or one specialist reviewer | Use delegates for cross-cutting questions such as API surface, infra constraints, security posture, or audit expectations |
| `build` | Leader only by default; optionally leader + up to 2 delegates and one bounded specialist reviewer | One or both delegates may be implementers if file ownership is disjoint; specialists stay review-oriented unless explicitly authorized |
| `review` | Reviewer leader plus up to 3 specialist reviewers | This is the main place where specialist review should become first-class when justified |
| `ship` | Leader plus optional release-focused specialists | Final checks should stay disciplined, but release and audit specialists are often justified here |

### Safe parallel work in v1

Safe to parallelize:

- repo area discovery by directory or subsystem
- dependency and configuration inventory
- API contract tracing
- test surface mapping
- docs or migration note drafting on disjoint files
- code changes in clearly separate file trees during `build`
- bounded specialist critiques such as security, auditability, traceability, or release-pipeline checks

Not safe to parallelize in v1:

- overlapping edits in the same module
- release readiness decisions
- final review ranking
- architectural synthesis that depends on unresolved tradeoffs
- unbounded specialist swarms on the same diff without a lead synthesis contract

### How the leader verifies and merges delegated work

The leader is responsible for:

- reading delegate outputs before accepting them
- inspecting touched files or diffs
- running or requesting verification commands for accepted edits
- explicitly marking each delegate result as accepted, partially accepted, or discarded
- summarizing that disposition in the main run artifact

Delegate output is advisory until the leader accepts it. The system should never imply that parallel work was merged blindly.

### Guardrails for fan-out, cost, and noise

- Default delegate count: `0` beyond the lead; the inferred front door may still create one router plus one lead by default
- Recommended max total delegates: `4`
- Recommended max editing delegates: `2`
- Hard rule for v1: no nested delegation
- Each workflow prompt should include a delegation budget and stopping rule
- The wrapper should print planned delegation before the run when the workflow is deterministic
- If delegates produce low-signal output, the leader should stop spawning more and continue single-agent
- Specialist reviewers should be selected explicitly by reason, for example `security`, `devsecops`, `traceability`, `audit`, or `release-pipeline`

The cost and latency tradeoff is simple in v1: use multiple agents only when the task is separable enough that parallelism saves more time than synthesis costs. The most credible multi-agent shape is one lead plus a few narrowly scoped specialists, not a large team by default.

### Specialist library and activation rules

The system should support a bounded library of specialist presets that the intent router or lead can activate deliberately:

| Specialist | Typical trigger | Default output |
| --- | --- | --- |
| Security review | auth changes, secret handling, untrusted input, data exposure risk | `security-findings.md` |
| DevSecOps review | CI/CD changes, container/runtime changes, supply-chain exposure, secret distribution | `devsecops-findings.md` |
| Traceability review | regulated work, complex migrations, multi-stage changes, high handoff cost | `traceability-findings.md` |
| Audit review | audit logging, compliance evidence, change accountability, evidence retention | `audit-findings.md` |
| Release pipeline review | versioning, packaging, release automation, rollout safety, rollback readiness | `release-review.md` |

These should not all run by default. They should be inferred or attached only when the task warrants them, and the run artifact must record why each one was selected.

## 8. **System Architecture**

### Wrapper CLI

V1 should be a local CLI wrapper that shells out to the installed `codex` binary. A TypeScript implementation is a reasonable default because it is well-suited to child process management, JSON handling, and repo-local packaging.

The wrapper owns:

- CLI argument parsing
- workflow selection
- prompt assembly
- config resolution
- run id generation
- artifact directory creation
- session lineage tracking
- best-effort event capture
- inspect, rerun, resume, and fork UX

### Prompt / skill packs

Prompt assets should be owned in two layers:

| Layer | Owner | Purpose |
| --- | --- | --- |
| Built-in workflow templates | `cstack` | Stable base prompts, output contracts, and delegation policy per workflow |
| Repo-local overrides | Repository | Team-specific conventions, coding standards, preferred commands, and MCP allowlists |

To avoid prompt soup, each workflow should assemble prompts from a small manifest:

- base workflow template
- repo context block
- task block
- optional capability pack references
- output contract block

V1 should allow only manifest-declared capability packs such as:

- `skill:<name>`
- `mcp:<server>`
- `shell`
- `web`

The wrapper should not concatenate arbitrary role files by default.

### Orchestration runtime

The orchestration layer should stay thin:

- decide run mode: `exec` or interactive
- materialize prompts
- attach artifact contract instructions
- invoke Codex
- capture outputs
- map run ids to Codex sessions
- record declared delegation policy and observed delegate summaries

What it should not do in v1:

- schedule long-running remote workers
- perform its own code merge engine
- maintain a separate memory graph
- replace Codex-native reasoning or review

### Config model

V1 should use a repo-local config file at `.cstack/config.yml`.

Rough schema:

| Key | Type | Purpose |
| --- | --- | --- |
| `version` | string | Config version |
| `project.name` | string | Human-readable project label |
| `codex.bin` | string | Path override for `codex` binary |
| `artifacts.root` | string | Default run root, default `.cstack/runs` |
| `workflows.<name>.mode` | enum | `exec` or `interactive` default |
| `workflows.<name>.delegation` | object | `allowed`, `default`, `max_total`, `max_editors` |
| `workflows.<name>.capabilities` | list | Allowed capability packs |
| `prompts.override_dir` | string | Repo-local prompt override path |
| `review.severity_threshold` | string | Default output filtering and exit behavior |
| `verification.default_commands` | list | Default test or lint commands for build and ship |

### State / artifact storage

Each run should create an immutable directory:

```text
.cstack/runs/<run-id>/
  run.json
  input.json
  prompt.md
  final.md
  events.jsonl
  session.json
  delegates/
  artifacts/
```

Required files:

| File | Meaning |
| --- | --- |
| `run.json` | Workflow name, timestamps, cwd, git branch, config snapshot, parent run id |
| `input.json` | Normalized user inputs and selected options |
| `prompt.md` | Fully materialized prompt sent to Codex |
| `final.md` | Final top-level response from Codex |
| `events.jsonl` | Best-effort event log for machine-readable runs |
| `session.json` | Primary Codex session id, fork lineage, and interactive metadata |

Workflow-specific artifacts live under `artifacts/`.

### Logs / transcripts / auditability

Auditability matters more than completeness in v1.

- `codex exec` workflows should record `events.jsonl` when possible.
- Interactive workflows should always record launch parameters, linked session ids, and final summaries.
- Full interactive transcript capture is best-effort and may be partial if Codex CLI does not expose a stable event stream.
- Delegate records should be explicit about whether they are observed directly or leader-reported.

This is enough to let a user inspect what was requested, what was observed, and what was decided.

## 9. **Codex CLI Integration Assumptions**

### What the wrapper relies on from Codex CLI

V1 assumes the local `codex` installation provides:

- interactive `codex` sessions
- `codex exec` for deterministic runs
- `codex exec --json` for structured output capture where available
- `codex exec --output-schema` for schema-constrained final messages
- `codex exec --output-last-message` for saved final output
- `codex review`
- `codex resume`
- `codex fork`
- repo-aware execution, shell access, patch-based editing, and native sub-agents

### What is implemented outside Codex CLI

`cstack` owns:

- workflow definitions
- prompt materialization
- repo-local config and overrides
- artifact layout
- session and run lineage
- replay and inspection UX
- delegation policy and reporting contract

Codex owns:

- reasoning
- tool selection
- code editing
- spawned agent execution
- review logic

### Where the boundaries are fragile

- Codex may not expose complete sub-agent telemetry to the wrapper.
- Interactive transcripts may not be fully machine-readable.
- Session id extraction and event formats may change across Codex versions.
- Schema-constrained output applies to final messages, not necessarily the full internal workflow.
- MCP and tool availability can differ by environment.

V1 should treat these boundaries as unstable and store both the requested behavior and the observed behavior.

### When the wrapper should use interactive `codex` vs `codex exec`

| Use case | Default |
| --- | --- |
| `discover` | `codex exec` |
| `spec` | `codex exec` |
| `review` | `codex review` first, then `codex exec` only when a custom output contract is needed |
| `ship` | `codex exec` plus local verification commands |
| `build` | Interactive `codex` by default |

`build` should support `--exec` for small, batch-friendly tasks, but guided interactive execution is the default because implementation usually benefits from iterative clarification, retries, and session continuity.

V1 should shell out to Codex CLI rather than attempt deeper runtime integration. That keeps the system practical to build, easier to debug, and aligned with upstream improvements.

## 10. **Repo and File Layout Proposal**

```text
.
├── .cstack/
│   ├── config.yml
│   ├── prompts/
│   │   ├── discover.md
│   │   ├── spec.md
│   │   ├── build.md
│   │   ├── review.md
│   │   └── ship.md
│   └── runs/
│       └── <run-id>/
│           ├── run.json
│           ├── input.json
│           ├── prompt.md
│           ├── final.md
│           ├── events.jsonl
│           ├── session.json
│           ├── artifacts/
│           └── delegates/
├── src/
│   ├── cli/
│   ├── workflows/
│   ├── codex/
│   ├── artifacts/
│   ├── config/
│   └── prompts/
└── docs/
    └── specs/
        └── cstack-spec-v0.1.md
```

Notes:

- `.cstack/` is repo-local operating state and should be gitignored by default except for prompt overrides and config if the team wants them versioned.
- Built-in prompt assets belong in `src/prompts/`; repo overrides belong in `.cstack/prompts/`.
- Runs are immutable. Re-execution creates a new run id and points back to the source run through lineage metadata.

## 11. **Execution Lifecycle**

### Standard lifecycle

1. User invokes either an explicit workflow command or `cstack <intent>`.
2. If the user invoked the inferred front door, the intent router resolves the likely stage sequence, capability packs, and specialist candidates.
3. `cstack` resolves config, workflow mode, capability packs, and delegation policy.
4. `cstack` creates a run id and run directory.
5. `cstack` materializes `input.json`, `prompt.md`, and the inferred plan if routing was involved.
6. `cstack` invokes `codex exec`, `codex review`, or interactive `codex`.
7. The leader agent executes, optionally delegating within the workflow policy.
8. `cstack` records observed events, session ids, delegate summaries, specialist reasons, and final output.
9. Workflow-specific artifacts are written under `artifacts/`.
10. `cstack` prints a short terminal summary: inferred plan if applicable, workflow, run id, status, key artifact paths, and next actions.

### Run ids and Codex session mapping

- `run_id` is generated by `cstack` and is stable for the local artifact directory.
- `codex_session_id` is whatever Codex reports for the primary session.
- `session.json` maps the two and records `parent_run_id`, `forked_from_run_id`, and child session ids when known.
- `resume` always starts from a `run_id`; the wrapper resolves the Codex session for the user.

### How users inspect, replay, and debug runs

- `cstack inspect <run-id>` reads `run.json`, `session.json`, the artifact index, and the delegate ledger.
- `cstack rerun <run-id>` reuses the saved normalized input and materialized prompt to create a fresh deterministic run.
- Debugging starts with artifact inspection, not with rerunning blindly. Users should be able to compare `prompt.md`, `final.md`, and `events.jsonl` across runs.

### Example end-to-end user flow

1. A senior IC runs `cstack "Add plan-based rate limits with audit logging and release safety checks"` instead of choosing a workflow manually.
2. The intent router infers `discover -> spec -> build -> review -> ship` and prints that plan before execution.
3. The router also infers that `audit` and `release-pipeline` specialists are justified, while `security` is optional and therefore not attached by default.
4. `discover` and `spec` complete first and produce saved context and planning artifacts.
5. `build` launches with a lead agent and only the bounded implementation delegates needed for disjoint file work.
6. `review` runs with the lead reviewer plus the selected specialists and records exactly why those specialists were used.
7. `ship` produces the final checklist and release-oriented summary, preserving lineage back to the inferred front door and every stage it ran.

### Example non-interactive run

Command:

```bash
cstack spec "Add org-scoped API keys with audit logging" --from discover-20260313-120400
```

Expected flow:

- `cstack` chooses `codex exec`
- prompt includes the linked discovery artifact, acceptance criteria, and the `spec` output contract
- output artifacts include `artifacts/spec.md`, `artifacts/plan.json`, and `artifacts/open-questions.md`
- the terminal summary points to the run id and recommends either `cstack build --from-run <run-id>` or `cstack inspect <run-id>`

### Example interactive run

Command:

```bash
cstack build --from-run spec-20260313-121015
```

Expected flow:

- `cstack` launches interactive `codex` with the spec artifact embedded into the initial prompt
- `session.json` stores the returned Codex session id
- the engineer iterates with Codex, runs tests, and adjusts scope
- later they use `cstack resume <run-id>` rather than remembering the raw Codex session id
- if they want an alternative implementation branch, they use `cstack fork <run-id> --workflow build`

### Example multi-agent run with failure handling

Command:

```bash
cstack "Introduce SSO with audit logging and hardened release checks"
```

Expected topology:

- intent router infers `discover -> spec -> build -> review`
- leader agent owns the main execution for each stage
- specialist `security-review` checks auth and identity risks
- specialist `audit-review` checks logging and evidence expectations
- specialist `release-pipeline-review` checks rollout and rollback assumptions

Artifacts:

- `routing-plan.json`
- `delegates/security-review/result.json`
- `delegates/audit-review/result.json`
- `delegates/release-pipeline-review/result.json`
- `artifacts/context.md`
- `artifacts/risks.md`

Failure handling:

- if `audit-review` returns low-signal output, the leader marks it `discarded`
- the leader does not keep spawning more specialists to compensate
- the final summary records which specialist outputs were accepted, partially accepted, or discarded
- the main run still completes, but with an explicit note that audit coverage was degraded

## 12. **Guardrails and Failure Handling**

### Failure modes and responses

| Failure mode | Expected response |
| --- | --- |
| Codex binary missing or incompatible | Fail fast before run creation is finalized; write an error record if the run directory already exists |
| Delegation unavailable | Continue in single-agent mode and record `delegation_mode: degraded` |
| Delegate stalls or fails | Mark delegate status, stop fan-out growth, continue with leader synthesis if enough signal exists |
| Dirty worktree with conflicting edits | Warn early; `build` and `ship` should require explicit confirmation flags to proceed |
| Structured output parse failure | Preserve raw `final.md`, record schema mismatch in `run.json`, and avoid pretending the artifact is valid |
| MCP server unavailable | Remove the capability pack for that run, log the downgrade, and continue if the workflow still makes sense |
| Verification commands fail | Record failure in `verification.json`; do not silently upgrade the run status to success |

### Trust guardrails

- Every workflow should declare whether it is single-agent first, delegate-optional, or single-agent only.
- The inferred front door must record the planned stage sequence before major execution starts.
- Delegation must be visible in artifacts, even if only through leader-reported summaries.
- Runs are immutable; reruns create new run ids.
- The wrapper should never hide whether a final answer came from one agent or a leader synthesizing delegates.
- Specialist reviewers must always record both their activation reason and their acceptance disposition.
- `review` and `ship` should stay disciplined by default because trust matters more than speculative parallelism there.

### Idempotency concerns

- `discover`, `spec`, and `review` are replayable but not guaranteed to be byte-for-byte identical because Codex is nondeterministic.
- Idempotency in v1 means stable inputs, stable artifact shape, and stable lineage, not identical model text.
- `build` is inherently stateful because the repo changes. Replay for `build` means fork, resume, or rerun with a new run id and explicit parent linkage.

### How orchestration degrades

If delegation or structured events do not work, `cstack` should still provide value as:

- workflow router
- prompt materializer
- run recorder
- session index

That is the correct degradation path for v1.

### MCP, local skills, and external tools without prompt soup

V1 should treat these as workflow-scoped capability packs, not free-floating prompt attachments.

- A workflow manifest declares which packs are allowed.
- Repo config decides which packs are enabled by default.
- The user can opt in to additional allowed packs per run.
- The prompt should name capabilities explicitly and briefly.
- The artifact record should state which packs were requested and which were actually available.

This keeps the operator model coherent: one workflow, one leader, a small set of tools, a saved artifact trail.

## 13. **MVP Milestones**

### Milestone 1: deterministic runner and artifact contract

- Implement `cstack discover` and `cstack spec`
- Materialize prompts and normalized inputs
- Create run directories with `run.json`, `prompt.md`, `final.md`, and workflow artifacts
- Add `cstack inspect`

### Milestone 2: interactive build with session lineage

- Implement `cstack build`
- Record `session.json`
- Add `cstack resume` and `cstack fork`
- Capture verification commands and change summaries

### Milestone 3: review and ship workflows

- Wrap `codex review`
- Add structured findings artifacts
- Implement `ship` as a final-prep workflow with verification hooks

### Milestone 4: bounded delegation and capability packs

- Add workflow-level delegation policy
- Persist delegate ledgers
- Support repo-configured capability packs for skills, MCP servers, shell, and web

### Milestone 5: inferred intent router and specialist library

- Add `cstack <intent>` as the primary front door
- Persist inferred routing plans and stage lineage
- Implement bounded specialist presets for security, DevSecOps, traceability, audit, and release-pipeline review
- Record specialist selection reasons and acceptance states

## 14. **Open Questions**

1. How much direct sub-agent telemetry can `cstack` reliably observe from Codex CLI versus infer from leader output?
2. Which specialist reviewers should be first-class in the earliest inferred-intent version, and which should remain opt-in?
3. How much prompt override flexibility should repo config allow before workflow behavior becomes too fragmented across teams?
4. What is the smallest stable event schema `cstack` can count on from `codex exec --json`?
5. Should `ship` remain a documentation-and-verification workflow, or should later versions own more release automation?
6. How should artifact retention work for large repos with many runs: keep all runs, expire old runs, or archive only summaries?

## 15. **Recommended Next Spec**

The next spec should define the inferred-intent router, workflow manifest, and specialist activation contract in detail.

That spec should answer:

- exact CLI grammar and flags for each workflow
- JSON/YAML schema for `.cstack/config.yml`
- artifact schema per workflow
- prompt manifest format and override rules
- session lineage format for `resume`, `fork`, and `rerun`
- delegate ledger schema and acceptance states
- routing-plan schema and stage inference rules
- specialist activation reasons and artifact schema

Without that layer, implementation will drift into ad hoc process management.

## **Build Recommendation**

Build the inferred front door next while preserving the explicit internal stages. The first slice should add `cstack <intent>`, a routing-plan artifact, one lead agent, and a bounded specialist library with explicit activation reasons. That validates the higher-level UX without collapsing the internal workflow contract.
