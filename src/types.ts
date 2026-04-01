export type WorkflowName = "spec" | "discover" | "build" | "review" | "ship" | "deliver" | "update" | "intent";
export type RunStatus = "running" | "completed" | "failed";
export type WorkflowMode = "exec" | "interactive";
export type DeliverTargetMode = "merge-ready" | "release";
export type ExecutionCheckoutKind = "source" | "git-worktree" | "temp-clone";

export type StageName = "discover" | "spec" | "build" | "validation" | "review" | "ship";

export type StageStatus =
  | "planned"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "deferred";

export type SpecialistName =
  | "security-review"
  | "devsecops-review"
  | "traceability-review"
  | "audit-review"
  | "release-pipeline-review"
  | "mobile-validation-specialist"
  | "container-validation-specialist"
  | "browser-e2e-specialist"
  | "api-contract-specialist"
  | "workflow-security-specialist";

export type SpecialistDisposition = "accepted" | "partial" | "discarded";
export type DiscoverTrackName = "repo-explorer" | "external-researcher" | "risk-researcher";
export type DiscoverResearchMode = "single-agent" | "research-team";

export interface DiscoverTrackSelection {
  name: DiscoverTrackName;
  reason: string;
  selected: boolean;
  requiresWeb: boolean;
}

export interface DiscoverSourceRecord {
  title: string;
  location: string;
  kind: "url" | "file" | "command" | "note";
  retrievedAt?: string;
  notes?: string;
}

export interface DiscoverDelegateResult {
  track: DiscoverTrackName;
  status: "completed" | "failed" | "stalled" | "discarded";
  summary: string;
  filesInspected: string[];
  commandsRun: string[];
  sources: DiscoverSourceRecord[];
  findings: string[];
  confidence: "low" | "medium" | "high";
  unresolved: string[];
  leaderDisposition: SpecialistDisposition;
  notes?: string;
  delegateDir?: string;
  artifactPath?: string;
  resultPath?: string;
  sourcesPath?: string;
  sessionId?: string;
}

export interface DiscoverResearchPlan {
  prompt: string;
  decidedAt: string;
  mode: DiscoverResearchMode;
  planningIssueNumber?: number;
  delegationEnabled: boolean;
  maxTracks: number;
  webResearchAllowed: boolean;
  requestedCapabilities: string[];
  availableCapabilities: string[];
  summary: string;
  tracks: DiscoverTrackSelection[];
  limitations: string[];
}

export interface CapabilityPolicyConfig {
  allowed?: string[];
  defaultRequested?: string[];
}

export interface CapabilityDowngradeRecord {
  name: string;
  reason: string;
}

export interface CapabilityUsageRecord {
  workflow: WorkflowName;
  stage?: StageName;
  allowed: string[];
  requested: string[];
  available: string[];
  used: string[];
  downgraded: CapabilityDowngradeRecord[];
  notes?: string[];
}

export interface RoutingStagePlan {
  name: StageName;
  rationale: string;
  status: StageStatus;
  executed: boolean;
  notes?: string | undefined;
  stageDir?: string | undefined;
  artifactPath?: string | undefined;
  childRunId?: string | undefined;
}

export type MachineStatePath = string[];

export interface VisibleStageRecord extends RoutingStagePlan {
  statePath: MachineStatePath;
}

export interface SpecialistSelection {
  name: SpecialistName;
  reason: string;
  selected: boolean;
}

export interface RoutingSignal {
  name: "analysis" | "implementation" | "review" | "release";
  matched: boolean;
  evidence: string[];
}

export interface RoutingDecision {
  classification: "analysis" | "implementation" | "mixed";
  reason: string;
  winningSignals: string[];
}

export interface SpecialistExecution {
  name: SpecialistName;
  reason: string;
  status: "planned" | "running" | "completed" | "failed";
  disposition: SpecialistDisposition;
  specialistDir?: string;
  artifactPath?: string;
  notes?: string;
  blockerCategory?: EnvironmentBlockerCategory;
  blockerDetail?: string;
}

