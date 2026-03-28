import { describe, expect, it } from "vitest";
import path from "node:path";
import { promises as fs } from "node:fs";
import { CSTACK_REPOSITORY, readCurrentVersion } from "../src/version.js";

describe("version", () => {
  it("reads the package.json version", async () => {
    const packageJsonPath = path.resolve("package.json");
    const packageVersion = JSON.parse(await fs.readFile(packageJsonPath, "utf8")).version as string;

    expect(await readCurrentVersion()).toBe(packageVersion);
  });

  it("publishes the repository slug constant", () => {
    expect(CSTACK_REPOSITORY).toBe("ganesh47/cstack");
  });
});
