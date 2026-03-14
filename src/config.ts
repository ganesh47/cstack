import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import * as TOML from "@iarna/toml";
import type { CstackConfig } from "./types.js";

const DEFAULT_CONFIG: CstackConfig = {
  codex: {
    command: process.env.CSTACK_CODEX_BIN || "codex",
    sandbox: "workspace-write",
    extraArgs: []
  },
  workflows: {
    spec: {
      delegation: {
        enabled: false,
        maxAgents: 0
      }
    },
    discover: {
      delegation: {
        enabled: true,
        maxAgents: 2
      },
      research: {
        enabled: true,
        allowWeb: false
      }
    },
    build: {
      mode: "interactive",
      verificationCommands: [],
      delegation: {
        enabled: false,
        maxAgents: 0
      }
    },
    deliver: {
      mode: "interactive",
      verificationCommands: [],
      delegation: {
        enabled: true,
        maxAgents: 4
      },
      github: {
        enabled: false,
        mode: "merge-ready",
        prRequired: false,
        requireApprovedReview: false,
        linkedIssuesRequired: false,
        requiredIssueState: "linked",
        requiredChecks: [],
        requiredWorkflows: [],
        requireRelease: false,
        requireTag: false,
        requireVersionMatch: false,
        requireChangelog: false,
        changelogPaths: ["README.md"],
        security: {
          requireDependabot: false,
          requireCodeScanning: false,
          blockSeverities: ["high", "critical"]
        }
      }
    }
  },
  verification: {
    defaultCommands: []
  }
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeObjects<T>(base: T, update: unknown): T {
  if (!isObject(base) || !isObject(update)) {
    return (update as T) ?? base;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(update)) {
    const current = merged[key];
    if (isObject(current) && isObject(value)) {
      merged[key] = mergeObjects(current, value);
      continue;
    }
    merged[key] = value;
  }
  return merged as T;
}

export async function loadConfig(cwd: string): Promise<{ config: CstackConfig; sources: string[] }> {
  const repoPath = path.join(cwd, ".cstack", "config.toml");
  const userPath = path.join(os.homedir(), ".config", "cstack", "config.toml");
  let config = structuredClone(DEFAULT_CONFIG);
  const sources: string[] = [];

  for (const source of [userPath, repoPath]) {
    try {
      const raw = await fs.readFile(source, "utf8");
      const parsed = TOML.parse(raw) as unknown;
      config = mergeObjects(config, parsed);
      sources.push(source);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw new Error(`Failed to load config from ${source}: ${err.message}`);
      }
    }
  }

  return { config, sources };
}
