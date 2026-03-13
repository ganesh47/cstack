# First Spec Meta-Prompt

Use this prompt to generate the first product and technical spec for `cstack`.

## Prompt

```text
You are the founding product strategist and systems architect for `cstack`, a Codex CLI-native workflow wrapper inspired by `gstack`.

Your job is to write the first serious spec for the product.

## Mission

Define `cstack` as a thin but opinionated layer on top of Codex CLI that gives an engineer a "smart multi-agent team" workflow for software delivery inside a repo.

This should feel like a strong adaptation of the `gstack` idea, not a shallow clone.

## Core Context

- Product name: `cstack`
- Reference inspiration: `gstack` uses a small set of opinionated workflow commands and role-shaped prompts to structure software work.
- Target platform: Codex CLI
- Key Codex-native capabilities to exploit:
  - repo-aware execution
  - shell access
  - patch-based code editing
  - sub-agents / delegation
  - parallel task decomposition
  - planning mode
  - web research when needed
  - local prompt assets / skills
  - MCP / external tool integrations
- Known local Codex CLI primitives available:
  - `codex exec`
  - `codex review`
  - `codex resume`
  - `codex fork`
  - `codex apply`
  - `codex exec --json`
  - `codex exec --output-schema`
  - `codex exec --output-last-message`
- Starting point: greenfield repo
- Primary users:
  - senior ICs
  - founders / technical leads
  - small teams that want repeatable AI-assisted engineering workflows
- Non-goals for v1:
  - hosted control plane
  - browser-first GUI
  - generalized "autonomous company" simulation
  - long-running remote agent clusters

## Important Framing

Do not assume Claude-specific features, terminology, or runtime behavior.
Do not treat this as "port gstack to another model".
Instead, define what the best version of this product looks like when Codex CLI is the native execution environment.

Assume the best v1 will likely be:

- a wrapper around the installed `codex` binary
- workflow-driven rather than roleplay-driven
- artifact-heavy and replayable
- conservative about custom runtime complexity
- selective about delegation
- explicit about when to use one agent versus a small team of agents

The result should be a spec for a product that is:

- practical to build
- clear about v1 scope
- shaped around developer workflows
- explicit about orchestration boundaries
- honest about failure modes

## Deliverable

Write **Spec v0.1** for the first shippable version of `cstack`.

The spec must be concrete enough that an implementation agent could use it to start scaffolding the project.

## Required Output Structure

Use exactly these sections and keep them substantive:

1. **One-Line Thesis**
2. **Premise Check**
   - What should be kept from the `gstack` idea
   - What must change for Codex CLI
   - What should be rejected entirely
3. **Problem Statement**
4. **Target Users and Jobs To Be Done**
5. **Product Principles**
6. **V1 Product Surface**
   - Proposed top-level commands / workflows
   - For each workflow: intent, trigger, inputs, outputs, and when not to use it
7. **Agent Model**
   - which roles exist
   - which roles are persistent concepts vs temporary prompt presets
   - when the primary agent delegates
   - how spawned agents report back
   - what the default multi-agent topology is per workflow
   - which subtasks are safe to parallelize
   - what guardrails cap agent fan-out, cost, and noise
8. **System Architecture**
   - wrapper CLI
   - prompt / skill packs
   - orchestration runtime
   - config model
   - state / artifact storage
   - logs / transcripts / auditability
9. **Codex CLI Integration Assumptions**
   - what the wrapper relies on from Codex CLI
   - what is implemented outside Codex CLI
   - where the boundaries are fragile
   - when the wrapper should use interactive `codex` vs `codex exec`
10. **Repo and File Layout Proposal**
11. **Execution Lifecycle**
   - from user command to plan, delegation, execution, review, and final output
12. **Guardrails and Failure Handling**
13. **MVP Milestones**
14. **Open Questions**
15. **Recommended Next Spec**

## Hard Requirements

The spec must answer these questions explicitly:

- Why should this exist if a user can already manually prompt Codex CLI?
- What is the minimum lovable workflow set for v1?
- What should be deterministic configuration versus flexible prompting?
- How do we prevent multi-agent behavior from becoming noisy, expensive, or hard to trust?
- What artifacts should be written to disk after each workflow run?
- How does a user inspect, replay, or debug a workflow?
- What does success look like for a single engineer in week one of usage?
- What should `cstack` own versus what should remain delegated to Codex CLI?
- Should v1 shell out to Codex CLI or attempt deeper runtime integration?
- How should interactive sessions, `resume`, and `fork` appear in the `cstack` UX?
- Which workflows should actively use Codex's multi-agent ecosystem, and which should stay single-agent by default?
- What is the delegation contract between the primary agent and spawned agents?
- How do MCP servers, local skills, and external tools fit into the workflow model without turning the system into prompt soup?

## Workflow Design Requirements

When defining workflows:

- prefer 4 to 6 top-level workflows for v1
- each workflow should map to a distinct user intent
- avoid roleplay-heavy names unless they materially help usability
- define whether each workflow is single-agent first, delegate-optional, or multi-agent by design
- include at least:
  - a planning/spec workflow
  - an execution/build workflow
  - a review/critique workflow
  - a context-gathering or discovery workflow
- if you include additional workflows, justify them

## Architecture Requirements

Be explicit about:

- local-first assumptions
- configuration files and their rough schema
- prompt template ownership
- artifact directories
- resumability
- idempotency concerns
- how orchestration should degrade when delegation is unavailable or fails
- the run artifact contract for every workflow
- how run ids map to Codex sessions
- how a user moves between deterministic workflow runs and interactive Codex sessions
- how the wrapper exposes Codex-native delegation, fork/resume, and tool integrations without leaking too much runtime complexity

## Multi-Agent Design Requirements

The spec must explicitly define:

- the primary reasons to use multiple Codex agents instead of one
- the agent topologies allowed in v1
  - example: leader + N specialists
  - example: leader + parallel explorers + final synthesizer
- the difference between durable workflow roles and ephemeral task-specific delegates
- which agent roles can edit code versus analyze only
- what context each delegate receives
- how delegates return results
- how the leader agent verifies and merges delegated work
- how failed, stalled, or low-signal delegates are handled
- the maximum recommended fan-out for v1 and why
- the cost/latency tradeoff model for multi-agent execution
- when the wrapper should suppress delegation entirely

## Interaction Model Requirements

The spec must explicitly define:

- the difference between deterministic workflow execution and guided interactive execution
- which workflows should default to `codex exec`
- which workflows should default to interactive `codex`
- how `resume` and `fork` are surfaced by the wrapper
- whether the wrapper records `events.jsonl`, `final.md`, and structured artifacts per run
- how delegated sub-work is summarized back into the primary run
- why the agent model is small and policy-driven instead of a large cast of named personas
- how Codex-native sub-agents, MCP tools, local prompt assets, and shell execution combine into one coherent operator model
- how the user can inspect which agents were spawned, what each one did, and what was accepted or discarded

## Quality Bar

The spec should read like a serious early-stage internal design document.
It should not be marketing copy.
It should make decisions.
It should separate:

- what is in v1
- what is deferred
- what is unknown

## Style Requirements

- Write in markdown.
- Use tables where they improve clarity.
- Prefer direct language over abstract framework speak.
- Name tradeoffs plainly.
- Include at least one example end-to-end user flow.
- Include one example of a non-interactive run and one example of an interactive run.
- Include at least one example of a multi-agent run showing leader, delegates, artifacts, and failure handling.
- End with a short section called **Build Recommendation** that states the first implementation slice to build next.
```

## Intended Use

Use this as the bootstrap prompt for the first spec pass, then refine the resulting spec into narrower prompts for:

- CLI command design
- config schema
- prompt pack design
- agent orchestration runtime
- artifact and audit model
