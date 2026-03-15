import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildValidationToolResearch,
  profileValidationRepository,
  selectValidationSpecialists
} from "../src/validation.js";

describe("validation intelligence", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-validation-"));
    await fs.mkdir(path.join(repoDir, ".github", "workflows"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("profiles a web and container repository", async () => {
    await fs.writeFile(
      path.join(repoDir, "package.json"),
      JSON.stringify(
        {
          name: "fixture-web",
          version: "1.0.0",
          bin: "bin/app.js",
          scripts: {
            lint: "eslint .",
            typecheck: "tsc --noEmit",
            test: "vitest run",
            "test:e2e": "playwright test"
          },
          devDependencies: {
            vitest: "^3.2.4",
            "@testing-library/react": "^16.0.0",
            playwright: "^1.52.0",
            react: "^19.0.0",
            vite: "^6.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(path.join(repoDir, "Dockerfile"), "FROM node:24-alpine\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".github", "workflows", "ci.yml"), "name: CI\n", "utf8");
    await fs.writeFile(path.join(repoDir, "playwright.config.ts"), "export default {};\n", "utf8");

    const profile = await profileValidationRepository(repoDir);

    expect(profile.surfaces).toContain("web-app");
    expect(profile.surfaces).toContain("container");
    expect(profile.surfaces).toContain("cli-binary");
    expect(profile.ciSystems).toContain("github-actions");
    expect(profile.runnerConstraints).toContain("docker-preferred");
    expect(profile.packageScripts.map((script) => script.name)).toEqual(["lint", "test", "test:e2e", "typecheck"]);
  });

  it("selects OSS tool research aligned with the repo profile", async () => {
    await fs.writeFile(
      path.join(repoDir, "package.json"),
      JSON.stringify(
        {
          name: "fixture-service",
          version: "1.0.0",
          scripts: {
            test: "vitest run"
          },
          dependencies: {
            express: "^5.0.0"
          },
          devDependencies: {
            vitest: "^3.2.4"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(path.join(repoDir, ".github", "workflows", "release.yml"), "name: Release\n", "utf8");

    const profile = await profileValidationRepository(repoDir);
    const research = buildValidationToolResearch(profile);
    const selections = selectValidationSpecialists(profile, "Validate API contract and hardened workflow security");

    expect(profile.surfaces).toContain("service");
    expect(research.selectedTools).toContain("testcontainers");
    expect(research.selectedTools).toContain("actionlint");
    expect(research.candidates.some((candidate) => candidate.tool === "zizmor")).toBe(true);
    expect(selections.filter((entry) => entry.selected).map((entry) => entry.name)).toContain("workflow-security-specialist");
    expect(selections.filter((entry) => entry.selected).map((entry) => entry.name)).toContain("api-contract-specialist");
  });
});
