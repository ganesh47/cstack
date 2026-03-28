import type {
  DeliverShipRecord,
  GitHubDeliveryRecord,
  PostShipEvidenceRecord,
  PostShipFollowUpRecord,
  PostShipObservedSignal,
  WorkflowName
} from "./types.js";

function pushUnique(target: string[], value: string): void {
  if (value && !target.includes(value)) {
    target.push(value);
  }
}

function buildObservedSignals(shipRecord: DeliverShipRecord, githubDeliveryRecord: GitHubDeliveryRecord): PostShipObservedSignal[] {
  return [
    {
      kind: "ship-readiness",
      status: shipRecord.readiness === "ready" ? "ready" : "blocked",
      summary: shipRecord.summary
    },
    {
      kind: "github-delivery",
      status: githubDeliveryRecord.overall.status,
      summary: githubDeliveryRecord.overall.summary
    },
    {
      kind: "issues",
      status: githubDeliveryRecord.issues.status,
      summary: githubDeliveryRecord.issues.summary
    },
    {
      kind: "checks",
      status: githubDeliveryRecord.checks.status,
      summary: githubDeliveryRecord.checks.summary
    },
    {
      kind: "actions",
      status: githubDeliveryRecord.actions.status,
      summary: githubDeliveryRecord.actions.summary
    },
    {
      kind: "release",
      status: githubDeliveryRecord.release.status,
      summary: githubDeliveryRecord.release.summary
    },
    {
      kind: "security",
      status: githubDeliveryRecord.security.status,
      summary: githubDeliveryRecord.security.summary
    }
  ];
}

export function buildPostShipArtifacts(options: {
  runId: string;
  workflow: WorkflowName;
  shipRecord: DeliverShipRecord;
  githubDeliveryRecord: GitHubDeliveryRecord;
}): {
  evidenceRecord: PostShipEvidenceRecord;
  followUpRecord: PostShipFollowUpRecord;
  summaryMarkdown: string;
  followUpDraftMarkdown: string;
} {
  const { runId, workflow, shipRecord, githubDeliveryRecord } = options;
  const observedSignals = buildObservedSignals(shipRecord, githubDeliveryRecord);
  const inferredRecommendations: string[] = [];

  if (shipRecord.readiness !== "ready") {
    pushUnique(inferredRecommendations, "Resolve the recorded ship blockers before treating the change as stable.");
  }
  if (githubDeliveryRecord.issues.status === "blocked") {
    pushUnique(inferredRecommendations, "Create or update a follow-up issue for the linked issue state before rerunning ship or deliver.");
  }
  if (githubDeliveryRecord.checks.status === "blocked") {
    pushUnique(inferredRecommendations, "Create a follow-up to restore the blocked required checks and rerun delivery verification.");
  }
  if (githubDeliveryRecord.actions.status === "blocked") {
    pushUnique(inferredRecommendations, "Review the blocked GitHub Actions runs and capture the next remediation slice.");
  }
  if (githubDeliveryRecord.release.status === "blocked") {
    pushUnique(inferredRecommendations, "Create a release-evidence follow-up before treating the release path as complete.");
  }
  if (githubDeliveryRecord.security.status === "blocked") {
    pushUnique(inferredRecommendations, "Create a remediation follow-up for the blocked security gate before progressing the release path.");
  }

  const status: PostShipEvidenceRecord["status"] =
    inferredRecommendations.length > 0
      ? "follow-up-required"
      : observedSignals.some((signal) => signal.status === "unknown")
        ? "signal-unavailable"
        : "stable";

  const summary =
    status === "stable"
      ? "Post-ship evidence is stable based on the recorded ship and GitHub delivery artifacts."
      : status === "signal-unavailable"
        ? "Post-ship evidence is incomplete because some downstream signals were unavailable."
        : "Post-ship follow-up is required based on the recorded ship and GitHub delivery blockers.";

  const recommendedDrafts = inferredRecommendations.map((recommendation, index) => ({
    title:
      githubDeliveryRecord.issueReferences.length > 0
        ? `Follow-up for linked issue #${githubDeliveryRecord.issueReferences[0]} (${index + 1})`
        : `Post-ship follow-up ${index + 1}`,
    reason: recommendation,
    priority:
      recommendation.toLowerCase().includes("security") || recommendation.toLowerCase().includes("blocked required checks")
        ? ("high" as const)
        : ("medium" as const)
  }));

  const sourceArtifacts =
    options.workflow === "deliver"
      ? [
          "artifacts/ship-record.json",
          "artifacts/github-delivery.json",
          "artifacts/github-mutation.json",
          "stages/ship/artifacts/ship-record.json",
          "stages/ship/artifacts/github-delivery.json",
          "stages/ship/artifacts/github-mutation.json"
        ]
      : ["artifacts/ship-record.json", "artifacts/github-delivery.json", "artifacts/github-mutation.json"];

  const evidenceRecord: PostShipEvidenceRecord = {
    status,
    summary,
    observedAt: new Date().toISOString(),
    observedSignals,
    inferredRecommendations,
    followUpRequired: inferredRecommendations.length > 0,
    sourceArtifacts: [...new Set(sourceArtifacts)]
  };

  const followUpRecord: PostShipFollowUpRecord = {
    status: recommendedDrafts.length > 0 ? "recommended" : "none",
    sourceRun: {
      runId,
      workflow
    },
    linkedIssueNumbers: githubDeliveryRecord.issueReferences,
    recommendedDrafts
  };

  const summaryMarkdown = [
    "# Post-Ship Summary",
    "",
    `- status: ${evidenceRecord.status}`,
    `- summary: ${evidenceRecord.summary}`,
    ...evidenceRecord.observedSignals.map((signal) => `- ${signal.kind}: ${signal.status} (${signal.summary})`),
    "",
    "## Follow-up recommendations",
    ...(evidenceRecord.inferredRecommendations.length > 0 ? evidenceRecord.inferredRecommendations.map((entry) => `- ${entry}`) : ["- none"])
  ].join("\n") + "\n";

  const followUpDraftMarkdown = [
    "# Post-Ship Follow-Up Draft",
    "",
    ...(recommendedDrafts.length > 0
      ? recommendedDrafts.flatMap((draft) => [`## ${draft.title}`, "", `- priority: ${draft.priority}`, `- reason: ${draft.reason}`, ""])
      : ["No follow-up draft is required from the current post-ship evidence."])
  ].join("\n") + "\n";

  return {
    evidenceRecord,
    followUpRecord,
    summaryMarkdown,
    followUpDraftMarkdown
  };
}
