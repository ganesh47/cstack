# GitHub Issue Progress Reconciliation (2026-03-28)

## Executed status

- Command surface: `npm run typecheck` and `npm test` (all suites passing).
- Current branch has implemented and wired all six end-to-end workstreams from issue #32 into the local-first artifact/inspection surfaces.

## Issue-by-issue status

### #32 — umbrella: end-to-end product delivery workstreams

All child workstreams are now implemented and independently test-validated:

- #33 GitHub planning lineage
- #34 Validation intelligence
- #35 Post-ship feedback
- #36 Initiative graph/control plane
- #37 Delivery checklist and deployment evidence
- #38 Capability-pack governance

### #33 — GitHub planning lineage

Implemented in code:
- plan-issue linkage in run metadata for discover/spec/build/review/ship/deliver
- `cstack spec --issue <n>`
- `artifacts/issue-draft.md` and `artifacts/issue-lineage.json`
- issue-aware inspect and downstream lineage rendering

### #34 — Validation intelligence

Implemented in code:
- explicit validation workflow artifacts in `deliver` (`validation-plan`, pyramid, coverage, repo profile)
- build versus validation failure distinction
- local + artifact-preserved validation evidence for inspect

### #35 — Post-ship feedback

Implemented in code:
- `artifacts/post-ship-summary.md`
- `artifacts/post-ship-evidence.json`
- `artifacts/follow-up-draft.md`
- `artifacts/follow-up-lineage.json`
- post-ship inspect output

### #36 — Initiative graph and run control plane

Implemented in code:
- optional initiative fields in run metadata
- `artifacts/initiative-graph.json`
- initiative-aware `runs` and inspect grouping

### #37 — Delivery checklist and deployment evidence

Implemented in code:
- readiness-policy and deployment-evidence artifacts in ship/deliver
- explicit blocker taxonomy for readiness outcomes
- inspect visibility for readiness dimensions

### #38 — Capability-pack governance

Implemented in code:
- workflow capability allowlists in config
- run-level requested/available/used capability artifacts
- inspect visibility for capability downgrades and policy posture