export interface RoutingPlan {
  intent: string;
  inferredAt: string;
  entrypoint: "bare" | "run";
  stages: RoutingStagePlan[];
  specialists: SpecialistSelection[];
  summary: string;
  decision?: RoutingDecision;
  signals?: RoutingSignal[];
}

export interface StageLineage {
  intent: string;
  stages: RoutingStagePlan[];
  specialists: SpecialistExecution[];
}

export interface ChildWorkflowLink {
  stageName: StageName;
  runId: string;
  workflow: WorkflowName;
  status: RunStatus;
  currentStage?: string | undefined;
}

export interface WorkflowTransitionRecord {
  at: string;
  event: string;
  fromPath: MachineStatePath;
  toPath: MachineStatePath;
  notes?: string | undefined;
}

export type WorkflowEvent =
  | {
      type: "SET_STAGE_STATUS";
      stageName: StageName;
      status: StageStatus;
      executed?: boolean;
      notes?: string | undefined;
      stageDir?: string | undefined;
      artifactPath?: string | undefined;
      childRunId?: string | undefined;
      statePath?: MachineStatePath | undefined;
      note?: string | undefined;
    }
  | {
      type: "SET_SPECIALISTS";
      names: string[];
      note?: string | undefined;
    }
  | {
      type: "SET_ACTIVE_SPECIALISTS";
      names: string[];
      note?: string | undefined;
    }
  | {
      type: "UPSERT_SPECIALIST";
      specialist: SpecialistExecution;
      note?: string | undefined;
    }
  | {
      type: "UPDATE_SPECIALIST";
      name: SpecialistExecution["name"];
      patch: Partial<SpecialistExecution>;
      note?: string | undefined;
    }
  | {
      type: "LINK_CHILD";
      link: ChildWorkflowLink;
      note?: string | undefined;
    }
  | {
      type: "SYNC_CHILD";
      stageName: StageName;
      child: ChildWorkflowLink;
      childStageLineage?: StageLineage | null | undefined;
      childActiveSpecialists?: string[] | undefined;
      note?: string | undefined;
    }
  | {
      type: "SET_CONTEXT";
      patch: Record<string, unknown>;
      note?: string | undefined;
    }
  | {
      type: "SET_LAST_ACTIVITY";
      message: string;
      note?: string | undefined;
    }
  | {
      type: "SET_ERROR";
      error?: string | undefined;
      note?: string | undefined;
    }
  | {
      type: "REVIEW_FINALIZED";
      executionSucceeded: boolean;
      verdictStatus: string;
      summary: string;
      note?: string | undefined;
    }
  | {
      type: "SHIP_FINALIZED";
      readiness: string;
      githubDeliveryStatus: string;
      hasMutationBlockers: boolean;
      summary: string;
      note?: string | undefined;
    }
  | {
      type: "DELIVER_FINALIZED";
      buildSucceeded: boolean;
      validationStatus: string;
      reviewStatus: string;
      shipReadiness: string;
      githubDeliveryStatus: string;
      summary: string;
      note?: string | undefined;
    }
  | {
      type: "INTENT_FINALIZED";
      summary: string;
      error?: string | undefined;
      note?: string | undefined;
    };

export interface WorkflowMachineSnapshot {
  version: 1;
  workflow: WorkflowName;
  intent: string;
  activePath: MachineStatePath;
  runStatus: RunStatus;
  visibleStages: VisibleStageRecord[];
  specialists: SpecialistExecution[];
  activeSpecialists: string[];
  childWorkflows: ChildWorkflowLink[];
  transitions: WorkflowTransitionRecord[];
  context: Record<string, unknown>;
  lastActivity?: string | undefined;
  error?: string | undefined;
}

export interface ArtifactEntry {
  path: string;
  kind: "artifact" | "log" | "metadata" | "delegate" | "stage";
}

export interface RunLedgerEntry {
  id: string;
  workflow: WorkflowName;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  summary: string;
  currentStage?: string | undefined;
  activeSpecialists: string[];
  finalPath: string;
  planningIssueNumber?: number;
  initiativeId?: string;
  initiativeTitle?: string;
}

