import path from "node:path";
import { promises as fs } from "node:fs";
import type { CstackConfig } from "./types.js";

function excerpt(input: string, lines = 24): string {
  return input.split("\n").slice(0, lines).join("\n");
}

export async function buildSpecPrompt(cwd: string, input: string, config: CstackConfig): Promise<{ prompt: string; context: string }> {
  const specDoc = path.join(cwd, "docs", "specs", "cstack-spec-v0.1.md");
  const researchDoc = path.join(cwd, "docs", "research", "gstack-codex-interaction-model.md");
  const promptAssetPath = path.join(cwd, ".cstack", "prompts", "spec.md");
  const context = [
    "Workflow: spec",
    `Delegation enabled: ${config.workflows.spec.delegation?.enabled ? "yes" : "no"}`,
    `Delegation max agents: ${config.workflows.spec.delegation?.maxAgents ?? 0}`,
    `Prompt asset: ${promptAssetPath}`,
    `Spec source: ${specDoc}`,
    `Research source: ${researchDoc}`
  ].join("\n");

  let specText = "";
  let researchText = "";
  let promptAsset = "";
  try {
    promptAsset = await fs.readFile(promptAssetPath, "utf8");
  } catch {}
  try {
    specText = await fs.readFile(specDoc, "utf8");
  } catch {}
  try {
    researchText = await fs.readFile(researchDoc, "utf8");
  } catch {}

  const prompt = [
    promptAsset || "You are running the `cstack spec` workflow.",
    "",
    "Use the repository documents as directional context, not as text to restate.",
    "Prefer a focused, implementation-ready output.",
    "",
    "## User request",
    input,
    "",
    "## Repository spec excerpt",
    excerpt(specText) || "(missing)",
    "",
    "## Repository research excerpt",
    excerpt(researchText) || "(missing)",
    "",
    "## Referenced files",
    `- ${specDoc}`,
    `- ${researchDoc}`
  ].join("\n");

  return { prompt, context };
}
