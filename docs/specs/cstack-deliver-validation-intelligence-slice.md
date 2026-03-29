# Deliver Validation Intelligence Slice

Historical note:

- This document was originally written as a future slice spec and now records the validation-intelligence workstream that shipped on 2026-03-28.
- The active shipped contract remains `docs/specs/cstack-spec-v0.1.md`.
- This slice records how `deliver` grew from bounded verification into a repo-aware validation system with an explicit validation stage and durable validation artifacts.

## Thesis

`deliver` should own an explicit `validation` stage between `build` and `review` that can infer the product surface, research the best OSS validation stack for that repo, generate a test pyramid with meaningful coverage, and run the same validation story locally and in GitHub Actions.

## Why This Slice Exists

Current `deliver` relies on bounded verification commands inherited from `build`. That is not strong enough for engineering-complete delivery across varied product shapes.

The missing capability is not just "run more tests." The wrapper needs to:

- understand what kind of product is in the repo
- infer what a good validation pyramid means for that product
- research and justify the best OSS tools for local and CI validation
- generate or extend tests with clear coverage intent
- wire the validation path into GitHub Actions when the repo lacks it
- leave behind artifacts that explain what was validated, what remains risky, and why

## Product Decision

This slice adds a first-class internal `validation` stage to `deliver`.

Target stage order:

1. `build`
2. `validation`
3. `review`
4. `ship`

`validation` is not just a post-build command runner.
It is a bounded multi-agent stage that:

- profiles the repo
- selects a validation strategy
- researches tool choices
- implements missing validation scaffolding when justified
- runs the validation pyramid
- records coverage, gaps, and CI portability

## Independent Team Contract

The validation intelligence team is responsible for:

- repo and product-surface profiling for validation
- validation-plan generation
- test pyramid intent and coverage reporting
- local and GitHub Actions validation linkage
- validation-aware artifact and inspector contracts

The team is explicitly not responsible for:

- issue lineage design
- deployment evidence collection
- post-ship feedback capture
- initiative-level grouping

## Scope

This slice should cover:

- web apps
- backend services
- CLIs and binaries
- libraries and SDKs
- containers
- iOS apps
- Android apps
- React Native or mixed mobile apps

It should work across languages and build systems by using repo profiling plus ecosystem-specific adapters rather than one universal test tool.

## Non-Goals

This slice does not require:

- production deployment orchestration
- proprietary SaaS testing platforms as the default answer
- universal 100% line coverage targets
- fully replacing language-native build and test systems
- fake "all ecosystems are the same" abstractions that ignore platform constraints

## Deliver Stage Contract

`deliver` should become:

1. `build`
2. `validation`
3. `review`
4. `ship`

Stage responsibilities:

- `build`: produce the implementation delta and basic verification evidence
- `validation`: design and execute the repo-appropriate test pyramid, local validation commands, CI validation wiring, and coverage analysis
- `review`: critique the implementation using build plus validation evidence
- `ship`: produce GitHub-complete delivery readiness using validation and review evidence

## Validation Stage Outcome

A successful `validation` stage should prove:

- the repo was profiled correctly enough to choose a validation strategy
- a validation pyramid was selected and documented
- local validation commands exist and were run
- GitHub Actions validation wiring exists or the gap is documented explicitly
- coverage and confidence are summarized by layer, not just one aggregate percent
- missing validation and residual risk are explicit

The stage may still conclude `blocked` or `partial` when:

- platform requirements cannot be satisfied locally or in GitHub-hosted runners
- the repo lacks enough product seams to generate safe coverage automatically
- the detected ecosystem needs human decisions on simulators, secrets, devices, or runner classes

## Validation Intelligence Team

This stage should default to one `Validation Lead` plus bounded specialists.

Core roles:

- `validation-lead`
  - owns strategy, synthesis, and final verdict
- `ecosystem-profiler`
  - identifies product type, language/runtime/build tools, packaging, and likely test seams
- `pyramid-architect`
  - defines the layered validation plan and coverage intent
- `local-validation-engineer`
  - chooses and wires local tools and commands
- `ci-validation-engineer`
  - maps the same validation story into GitHub Actions
- `coverage-analyst`
  - evaluates measured and missing coverage

Optional bounded specialists:

- `mobile-validation-specialist`
- `container-validation-specialist`
- `browser-e2e-specialist`
- `api-contract-specialist`
- `workflow-security-specialist`

Rules:

- do not spawn the whole team by default
- activate only the specialists justified by repo profile and change scope
- every specialist must produce attributed artifacts
- the lead must record accepted, partial, or discarded dispositions

## Repo Profiling Model

The first step in `validation` is a repo profile.

Minimum profile dimensions:

- primary language(s)
- package/build system
- deployable artifact type:
  - web app
  - service
  - library
  - CLI/binary
  - mobile app
  - container image
- existing test stack
- existing CI stack
- coverage tooling present or absent
- platform runner constraints:
  - Linux
  - macOS
  - Android emulator
  - iOS simulator
  - Docker availability

Key signals include:

- lockfiles and manifests
- build files
- workflow files
- test directories
- existing coverage reports
- container manifests
- Xcode, Gradle, Cargo, Go, npm, Python, JVM, .NET, Ruby, PHP, and shell conventions

## Validation Pyramid Model

The `validation` stage should reason in layers, not in one flat command list.

Canonical layers:

1. static validation
   - typecheck
   - lint
   - config and workflow lint
   - container and supply-chain lint
2. unit and component tests
3. integration and contract tests
4. end-to-end or system tests
5. packaging and runtime smoke tests

Every run should write a pyramid summary with:

- chosen layers
- why each layer applies
- target commands
- current coverage evidence
- gaps
- blockers

## Tool Selection Strategy

The system should not hardcode one toolchain for every repo.

It should choose from repo-appropriate OSS tools based on:

- ecosystem fit
- local developer ergonomics
- GitHub Actions compatibility
- headless or emulator support
- artifact friendliness
- maintenance health and documentation quality

### Preferred Tool Families By Surface

#### Web and browser-heavy JavaScript/TypeScript

- unit/component:
  - `Vitest`
  - `Jest` when already established
- UI component testing:
  - Testing Library adapters
- end-to-end:
  - `Playwright` preferred
  - `Cypress` when already present and healthy
- workflow lint:
  - `actionlint`
  - `zizmor` for GitHub Actions security lint

Why:

- strong local and GitHub Actions support
- good artifact output
- Playwright has first-party CI guidance and parallel/browser support

#### Backend services and APIs

- unit tests:
  - language-native runner first
- integration tests:
  - `Testcontainers` where the ecosystem supports it
- API contract or fuzz:
  - `Schemathesis` for OpenAPI-driven APIs when specs exist
- smoke:
  - repo-native smoke scripts or CLI probes

Why:

- language-native unit runners preserve ecosystem norms
- Testcontainers improves local/CI parity for service dependencies
- contract tooling should be used when the API surface is explicitly described

#### CLIs and binaries

- unit tests:
  - language-native runner first
- smoke and black-box:
  - shell-driven command probes
  - `bats-core` for shell-facing CLIs where appropriate
- packaging:
  - generated install and invocation smoke tests

Why:

- CLI quality depends heavily on black-box invocation, exit codes, and packaging behavior

#### Containers

- lint:
  - `Hadolint`
- vulnerability and secret scanning:
  - `Trivy`
- image structure and smoke:
  - `container-structure-test`
  - `Goss` when service assertions fit better
- SBOM:
  - `Syft`

Why:

- these tools support local runs and GitHub Actions usage well
- they cover build correctness, image contents, and supply-chain visibility

#### iOS and Android

- native tests:
  - `xcodebuild test` / `XCTest` or Swift-native testing where present
  - `gradlew test` and `connectedAndroidTest` / AndroidX test stack where present
- cross-platform black-box UI:
  - `Maestro`
- React Native gray-box:
  - `Detox` when the repo already fits that model

Why:

- native ecosystems already define core test entrypoints
- Maestro is useful for portable black-box flows across mobile surfaces
- GitHub Actions support depends on macOS and emulator/simulator runner choices

#### GitHub Actions validation itself

- `actionlint`
- `zizmor`

Why:

- validation should cover the workflow system that will enforce CI gates

## Research Requirement

The `validation` stage must perform explicit research before introducing a new tool family into a repo.

Research process:

1. detect current stack and gaps
2. shortlist candidate OSS tools
3. compare them on:
   - repo fit
   - local setup cost
   - GitHub Actions fit
   - artifact quality
   - ecosystem momentum