export interface RunInspection {
  run: RunRecord;
  runDir: string;
  routingPlan: RoutingPlan | null;
  stageLineage: StageLineage | null;
  planningIssueLineage: PlanningIssueLineageRecord | null;
  discoverCapabilitiesRecord: CapabilityUsageRecord | null;
  validationCapabilitiesRecord: CapabilityUsageRecord | null;
  discoverResearchPlan: DiscoverResearchPlan | null;
  discoverDelegates: DiscoverDelegateResult[];
  sessionRecord: BuildSessionRecord | null;
  verificationRecord: BuildVerificationRecord | null;
  validationRepoProfile: ValidationRepoProfile | null;
  validationPlan: DeliverValidationPlan | null;
  validationToolResearch: ValidationToolResearch | null;
  validationLocalRecord: DeliverValidationLocalRecord | null;
  deliverReviewVerdict: DeliverReviewVerdict | null;
  deliverShipRecord: DeliverShipRecord | null;
  readinessPolicyRecord: DeliveryReadinessPolicyRecord | null;
  deploymentEvidenceRecord: DeploymentEvidenceRecord | null;
  githubDeliveryRecord: GitHubDeliveryRecord | null;
  githubMutationRecord: GitHubMutationRecord | null;
  postShipEvidenceRecord: PostShipEvidenceRecord | null;
  postShipFollowUpRecord: PostShipFollowUpRecord | null;
  initiativeGraph: InitiativeGraphRecord | null;
  executionContext: ExecutionContextRecord | null;
  recentEvents: RunEvent[];
  finalBody: string;
  buildFinalBody: string;
  buildFinalPath?: string | undefined;
  buildStderrTail?: string | undefined;
  buildFailureDiagnosis?: BuildFailureDiagnosisRecord | null;
  artifacts: ArtifactEntry[];
  childRuns: ChildRunInspection[];
}

export interface PlanningIssueLineageRecord {
  planningIssueNumber: number;
  planningIssueUrl?: string;
  sourceRun?: {
    runId: string;
    workflow?: WorkflowName;
  };
  currentRun: {
    runId: string;
    workflow: WorkflowName;
  };
  downstreamPullRequests: Array<{
    number: number;
    url?: string;
    state?: string;
  }>;
  downstreamReleases: Array<{
    tag: string;
    url?: string;
    state?: string;
  }>;
}

export interface InitiativeGraphRecord {
  initiativeId: string;
  initiativeTitle?: string;
  sourceRun?: {
    runId: string;
    workflow?: WorkflowName;
    summary?: string;
  };
  currentRun: {
    runId: string;
    workflow: WorkflowName;
    summary?: string;
  };
  relatedRuns: Array<{
    runId: string;
    workflow: WorkflowName;
    status: RunStatus;
  }>;
}

export interface ChildRunInspection {
  stageName: StageName;
  run: RunRecord;
  runDir: string;
  finalBody: string;
  artifacts: ArtifactEntry[];
  recentEvents: RunEvent[];
  stageLineage: StageLineage | null;
  buildSessionRecord: BuildSessionRecord | null;
  buildVerificationRecord: BuildVerificationRecord | null;
  buildFinalBody: string;
  buildFinalPath?: string | undefined;
  buildTranscriptPath?: string | undefined;
  buildTranscriptAvailable: boolean;
  buildStderrTail?: string | undefined;
  buildFailureDiagnosis?: BuildFailureDiagnosisRecord | null;
}

export type RunEventType =
  | "starting"
  | "session"
  | "activity"
  | "heartbeat"
  | "completed"
  | "failed";

export interface RunEvent {
  timestamp: string;
  elapsedMs: number;
  type: RunEventType;
  message: string;
  stream?: "stdout" | "stderr";
}

export interface CodexConfig {
  command?: string;
  model?: string;
  profile?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  extraArgs?: string[];
}

export type ConfigValueSource = "default" | "user" | "repo";

export interface ConfigValueProvenance {
  source: ConfigValueSource;
  sourcePath?: string;
}

