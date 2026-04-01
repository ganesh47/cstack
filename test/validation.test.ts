import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildValidationToolResearch,
  detectValidationBootstrapTools,
  prepareValidationToolBin,
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
    expect(profile.workspaceTargets.find((target) => target.path === ".")?.support).toBe("native");
  });

  it("profiles nested workspace targets truthfully", async () => {
    await fs.mkdir(path.join(repoDir, "packages", "api"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "packages", "cli"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "docker", "api"), { recursive: true });

    await fs.writeFile(
      path.join(repoDir, "package.json"),
      JSON.stringify(
        {
          name: "fixture-monorepo",
          private: true,
          scripts: {
            test: "vitest run"
          },
          workspaces: ["packages/*"],
          devDependencies: {
            vitest: "^3.2.4"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(repoDir, "packages", "api", "package.json"),
      JSON.stringify(
        {
          name: "@fixture/api",
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
    await fs.writeFile(path.join(repoDir, "packages", "cli", "pyproject.toml"), "[project]\nname='fixture-cli'\n", "utf8");
    await fs.writeFile(path.join(repoDir, "docker", "api", "Dockerfile"), "FROM node:24-alpine\n", "utf8");

    const profile = await profileValidationRepository(repoDir);

    expect(profile.workspaceTargets.map((target) => target.path)).toEqual([".", "docker/api", "packages/api", "packages/cli"]);
    expect(profile.workspaceTargets.find((target) => target.path === "packages/api")?.support).toBe("partial");
    expect(profile.workspaceTargets.find((target) => target.path === "packages/cli")?.support).toBe("inventory-only");
    expect(profile.workspaceTargets.find((target) => target.path === "docker/api")?.support).toBe("inventory-only");
    expect(profile.limitations).toContain("Validation command inference is currently root-biased; nested workspace targets are inventoried and reported explicitly.");
    expect(profile.limitations.join("\n")).toContain("packages/cli");
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

  it("prepares wrapper scripts for bootstrap validation tools", async () => {
    const commands = ["actionlint .github/workflows/*.yml", "hadolint Dockerfile", "zizmor .github/workflows"];

    expect(detectValidationBootstrapTools(commands)).toEqual(["actionlint", "hadolint", "zizmor"]);

    const prepared = await prepareValidationToolBin(repoDir, commands);

    expect(prepared.binDir).toBeTruthy();
    expect(prepared.tools).toEqual(["actionlint", "hadolint", "zizmor"]);
    await expect(fs.access(path.join(prepared.binDir!, "actionlint"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(prepared.binDir!, "hadolint"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(prepared.binDir!, "zizmor"))).resolves.toBeUndefined();
  });
});
