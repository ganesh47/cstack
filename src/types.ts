export type WorkflowName = "spec" | "discover" | "build" | "update" | "intent";
export type RunStatus = "running" | "completed" | "failed";
export type WorkflowMode = "exec" | "interactive";

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
  };
  verification?: VerificationConfig;
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
    selectedSpecialists?: string[];
    delegatedTracks?: string[];
    webResearchAllowed?: boolean;
    linkedRunId?: string;
    requestedMode?: WorkflowMode;
    observedMode?: WorkflowMode;
    verificationCommands?: string[];
    dryRun?: boolean;
  };
}