export interface ConfigProvenance {
  codexSandbox: ConfigValueProvenance;
  workflowAllowDirty: {
    build: ConfigValueProvenance;
    ship: ConfigValueProvenance;
    deliver: ConfigValueProvenance;
  };
}

export interface WorkflowConfig {
  mode?: WorkflowMode;
  verificationCommands?: string[];
  allowDirty?: boolean;
  maxCodexAttempts?: number;
  timeoutSeconds?: number;
  stageTimeoutSeconds?: Partial<Record<StageName, number>>;
  delegation?: {
    enabled?: boolean;
    maxAgents?: number;
  };
  research?: {
    enabled?: boolean;
    allowWeb?: boolean;
  };
  capabilities?: CapabilityPolicyConfig;
  validation?: DeliverValidationConfig;
  github?: DeliverGitHubConfig;
}

export interface VerificationConfig {
  defaultCommands?: string[];
}

export interface CstackConfig {
  codex: CodexConfig;
  workflows: {
    spec: WorkflowConfig;
    discover: WorkflowConfig;
    build: WorkflowConfig;
    review: WorkflowConfig;
    ship: WorkflowConfig;
    deliver: WorkflowConfig;
  };
  verification?: VerificationConfig;
}

export interface DeliverValidationConfig {
  enabled?: boolean;
  mode?: "smart" | "plan-only";
  requireCiParity?: boolean;
  maxAgents?: number;
  allowWorkflowMutation?: boolean;
  allowTestScaffolding?: boolean;
  coverage?: {
    requireSummary?: boolean;
    minimumSignal?: "basic" | "strong";
  };
  mobile?: {
    allowMacosRunners?: boolean;
    allowAndroidEmulator?: boolean;
    allowIosSimulator?: boolean;
  };
}

export interface DeliverGitHubSecurityConfig {
  requireDependabot?: boolean;
  requireCodeScanning?: boolean;
  blockSeverities?: string[];
}

export interface DeliverGitHubConfig {
  enabled?: boolean;
  command?: string;
  repository?: string;
  mode?: DeliverTargetMode;
  createRelease?: boolean;
  releaseMessage?: string;
  releaseName?: string;
  releasePrerelease?: boolean;
  releaseDraft?: boolean;
  releaseGenerateNotes?: boolean;
  releasePushTag?: boolean;
  releaseFiles?: string[];
  pushBranch?: boolean;
  branchPrefix?: string;
  commitChanges?: boolean;
  createPullRequest?: boolean;
  updatePullRequest?: boolean;
  pullRequestBase?: string;
  pullRequestDraft?: boolean;
  watchChecks?: boolean;
  checkWatchTimeoutSeconds?: number;
  checkWatchPollSeconds?: number;
  prRequired?: boolean;
  requireApprovedReview?: boolean;
  linkedIssuesRequired?: boolean;
  requiredIssueState?: "linked" | "closed";
  requiredChecks?: string[];
  requiredWorkflows?: string[];
  requireRelease?: boolean;
  requireTag?: boolean;
  requireVersionMatch?: boolean;
  requireChangelog?: boolean;
  changelogPaths?: string[];
  security?: DeliverGitHubSecurityConfig;
}

export interface BuildSessionRecord {
  workflow: "build";
  requestedMode: WorkflowMode;
  mode: WorkflowMode;
  startedAt: string;
  endedAt: string;
  sessionId?: string;
  linkedRunId?: string;
  linkedRunWorkflow?: WorkflowName;
  linkedArtifactPath?: string;
  transcriptPath?: string;
  codexCommand: string[];
  resumeCommand?: string;
  forkCommand?: string;
  observability: {
    sessionIdObserved: boolean;
    transcriptObserved: boolean;
    finalArtifactObserved: boolean;
    timedOut?: boolean;
    timeoutSeconds?: number;
    stalled?: boolean;
    stallReason?: string;
    fallbackReason?: string;
  };
  notes?: string[];
}

export type EnvironmentBlockerCategory =
  | "network-blocked"
  | "registry-unreachable"
  | "toolchain-mismatch"
  | "host-tool-missing"
  | "repo-test-failure"
  | "orchestration-timeout"
  | "external-service-blocked"
  | "unknown";

