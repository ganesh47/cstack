import type { ConfigProvenance, ConfigValueSource, CstackConfig, WorkflowName } from "./types.js";

export const DEFAULT_DANGEROUS_SANDBOX = "danger-full-access";
export const SAFE_SANDBOX_OVERRIDE = "workspace-write";

const ALLOW_DIRTY_WORKFLOWS = ["build", "ship", "deliver"] as const;

export interface ResolvedRunPolicy {
  config: CstackConfig;
  safe: boolean;
}

export function resolveRunPolicy(options: {
  config: CstackConfig;
  provenance: ConfigProvenance;
  safe?: boolean | undefined;
}): ResolvedRunPolicy {
  const safe = options.safe ?? false;
  if (!safe) {
    return {
      config: options.config,
      safe
    };
  }

  const config = structuredClone(options.config);
  if (options.provenance.codexSandbox.source === "default") {
    config.codex.sandbox = SAFE_SANDBOX_OVERRIDE;
  }
  for (const workflow of ALLOW_DIRTY_WORKFLOWS) {
    if (options.provenance.workflowAllowDirty[workflow].source === "default") {
      config.workflows[workflow].allowDirty = false;
    }
  }

  return { config, safe };
}

export function resolveSourceExecutionReason(options: {
  workflow: Extract<WorkflowName, "build" | "deliver">;
  allowDirty?: boolean;
  safe?: boolean;
  requestedAllowDirty?: boolean;
  configuredAllowDirtySource?: ConfigValueSource;
}): string | undefined {
  if (!options.allowDirty) {
    return undefined;
  }
  if (options.safe) {
    if (options.requestedAllowDirty) {
      return `Direct source execution was explicitly enabled via --allow-dirty while --safe was set for ${options.workflow}.`;
    }
    return `Direct source execution remained enabled for ${options.workflow} because allowDirty is explicitly configured while --safe was set.`;
  }
  if (options.requestedAllowDirty) {
    return `Direct source execution was explicitly enabled via --allow-dirty for ${options.workflow}.`;
  }
  if (options.configuredAllowDirtySource && options.configuredAllowDirtySource !== "default") {
    return `Direct source execution was enabled by configured allowDirty for ${options.workflow}.`;
  }
  return `Direct source execution used the default execution policy for ${options.workflow}.`;
}

export function emitDeprecatedAllowAllWarning(command: string): void {
  process.stderr.write(
    `[cstack] Warning: \`--allow-all\` is deprecated for \`${command}\` and has no effect.\n`
  );
}
