export type WorkflowName = "spec" | "discover" | "build" | "deliver" | "update" | "intent";
export type RunStatus = "running" | "completed" | "failed";
export type WorkflowMode = "exec" | "interactive";
export type DeliverTargetMode = "merge-ready" | "release";

export type StageName = "discover" | "spec" | "build" | "review" | "ship";

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
  | "release-pipeline-review";

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
  delegationEnabled: boolean;
  maxTracks: number;
  webResearchAllowed: boolean;
  requestedCapabilities: string[];
  availableCapabilities: string[];
  summary: string;
  tracks: DiscoverTrackSelection[];
  limitations: string[];
}

export interface RoutingStagePlan {
  name: StageName;
  rationale: string;
  status: StageStatus;
  executed: boolean;
  notes?: string;
  stageDir?: string;
  artifactPath?: string;
}

export interface SpecialistSelection {
  name: SpecialistName;
  reason: string;
  selected: boolean;
}

export interface SpecialistExecution {
  name: SpecialistName;
  reason: string;
  status: "planned" | "running" | "completed" | "failed";
  disposition: SpecialistDisposition;
  specialistDir?: string;
  artifactPath?: string;
  notes?: string;
}

export interface RoutingPlan {
  intent: string;
  inferredAt: string;
  entrypoint: "bare" | "run";
  stages: RoutingStagePlan[];
  specialists: SpecialistSelection[];
  summary: string;
}

export interface StageLineage {
  intent: string;
  stages: RoutingStagePlan[];
  specialists: SpecialistExecution[];
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
}

export interface RunInspection {
  run: RunRecord;
  runDir: string;
  routingPlan: RoutingPlan | null;
  stageLineage: StageLineage | null;
  discoverResearchPlan: DiscoverResearchPlan | null;
  discoverDelegates: DiscoverDelegateResult[];
  sessionRecord: BuildSessionRecord | null;
  verificationRecord: BuildVerificationRecord | null;
  deliverReviewVerdict: DeliverReviewVerdict | null;
  deliverShipRecord: DeliverShipRecord | null;
  githubDeliveryRecord: GitHubDeliveryRecord | null;
  githubMutationRecord: GitHubMutationRecord | null;
  recentEvents: RunEvent[];
  finalBody: string;
  artifacts: ArtifactEntry[];
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

export interface WorkflowConfig {
  mode?: WorkflowMode;
  verificationCommands?: string[];
  delegation?: {
    enabled?: boolean;
    maxAgents?: number;
  };
  research?: {
    enabled?: boolean;
    allowWeb?: boolean;
  };
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
    deliver: WorkflowConfig;
  };
  verification?: VerificationConfig;
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
    fallbackReason?: string;
  };
  notes?: string[];
}

export interface BuildVerificationCommandRecord {
  command: string;
  exitCode: number;
  status: "passed" | "failed";
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
}

export interface BuildVerificationRecord {
  status: "not-run" | "passed" | "failed";
  requestedCommands: string[];
  results: BuildVerificationCommandRecord[];
  notes?: string;
}

export interface DeliverReviewFinding {
  severity: "info" | "warning" | "high";
  title: string;
  detail: string;
  owner?: string;
}

export interface DeliverReviewVerdict {
  status: "ready" | "changes-requested" | "blocked";
  summary: string;
  findings: DeliverReviewFinding[];
  recommendedActions: string[];
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
  inputs: {
    userPrompt: string;
    entrypoint?: "workflow" | "intent";
    plannedStages?: string[];
    delegatedTracks?: string[];
    webResearchAllowed?: boolean;
    linkedRunId?: string;
    requestedMode?: WorkflowMode;
    observedMode?: WorkflowMode;
    verificationCommands?: string[];
    selectedSpecialists?: SpecialistName[];
    deliveryMode?: DeliverTargetMode;
    issueNumbers?: number[];
    dryRun?: boolean;
  };
}