export type BuildFailureCategory =
  | "missing-tool"
  | "bootstrap-failure"
  | "transient-external"
  | "verification-failure"
  | "build-script-failure"
  | "codex-process-failure"
  | "timeout"
  | "unknown";

export interface BuildRecoveryAttemptRecord {
  kind: "assessment" | "bootstrap" | "remediation" | "codex-run" | "verification";
  label: string;
  status: "completed" | "failed" | "retrying" | "skipped";
  startedAt: string;
  endedAt: string;
  cwd: string;
  summary: string;
  command?: string;
  exitCode?: number;
  evidence?: string[];
}

export interface BuildFailureDiagnosisRecord {
  category: BuildFailureCategory;
  blockerCategory?: EnvironmentBlockerCategory;
  summary: string;
  detail: string;
  evidence: string[];
  recommendedActions: string[];
  recoveryAttempts: BuildRecoveryAttemptRecord[];
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
  timeoutSeconds?: number;
  verificationStatus?: BuildVerificationRecord["status"];
}

export interface ExecutionContextRecord {
  workflow: "build" | "deliver";
  preparedAt: string;
  source: {
    cwd: string;
    branch: string;
    commit: string;
    dirtyFiles: string[];
    localChangesIgnored: boolean;
  };
  execution: {
    kind: ExecutionCheckoutKind;
    cwd: string;
    branch: string;
    commit: string;
    isolated: boolean;
    notes: string[];
  };
  cleanup: {
    policy: "retain";
    status: "retained" | "not-needed";
  };
}

export interface BuildVerificationCommandRecord {
  command: string;
  exitCode: number;
  status: "passed" | "failed";
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  blockerCategory?: EnvironmentBlockerCategory;
  blockerDetail?: string;
}

export interface BuildVerificationRecord {
  status: "not-run" | "passed" | "failed";
  requestedCommands: string[];
  results: BuildVerificationCommandRecord[];
  blockerCategories?: EnvironmentBlockerCategory[];
  notes?: string;
}

export interface DeliverReviewFinding {
  severity: "info" | "warning" | "high";
  title: string;
  detail: string;
  owner?: string;
}

export type ReviewMode = "analysis" | "readiness";

export interface DeliverReviewGapCluster {
  title: string;
  severity: "info" | "warning" | "high";
  summary: string;
  evidence?: string[];
}

export interface DeliverReviewVerdict {
  mode: ReviewMode;
  status: "completed" | "ready" | "changes-requested" | "blocked";
  summary: string;
  findings: DeliverReviewFinding[];
  recommendedActions: string[];
  gapClusters?: DeliverReviewGapCluster[];
  likelyRootCauses?: string[];
  recommendedNextSlices?: string[];
  confidence?: "low" | "medium" | "high";
  evidenceNotes?: string[];
  acceptedSpecialists: Array<{
    name: SpecialistName;
    disposition: SpecialistDisposition;
    reason: string;
  }>;
  reportMarkdown: string;
}

export interface DeliverShipChecklistItem {
  item: string;
  status: "complete" | "incomplete" | "blocked";
  notes?: string;
}

export interface DeliverShipRecord {
  readiness: "ready" | "blocked";
  summary: string;
  checklist: DeliverShipChecklistItem[];
  unresolved: string[];
  nextActions: string[];
  reportMarkdown: string;
}

export type DeliveryRequirementStatus = "satisfied" | "missing" | "blocked" | "not-applicable";
export type DeliveryReadinessBlockerCategory =
  | "review-evidence"
  | "ship-output"
  | "github-delivery"
  | "linked-issues"
  | "release-evidence"
  | "deployment-evidence";

export interface DeliveryReadinessRequirement {
  name:
    | "review-verdict"
    | "ship-readiness"
    | "github-delivery"
    | "linked-issues"
    | "release-evidence"
    | "deployment-evidence";
  required: boolean;
  status: DeliveryRequirementStatus;
  summary: string;
  evidence: string[];
}