4. choose the minimum viable stack
5. write the decision and sources to artifacts

Hard rule:

- do not silently add a trendy tool without writing down why it beat the alternatives

## Local And CI Parity Contract

The system should prefer tools that support both:

- local developer execution
- GitHub Actions execution

For every selected layer, the stage should produce:

- local command
- CI command
- runner requirements
- cache or service requirements
- artifact outputs

If parity is impossible, the artifact trail must explain:

- what can run locally only
- what can run in CI only
- what needs macOS, Docker, emulators, or special permissions

## GitHub Actions Contract

When this slice is active, `validation` should be able to:

- inspect existing workflow files
- identify missing validation jobs
- add or refine GitHub Actions jobs when justified
- keep validation jobs scoped to the repo reality
- lint and security-check workflow files

The slice should prefer:

- matrix builds when the language/runtime warrants it
- explicit artifact upload for test reports when useful
- deterministic runner requirements
- cache use only when it materially helps

The slice should not:

- invent a huge CI estate for a small repo
- add multi-OS matrices without evidence they matter
- force macOS runners where the product does not require them

## Artifact Contract

Top-level deliver additions:

- `stages/validation/`
- `stages/validation/prompt.md`
- `stages/validation/context.md`
- `stages/validation/final.md`
- `stages/validation/events.jsonl`
- `stages/validation/repo-profile.json`
- `stages/validation/validation-plan.json`
- `stages/validation/tool-research.json`
- `stages/validation/artifacts/test-pyramid.md`
- `stages/validation/artifacts/coverage-summary.json`
- `stages/validation/artifacts/coverage-gaps.md`
- `stages/validation/artifacts/local-validation.json`
- `stages/validation/artifacts/ci-validation.json`
- `stages/validation/artifacts/github-actions-plan.md`
- `stages/validation/artifacts/test-inventory.json`
- `stages/validation/delegates/<specialist>/...` when specialists run

Recommended artifact meanings:

- `repo-profile.json`
  - detected ecosystems, product surfaces, runner constraints
- `validation-plan.json`
  - chosen layers, selected tools, commands, expected evidence
- `tool-research.json`
  - candidates, comparison criteria, selected tool, sources
- `coverage-summary.json`
  - measured and inferred coverage per layer
- `ci-validation.json`
  - GitHub Actions jobs, triggers, matrices, required artifacts
- `local-validation.json`
  - developer-local commands and prerequisites

## Inspector And Ledger Expectations

`inspect` should be able to show:

- repo profile summary
- selected validation layers
- tool research and selected tool families
- local and CI validation plans
- coverage summary and residual gaps
- whether the stage concluded `ready`, `partial`, or `blocked`

`runs` does not need a new top-level workflow for this slice, but deliver summaries should surface validation disposition clearly enough to distinguish build failure from validation failure.

## Validation Record Shape

Recommended `validation-plan.json` shape:

```json
{
  "mode": "single-agent" ,
  "repoProfile": {
    "surfaces": ["web-app", "container"],
    "languages": ["typescript"],
    "buildSystems": ["npm"],
    "ci": ["github-actions"],
    "constraints": ["linux-only", "docker-available"]
  },
  "layers": [
    {
      "name": "static",
      "selected": true,
      "tools": ["eslint", "tsc", "actionlint", "zizmor"],
      "commands": ["npm run lint", "npm run typecheck"]
    },
    {
      "name": "unit-component",
      "selected": true,
      "tools": ["vitest", "@testing-library/react"],
      "commands": ["npm test -- --runInBand"]
    },
    {
      "name": "integration",
      "selected": true,
      "tools": ["playwright"],
      "commands": ["npx playwright test"]
    }
  ],
  "selectedSpecialists": ["browser-e2e-specialist"],
  "ciPlan": {
    "requiredJobs": ["lint", "unit", "e2e"],
    "runnerLabels": ["ubuntu-latest"]
  },
  "status": "ready"
}
```

## Multi-Agent Delivery Pattern

The validation team should operate in bounded phases:

1. profile the repo
2. plan the pyramid
3. research candidate OSS tools
4. implement or refine tests and CI wiring
5. run validation
6. synthesize coverage and gaps

Safe parallelization boundaries:

- repo profiling vs existing test inventory analysis
- tool research by surface
- local command wiring vs CI workflow drafting
- coverage synthesis after commands finish

Unsafe boundaries:

- multiple agents editing the same workflow or same test harness files without ownership
- uncontrolled fan-out by every possible platform specialist

## Coverage Policy

The goal is not naive maximum line coverage.

The stage should optimize for:

- broad defect-detection surface
- representative user-path coverage
- packaging confidence
- regression resistance
- CI reproducibility

Coverage reporting should distinguish:

- measured coverage
- estimated risk reduction
- missing high-value scenarios
- intentionally deferred validation

## Failure Handling

`validation` should fail closed when:

- the selected validation plan cannot be executed and no justified fallback exists
- added CI validation is syntactically invalid
- required validation layers fail
- the stage cannot prove minimum packaging or runtime smoke checks for a releasable artifact

`validation` may mark itself `partial` when:

- emulator or simulator requirements exceed available local or CI resources
- coverage collection is ecosystem-limited but core tests still run
- the repo lacks enough seams for safe automatic scaffold generation

In every non-ready case, artifacts must explain:

- what failed
- what ran successfully
- what remains
- what manual follow-up is required

## Acceptance Criteria

This slice is complete when:

- `deliver` can infer a validation strategy appropriate to the repo shape
- validation artifacts explain what was run, what coverage was intended, and what remains uncovered
- local and GitHub Actions validation evidence are linked in one run
- failure summaries distinguish implementation failure from validation failure

## Release Boundary

First release for this slice should include:

- an expanded internal `validation` stage in `deliver`
- richer `stages/validation/...` artifacts
- validation-aware inspector views

It should not require:

- issue lineage support
- deployment evidence support
- post-ship feedback support

## Config Contract

Recommended future config additions:

```toml
[workflows.deliver.validation]
enabled = true
mode = "smart"
requireCiParity = true
maxAgents = 5
allowWorkflowMutation = true
allowTestScaffolding = true

[workflows.deliver.validation.coverage]
requireSummary = true
minimumSignal = "strong"

[workflows.deliver.validation.mobile]
allowMacosRunners = true
allowAndroidEmulator = true
allowIosSimulator = true
```

The repo should remain able to disable expensive or platform-specific branches explicitly.

## Inspector Expectations

`inspect` for deliver runs should gain validation-aware views:

- validation summary
- repo profile
- test pyramid
- tool research
- coverage
- local validation commands
- CI validation plan
- delegated validation specialists

Useful commands:

- `show validation`
- `show pyramid`
- `show coverage`
- `show ci-validation`
- `show tool-research`

## Acceptance For This Slice

This slice is complete when:

- `deliver` includes a real internal `validation` stage
- the stage writes repo profile, validation plan, tool research, and coverage artifacts
- the stage can choose validation tools by repo type rather than one universal stack
- the stage can generate or refine local validation and GitHub Actions validation
- inspector can explain validation outcomes
- tests cover at least web, container, and one mobile-oriented profiling path
- docs explain the validation-intelligence contract
- the slice ships through the normal PR and release path

## Research Basis

This slice assumes current OSS tooling with official local and CI guidance, including:

- Playwright CI guidance: <https://playwright.dev/docs/ci>
- GitHub Actions matrix and runner guidance: <https://docs.github.com/actions/using-jobs/using-a-matrix-for-your-jobs>
- Maestro GitHub Actions guidance: <https://docs.maestro.dev/ci-integration/github-actions>
- Trivy documentation: <https://trivy.dev/latest/>
- Hadolint repository and usage guidance: <https://github.com/hadolint/hadolint>
- container-structure-test repository: <https://github.com/GoogleContainerTools/container-structure-test>
- Testcontainers documentation: <https://testcontainers.com/>
- Schemathesis documentation: <https://schemathesis.readthedocs.io/>
- actionlint repository: <https://github.com/rhysd/actionlint>
- zizmor repository: <https://github.com/zizmorcore/zizmor>

These sources should be revalidated at implementation time before choosing exact tool defaults.

## Build Recommendation

Implement this slice in two releases:

1. add the explicit `validation` stage, repo profiling, artifact contract, and web/container/GitHub Actions validation intelligence first
2. add mobile-specialized validation adapters and richer ecosystem-specific coverage handling after the core stage is stable
