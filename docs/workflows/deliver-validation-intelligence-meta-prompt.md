# Deliver Validation Intelligence Meta Prompt

Use this as the top-level prompt for implementing the validation-intelligence slice for `deliver`.

```md
You are the lead execution conductor for `cstack` in this repository.

Your mission is to implement and release the `deliver` validation-intelligence slice end to end.

This is not a brainstorming-only task.
Execute the work:

- read the current active spec and the new validation slice spec
- update docs if implementation refines the slice
- implement the new internal `validation` stage for `deliver`
- preserve explicit internal stage artifacts and lineage
- make validation repo-aware across product types
- use a bounded multi-agent team to research tooling, design a testing pyramid, implement validation, and wire GitHub Actions where justified
- add or update tests
- validate locally
- work through a branch and pull request, not direct pushes to `main`
- merge through the PR flow
- prepare and start a release when the slice is complete

## Source Of Truth

Read these first:

- `docs/specs/cstack-spec-v0.1.md`
- `docs/specs/cstack-deliver-validation-intelligence-slice.md`
- `docs/specs/cstack-deliver-slice.md`
- `docs/workflows/current-project-workflow.md`

Treat `docs/specs/cstack-spec-v0.1.md` as the active shipped contract.
Treat `docs/specs/cstack-deliver-validation-intelligence-slice.md` as the future slice to realize and then fold into the active contract.

## Product Direction

Keep the work aligned to the current product shape:

- `cstack` is a local-first wrapper around Codex CLI
- `deliver` is the operator-facing umbrella workflow
- GitHub is the engineering control plane for delivery
- artifacts are first-class
- delegation must stay bounded and inspectable
- the new work is a real `validation` stage, not a vague expansion of `build`
- the result must work across repo types by using profiling and adapters, not one universal test stack

## Required Outcome

Deliver all of the following:

- an explicit internal `validation` stage inside `deliver`
- updated active spec to reflect the new shipped contract
- repo profiling for validation planning
- a validation pyramid planner
- tool research artifacts with source attribution
- local validation and GitHub Actions validation planning
- bounded validation specialists with recorded dispositions
- validation-aware inspection support
- tests for the new behavior
- a PR-based merge to `main`
- a release containing the new capability

## Hard Constraints

- do not push directly to `main`
- create a feature branch
- commit in small logical increments
- push the branch frequently
- open a PR with `gh pr create`
- keep the PR description concrete and reviewable
- merge through the PR flow
- only cut the release after the PR is merged

- keep `build`, `validation`, `review`, and `ship` distinct internally
- preserve reconstructable artifact lineage
- avoid fake multi-agent theater with no durable outputs
- do not pretend one tool solves all ecosystems
- fail closed when required validation evidence is missing or broken

## Validation Stage Expectations

Design and implement `validation` around these responsibilities:

- detect the repo shape and runner constraints
- infer a testing pyramid
- research the best OSS tools for that repo for both local and GitHub Actions validation
- compare candidate tools and record why the chosen toolset won
- implement or extend test scaffolding when justified
- add or refine GitHub Actions validation jobs when justified
- run the selected validation layers
- summarize coverage and residual gaps

At minimum, the stage should write artifacts such as:

- `stages/validation/repo-profile.json`
- `stages/validation/validation-plan.json`
- `stages/validation/tool-research.json`
- `stages/validation/artifacts/test-pyramid.md`
- `stages/validation/artifacts/coverage-summary.json`
- `stages/validation/artifacts/coverage-gaps.md`
- `stages/validation/artifacts/local-validation.json`
- `stages/validation/artifacts/ci-validation.json`
- `stages/validation/artifacts/github-actions-plan.md`
- `stages/validation/delegates/<specialist>/...` when specialists run

## Multi-Agent Strategy

Use a bounded team with explicit ownership:

- `validation-lead`
  - owns stage design, synthesis, and acceptance decisions
- `ecosystem-profiler`
  - owns repo profiling logic and profile artifacts
- `tool-researcher`
  - owns OSS tool comparison and source-backed recommendations
- `local-validation-engineer`
  - owns local test harness wiring and command execution
- `ci-validation-engineer`
  - owns GitHub Actions validation wiring
- `coverage-analyst`
  - owns coverage summaries and gap analysis

Optional specialists only when justified:

- `mobile-validation-specialist`
- `container-validation-specialist`
- `browser-e2e-specialist`
- `api-contract-specialist`
- `workflow-security-specialist`

Rules:

- do not run all specialists by default
- assign clear file ownership when delegates edit code
- every delegate must write attributable artifacts
- the lead must record accepted, partial, or discarded dispositions

## Implementation Strategy

Deliver the slice in coherent increments:

1. add validation stage and stage lineage updates
2. add repo profiling and validation-plan artifacts
3. add tool research pipeline and source-backed comparison artifacts
4. add first useful ecosystem adapters
5. add inspector support
6. add or update tests
7. update active spec and README
8. open and merge the PR
9. cut and verify the release

## Ecosystem Priority

Build the first useful slice around:

- web and TypeScript/JavaScript repos
- backend service repos
- containers
- GitHub Actions workflow validation itself

Then add bounded profiling support for:

- iOS
- Android
- React Native
- CLIs and binaries

If all adapters cannot be implemented in one release, still ship a truthful vertical slice with:

- explicit repo profile output
- truthful unsupported/deferred states
- strong web/container/service handling
- documented mobile limits

## Testing Requirements

Add or update tests for:

- deliver stage order with `validation`
- repo profiling
- tool research artifact generation
- web/container/service adapter selection
- validation artifact persistence
- inspector rendering for validation outputs
- GitHub Actions planning output
- failure and partial states

Use fixtures and deterministic test doubles where possible.

## Docs Requirements

Update:

- `docs/specs/cstack-spec-v0.1.md`
- `README.md`
- any relevant workflow guides

The docs must explain:

- what the validation stage does
- how the testing pyramid is inferred
- how tool research is recorded
- what local vs CI parity means
- what ecosystems are fully supported versus partially supported

## Git And PR Discipline

You must work through a branch and PR.

Required flow:

1. create a feature branch
2. commit small logical slices
3. push the branch frequently
4. open a PR with a clear title and body
5. update the PR description as the slice firms up
6. run validation locally
7. merge through the PR flow
8. fast-forward local `main`
9. start the release from merged `main`

Do not bypass this flow with direct pushes to `main`.

## Release Expectations

When the slice is complete:

- choose the next appropriate version
- update release-facing docs if needed
- rerun validation
- merge the PR
- pull merged `main`
- dispatch the release workflow
- verify the GitHub Release, assets, and install path

## Final Reporting

At the end:

- summarize the shipped validation model
- summarize the repo types and adapters supported
- list validation artifacts added
- list tests run
- list branch, PR, merge commit, and release tag
- note residual gaps honestly
```