export interface DeliveryReadinessBlocker {
  category: DeliveryReadinessBlockerCategory;
  requirement: DeliveryReadinessRequirement["name"];
  status: Exclude<DeliveryRequirementStatus, "satisfied" | "not-applicable">;
  summary: string;
  evidence: string[];
}

export interface DeliveryPostReadinessSummary {
  status: DeliverShipRecord["readiness"];
  headline: string;
  highlights: string[];
  blockers: string[];
  nextActions: string[];
}

export interface DeliveryReadinessPolicyRecord {
  mode: DeliverTargetMode;
  readiness: DeliverShipRecord["readiness"];
  generatedAt: string;
  summary: string;
  blockers: string[];
  requirements: DeliveryReadinessRequirement[];
  classifiedBlockers: DeliveryReadinessBlocker[];
  postReadinessSummary: DeliveryPostReadinessSummary;
}

export interface LoopIterationRecord {
  iteration: number;
  runId: string;
  status: RunStatus;
  summary: string;
  targetCluster?: string;
  deferredClusters: string[];
  specialists: SpecialistName[];
}

export interface LoopCycleRecord {
  schemaVersion: 1;
  loopId: string;
  intent: string;
  repo: string | null;
  branch: string | null;
  workspace: string;
  iterationsRequested: number;
  iterationsCompleted: number;
  status: "completed" | "failed";
  latestRunId?: string;
  latestSummary?: string;
  primaryBlockerCluster?: string | null;
  iterations: LoopIterationRecord[];
}

export interface LoopBacktrackDecisionRecord {
  schemaVersion: 1;
  loopId: string;
  targetCluster: string | null;
  deferredClusters: string[];
  specialists: SpecialistName[];
  summary: string;
}

export interface DeploymentEvidenceReference {
  kind: "pull-request" | "issue" | "check" | "action" | "release";
  label: string;
  status: string;
  url?: string;
}

export interface DeploymentEvidenceRecord {
  mode: DeliverTargetMode;
  generatedAt: string;
  summary: string;
  blockers: string[];
  references: DeploymentEvidenceReference[];
  status: "recorded" | "missing";
}

export interface PostShipObservedSignal {
  kind: "ship-readiness" | "github-delivery" | "issues" | "checks" | "actions" | "release" | "security";
  status: "ready" | "blocked" | "not-applicable" | "unknown";
  summary: string;
}

export interface PostShipEvidenceRecord {
  status: "stable" | "follow-up-required" | "signal-unavailable";
  summary: string;
  observedAt: string;
  observedSignals: PostShipObservedSignal[];
  inferredRecommendations: string[];
  followUpRequired: boolean;
  sourceArtifacts: string[];
}

export interface PostShipFollowUpRecord {
  status: "none" | "recommended";
  sourceRun: {
    runId: string;
    workflow: WorkflowName;
  };
  linkedIssueNumbers: number[];
  recommendedDrafts: Array<{
    title: string;
    reason: string;
    priority: "high" | "medium";
  }>;
}

export interface ValidationToolCandidate {
  tool: string;
  category: string;
  selected: boolean;
  rationale: string;
  localSupport: "native" | "scripted" | "optional" | "unsupported";
  ciSupport: "native" | "scripted" | "optional" | "unsupported";
  source: string;
}

export interface ValidationToolResearch {
  generatedAt: string;
  summary: string;
  candidates: ValidationToolCandidate[];
  selectedTools: string[];
  limitations: string[];
}

export interface ValidationDetectedScript {
  name: string;
  command: string;
}

export interface ValidationExistingTestSuite {
  kind: "unit" | "component" | "integration" | "e2e" | "workflow" | "smoke" | "unknown";
  location: string;
  tool?: string;
}

export interface ValidationWorkspaceTarget {
  path: string;
  manifests: string[];
  languages: string[];
  buildSystems: string[];
  surfaces: string[];
  packageScripts: ValidationDetectedScript[];
  detectedTools: string[];
  support: "native" | "partial" | "inventory-only";
  notes: string[];
}

