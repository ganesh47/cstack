import os from "node:os";
import path from "node:path";
import { constants as fsConstants, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { buildEvent, ProgressReporter } from "./progress.js";
import { CSTACK_REPOSITORY, readCurrentVersion } from "./version.js";

const execFileAsync = promisify(execFile);
const UPDATE_AVAILABLE_EXIT_CODE = 20;

export interface UpdateOptions {
  check: boolean;
  dryRun: boolean;
  yes: boolean;
  version?: string;
  channel?: string;
  verbose: boolean;
}

export interface UpdateDependencies {
  fetchImpl?: typeof fetch;
  currentVersion?: string;
  executablePath?: string;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
  npmBin?: string;
  ghBin?: string;
  repository?: string;
  apiBaseUrl?: string;
  execCommand?: (file: string, args: string[], options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>;
  confirmPrompt?: (message: string) => Promise<boolean>;
}

export interface UpdateResult {
  status: "updated" | "already-current" | "available" | "dry-run";
  currentVersion: string;
  targetVersion: string;
  releaseTag: string;
  manualCommand: string;
  releaseUrl: string;
  exitCode: number;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubReleasePayload {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubReleaseAsset[];
}

interface ReleaseInfo {
  tagName: string;
  version: string;
  htmlUrl: string;
  assets: GitHubReleaseAsset[];
}

interface InstallContext {
  executablePath: string | null;
  packageRoot: string | null;
  sourceCheckout: boolean;
  npmPrefix: string | null;
  prefixWritable: boolean;
}

export class UpdateCommandError extends Error {
  exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "UpdateCommandError";
    this.exitCode = exitCode;
  }
}

function normalizeVersion(version: string): string {
  return version.replace(/^v/, "");
}

function validateChannel(channel: string | undefined): string {
  const resolved = channel ?? "stable";
  if (resolved !== "stable") {
    throw new UpdateCommandError(`Unsupported update channel: ${resolved}. Only 'stable' is supported.`);
  }
  return resolved;
}

function validateVersion(version: string | undefined): string | undefined {
  if (!version) {
    return undefined;
  }
  const normalized = normalizeVersion(version);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new UpdateCommandError(`Invalid version: ${version}`);
  }
  return normalized;
}

function compareVersions(left: string, right: string): number {
  const parse = (input: string): { numbers: number[]; prerelease: string | null } => {
    const parts = normalizeVersion(input).split("-", 2);
    const core = parts[0] ?? "0.0.0";
    const prerelease = parts[1] ?? null;
    const numbers = core.split(".").map((value) => Number.parseInt(value, 10));
    return { numbers, prerelease };
  };

  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index += 1) {
    const delta = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (delta !== 0) {
      return delta < 0 ? -1 : 1;
    }
  }

  if (a.prerelease === b.prerelease) {
    return 0;
  }
  if (a.prerelease === null) {
    return 1;
  }
  if (b.prerelease === null) {
    return -1;
  }
  return a.prerelease.localeCompare(b.prerelease);
}

function createManualCommand(repository: string, version: string): string {
  return `npm install -g "https://github.com/${repository}/releases/download/v${version}/cstack-${version}.tgz"`;
}

function createReporter(deps: UpdateDependencies, target: string): ProgressReporter {
  return new ProgressReporter("update", target, deps.stdout ?? process.stdout);
}

