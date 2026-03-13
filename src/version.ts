import { promises as fs } from "node:fs";

let cachedVersion: string | null = null;

export const CSTACK_REPOSITORY = "ganesh47/cstack";

export async function readCurrentVersion(): Promise<string> {
  if (cachedVersion) {
    return cachedVersion;
  }

  const packageJsonPath = new URL("../package.json", import.meta.url);
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  if (!parsed.version) {
    throw new Error("package.json is missing a version field.");
  }

  cachedVersion = parsed.version;
  return parsed.version;
}
