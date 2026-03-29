# Capability-Pack Governance Slice

Historical note:

- This document was originally written as a future slice spec and now records the capability-pack governance workstream that shipped on 2026-03-28.
- The active shipped contract remains `docs/specs/cstack-spec-v0.1.md`.
- This slice records how workflow-attached capabilities became explicit, policy-visible, and inspectable.

## Thesis

`cstack` should expose capability packs as a first-class policy surface so workflows can declare which external research, browser, GitHub, shell, or other capability families are allowed, requested, available, and actually used.

## Why This Slice Exists

The current product already implies capability boundaries through workflow design and local tooling.

What is still missing is a stable contract for:

- which capability packs a workflow may attach
- which packs were requested versus actually available
- when external research or browser use was allowed by policy
- how capability usage is made inspectable after the run

## Product Decision

This slice turns capability-pack governance into explicit config, artifact, and inspection surfaces.

It should strengthen workflow control without turning capability attachment into prompt soup.

## Scope

This slice owns:

- workflow-level capability allowlists
- config for requested versus allowed capability packs
- artifact recording for requested, available, and used capabilities
- external research and browser-use policy visibility
- inspector views for capability usage

This slice does not own:

- issue lineage semantics
- validation strategy design
- initiative graph UX

## Independent Team Contract

The capability-pack governance team is responsible for:

- capability config schema
- workflow attachment rules
- requested-versus-observed capability recording
- inspector support for capability visibility

The team is explicitly not responsible for:

- inventing new workflows solely to justify capability packs
- embedding arbitrary role files into prompts
- broad autonomous orchestration semantics

## Capability Model

Recommended capability families:

- `shell`
- `web`
- `github`
- `browser`
- `mcp:<server>`
- `skill:<name>`

Each workflow should be able to record:

- allowed packs
- requested packs
- available packs
- used packs
- downgraded or denied packs

## Config Contract

Recommended future config shape:

```toml
[workflows.discover.capabilities]
allowed = ["shell", "web", "github"]
defaultRequested = ["shell"]

[workflows.deliver.capabilities]
allowed = ["shell", "github", "browser"]
defaultRequested = ["shell", "github"]
```

## Artifact Contract

Recommended additions:

- `artifacts/capabilities.json`
- `artifacts/capability-policy.md`

Recommended meanings:

- `capabilities.json`
  - requested, allowed, available, used, and denied capability packs for the run
- `capability-policy.md`
  - human-readable explanation of workflow capability posture and downgrades

Recommended `capabilities.json` shape:

```json
{
  "workflow": "discover",
  "allowed": ["shell", "web", "github"],
  "requested": ["shell", "web"],
  "available": ["shell"],
  "used": ["shell"],
  "downgraded": [
    {
      "name": "web",
      "reason": "disabled by repo policy"
    }
  ]
}
```

## Inspector and Ledger Expectations

`inspect` should be able to show:

- which capabilities were requested
- which were actually available
- which were used
- which were downgraded or denied and why

`runs` may later expose coarse capability summaries for filtering and audit.

## Acceptance Criteria

This slice is complete when:

- workflows can declare allowed capability packs
- run artifacts show requested, available, and actually used capabilities
- external research is policy-visible rather than implicit
- capability usage remains bounded and inspectable

## Release Boundary

First release for this slice should include:

- capability config schema
- workflow policy integration
- capability artifacts
- inspector support for capability visibility

It should not require:

- initiative graph support
- issue lineage support
- validation strategy support

## Non-Goals

This slice should not:

- encourage unconstrained prompt assembly
- imply that capability availability is identical across environments
- hide downgraded capabilities behind silent fallback
