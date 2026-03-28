import { describe, expect, it } from "vitest";
import { buildPostShipArtifacts } from "../src/post-ship.js";
import type { DeliverShipRecord, GitHubDeliveryRecord } from "../src/types.js";

function baseGithubDeliveryRecord(overrides: Partial<GitHubDeliveryRecord> = {}): GitHubDeliveryRecord {
  const base: GitHubDeliveryRecord = {
    repository: "ganesh47/cstack",
    mode: "merge-ready",
    branch: {
      name: "main",
      headSha: "abc123",
      defaultBranch: "main"
    },
    requestedPolicy: {
      repository: "ganesh47/cstack",
      mode: "merge-ready",
      createPullRequest: true
    },
    issueReferences: [123],
    branchState: {
      required: true,
      status: "ready",
      summary: "branch state is aligned",
      blockers: [],
      observedAt: "2026-03-28T00:00:00.000Z",
      source: "git",
      observed: {
        current: "main",
        headSha: "abc123",
        defaultBranch: "main"
      }
    },
    pullRequest: {
      required: true,
      status: "ready",
      summary: "pull request is approved",
      blockers: [],
      observedAt: "2026-03-28T00:00:00.000Z",
      source: "gh",
      observed: {
        number: 7,
        title: "Release",
        state: "OPEN",
        isDraft: false,
        headRefName: "main",
        baseRefName: "main",
        url: "https://github.com/ganesh47/cstack/pull/7"
      }
    },
    issues: {
      required: true,
      status: "ready",
      summary: "required issues closed",
      blockers: [],
      observedAt: "2026-03-28T00:00:00.000Z",
      source: "gh",
      observed: [{ number: 123, title: "Track", state: "CLOSED", url: "https://github.com/ganesh47/cstack/issues/123" }]
    },
    checks: {
      required: true,
      status: "ready",
      summary: "required checks pass",
      blockers: [],
      observedAt: "2026-03-28T00:00:00.000Z",
      source: "gh",
      observed: [{ name: "deliver/test", status: "completed", conclusion: "success", detailsUrl: "https://github.com/ganesh47/cstack/actions/runs/10" }]
    },
    actions: {
      required: true,
      status: "ready",
      summary: "required actions pass",
      blockers: [],
      observedAt: "2026-03-28T00:00:00.000Z",
      source: "gh",
      observed: [{
        databaseId: 1,
        workflowName: "Release",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/ganesh47/cstack/actions/runs/11"
      }]
    },
    release: {
      required: false,
      status: "not-applicable",
      summary: "release evidence not required",
      blockers: [],
      observedAt: "2026-03-28T00:00:00.000Z",
      source: "gh",
      observed: {
        tagName: "v1.0.0",
        tagExists: true,
        releaseExists: true
      }
    },
    security: {
      required: true,
      status: "ready",
      summary: "security signals clean",
      blockers: [],
      observedAt: "2026-03-28T00:00:00.000Z",
      source: "gh",
      observed: {
        dependabot: [],
        codeScanning: []
      }
    },
    mutation: {
      enabled: false,
      branch: {
        initial: "main",
        current: "main",
        created: false,
        pushed: false
      },
      commit: {
        created: false,
        changedFiles: []
      },
      pullRequest: {
        created: false,
        updated: false
      },
      checks: {
        watched: false,
        polls: 0,
        completed: false,
        summary: "no mutation required"
      },
      blockers: [],
      summary: "no mutation was performed"
    },
    overall: {
      status: "ready",
      summary: "delivery readiness achieved",
      blockers: [],
      observedAt: "2026-03-28T00:00:00.000Z"
    },
    limitations: []
  };

  return {
    ...base,
    ...overrides
  };
}

function shipRecord(readiness: DeliverShipRecord["readiness"]): DeliverShipRecord {
  return {
    readiness,
    summary: readiness === "ready" ? "Ship checks are complete." : "Ship checks blocked by regressions.",
    checklist: [],
    unresolved: readiness === "ready" ? [] : ["docs update", "runbook update"],
    nextActions: readiness === "ready" ? [] : ["address blockers", "rerun ship"],
    reportMarkdown: "# Ship report\n"
  };
}

