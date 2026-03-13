export type WorkflowName = "spec" | "discover";

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
  };
}
