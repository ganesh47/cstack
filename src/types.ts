export type WorkflowName = "spec";

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
  stdoutPath: string;
  stderrPath: string;
  configSources: string[];
  sessionId?: string;
  error?: string;
  inputs: {
    userPrompt: string;
  };
}