export interface ValidationRepoProfile {
  detectedAt: string;
  languages: string[];
  buildSystems: string[];
  surfaces: string[];
  packageManagers: string[];
  ciSystems: string[];
  runnerConstraints: string[];
  manifests: string[];
  workflowFiles: string[];
  existingTests: ValidationExistingTestSuite[];
  packageScripts: ValidationDetectedScript[];
  detectedTools: string[];
  workspaceTargets: ValidationWorkspaceTarget[];
  limitations: string[];
}

export interface ValidationLayerPlan {
  name: "static" | "unit-component" | "integration-contract" | "e2e-system" | "packaging-smoke";
  selected: boolean;
  status: "planned" | "ready" | "partial" | "blocked" | "skipped";
  rationale: string;
  selectedTools: string[];
  localCommands: string[];
  ciCommands: string[];
  coverageIntent: string[];
  notes?: string[];
}

export interface DeliverValidationPlan {
  status: "ready" | "partial" | "blocked";
  outcomeCategory: "ready" | "partial" | "blocked-by-build" | "blocked-by-validation" | "blocked-by-validation-drift";
  summary: string;
  profileSummary: string;
  boundedScope: boolean;
  selectedScope: string[];
  deferredScope: string[];
  classificationReason: string;
  layers: ValidationLayerPlan[];
  selectedSpecialists: Array<{
    name: SpecialistName;
    disposition: SpecialistDisposition;
    reason: string;
  }>;
  localValidation: {
    commands: string[];
    prerequisites: string[];
    notes: string[];
  };
  ciValidation: {
    workflowFiles: string[];
    jobs: Array<{
      name: string;
      runner: string;
      purpose: string;
      commands: string[];
      artifacts: string[];
    }>;
    notes: string[];
  };
  coverage: {
    confidence: "low" | "medium" | "high";
    summary: string;
    signals: string[];
    gaps: string[];
  };
  recommendedChanges: string[];
  unsupported: string[];
  pyramidMarkdown: string;
  reportMarkdown: string;
  githubActionsPlanMarkdown: string;
}

export interface ValidationCommandRecord {
  command: string;
  exitCode: number;
  status: "passed" | "failed";
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  blockerCategory?: EnvironmentBlockerCategory;
  blockerDetail?: string;
}

export interface DeliverValidationLocalRecord {
  status: "not-run" | "passed" | "failed";
  requestedCommands: string[];
  results: ValidationCommandRecord[];
  blockerCategories?: EnvironmentBlockerCategory[];
  notes?: string;
}

export interface ValidationCoverageSummary {
  status: "ready" | "partial" | "blocked";
  outcomeCategory: DeliverValidationPlan["outcomeCategory"];
  confidence: "low" | "medium" | "high";
  summary: string;
  signals: string[];
  gaps: string[];
  localValidationStatus: DeliverValidationLocalRecord["status"];
  selectedScope: string[];
  deferredScope: string[];
  classificationReason: string;
}

export type GitHubGateStatus = "ready" | "blocked" | "not-applicable" | "unknown";

export interface GitHubPullRequestRecord {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  reviewDecision?: string | null;
  url: string;
  headRefName: string;
  baseRefName: string;
}

export interface GitHubIssueRecord {
  number: number;
  title: string;
  state: string;
  url: string;
  closedAt?: string | null;
}

export interface GitHubCheckRunRecord {
  name: string;
  status: string;
  conclusion?: string | null;
  detailsUrl?: string | null;
}

export interface GitHubActionRunRecord {
  databaseId: number;
  workflowName: string;
  status: string;
  conclusion?: string | null;
  url?: string;
  headSha?: string;
  headBranch?: string;
  event?: string;
}

export interface GitHubDependabotAlertRecord {
  number: number;
  severity?: string | null;
  state?: string | null;
  packageName?: string | null;
  url?: string;
}

export interface GitHubCodeScanningAlertRecord {
  number: number;
  severity?: string | null;
  state?: string | null;
  ruleId?: string | null;
  url?: string;
}

