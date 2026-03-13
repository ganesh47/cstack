export type WorkflowName = "spec" | "discover" | "update" | "intent";

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
  delegation?: {
    enabled?: boolean;
    maxAgents?: number;
  };
}

export interface CstackConfig {
  codex: CodexConfig;
  workflows: {
    spec: WorkflowConfig;
    discover: WorkflowConfig;
  };
}

export interface RunRecord {
  id: string;
  workflow: WorkflowName;
  createdAt: string;
  updatedAt: string;
  status: "running" | "completed" | "failed";
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
  sessionId?: string;
  lastActivity?: string;
  error?: string;
  inputs: {
    userPrompt: string;
    entrypoint?: "workflow" | "intent";
    plannedStages?: string[];
    selectedSpecialists?: string[];
    dryRun?: boolean;
  };
}
