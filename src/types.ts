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
  childRunId?: string;
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
  validationRepoProfile: ValidationRepoProfile | null;
  validationPlan: DeliverValidationPlan | null;
  validationToolResearch: ValidationToolResearch | null;
  validationLocalRecord: DeliverValidationLocalRecord | null;
  deliverReviewVerdict: DeliverReviewVerdict | null;
  deliverShipRecord: DeliverShipRecord | null;
  githubDeliveryRecord: GitHubDeliveryRecord | null;
  githubMutationRecord: GitHubMutationRecord | null;
  executionContext: ExecutionContextRecord | null;
  recentEvents: RunEvent[];
  finalBody: string;
  buildFinalBody: string;
  buildFinalPath?: string | undefined;
  buildStderrTail?: string | undefined;
  artifacts: ArtifactEntry[];
  childRuns: ChildRunInspection[];
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
  allowDirty?: boolean;
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
    fallbackReason?: string;
  };
  notes?: string[];
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
  summary: string;
  profileSummary: string;
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
}

export interface DeliverValidationLocalRecord {
  status: "not-run" | "passed" | "failed";
  requestedCommands: string[];
  results: ValidationCommandRecord[];
  notes?: string;
}

export interface ValidationCoverageSummary {
  status: "ready" | "partial" | "blocked";
  confidence: "low" | "medium" | "high";
  summary: string;
  signals: string[];
  gaps: string[];
  localValidationStatus: DeliverValidationLocalRecord["status"];
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
  rerunOfRunId?: string | undefined;
  forkedFromRunId?: string | undefined;
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
    allowDirty?: boolean;
    timeoutSeconds?: number;
  };
}