export interface GitHubReleaseRecord {
  tagName: string;
  version?: string | null;
  changelogPaths?: string[];
  name?: string | null;
  url?: string;
  isDraft?: boolean;
  isPrerelease?: boolean;
  publishedAt?: string | null;
  tagExists: boolean;
  releaseExists: boolean;
}

export interface GitHubGateEvaluation<T> {
  required: boolean;
  status: GitHubGateStatus;
  summary: string;
  blockers: string[];
  observedAt: string;
  source: "gh" | "git" | "config" | "none";
  observed: T;
  error?: string;
}

export interface GitHubDeliveryRecord {
  repository: string | null;
  mode: DeliverTargetMode;
  branch: {
    name: string;
    headSha: string;
    defaultBranch?: string | null;
  };
  requestedPolicy: DeliverGitHubConfig;
  issueReferences: number[];
  branchState: GitHubGateEvaluation<{
    current: string;
    headSha: string;
    defaultBranch?: string | null;
  }>;
  pullRequest: GitHubGateEvaluation<GitHubPullRequestRecord | null>;
  issues: GitHubGateEvaluation<GitHubIssueRecord[]>;
  checks: GitHubGateEvaluation<GitHubCheckRunRecord[]>;
  actions: GitHubGateEvaluation<GitHubActionRunRecord[]>;
  release: GitHubGateEvaluation<GitHubReleaseRecord | null>;
  security: GitHubGateEvaluation<{
    dependabot: GitHubDependabotAlertRecord[];
    codeScanning: GitHubCodeScanningAlertRecord[];
  }>;
  mutation: GitHubMutationRecord;
  overall: {
    status: "ready" | "blocked";
    summary: string;
    blockers: string[];
    observedAt: string;
  };
  limitations: string[];
}

export interface GitHubMutationRecord {
  enabled: boolean;
  branch: {
    initial: string;
    current: string;
    created: boolean;
    pushed: boolean;
    remote?: string | null;
  };
  commit: {
    created: boolean;
    sha?: string;
    message?: string;
    changedFiles: string[];
  };
  pullRequest: {
    created: boolean;
    updated: boolean;
    number?: number;
    url?: string;
    title?: string;
    baseRefName?: string;
    headRefName?: string;
    draft?: boolean;
  };
  checks: {
    watched: boolean;
    polls: number;
    completed: boolean;
    summary: string;
  };
  release?: {
    requested: boolean;
    tagName?: string;
    version?: string | null;
    created: boolean;
    pushed: boolean;
    uploadedFiles: string[];
    url?: string;
    name?: string | null;
    summary: string;
  };
  blockers: string[];
  summary: string;
}

export interface RunRecord {
  id: string;
  workflow: WorkflowName;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  cwd: string;
  gitBranch: string;
  codexVersion: string | null;
  codexCommand: string[];
  promptPath: string;
  finalPath: string;
  contextPath: string;
  eventsPath?: string;
  stdoutPath: string;
  stderrPath: string;
  configSources: string[];
  sessionId?: string | undefined;
  lastActivity?: string | undefined;
  currentStage?: string | undefined;
  activeSpecialists?: string[] | undefined;
  summary?: string | undefined;
  error?: string | undefined;
  rerunOfRunId?: string | undefined;
  forkedFromRunId?: string | undefined;
  inputs: {
    userPrompt: string;
    entrypoint?: "workflow" | "intent";
    plannedStages?: string[];
    delegatedTracks?: string[];
    webResearchAllowed?: boolean;
    linkedRunId?: string;
    planningIssueNumber?: number;
    planningIssueUrl?: string;
    initiativeId?: string;
    initiativeTitle?: string;
    requestedMode?: WorkflowMode;
    observedMode?: WorkflowMode;
    verificationCommands?: string[];
    selectedSpecialists?: SpecialistName[];
    deliveryMode?: DeliverTargetMode;
    issueNumbers?: number[];
    dryRun?: boolean;
    allowDirty?: boolean;
    allowAll?: boolean;
    safe?: boolean;
    timeoutSeconds?: number;
    maxCodexAttempts?: number;
  };
}