describe("buildPostShipArtifacts", () => {
  it("builds a stable evidence record when delivery signals are clean", () => {
    const result = buildPostShipArtifacts({
      runId: "2026-03-14T10-00-00-deliver-release",
      workflow: "deliver",
      shipRecord: shipRecord("ready"),
      githubDeliveryRecord: baseGithubDeliveryRecord()
    });

    expect(result.evidenceRecord.status).toBe("stable");
    expect(result.evidenceRecord.followUpRequired).toBe(false);
    expect(result.evidenceRecord.sourceArtifacts).toContain("stages/ship/artifacts/ship-record.json");
    expect(result.evidenceRecord.sourceArtifacts).toContain("artifacts/ship-record.json");
    expect(result.followUpRecord.status).toBe("none");
    expect(result.followUpRecord.recommendedDrafts).toHaveLength(0);
    expect(result.followUpDraftMarkdown).toContain("No follow-up draft is required");
  });

  it("builds follow-up required evidence when ship and GitHub signals are blocked", () => {
    const result = buildPostShipArtifacts({
      runId: "2026-03-14T10-00-00-ship-blocked",
      workflow: "ship",
      shipRecord: shipRecord("blocked"),
      githubDeliveryRecord: baseGithubDeliveryRecord({
        issues: {
          ...baseGithubDeliveryRecord().issues,
          status: "blocked",
          summary: "issue not updated"
        },
        checks: {
          ...baseGithubDeliveryRecord().checks,
          status: "blocked",
          summary: "required checks failed"
        },
        actions: {
          ...baseGithubDeliveryRecord().actions,
          status: "blocked",
          summary: "release workflow failed"
        },
        security: {
          ...baseGithubDeliveryRecord().security,
          status: "blocked",
          summary: "open security finding"
        },
        release: {
          ...baseGithubDeliveryRecord().release,
          status: "blocked",
          summary: "release evidence missing"
        }
      })
    });

    expect(result.evidenceRecord.status).toBe("follow-up-required");
    expect(result.evidenceRecord.followUpRequired).toBe(true);
    expect(result.evidenceRecord.inferredRecommendations).toEqual(
      expect.arrayContaining([
        "Resolve the recorded ship blockers before treating the change as stable.",
        "Create a follow-up to restore the blocked required checks and rerun delivery verification.",
        "Review the blocked GitHub Actions runs and capture the next remediation slice.",
        "Create a remediation follow-up for the blocked security gate before progressing the release path.",
        "Create a release-evidence follow-up before treating the release path as complete.",
        "Create or update a follow-up issue for the linked issue state before rerunning ship or deliver."
      ])
    );
    expect(result.followUpRecord.status).toBe("recommended");
    expect(result.followUpRecord.linkedIssueNumbers).toEqual([123]);
    expect(result.followUpRecord.recommendedDrafts).toHaveLength(6);
    expect(result.followUpRecord.recommendedDrafts[0]!.priority).toBe("medium");
    expect(result.followUpRecord.recommendedDrafts[2]!.priority).toBe("high");
    expect(result.followUpDraftMarkdown).toContain("## Follow-up for linked issue #123 (1)");
  });

  it("marks evidence as signal-unavailable when a signal is unknown", () => {
    const result = buildPostShipArtifacts({
      runId: "2026-03-14T10-00-00-ship-unknown",
      workflow: "ship",
      shipRecord: shipRecord("ready"),
      githubDeliveryRecord: baseGithubDeliveryRecord({
        checks: {
          ...baseGithubDeliveryRecord().checks,
          status: "unknown"
        }
      })
    });

    expect(result.evidenceRecord.status).toBe("signal-unavailable");
    expect(result.evidenceRecord.followUpRequired).toBe(false);
    expect(result.followUpRecord.status).toBe("none");
  });
});
