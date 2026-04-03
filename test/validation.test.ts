import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildValidationToolResearch,
  detectValidationBootstrapTools,
  prepareValidationToolBin,
  profileValidationRepository,
  selectDefaultLocalCommands,
  selectValidationSpecialists
} from "../src/validation.js";
import type { BuildVerificationRecord } from "../src/types.js";

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
    expect(profile.workspaceTargets.find((target) => target.path === "packages/cli")?.support).toBe("partial");
    expect(profile.workspaceTargets.find((target) => target.path === "docker/api")?.support).toBe("inventory-only");
    expect(profile.limitations).toContain("Validation command inference is currently root-biased; nested workspace targets are inventoried and reported explicitly.");
    expect(profile.limitations.join("\n")).toContain("packages/cli");
  });

  it("detects declared package managers from package.json metadata", async () => {
    await fs.writeFile(
      path.join(repoDir, "package.json"),
      JSON.stringify(
        {
          name: "fixture-pnpm",
          private: true,
          packageManager: "pnpm@9.12.0",
          scripts: {
            test: "vitest run"
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

    const profile = await profileValidationRepository(repoDir);

    expect(profile.packageManagers).toContain("pnpm");
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

  it("selects local JS validation commands with the repo package manager", () => {
    const verificationRecord: BuildVerificationRecord = {
      status: "passed",
      requestedCommands: [],
      results: []
    };

    const pnpmCommands = selectDefaultLocalCommands(
      {
        detectedAt: new Date().toISOString(),
        languages: ["javascript"],
        buildSystems: ["npm", "pnpm"],
        surfaces: ["library"],
        packageManagers: ["pnpm"],
        ciSystems: [],
        runnerConstraints: ["linux-default"],
        manifests: ["package.json", "pnpm-lock.yaml"],
        workflowFiles: [],
        existingTests: [],
        packageScripts: [
          { name: "lint", command: "eslint ." },
          { name: "test", command: "vitest run" },
          { name: "build", command: "tsc -p tsconfig.json" }
        ],
        detectedTools: ["vitest"],
        workspaceTargets: [],
        limitations: []
      },
      verificationRecord
    );

    const yarnCommands = selectDefaultLocalCommands(
      {
        detectedAt: new Date().toISOString(),
        languages: ["javascript"],
        buildSystems: ["npm", "yarn"],
        surfaces: ["library"],
        packageManagers: ["yarn"],
        ciSystems: [],
        runnerConstraints: ["linux-default"],
        manifests: ["package.json", "yarn.lock"],
        workflowFiles: [],
        existingTests: [],
        packageScripts: [
          { name: "typecheck", command: "tsc --noEmit" },
          { name: "test:e2e", command: "playwright test" }
        ],
        detectedTools: ["playwright"],
        workspaceTargets: [],
        limitations: []
      },
      verificationRecord
    );

    expect(pnpmCommands).toEqual(["pnpm lint", "pnpm test", "pnpm build"]);
    expect(yarnCommands).toEqual(["yarn typecheck", "yarn test:e2e"]);
  });

  it("infers target-aware commands and prerequisites for nested workspaces", async () => {
    await fs.mkdir(path.join(repoDir, "packages", "api"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "packages", "cli"), { recursive: true });
    await fs.writeFile(path.join(repoDir, ".nvmrc"), "20.17.0\n", "utf8");
    await fs.writeFile(
      path.join(repoDir, "package.json"),
      JSON.stringify(
        {
          name: "fixture-monorepo",
          private: true,
          packageManager: "pnpm@9.12.0",
          scripts: {
            check: "pnpm run check:api && pnpm run check:cli"
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
          private: true,
          scripts: {
            lint: "eslint src --ext .ts",
            test: "vitest run"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(repoDir, "packages", "cli", "pyproject.toml"),
      [
        "[project]",
        "name = 'fixture-cli'",
        "requires-python = '>=3.12'",
        "",
        "[project.optional-dependencies]",
        "dev = ['pytest>=8.0', 'ruff>=0.6']",
        "",
        "[tool.uv]",
        "package = true",
        "",
        "[tool.ruff]",
        "line-length = 100",
        "",
        "[tool.pytest.ini_options]",
        "minversion = '8.0'"
      ].join("\n"),
      "utf8"
    );

    const profile = await profileValidationRepository(repoDir);
    const commands = selectDefaultLocalCommands(profile, { status: "passed", requestedCommands: [], results: [] });

    expect(commands).toContain("pnpm check");
    expect(commands).toContain("pnpm --dir packages/api lint");
    expect(commands).toContain("pnpm --dir packages/api test");
    expect(commands).toContain("cd packages/cli && uv run ruff check .");
    expect(commands).toContain("cd packages/cli && uv run pytest");
    expect(profile.prerequisites).toContain("Node 20.17.0 from .nvmrc");
    expect(profile.prerequisites).toContain("Python >=3.12 for packages/cli");
    expect(profile.prerequisites).toContain("uv available on PATH for packages/cli");
  });
});
