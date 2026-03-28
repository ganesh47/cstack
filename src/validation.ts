import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classifyExecutionBlocker, uniqueBlockerCategories } from "./blockers.js";
import { readCodexFinalOutput, runCodexExec } from "./codex.js";
import {
  buildDeliverValidationLeadPrompt,
  buildDeliverValidationSpecialistPrompt
} from "./prompt.js";
import type {
  BuildVerificationRecord,
  CapabilityUsageRecord,
  CstackConfig,
  DeliverValidationLocalRecord,
  DeliverValidationPlan,
  SpecialistDisposition,
  SpecialistExecution,
  SpecialistName,
  ValidationCommandRecord,
  ValidationCoverageSummary,
  ValidationDetectedScript,
  ValidationRepoProfile,
  ValidationToolCandidate,
  ValidationToolResearch,
  ValidationWorkspaceTarget
} from "./types.js";

const execFileAsync = promisify(execFile);

const TOOL_SOURCES: Record<string, string> = {
  playwright: "https://playwright.dev/docs/ci",
  vitest: "https://vitest.dev/",
  jest: "https://jestjs.io/docs/getting-started",
  "testing-library": "https://testing-library.com/docs/",
  cypress: "https://docs.cypress.io/",
  testcontainers: "https://testcontainers.com/",
  schemathesis: "https://schemathesis.readthedocs.io/",
  "bats-core": "https://github.com/bats-core/bats-core",
  hadolint: "https://github.com/hadolint/hadolint",
  trivy: "https://trivy.dev/latest/",
  "container-structure-test": "https://github.com/GoogleContainerTools/container-structure-test",
  syft: "https://github.com/anchore/syft",
  actionlint: "https://github.com/rhysd/actionlint",
  zizmor: "https://github.com/zizmorcore/zizmor",
  maestro: "https://docs.maestro.dev/ci-integration/github-actions",
  detox: "https://wix.github.io/Detox/",
  xctest: "https://developer.apple.com/documentation/xctest",
  gradle: "https://docs.gradle.org/current/userguide/userguide.html",
  pytest: "https://docs.pytest.org/",
  ruff: "https://docs.astral.sh/ruff/",
  mypy: "https://mypy.readthedocs.io/",
  cargo: "https://doc.rust-lang.org/cargo/",
  "cargo-clippy": "https://doc.rust-lang.org/clippy/",
  go: "https://go.dev/doc/",
  dotnet: "https://learn.microsoft.com/dotnet/core/testing/",
  github_actions: "https://docs.github.com/actions/using-jobs/using-a-matrix-for-your-jobs"
};

export interface DeliverValidationPaths {
  stageDir: string;
  promptPath: string;
  contextPath: string;
  finalPath: string;
  eventsPath: string;
  stdoutPath: string;
  stderrPath: string;
  repoProfilePath: string;
  validationPlanPath: string;
  toolResearchPath: string;
  testPyramidPath: string;
  coverageSummaryPath: string;
  coverageGapsPath: string;
  localValidationPath: string;
  ciValidationPath: string;
  githubActionsPlanPath: string;
  testInventoryPath: string;
}

export interface DeliverValidationExecutionOptions {
  cwd: string;
  runId: string;
  input: string;
  config: CstackConfig;
  paths: DeliverValidationPaths;
  buildSummary: string;
  buildVerificationRecord: BuildVerificationRecord;
}

export interface DeliverValidationExecutionResult {
  repoProfile: ValidationRepoProfile;
  toolResearch: ValidationToolResearch;
  validationPlan: DeliverValidationPlan;
  localValidationRecord: DeliverValidationLocalRecord;
  coverageSummary: ValidationCoverageSummary;
  selectedSpecialists: Array<{ name: SpecialistName; reason: string; selected: boolean }>;
  specialistExecutions: SpecialistExecution[];
  finalBody: string;
}

type ValidationSpecialistSelection = Array<{ name: SpecialistName; reason: string; selected: boolean }>;

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(
      details.includes("did not write final output") ? `${context} did not write final output` : `${context} did not return valid JSON: ${details}`
    );
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(cwd: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function listWorkflowFiles(cwd: string): Promise<string[]> {
  const workflowsDir = path.join(cwd, ".github", "workflows");
  try {
    const entries = await fs.readdir(workflowsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(".github", "workflows", entry.name))
      .sort();
  } catch {
    return [];
  }
}

async function collectManifestHints(cwd: string): Promise<string[]> {
  const candidates = [
    "package.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "requirements.txt",
    "Gemfile",
    "composer.json",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "gradlew",
    "Podfile",
    "Package.swift",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml"
  ];
  const manifests: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(path.join(cwd, candidate))) {
      manifests.push(candidate);
    }
  }
  return manifests;
}

async function readPackageJsonAt(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function findFiles(cwd: string, names: string[], options: { maxDepth?: number; maxResults?: number } = {}): Promise<string[]> {
  const maxDepth = options.maxDepth ?? 4;
  const maxResults = options.maxResults ?? 50;
  const wanted = new Set(names);
  const results: string[] = [];

  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || results.length >= maxResults) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults) {
        return;
      }
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".cstack" || entry.name === "dist") {
        continue;
      }
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(cwd, absolutePath);
      if (entry.isDirectory()) {
        await visit(absolutePath, depth + 1);
        continue;
      }
      if (wanted.has(entry.name)) {
        results.push(relativePath);
      }
    }
  }

  await visit(cwd, 0);
  return results.sort();
}

function pushUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (value && !target.includes(value)) {
      target.push(value);
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function classifyWorkspaceSupport(target: {
  path: string;
  manifests: string[];
  packageScripts: ValidationDetectedScript[];
  workflowFiles: string[];
}): ValidationWorkspaceTarget["support"] {
  if (target.path === ".") {
    return "native";
  }
  if (target.workflowFiles.length > 0) {
    return "native";
  }
  if (target.manifests.includes("package.json") && target.packageScripts.length > 0) {
    return "partial";
  }
  return "inventory-only";
}

function extractPackageScripts(pkg: Record<string, unknown> | null): Array<{ name: string; command: string }> {
  if (!pkg || typeof pkg.scripts !== "object" || pkg.scripts === null) {
    return [];
  }
  return Object.entries(pkg.scripts as Record<string, unknown>)
    .filter(([, value]) => typeof value === "string")
    .map(([name, command]) => ({ name, command: String(command) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function collectPackageTools(pkg: Record<string, unknown> | null): string[] {
  if (!pkg) {
    return [];
  }
  const toolNames = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object") {
      continue;
    }
    for (const dep of Object.keys(deps as Record<string, unknown>)) {
      if (/vitest|jest|playwright|cypress|@testing-library|eslint|typescript|tsx|vite|next|react|express|fastify|nestjs|docker/i.test(dep)) {
        toolNames.add(dep);
      }
    }
  }
  return [...toolNames].sort();
}

function detectLanguages(manifests: string[], pkg: Record<string, unknown> | null): string[] {
  const languages: string[] = [];
  if (pkg) {
    pushUnique(languages, ["javascript", "typescript"]);
  }
  if (manifests.includes("Cargo.toml")) {
    languages.push("rust");
  }
  if (manifests.includes("go.mod")) {
    languages.push("go");
  }
  if (manifests.includes("pyproject.toml") || manifests.includes("requirements.txt")) {
    languages.push("python");
  }
  if (manifests.includes("Gemfile")) {
    languages.push("ruby");
  }
  if (manifests.includes("composer.json")) {
    languages.push("php");
  }
  if (manifests.includes("Package.swift")) {
    languages.push("swift");
  }
  if (manifests.some((manifest) => manifest.startsWith("build.gradle") || manifest === "gradlew" || manifest.startsWith("settings.gradle"))) {
    languages.push("kotlin");
    languages.push("java");
  }
  return [...new Set(languages)];
}

function detectBuildSystems(manifests: string[], pkg: Record<string, unknown> | null): string[] {
  const systems: string[] = [];
  if (pkg) {
    systems.push("npm");
  }
  if (manifests.includes("pnpm-lock.yaml")) {
    systems.push("pnpm");
  }
  if (manifests.includes("yarn.lock")) {
    systems.push("yarn");
  }
  if (manifests.includes("Cargo.toml")) {
    systems.push("cargo");
  }
  if (manifests.includes("go.mod")) {
    systems.push("go");
  }
  if (manifests.includes("pyproject.toml")) {
    systems.push("python");
  }
  if (manifests.some((manifest) => manifest.startsWith("build.gradle") || manifest === "gradlew")) {
    systems.push("gradle");
  }
  if (manifests.includes("Package.swift")) {
    systems.push("swiftpm");
  }
  if (manifests.includes("Dockerfile")) {
    systems.push("docker");
  }
  return [...new Set(systems)];
}

function detectPackageManagers(manifests: string[]): string[] {
  const managers: string[] = [];
  if (manifests.includes("package-lock.json")) {
    managers.push("npm");
  }
  if (manifests.includes("pnpm-lock.yaml")) {
    managers.push("pnpm");
  }
  if (manifests.includes("yarn.lock")) {
    managers.push("yarn");
  }
  if (manifests.includes("Cargo.toml")) {
    managers.push("cargo");
  }
  if (manifests.includes("go.mod")) {
    managers.push("go");
  }
  if (manifests.includes("pyproject.toml")) {
    managers.push("pip/pyproject");
  }
  return [...new Set(managers)];
}

function detectSurfaces(options: {
  pkg: Record<string, unknown> | null;
  manifests: string[];
  detectedTools: string[];
  workflowFiles: string[];
  existingTests: string[];
}): string[] {
  const surfaces: string[] = [];
  const pkg = options.pkg;
  const scripts = extractPackageScripts(pkg).map((entry) => entry.name);
  const deps = collectPackageTools(pkg);
  const hasBin = Boolean(pkg && typeof pkg.bin === "object") || Boolean(pkg && typeof pkg.bin === "string");
  const hasDocker = options.manifests.includes("Dockerfile") || options.manifests.includes("docker-compose.yml") || options.manifests.includes("docker-compose.yaml");
  const hasMobileIos = options.manifests.includes("Podfile") || options.manifests.includes("Package.swift");
  const hasMobileAndroid = options.manifests.some((manifest) => manifest.includes("gradle"));
  const webSignals = deps.some((dep) => /react|next|vite|playwright|cypress|@testing-library/.test(dep)) || scripts.some((name) => /dev|start|storybook/.test(name));
  const serviceSignals = deps.some((dep) => /express|fastify|nest/.test(dep)) || scripts.some((name) => /serve|api/.test(name));

  if (webSignals) {
    surfaces.push("web-app");
  }
  if (serviceSignals) {
    surfaces.push("service");
  }
  if (hasBin) {
    surfaces.push("cli-binary");
  }
  if (hasDocker) {
    surfaces.push("container");
  }
  if (hasMobileIos) {
    surfaces.push("ios-app");
  }
  if (hasMobileAndroid) {
    surfaces.push("android-app");
  }
  if (options.workflowFiles.length > 0) {
    surfaces.push("github-workflows");
  }
  if (surfaces.length === 0 && pkg) {
    surfaces.push("library");
  }
  if (surfaces.length === 0 && options.existingTests.length > 0) {
    surfaces.push("service");
  }
  return [...new Set(surfaces)];
}

function buildExistingSuites(options: {
  testFiles: string[];
  workflowFiles: string[];
  packageTools: string[];
}): ValidationRepoProfile["existingTests"] {
  const suites: ValidationRepoProfile["existingTests"] = [];
  for (const file of options.testFiles) {
    const lower = file.toLowerCase();
    let kind: ValidationRepoProfile["existingTests"][number]["kind"] = "unknown";
    if (/e2e|playwright|cypress|maestro|detox/.test(lower)) {
      kind = "e2e";
    } else if (/integration|contract|api/.test(lower)) {
      kind = "integration";
    } else if (/unit|spec|test/.test(lower)) {
      kind = "unit";
    }
    const tool =
      options.packageTools.find((candidate) => lower.includes(candidate.replace(/[@/]/g, ""))) ??
      options.packageTools.find((candidate) => /vitest|jest|playwright|cypress/.test(candidate));
    suites.push({ kind, location: file, ...(tool ? { tool } : {}) });
  }
  for (const file of options.workflowFiles) {
    suites.push({ kind: "workflow", location: file, tool: "github-actions" });
  }
  return suites;
}

async function collectWorkspaceTargets(cwd: string, rootPkg: Record<string, unknown> | null, rootManifests: string[], workflowFiles: string[]): Promise<ValidationWorkspaceTarget[]> {
  const manifestFiles = await findFiles(
    cwd,
    [
      "package.json",
      "pyproject.toml",
      "requirements.txt",
      "Cargo.toml",
      "go.mod",
      "Dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
      "build.gradle",
      "build.gradle.kts",
      "settings.gradle",
      "settings.gradle.kts",
      "Package.swift",
      "Podfile"
    ],
    { maxDepth: 6, maxResults: 200 }
  );
  const targets = new Map<string, ValidationWorkspaceTarget>();
  const ensureTarget = async (targetPath: string): Promise<ValidationWorkspaceTarget> => {
    const existing = targets.get(targetPath);
    if (existing) {
      return existing;
    }
    const pkgPath = targetPath === "." ? path.join(cwd, "package.json") : path.join(cwd, targetPath, "package.json");
    const pkg = targetPath === "." ? rootPkg : await readPackageJsonAt(pkgPath);
    const manifests = targetPath === "." ? [...rootManifests] : [];
    const workflowSubset = targetPath === "." ? [...workflowFiles] : [];
    const target: ValidationWorkspaceTarget = {
      path: targetPath,
      manifests,
      languages: detectLanguages(manifests, pkg),
      buildSystems: detectBuildSystems(manifests, pkg),
      surfaces: [],
      packageScripts: extractPackageScripts(pkg),
      detectedTools: collectPackageTools(pkg),
      support: "inventory-only",
      notes: []
    };
    targets.set(targetPath, target);
    return target;
  };

  const rootTarget = await ensureTarget(".");
  rootTarget.surfaces = detectSurfaces({
    pkg: rootPkg,
    manifests: rootTarget.manifests,
    detectedTools: rootTarget.detectedTools,
    workflowFiles,
    existingTests: []
  });
  rootTarget.support = classifyWorkspaceSupport({
    path: ".",
    manifests: rootTarget.manifests,
    packageScripts: rootTarget.packageScripts,
    workflowFiles
  });

  for (const manifestFile of manifestFiles) {
    const directory = path.dirname(manifestFile);
    const targetPath = directory === "" ? "." : directory;
    const target = await ensureTarget(targetPath);
    const manifestName = path.basename(manifestFile);
    if (!target.manifests.includes(manifestName)) {
      target.manifests.push(manifestName);
      target.manifests.sort();
    }
  }

  for (const target of targets.values()) {
    const pkgPath = target.path === "." ? path.join(cwd, "package.json") : path.join(cwd, target.path, "package.json");
    const pkg = target.path === "." ? rootPkg : await readPackageJsonAt(pkgPath);
    target.languages = detectLanguages(target.manifests, pkg);
    target.buildSystems = detectBuildSystems(target.manifests, pkg);
    target.packageScripts = extractPackageScripts(pkg);
    target.detectedTools = collectPackageTools(pkg);
    target.surfaces = detectSurfaces({
      pkg,
      manifests: target.manifests,
      detectedTools: target.detectedTools,
      workflowFiles: target.path === "." ? workflowFiles : [],
      existingTests: []
    });
    target.support = classifyWorkspaceSupport({
      path: target.path,
      manifests: target.manifests,
      packageScripts: target.packageScripts,
      workflowFiles: target.path === "." ? workflowFiles : []
    });
    if (target.path !== "." && target.support !== "native") {
      target.notes.push("Validation command inference is currently rooted in the top-level repo; inspect this target manually.");
    }
    if (target.path !== "." && !target.manifests.includes("package.json")) {
      target.notes.push("No top-level JS package manifest was found for this target.");
    }
  }

  return [...targets.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export async function profileValidationRepository(cwd: string): Promise<ValidationRepoProfile> {
  const pkg = await readPackageJson(cwd);
  const manifests = await collectManifestHints(cwd);
  const workflowFiles = await listWorkflowFiles(cwd);
  const testFiles = await findFiles(cwd, [
    "vitest.config.ts",
    "vitest.config.js",
    "jest.config.js",
    "jest.config.ts",
    "playwright.config.ts",
    "playwright.config.js",
    "cypress.config.ts",
    "cypress.config.js",
    "pytest.ini",
    "conftest.py",
    "Cargo.toml",
    "Dockerfile",
    "container-structure-test.yaml",
    "container-structure-test.yml",
    "maestro.yaml",
    "maestro.yml"
  ]);
  const packageTools = collectPackageTools(pkg);
  const scripts = extractPackageScripts(pkg);
  const languages = detectLanguages(manifests, pkg);
  const buildSystems = detectBuildSystems(manifests, pkg);
  const packageManagers = detectPackageManagers(manifests);
  const existingTests = buildExistingSuites({ testFiles, workflowFiles, packageTools });
  const surfaces = detectSurfaces({
    pkg,
    manifests,
    detectedTools: packageTools,
    workflowFiles,
    existingTests: existingTests.map((entry) => entry.location)
  });
  const ciSystems = workflowFiles.length > 0 ? ["github-actions"] : [];
  const workspaceTargets = await collectWorkspaceTargets(cwd, pkg, manifests, workflowFiles);
  const runnerConstraints: string[] = [];
  if (surfaces.includes("ios-app")) {
    runnerConstraints.push("macos-required", "ios-simulator");
  }
  if (surfaces.includes("android-app")) {
    runnerConstraints.push("android-emulator");
  }
  if (surfaces.includes("container")) {
    runnerConstraints.push("docker-preferred");
  }
  if (!runnerConstraints.includes("linux-default")) {
    runnerConstraints.unshift("linux-default");
  }

  const limitations: string[] = [];
  if (surfaces.includes("ios-app")) {
    limitations.push("iOS validation may require macOS runners and simulator provisioning.");
  }
  if (surfaces.includes("android-app")) {
    limitations.push("Android validation may require emulator-capable runners.");
  }
  if (surfaces.length === 0) {
    limitations.push("Repository surface could not be classified confidently.");
  }
  const nestedTargets = workspaceTargets.filter((target) => target.path !== ".");
  if (nestedTargets.length > 0) {
    limitations.push("Validation command inference is currently root-biased; nested workspace targets are inventoried and reported explicitly.");
  }
  for (const target of nestedTargets.filter((entry) => entry.support !== "native")) {
    limitations.push(`Workspace target ${target.path} is ${target.support}; direct validation commands were not inferred for it.`);
  }

  return {
    detectedAt: new Date().toISOString(),
    languages,
    buildSystems,
    surfaces,
    packageManagers,
    ciSystems,
    runnerConstraints,
    manifests,
    workflowFiles,
    existingTests,
    packageScripts: scripts,
    detectedTools: packageTools,
    workspaceTargets,
    limitations
  };
}

function candidate(tool: string, category: string, selected: boolean, rationale: string, localSupport: ValidationToolCandidate["localSupport"], ciSupport: ValidationToolCandidate["ciSupport"]): ValidationToolCandidate {
  return {
    tool,
    category,
    selected,
    rationale,
    localSupport,
    ciSupport,
    source: TOOL_SOURCES[tool] ?? TOOL_SOURCES["github_actions"] ?? "https://docs.github.com/actions/using-jobs/using-a-matrix-for-your-jobs"
  };
}

export function buildValidationToolResearch(profile: ValidationRepoProfile): ValidationToolResearch {
  const candidates: ValidationToolCandidate[] = [];
  const selectedTools: string[] = [];
  const add = (entry: ValidationToolCandidate) => {
    candidates.push(entry);
    if (entry.selected && !selectedTools.includes(entry.tool)) {
      selectedTools.push(entry.tool);
    }
  };

  if (profile.surfaces.includes("web-app")) {
    add(candidate("vitest", "unit-component", profile.detectedTools.some((tool) => tool.includes("vitest")) || profile.packageScripts.some((script) => script.name === "test"), "Fast JS/TS unit coverage with strong local ergonomics.", "native", "native"));
    add(candidate("testing-library", "component", profile.detectedTools.some((tool) => tool.includes("testing-library")), "UI component assertions align with browser-heavy apps.", "native", "native"));
    add(candidate("playwright", "e2e-system", true, "Preferred browser E2E stack with strong GitHub Actions support.", "native", "native"));
    add(candidate("cypress", "e2e-system", profile.detectedTools.some((tool) => tool.includes("cypress")), "Keep existing Cypress stacks when already present.", "native", "native"));
  }

  if (profile.surfaces.includes("service") || profile.surfaces.includes("library")) {
    add(candidate("testcontainers", "integration-contract", profile.surfaces.includes("service"), "Supports local and CI parity for dependency-backed integration tests.", "scripted", "native"));
    add(candidate("schemathesis", "integration-contract", false, "Contract and fuzz validation when OpenAPI descriptions exist.", "optional", "optional"));
  }

  if (profile.surfaces.includes("cli-binary")) {
    add(candidate("bats-core", "packaging-smoke", false, "Useful for black-box CLI smoke tests when shell-first UX matters.", "scripted", "scripted"));
  }

  if (profile.surfaces.includes("container")) {
    add(candidate("hadolint", "static", true, "Lint Dockerfiles deterministically.", "optional", "native"));
    add(candidate("trivy", "static", true, "Container and supply-chain scanning for local and CI use.", "optional", "native"));
    add(candidate("container-structure-test", "packaging-smoke", true, "Validate image structure and runtime expectations.", "optional", "native"));
    add(candidate("syft", "packaging-smoke", false, "Generate SBOM evidence when supply-chain artifacts matter.", "optional", "optional"));
  }

  if (profile.ciSystems.includes("github-actions")) {
    add(candidate("actionlint", "static", true, "Validate GitHub Actions syntax and structure.", "optional", "native"));
    add(candidate("zizmor", "static", true, "Security lint GitHub workflow definitions.", "optional", "native"));
  }

  if (profile.surfaces.includes("ios-app") || profile.surfaces.includes("android-app")) {
    add(candidate("maestro", "e2e-system", true, "Portable black-box mobile UI validation.", "optional", "scripted"));
  }
  if (profile.surfaces.includes("ios-app")) {
    add(candidate("xctest", "unit-component", true, "Native iOS test entrypoint.", "native", "scripted"));
  }
  if (profile.surfaces.includes("android-app")) {
    add(candidate("gradle", "unit-component", true, "Native Android test entrypoint.", "native", "scripted"));
    add(candidate("detox", "e2e-system", false, "Useful for React Native stacks that already fit gray-box testing.", "scripted", "scripted"));
  }

  if (profile.languages.includes("python")) {
    add(candidate("pytest", "unit-component", true, "Default Python test runner.", "native", "native"));
    add(candidate("ruff", "static", true, "Fast linting for Python repos.", "native", "native"));
    add(candidate("mypy", "static", false, "Use when the repo already opts into typed Python.", "native", "native"));
  }
  if (profile.languages.includes("rust")) {
    add(candidate("cargo", "unit-component", true, "Native Rust test runner.", "native", "native"));
    add(candidate("cargo-clippy", "static", true, "Native static analysis for Rust.", "native", "native"));
  }
  if (profile.languages.includes("go")) {
    add(candidate("go", "unit-component", true, "Native Go test runner.", "native", "native"));
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: `Selected ${selectedTools.length} validation tool families for surfaces: ${profile.surfaces.join(", ") || "unknown"}.`,
    candidates,
    selectedTools,
    limitations: profile.limitations
  };
}

export function selectValidationSpecialists(profile: ValidationRepoProfile, input: string): ValidationSpecialistSelection {
  const lower = input.toLowerCase();
  const selections: ValidationSpecialistSelection = [];

  if (profile.surfaces.includes("web-app")) {
    selections.push({
      name: "browser-e2e-specialist",
      reason: "Browser-facing flows or web tooling require end-to-end validation planning.",
      selected: true
    });
  }
  if (profile.surfaces.includes("container")) {
    selections.push({
      name: "container-validation-specialist",
      reason: "Container packaging and image validation are part of the repo surface.",
      selected: true
    });
  }
  if (profile.ciSystems.includes("github-actions")) {
    selections.push({
      name: "workflow-security-specialist",
      reason: "GitHub Actions validation and hardening are part of the delivery path.",
      selected: true
    });
  }
  if (profile.surfaces.includes("service") && /(openapi|contract|api)/.test(lower)) {
    selections.push({
      name: "api-contract-specialist",
      reason: "The task language implies API contract coverage.",
      selected: true
    });
  }
  if (profile.surfaces.includes("ios-app") || profile.surfaces.includes("android-app")) {
    selections.push({
      name: "mobile-validation-specialist",
      reason: "Mobile surfaces need simulator/emulator-aware validation planning.",
      selected: true
    });
  }

  return selections.slice(0, 3);
}

function selectDefaultLocalCommands(profile: ValidationRepoProfile, buildVerificationRecord: BuildVerificationRecord): string[] {
  const commands: string[] = [];
  const scriptMap = new Map(profile.packageScripts.map((script) => [script.name, script.command]));
  const add = (command: string) => {
    if (command && !commands.includes(command)) {
      commands.push(command);
    }
  };

  for (const command of buildVerificationRecord.requestedCommands) {
    add(command);
  }
  if (scriptMap.has("lint")) {
    add("npm run lint");
  }
  if (scriptMap.has("typecheck")) {
    add("npm run typecheck");
  }
  if (scriptMap.has("test")) {
    add("npm test");
  }
  if (scriptMap.has("test:unit")) {
    add("npm run test:unit");
  }
  if (scriptMap.has("test:integration")) {
    add("npm run test:integration");
  }
  if (scriptMap.has("test:e2e")) {
    add("npm run test:e2e");
  }
  if (scriptMap.has("build")) {
    add("npm run build");
  }
  if (profile.buildSystems.includes("cargo")) {
    add("cargo test");
  }
  if (profile.buildSystems.includes("go")) {
    add("go test ./...");
  }
  if (profile.buildSystems.includes("python")) {
    add("pytest");
  }
  return commands;
}

function selectDefaultCiJobs(profile: ValidationRepoProfile, localCommands: string[]): DeliverValidationPlan["ciValidation"]["jobs"] {
  const jobs: DeliverValidationPlan["ciValidation"]["jobs"] = [];
  if (localCommands.length > 0) {
    jobs.push({
      name: "validation",
      runner: profile.runnerConstraints.includes("macos-required") ? "macos-latest" : "ubuntu-latest",
      purpose: "Run the repo-selected local validation commands inside GitHub Actions.",
      commands: localCommands,
      artifacts: ["test-reports", "coverage-reports"]
    });
  }
  if (profile.surfaces.includes("container")) {
    jobs.push({
      name: "container-validation",
      runner: "ubuntu-latest",
      purpose: "Run container lint and security validation for build artifacts.",
      commands: ["hadolint Dockerfile", "trivy image <image-or-build-output>"],
      artifacts: ["container-scan-results"]
    });
  }
  return jobs;
}

function buildInitialValidationPlan(profile: ValidationRepoProfile, toolResearch: ValidationToolResearch, buildVerificationRecord: BuildVerificationRecord, selectedSpecialists: ValidationSpecialistSelection): DeliverValidationPlan {
  const localCommands = selectDefaultLocalCommands(profile, buildVerificationRecord);
  const ciJobs = selectDefaultCiJobs(profile, localCommands);
  const layers: DeliverValidationPlan["layers"] = [
    {
      name: "static",
      selected: true,
      status: "ready",
      rationale: "Static validation catches syntax, types, workflow, and container issues early.",
      selectedTools: toolResearch.candidates.filter((candidate) => candidate.category === "static" && candidate.selected).map((candidate) => candidate.tool),
      localCommands: localCommands.filter((command) => /lint|typecheck|check|clippy/.test(command)),
      ciCommands: localCommands.filter((command) => /lint|typecheck|check|clippy/.test(command)),
      coverageIntent: ["syntax and type safety", "workflow correctness", "container lint where applicable"]
    },
    {
      name: "unit-component",
      selected: true,
      status: localCommands.some((command) => /test/.test(command)) ? "ready" : "partial",
      rationale: "Unit and component layers should cover the most common regression surface first.",
      selectedTools: toolResearch.candidates.filter((candidate) => candidate.category === "unit-component" && candidate.selected).map((candidate) => candidate.tool),
      localCommands: localCommands.filter((command) => /test/.test(command) && !/integration|e2e/.test(command)),
      ciCommands: localCommands.filter((command) => /test/.test(command) && !/integration|e2e/.test(command)),
      coverageIntent: ["business logic", "component behavior", "CLI argument and exit-code paths"]
    },
    {
      name: "integration-contract",
      selected: profile.surfaces.includes("service") || profile.surfaces.includes("container"),
      status: profile.surfaces.includes("service") ? "partial" : "skipped",
      rationale: "Integration and contract coverage is valuable when services or containers have dependency boundaries.",
      selectedTools: toolResearch.candidates.filter((candidate) => candidate.category === "integration-contract" && candidate.selected).map((candidate) => candidate.tool),
      localCommands: localCommands.filter((command) => /integration/.test(command)),
      ciCommands: localCommands.filter((command) => /integration/.test(command)),
      coverageIntent: ["service boundaries", "dependency integration", "API or contract drift"]
    },
    {
      name: "e2e-system",
      selected: profile.surfaces.some((surface) => ["web-app", "ios-app", "android-app"].includes(surface)),
      status: profile.surfaces.includes("web-app") ? "partial" : "skipped",
      rationale: "System flows should cover representative user journeys for interactive products.",
      selectedTools: toolResearch.candidates.filter((candidate) => candidate.category === "e2e-system" && candidate.selected).map((candidate) => candidate.tool),
      localCommands: localCommands.filter((command) => /e2e/.test(command)),
      ciCommands: localCommands.filter((command) => /e2e/.test(command)),
      coverageIntent: ["critical user journeys", "auth or session flows", "release-time regressions"]
    },
    {
      name: "packaging-smoke",
      selected: true,
      status: profile.surfaces.includes("container") || profile.surfaces.includes("cli-binary") ? "partial" : "ready",
      rationale: "Packaging and runtime smoke checks ensure the produced artifact can actually boot or run.",
      selectedTools: toolResearch.candidates.filter((candidate) => candidate.category === "packaging-smoke" && candidate.selected).map((candidate) => candidate.tool),
      localCommands: localCommands.filter((command) => /build/.test(command)),
      ciCommands: localCommands.filter((command) => /build/.test(command)),
      coverageIntent: ["build artifact readiness", "runtime smoke", "container image structure where relevant"]
    }
  ];

  return {
    status: localCommands.length > 0 ? "ready" : "partial",
    outcomeCategory: localCommands.length > 0 ? "ready" : "partial",
    summary: `Validation planning selected ${layers.filter((layer) => layer.selected).length} pyramid layers.`,
    profileSummary: `Surfaces: ${profile.surfaces.join(", ") || "unknown"}; build systems: ${profile.buildSystems.join(", ") || "unknown"}; workspace targets: ${profile.workspaceTargets.length}.`,
    layers,
    selectedSpecialists: selectedSpecialists.filter((entry) => entry.selected).map((entry) => ({
      name: entry.name,
      disposition: "accepted",
      reason: entry.reason
    })),
    localValidation: {
      commands: localCommands,
      prerequisites: profile.runnerConstraints,
      notes: localCommands.length > 0 ? [] : ["No deterministic local validation commands were inferred from the repo."]
    },
    ciValidation: {
      workflowFiles: profile.workflowFiles,
      jobs: ciJobs,
      notes: profile.workflowFiles.length > 0 ? [] : ["GitHub Actions workflow files are not present yet."]
    },
    coverage: {
      confidence: localCommands.length > 0 && profile.limitations.length === 0 ? "medium" : "low",
      summary: "Coverage is summarized by layer, with emphasis on representative risk reduction rather than one percentage.",
      signals: [
        "repo profile completed",
        "tool families selected",
        "pyramid layers planned",
        ...(profile.workspaceTargets.length > 1 ? [`workspace inventory recorded for ${profile.workspaceTargets.length} targets`] : [])
      ],
      gaps: localCommands.length > 0 ? [] : ["No runnable local validation commands were inferred."]
    },
    recommendedChanges: [],
    unsupported: profile.limitations,
    pyramidMarkdown: "# Test Pyramid\n\nPlanned validation layers will be synthesized by the validation lead.\n",
    reportMarkdown: "# Validation Summary\n\nValidation planning completed.\n",
    githubActionsPlanMarkdown: "# GitHub Actions Validation Plan\n\nValidation lead will refine CI job design.\n"
  };
}

function buildValidationCapabilityRecord(options: {
  config: CstackConfig;
  repoProfile: ValidationRepoProfile;
  toolResearch: ValidationToolResearch;
}): CapabilityUsageRecord {
  const workflowPolicy = options.config.workflows.deliver.capabilities ?? {};
  const allowed = unique(workflowPolicy.allowed ?? []);
  const requested = unique([
    ...(workflowPolicy.defaultRequested ?? []),
    "shell",
    ...(options.repoProfile.workflowFiles.length > 0 ? ["github"] : []),
    ...(options.repoProfile.surfaces.includes("web-app") ? ["browser"] : [])
  ]);
  const downgraded: CapabilityUsageRecord["downgraded"] = [];
  const available: string[] = [];

  for (const capability of requested) {
    if (allowed.length > 0 && !allowed.includes(capability)) {
      downgraded.push({
        name: capability,
        reason: "not allowed by workflow capability policy"
      });
      continue;
    }
    if (capability === "browser" && !options.repoProfile.surfaces.includes("web-app")) {
      downgraded.push({
        name: capability,
        reason: "repo profile does not justify browser capability for this validation stage"
      });
      continue;
    }
    available.push(capability);
  }

  const toolNames = options.toolResearch.candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.tool);
  const used: string[] = [];

  return {
    workflow: "deliver",
    stage: "validation",
    allowed,
    requested,
    available,
    used,
    downgraded,
    notes: [
      `repo surfaces: ${options.repoProfile.surfaces.join(", ") || "unknown"}`,
      `selected tools: ${toolNames.join(", ") || "none"}`
    ]
  };
}

function inferUsedValidationCapabilities(options: {
  localValidationRecord: DeliverValidationLocalRecord;
  validationPlan: DeliverValidationPlan;
  availableCapabilities: string[];
  selectedToolNames: string[];
}): string[] {
  const used = new Set<string>();

  if (options.localValidationRecord.status !== "not-run" && options.localValidationRecord.results.length > 0) {
    used.add("shell");
  }

  const commandHints = options.localValidationRecord.results
    .flatMap((result) => [result.command])
    .concat(options.validationPlan.localValidation.commands)
    .map((command) => command.toLowerCase());

  for (const command of commandHints) {
    if (/playwright|cypress|detox|maestro|puppeteer|selenium|e2e|browser/.test(command)) {
      used.add("browser");
      break;
    }
    if (!options.selectedToolNames.includes("playwright") && !options.selectedToolNames.includes("cypress") && /e2e|browser/.test(command)) {
      used.add("browser");
      break;
    }
  }

  if (options.validationPlan.ciValidation.jobs.length > 0 && options.localValidationRecord.status !== "not-run") {
    used.add("github");
  }

  return [...used].filter((capability) => options.availableCapabilities.includes(capability));
}

async function runCommandSet(cwd: string, runDir: string, commands: string[]): Promise<DeliverValidationLocalRecord> {
  if (commands.length === 0) {
    return {
      status: "not-run",
      requestedCommands: [],
      results: [],
      notes: "No local validation commands were selected."
    };
  }

  const commandDir = path.join(runDir, "artifacts", "validation");
  await fs.mkdir(commandDir, { recursive: true });
  const shell = process.env.SHELL || "/bin/sh";
  const results: ValidationCommandRecord[] = [];

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    const stdoutPath = path.join(commandDir, `${index + 1}.stdout.log`);
    const stderrPath = path.join(commandDir, `${index + 1}.stderr.log`);
    const startedAt = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync(shell, ["-lc", command], { cwd, maxBuffer: 10 * 1024 * 1024 });
      await fs.writeFile(stdoutPath, stdout, "utf8");
      await fs.writeFile(stderrPath, stderr, "utf8");
      results.push({
        command,
        exitCode: 0,
        status: "passed",
        durationMs: Date.now() - startedAt,
        stdoutPath,
        stderrPath
      });
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
      await fs.writeFile(stdoutPath, execError.stdout ?? "", "utf8");
      await fs.writeFile(stderrPath, execError.stderr ?? execError.message, "utf8");
      const blocker = classifyExecutionBlocker(command, `${execError.stderr ?? ""}\n${execError.stdout ?? ""}\n${execError.message ?? ""}`);
      results.push({
        command,
        exitCode: typeof execError.code === "number" ? execError.code : 1,
        status: "failed",
        durationMs: Date.now() - startedAt,
        stdoutPath,
        stderrPath,
        ...(blocker?.category ? { blockerCategory: blocker.category } : {}),
        ...(blocker?.detail ? { blockerDetail: blocker.detail } : {})
      });
    }
  }

  return {
    status: results.every((entry) => entry.status === "passed") ? "passed" : "failed",
    requestedCommands: commands,
    results,
    blockerCategories: uniqueBlockerCategories(results.map((result) => result.blockerCategory))
  };
}

async function runValidationSpecialist(options: {
  cwd: string;
  runId: string;
  stageDir: string;
  input: string;
  specialist: { name: SpecialistName; reason: string; selected: boolean };
  config: CstackConfig;
  repoProfile: ValidationRepoProfile;
  toolResearch: ValidationToolResearch;
  buildSummary: string;
  buildVerificationRecord: BuildVerificationRecord;
}): Promise<{ execution: SpecialistExecution; finalBody: string }> {
  const delegateDir = path.join(options.stageDir, "delegates", options.specialist.name);
  await fs.mkdir(path.join(delegateDir, "artifacts"), { recursive: true });

  const requestPath = path.join(delegateDir, "request.md");
  const promptPath = path.join(delegateDir, "prompt.md");
  const contextPath = path.join(delegateDir, "context.md");
  const finalPath = path.join(delegateDir, "final.md");
  const eventsPath = path.join(delegateDir, "events.jsonl");
  const stdoutPath = path.join(delegateDir, "stdout.log");
  const stderrPath = path.join(delegateDir, "stderr.log");
  const artifactPath = path.join(delegateDir, "artifacts", `${options.specialist.name}.md`);

  await fs.writeFile(
    requestPath,
    [`# ${options.specialist.name}`, "", `Reason: ${options.specialist.reason}`, "", `Validation request: ${options.input}`].join("\n"),
    "utf8"
  );

  const { prompt, context } = await buildDeliverValidationSpecialistPrompt({
    cwd: options.cwd,
    input: options.input,
    name: options.specialist.name,
    reason: options.specialist.reason,
    repoProfile: options.repoProfile,
    toolResearch: options.toolResearch,
    buildSummary: options.buildSummary,
    buildVerificationRecord: options.buildVerificationRecord
  });

  await fs.writeFile(promptPath, prompt, "utf8");
  await fs.writeFile(contextPath, `${context}\n`, "utf8");

  try {
    const result = await runCodexExec({
      cwd: options.cwd,
      workflow: "deliver",
      runId: `${options.runId}-${options.specialist.name}`,
      prompt,
      finalPath,
      eventsPath,
      stdoutPath,
      stderrPath,
      config: options.config
    });
    const finalBody = await readCodexFinalOutput({
      context: `Validation specialist ${options.specialist.name}`,
      finalPath,
      stdoutPath,
      stderrPath,
      result
    });
    await fs.writeFile(artifactPath, finalBody, "utf8");
    return {
      execution: {
        name: options.specialist.name,
        reason: options.specialist.reason,
        status: result.code === 0 ? "completed" : "failed",
        disposition: result.code === 0 ? "accepted" : "discarded",
        specialistDir: delegateDir,
        artifactPath,
        notes: result.code === 0 ? "Accepted provisionally until the validation lead synthesizes the final plan." : `Exited with code ${result.code}.`
      },
      finalBody
    };
  } catch (error) {
    return {
      execution: {
        name: options.specialist.name,
        reason: options.specialist.reason,
        status: "failed",
        disposition: "discarded",
        specialistDir: delegateDir,
        notes: error instanceof Error ? error.message : String(error)
      },
      finalBody: ""
    };
  }
}

function renderCoverageGapsMarkdown(plan: DeliverValidationPlan, localValidationRecord: DeliverValidationLocalRecord): string {
  return [
    "# Coverage Gaps",
    "",
    `Outcome category: ${plan.outcomeCategory}`,
    "",
    ...(plan.coverage.gaps.length > 0 ? plan.coverage.gaps.map((gap) => `- ${gap}`) : ["- none recorded"]),
    "",
    `Local validation status: ${localValidationRecord.status}`,
    ...(localValidationRecord.blockerCategories?.length ? [`Local blockers: ${localValidationRecord.blockerCategories.join(", ")}`] : [])
  ].join("\n") + "\n";
}

function deriveValidationOutcomeCategory(
  plan: Pick<DeliverValidationPlan, "status" | "coverage" | "localValidation" | "unsupported">,
  localValidationRecord: DeliverValidationLocalRecord
): DeliverValidationPlan["outcomeCategory"] {
  if (localValidationRecord.status === "failed" || (localValidationRecord.blockerCategories?.length ?? 0) > 0) {
    return "blocked-by-validation";
  }
  if (plan.status === "ready") {
    return "ready";
  }
  if (plan.status === "blocked") {
    return "blocked-by-validation";
  }
  return "partial";
}

function buildCoverageSummary(plan: DeliverValidationPlan, localValidationRecord: DeliverValidationLocalRecord): ValidationCoverageSummary {
  return {
    status: plan.status,
    outcomeCategory: plan.outcomeCategory,
    confidence: plan.coverage.confidence,
    summary:
      plan.outcomeCategory === "blocked-by-validation"
        ? `Validation commands or validation-specific blockers prevented a ready result. ${plan.coverage.summary}`
        : plan.coverage.summary,
    signals: [
      ...plan.coverage.signals,
      `${plan.layers.filter((layer) => layer.selected).length} validation layer(s) selected`,
      `${plan.localValidation.commands.length} local validation command(s) planned`,
      `${plan.ciValidation.jobs.length} CI validation job(s) planned`,
      ...(localValidationRecord.status === "passed" ? ["selected local validation commands passed"] : []),
      ...(localValidationRecord.status === "failed" ? ["one or more selected local validation commands failed"] : []),
      ...(localValidationRecord.blockerCategories?.map((blocker) => `local validation blocker: ${blocker}`) ?? [])
    ],
    gaps: [
      ...plan.coverage.gaps,
      ...(localValidationRecord.status === "failed" ? ["Local validation command execution failed."] : []),
      ...(localValidationRecord.blockerCategories?.map((blocker) => `Local validation blocked by ${blocker}.`) ?? []),
      ...plan.unsupported
    ],
    localValidationStatus: localValidationRecord.status
  };
}

function finalizeValidationPlanStatus(plan: DeliverValidationPlan, localValidationRecord: DeliverValidationLocalRecord): DeliverValidationPlan["status"] {
  if (localValidationRecord.status === "failed") {
    return "blocked";
  }
  if (plan.unsupported.length > 0 || plan.coverage.gaps.length > 0) {
    return plan.localValidation.commands.length > 0 ? "partial" : "blocked";
  }
  return plan.localValidation.commands.length > 0 ? "ready" : plan.status;
}

export async function runDeliverValidationExecution(options: DeliverValidationExecutionOptions): Promise<DeliverValidationExecutionResult> {
  await fs.mkdir(path.join(options.paths.stageDir, "artifacts"), { recursive: true });
  await fs.writeFile(options.paths.stdoutPath, "", "utf8");
  await fs.writeFile(options.paths.stderrPath, "", "utf8");
  await fs.writeFile(options.paths.eventsPath, "", "utf8");

  const repoProfile = await profileValidationRepository(options.cwd);
  const toolResearch = buildValidationToolResearch(repoProfile);
  const capabilityRecord = buildValidationCapabilityRecord({
    config: options.config,
    repoProfile,
    toolResearch
  });
  const selectedSpecialists = selectValidationSpecialists(repoProfile, options.input);
  const initialPlan = buildInitialValidationPlan(repoProfile, toolResearch, options.buildVerificationRecord, selectedSpecialists);

  await writeJson(options.paths.repoProfilePath, repoProfile);
  await writeJson(options.paths.toolResearchPath, toolResearch);
  await writeJson(options.paths.testInventoryPath, {
    existingTests: repoProfile.existingTests,
    packageScripts: repoProfile.packageScripts
  });

  const specialistExecutions: SpecialistExecution[] = [];
  const specialistOutputs: Array<{ name: SpecialistName; reason: string; finalBody: string }> = [];
  for (const specialist of selectedSpecialists.filter((entry) => entry.selected)) {
    const result = await runValidationSpecialist({
      cwd: options.cwd,
      runId: options.runId,
      stageDir: options.paths.stageDir,
      input: options.input,
      specialist,
      config: options.config,
      repoProfile,
      toolResearch,
      buildSummary: options.buildSummary,
      buildVerificationRecord: options.buildVerificationRecord
    });
    specialistExecutions.push(result.execution);
    specialistOutputs.push({
      name: specialist.name,
      reason: specialist.reason,
      finalBody: result.finalBody
    });
  }

  const leadPrompt = await buildDeliverValidationLeadPrompt({
    cwd: options.cwd,
    input: options.input,
    repoProfile,
    toolResearch,
    initialPlan,
    buildSummary: options.buildSummary,
    buildVerificationRecord: options.buildVerificationRecord,
    specialistResults: specialistOutputs
  });
  await fs.writeFile(options.paths.promptPath, leadPrompt.prompt, "utf8");
  await fs.writeFile(options.paths.contextPath, `${leadPrompt.context}\n`, "utf8");

  const result = await runCodexExec({
    cwd: options.cwd,
    workflow: "deliver",
    runId: `${options.runId}-validation`,
    prompt: leadPrompt.prompt,
    finalPath: options.paths.finalPath,
    eventsPath: options.paths.eventsPath,
    stdoutPath: options.paths.stdoutPath,
    stderrPath: options.paths.stderrPath,
    config: options.config
  });

  const finalBody = await readCodexFinalOutput({
    context: "Validation lead",
    finalPath: options.paths.finalPath,
    stdoutPath: options.paths.stdoutPath,
    stderrPath: options.paths.stderrPath,
    result
  });
  const validationPlan = parseJson<DeliverValidationPlan>(finalBody, "Validation lead");
  const acceptedByName = new Map(validationPlan.selectedSpecialists.map((entry) => [entry.name, entry]));
  for (let index = 0; index < specialistExecutions.length; index += 1) {
    const execution = specialistExecutions[index]!;
    const accepted = acceptedByName.get(execution.name);
    specialistExecutions[index] = accepted
      ? {
          ...execution,
          disposition: accepted.disposition as SpecialistDisposition,
          notes: accepted.reason
        }
      : {
          ...execution,
          disposition: "discarded",
          notes: execution.notes ?? "The validation lead did not rely on this specialist output."
        };
  }

  const localValidationRecord: DeliverValidationLocalRecord =
    result.code === 0
      ? await runCommandSet(options.cwd, options.paths.stageDir, validationPlan.localValidation.commands)
      : {
          status: "not-run",
          requestedCommands: validationPlan.localValidation.commands,
          results: [],
          notes: "Local validation commands were skipped because the validation lead did not complete successfully."
        };
  const normalizedPlan: DeliverValidationPlan = {
    ...validationPlan,
    status: finalizeValidationPlanStatus(validationPlan, localValidationRecord),
    outcomeCategory: deriveValidationOutcomeCategory(validationPlan, localValidationRecord),
    selectedSpecialists: validationPlan.selectedSpecialists.map((entry) => ({
      ...entry,
      disposition: acceptedByName.get(entry.name)?.disposition ?? entry.disposition
    })),
    coverage: {
      ...validationPlan.coverage,
      gaps: [
        ...validationPlan.coverage.gaps,
        ...(localValidationRecord.status === "failed" ? ["One or more selected validation commands failed."] : []),
        ...(localValidationRecord.blockerCategories?.map((blocker) => `Validation blocked by ${blocker}.`) ?? [])
      ]
    }
  };
  const selectedToolNames = toolResearch.candidates
    .filter((candidate) => candidate.selected)
    .map((candidate) => candidate.tool);
  const observedCapabilities = inferUsedValidationCapabilities({
    localValidationRecord,
    validationPlan: normalizedPlan,
    availableCapabilities: capabilityRecord.available,
    selectedToolNames
  });
  const capabilityArtifact: CapabilityUsageRecord = {
    ...capabilityRecord,
    used: observedCapabilities,
    notes: [
      ...(capabilityRecord.notes ?? []),
      "used capabilities are derived from executed local validation commands and observed CI validation job coverage."
    ]
  };
  const coverageSummary = buildCoverageSummary(normalizedPlan, localValidationRecord);

  await writeJson(path.join(options.paths.stageDir, "artifacts", "capabilities.json"), capabilityArtifact);
  await writeJson(options.paths.validationPlanPath, normalizedPlan);
  await fs.writeFile(options.paths.testPyramidPath, normalizedPlan.pyramidMarkdown, "utf8");
  await writeJson(options.paths.coverageSummaryPath, coverageSummary);
  await fs.writeFile(options.paths.coverageGapsPath, renderCoverageGapsMarkdown(normalizedPlan, localValidationRecord), "utf8");
  await writeJson(options.paths.localValidationPath, localValidationRecord);
  await writeJson(options.paths.ciValidationPath, normalizedPlan.ciValidation);
  await fs.writeFile(options.paths.githubActionsPlanPath, normalizedPlan.githubActionsPlanMarkdown, "utf8");

  return {
    repoProfile,
    toolResearch,
    validationPlan: normalizedPlan,
    localValidationRecord,
    coverageSummary,
    selectedSpecialists,
    specialistExecutions,
    finalBody
  };
}