async function defaultExecCommand(file: string, args: string[], options?: { cwd?: string }): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, args, {
    cwd: options?.cwd,
    maxBuffer: 1024 * 1024
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function defaultConfirmPrompt(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function isInteractive(deps: UpdateDependencies): boolean {
  return Boolean((deps.stdout ?? process.stdout).isTTY && process.stdin.isTTY);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isWritable(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function detectInstallContext(cwd: string, deps: UpdateDependencies): Promise<InstallContext> {
  const executablePath = deps.executablePath ?? process.argv[1] ?? null;
  const resolvedExecutable = executablePath ? await fs.realpath(executablePath).catch(() => path.resolve(executablePath)) : null;
  const packageRoot = resolvedExecutable ? path.dirname(path.dirname(resolvedExecutable)) : null;
  const sourceCheckout = packageRoot
    ? (await pathExists(path.join(packageRoot, ".git"))) && (await pathExists(path.join(packageRoot, "src", "cli.ts")))
    : false;

  const execCommand = deps.execCommand ?? defaultExecCommand;
  const npmBin = deps.npmBin ?? "npm";
  let npmPrefix: string | null = null;
  let prefixWritable = false;

  try {
    const { stdout } = await execCommand(npmBin, ["prefix", "-g"], { cwd });
    npmPrefix = stdout.trim() || null;
    prefixWritable = npmPrefix ? await isWritable(npmPrefix) : false;
  } catch {
    npmPrefix = null;
    prefixWritable = false;
  }

  return {
    executablePath: resolvedExecutable,
    packageRoot,
    sourceCheckout,
    npmPrefix,
    prefixWritable
  };
}

async function fetchReleasePayload(pathname: string, deps: UpdateDependencies): Promise<GitHubReleasePayload> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const apiBaseUrl = deps.apiBaseUrl ?? "https://api.github.com";
  const repository = deps.repository ?? CSTACK_REPOSITORY;
  const url = `${apiBaseUrl.replace(/\/$/, "")}/repos/${repository}${pathname}`;

  const attemptHttp = async (): Promise<GitHubReleasePayload> => {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "cstack-update"
      }
    });
    if (!response.ok) {
      throw new Error(`GitHub API request failed with ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as GitHubReleasePayload;
  };

  try {
    return await attemptHttp();
  } catch (error) {
    const execCommand = deps.execCommand ?? defaultExecCommand;
    const ghBin = deps.ghBin ?? "gh";
    try {
      const { stdout } = await execCommand(ghBin, ["api", `repos/${repository}${pathname}`]);
      return JSON.parse(stdout) as GitHubReleasePayload;
    } catch {
      throw new UpdateCommandError(
        `Unable to reach GitHub release metadata for ${repository}. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

async function resolveRelease(deps: UpdateDependencies, version?: string): Promise<ReleaseInfo> {
  const payload = await fetchReleasePayload(version ? `/releases/tags/v${version}` : "/releases/latest", deps);
  if (payload.draft || payload.prerelease) {
    throw new UpdateCommandError(`Release ${payload.tag_name} is not a stable public release.`);
  }

  const normalizedVersion = normalizeVersion(payload.tag_name);
  return {
    tagName: payload.tag_name,
    version: normalizedVersion,
    htmlUrl: payload.html_url,
    assets: payload.assets
  };
}

function getRequiredAsset(release: ReleaseInfo, name: string): GitHubReleaseAsset {
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset) {
    throw new UpdateCommandError(`Release ${release.tagName} is missing required asset: ${name}`);
  }
  return asset;
}

async function downloadFile(url: string, destinationPath: string, deps: UpdateDependencies): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "cstack-update"
    }
  });
  if (!response.ok) {
    throw new UpdateCommandError(`Download failed for ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(destinationPath, Buffer.from(arrayBuffer));
}

async function sha256File(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

function parseChecksumFile(body: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match?.[1] || !match[2]) {
      continue;
    }
    checksums.set(match[2].trim(), match[1].toLowerCase());
  }
  return checksums;
}

async function verifyTarballChecksum(tarballPath: string, checksumPath: string, tarballName: string): Promise<void> {
  const checksumBody = await fs.readFile(checksumPath, "utf8");
  const entries = parseChecksumFile(checksumBody);
  const expected = entries.get(tarballName);
  if (!expected) {
    throw new UpdateCommandError(`SHA256SUMS.txt does not contain an entry for ${tarballName}`);
  }

  const actual = await sha256File(tarballPath);
  if (actual !== expected) {
    throw new UpdateCommandError(`Checksum mismatch for ${tarballName}`);
  }
}

function parseUpdateArgs(args: string[]): UpdateOptions {
  const options: UpdateOptions = {
    check: false,
    dryRun: false,
    yes: false,
    verbose: false,
    channel: "stable"
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--check":
        options.check = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--yes":
      case "-y":
        options.yes = true;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--version":
        {
          const nextValue = args[index + 1];
          if (!nextValue) {
            throw new UpdateCommandError("`cstack update --version` requires a version value.");
          }
          options.version = nextValue;
          index += 1;
          break;
        }
      case "--channel":
        {
          const nextValue = args[index + 1];
          if (!nextValue) {
            throw new UpdateCommandError("`cstack update --channel` requires a channel value.");
          }
          options.channel = nextValue;
          index += 1;
          break;
        }
      default:
        throw new UpdateCommandError(`Unknown update option: ${arg}`);
    }
  }

  const validatedChannel = validateChannel(options.channel);
  options.channel = validatedChannel;
  const validatedVersion = validateVersion(options.version);
  if (validatedVersion) {
    options.version = validatedVersion;
  } else {
    delete options.version;
  }
  return options;
}

export function parseUpdateCommandArgs(args: string[]): UpdateOptions {
  return parseUpdateArgs(args);
}

export async function runUpdate(cwd: string, options: UpdateOptions, deps: UpdateDependencies = {}): Promise<UpdateResult> {
  const currentVersion = deps.currentVersion ?? (await readCurrentVersion());
  const repository = deps.repository ?? CSTACK_REPOSITORY;
  const release = await resolveRelease(deps, options.version);
  const reporter = createReporter(deps, options.version ? `v${release.version}` : "self-update");
  const startedAt = Date.now();
  const emit = (type: "starting" | "activity" | "heartbeat" | "completed" | "failed", message: string) =>
    reporter.emit(buildEvent(type, Date.now() - startedAt, message));
  const manualCommand = createManualCommand(repository, release.version);
  const comparison = compareVersions(currentVersion, release.version);
  const execCommand = deps.execCommand ?? defaultExecCommand;
  const npmBin = deps.npmBin ?? "npm";
  const confirmPrompt = deps.confirmPrompt ?? defaultConfirmPrompt;
  const stderr = deps.stderr ?? process.stderr;
  const stdout = deps.stdout ?? process.stdout;

  try {
    emit("starting", `Checking GitHub release ${release.tagName}`);

    if (options.verbose) {
      stdout.write(`Current version: ${currentVersion}\n`);
      stdout.write(`Target release: ${release.tagName}\n`);
      stdout.write(`Release URL: ${release.htmlUrl}\n`);
    }

    if (comparison === 0 || (!options.version && comparison > 0)) {
      emit("completed", `Already current at v${currentVersion}`);
      stdout.write(`cstack is already current at v${currentVersion}.\n`);
      return {
        status: "already-current",
        currentVersion,
        targetVersion: release.version,
        releaseTag: release.tagName,
        manualCommand,
        releaseUrl: release.htmlUrl,
        exitCode: 0
      };
    }

    const action = comparison > 0 ? "downgrade" : "update";
    if (options.check) {
      emit("completed", `${action === "downgrade" ? "Selected" : "Update available"}: v${currentVersion} -> v${release.version}`);
      stdout.write(`Current: v${currentVersion}\nTarget:  v${release.version}\n`);
      stdout.write(`Run \`cstack update --yes${options.version ? ` --version ${release.version}` : ""}\` to apply it.\n`);
      return {
        status: "available",
        currentVersion,
        targetVersion: release.version,
        releaseTag: release.tagName,
        manualCommand,
        releaseUrl: release.htmlUrl,
        exitCode: UPDATE_AVAILABLE_EXIT_CODE
      };
    }

    const installContext = await detectInstallContext(cwd, deps);
    if (installContext.sourceCheckout) {
      throw new UpdateCommandError(
        [
          "This cstack invocation is running from a source checkout, so self-update is not supported.",
          `Install the published release manually instead:`,
          manualCommand
        ].join("\n")
      );
    }

    if (!installContext.npmPrefix) {
      throw new UpdateCommandError(
        [
          "Unable to detect the global npm prefix for this installation.",
          "Make sure `npm` is installed and on PATH, then run:",
          manualCommand
        ].join("\n")
      );
    }

    if (!installContext.prefixWritable) {
      throw new UpdateCommandError(
        [
          `Global npm prefix is not writable: ${installContext.npmPrefix}`,
          "Re-run with a writable npm prefix or install manually:",
          manualCommand
        ].join("\n")
      );
    }

    const interactive = isInteractive(deps);
    if (!options.yes && !options.dryRun) {
      if (!interactive) {
        emit("completed", `Update available: v${currentVersion} -> v${release.version}`);
        stdout.write(`Update available: v${currentVersion} -> v${release.version}\n`);
        stderr.write("Refusing to mutate a non-interactive session without `--yes`.\n");
        return {
          status: "available",
          currentVersion,
          targetVersion: release.version,
          releaseTag: release.tagName,
          manualCommand,
          releaseUrl: release.htmlUrl,
          exitCode: UPDATE_AVAILABLE_EXIT_CODE
        };
      }

      const confirmed = await confirmPrompt(`Update cstack from v${currentVersion} to v${release.version}?`);
      if (!confirmed) {
        emit("completed", "Update cancelled");
        stdout.write("Update cancelled.\n");
        return {
          status: "available",
          currentVersion,
          targetVersion: release.version,
          releaseTag: release.tagName,
          manualCommand,
          releaseUrl: release.htmlUrl,
          exitCode: UPDATE_AVAILABLE_EXIT_CODE
        };
      }
    }

    if (options.dryRun) {
      emit("completed", `Dry run ready: v${currentVersion} -> v${release.version}`);
      stdout.write(
        [
          `Dry run: ${action} cstack from v${currentVersion} to v${release.version}`,
          `Release: ${release.htmlUrl}`,
          `Manual fallback: ${manualCommand}`
        ].join("\n") + "\n"
      );
      return {
        status: "dry-run",
        currentVersion,
        targetVersion: release.version,
        releaseTag: release.tagName,
        manualCommand,
        releaseUrl: release.htmlUrl,
        exitCode: 0
      };
    }

    const tarballName = `cstack-${release.version}.tgz`;
    const tarballAsset = getRequiredAsset(release, tarballName);
    const checksumAsset = getRequiredAsset(release, "SHA256SUMS.txt");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-update-"));
    const tarballPath = path.join(tempDir, tarballName);
    const checksumPath = path.join(tempDir, "SHA256SUMS.txt");

    try {
      emit("activity", `Downloading ${tarballName}`);
      await downloadFile(tarballAsset.browser_download_url, tarballPath, deps);

      emit("activity", "Downloading SHA256SUMS.txt");
      await downloadFile(checksumAsset.browser_download_url, checksumPath, deps);

      emit("activity", `Verifying checksum for ${tarballName}`);
      await verifyTarballChecksum(tarballPath, checksumPath, tarballName);

      if (options.verbose) {
        stdout.write(`Using temp directory: ${tempDir}\n`);
        stdout.write(`Installing with: ${npmBin} install -g ${tarballPath}\n`);
      }

      emit("activity", "Installing verified release tarball");
      try {
        await execCommand(npmBin, ["install", "-g", tarballPath], { cwd });
      } catch (error) {
        throw new UpdateCommandError(
          [
            `Failed to install ${tarballName} with npm.`,
            error instanceof Error ? error.message : String(error),
            "Manual fallback:",
            manualCommand
          ].join("\n")
        );
      }

      emit("completed", `Installed v${release.version}`);
      stdout.write(`Updated cstack from v${currentVersion} to v${release.version}.\n`);
      return {
        status: "updated",
        currentVersion,
        targetVersion: release.version,
        releaseTag: release.tagName,
        manualCommand,
        releaseUrl: release.htmlUrl,
        exitCode: 0
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    emit("failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
