import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseUpdateCommandArgs, runUpdate } from "../src/update.js";

interface CaptureStream {
  isTTY?: boolean;
  columns?: number;
  writes: string[];
  write(chunk: string): boolean;
}

function makeStream(isTTY = false): CaptureStream {
  return {
    isTTY,
    columns: 100,
    writes: [],
    write(chunk: string) {
      this.writes.push(chunk);
      return true;
    }
  };
}

function makeFetch(latestVersion: string, tarballBytes = Buffer.from("fake tarball"), checksumOverride?: string): typeof fetch {
  const tarballName = `cstack-${latestVersion}.tgz`;
  const checksum = checksumOverride ?? createSha256(tarballBytes);
  const releaseBody = {
    tag_name: `v${latestVersion}`,
    html_url: `https://github.com/ganesh47/cstack/releases/tag/v${latestVersion}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: tarballName,
        browser_download_url: `https://downloads.test/${tarballName}`
      },
      {
        name: "SHA256SUMS.txt",
        browser_download_url: "https://downloads.test/SHA256SUMS.txt"
      }
    ]
  };

  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/releases/latest") || url.includes(`/releases/tags/v${latestVersion}`)) {
      return new Response(JSON.stringify(releaseBody), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    if (url.endsWith(tarballName)) {
      return new Response(tarballBytes, { status: 200 });
    }
    if (url.endsWith("SHA256SUMS.txt")) {
      return new Response(`${checksum}  ${tarballName}\n`, { status: 200 });
    }
    return new Response("not found", { status: 404, statusText: "Not Found" });
  }) as typeof fetch;
}

function createSha256(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

describe("update command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cstack-update-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("parses the supported update flags", () => {
    expect(
      parseUpdateCommandArgs(["--check", "--dry-run", "--yes", "--version", "0.4.0", "--channel", "stable", "--verbose"])
    ).toEqual({
      check: true,
      dryRun: true,
      yes: true,
      version: "0.4.0",
      channel: "stable",
      verbose: true
    });
  });

  it("reports when a newer release is available in check mode", async () => {
    const stdout = makeStream();

    const result = await runUpdate(
      tempDir,
      { check: true, dryRun: false, yes: false, verbose: false, channel: "stable" },
      {
        currentVersion: "0.3.0",
        fetchImpl: makeFetch("0.4.0"),
        stdout: stdout as unknown as NodeJS.WriteStream
      }
    );

    expect(result.status).toBe("available");
    expect(result.exitCode).toBe(20);
    expect(stdout.writes.join("")).toContain("Current: v0.3.0");
    expect(stdout.writes.join("")).toContain("Target:  v0.4.0");
  });

  it("applies a verified release tarball through npm", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    const prefixDir = path.join(tempDir, "npm-prefix");
    const installRoot = path.join(tempDir, "installed-package");
    const executablePath = path.join(installRoot, "bin", "cstack.js");
    const executed: Array<{ file: string; args: string[] }> = [];

    await fs.mkdir(path.dirname(executablePath), { recursive: true });
    await fs.writeFile(executablePath, "#!/usr/bin/env node\n", "utf8");
    await fs.mkdir(prefixDir, { recursive: true });

    const result = await runUpdate(
      tempDir,
      { check: false, dryRun: false, yes: true, verbose: true, channel: "stable" },
      {
        currentVersion: "0.3.0",
        fetchImpl: makeFetch("0.4.0"),
        stdout: stdout as unknown as NodeJS.WriteStream,
        stderr: stderr as unknown as NodeJS.WriteStream,
        executablePath,
        execCommand: async (file, args) => {
          executed.push({ file, args });
          if (args[0] === "prefix") {
            return { stdout: `${prefixDir}\n`, stderr: "" };
          }
          if (args[0] === "install") {
            expect(args[2]).toMatch(/cstack-0\.4\.0\.tgz$/);
            return { stdout: "installed\n", stderr: "" };
          }
          throw new Error(`Unexpected command: ${file} ${args.join(" ")}`);
        }
      }
    );

    expect(result.status).toBe("updated");
    expect(result.exitCode).toBe(0);
    expect(stdout.writes.join("")).toContain("Updated cstack from v0.3.0 to v0.4.0.");
    expect(executed.some((call) => call.args[0] === "prefix")).toBe(true);
    expect(executed.some((call) => call.args[0] === "install")).toBe(true);
  });

  it("refuses self-update from a source checkout", async () => {
    const repoRoot = path.join(tempDir, "repo");
    const executablePath = path.join(repoRoot, "bin", "cstack.js");
    const prefixDir = path.join(tempDir, "npm-prefix");

    await fs.mkdir(path.join(repoRoot, "bin"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, ".git"), "", "utf8");
    await fs.writeFile(path.join(repoRoot, "src", "cli.ts"), "", "utf8");
    await fs.writeFile(executablePath, "", "utf8");
    await fs.mkdir(prefixDir, { recursive: true });

    await expect(
      runUpdate(
        repoRoot,
        { check: false, dryRun: false, yes: true, verbose: false, channel: "stable" },
        {
          currentVersion: "0.3.0",
          fetchImpl: makeFetch("0.4.0"),
          executablePath,
          stdout: makeStream() as unknown as NodeJS.WriteStream,
          execCommand: async (_file, args) => {
            if (args[0] === "prefix") {
              return { stdout: `${prefixDir}\n`, stderr: "" };
            }
            throw new Error(`Unexpected command ${args.join(" ")}`);
          }
        }
      )
    ).rejects.toThrow(/source checkout/);
  });

  it("fails closed on checksum mismatch", async () => {
    const stdout = makeStream();
    const executablePath = path.join(tempDir, "installed", "bin", "cstack.js");
    const prefixDir = path.join(tempDir, "npm-prefix");
    let installCalled = false;

    await fs.mkdir(path.dirname(executablePath), { recursive: true });
    await fs.writeFile(executablePath, "", "utf8");
    await fs.mkdir(prefixDir, { recursive: true });

    await expect(
      runUpdate(
        tempDir,
        { check: false, dryRun: false, yes: true, verbose: false, channel: "stable" },
        {
          currentVersion: "0.3.0",
          fetchImpl: makeFetch("0.4.0", Buffer.from("actual"), "0".repeat(64)),
          executablePath,
          stdout: stdout as unknown as NodeJS.WriteStream,
          execCommand: async (_file, args) => {
            if (args[0] === "prefix") {
              return { stdout: `${prefixDir}\n`, stderr: "" };
            }
            if (args[0] === "install") {
              installCalled = true;
            }
            return { stdout: "", stderr: "" };
          }
        }
      )
    ).rejects.toThrow(/Checksum mismatch/);

    expect(installCalled).toBe(false);
  });

  it("refuses non-interactive mutation without --yes", async () => {
    const stdout = makeStream(false);
    const stderr = makeStream(false);
    const prefixDir = path.join(tempDir, "npm-prefix");
    const executablePath = path.join(tempDir, "installed", "bin", "cstack.js");

    await fs.mkdir(path.dirname(executablePath), { recursive: true });
    await fs.writeFile(executablePath, "", "utf8");
    await fs.mkdir(prefixDir, { recursive: true });

    const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false
    });
    try {
      const result = await runUpdate(
        tempDir,
        { check: false, dryRun: false, yes: false, verbose: false, channel: "stable" },
        {
          currentVersion: "0.3.0",
          fetchImpl: makeFetch("0.4.0"),
          executablePath,
          stdout: stdout as unknown as NodeJS.WriteStream,
          stderr: stderr as unknown as NodeJS.WriteStream,
          execCommand: async (_file, args) => {
            if (args[0] === "prefix") {
              return { stdout: `${prefixDir}\n`, stderr: "" };
            }
            throw new Error(`Unexpected command ${args.join(" ")}`);
          }
        }
      );

      expect(result.status).toBe("available");
      expect(result.exitCode).toBe(20);
      expect(stdout.writes.join("")).toContain("Update available: v0.3.0 -> v0.4.0");
      expect(stderr.writes.join("")).toContain("Refusing to mutate a non-interactive session without `--yes`.");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", originalDescriptor);
      } else {
        Object.defineProperty(process.stdin, "isTTY", {
          configurable: true,
          value: undefined
        });
      }
    }
  });

  it("suspends the dashboard while awaiting interactive confirmation and resumes afterward", async () => {
    process.env.TERM = "xterm-256color";
    const stdout = makeStream(true);
    const stderr = makeStream(true);
    const prefixDir = path.join(tempDir, "npm-prefix");
    const executablePath = path.join(tempDir, "installed", "bin", "cstack.js");
    const prompts: string[] = [];
    const executed: Array<{ file: string; args: string[] }> = [];

    await fs.mkdir(path.dirname(executablePath), { recursive: true });
    await fs.writeFile(executablePath, "", "utf8");
    await fs.mkdir(prefixDir, { recursive: true });

    const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true
    });
    try {
      const result = await runUpdate(
        tempDir,
        { check: false, dryRun: false, yes: false, verbose: false, channel: "stable" },
        {
          currentVersion: "0.17.1",
          fetchImpl: makeFetch("0.17.2"),
          executablePath,
          stdout: stdout as unknown as NodeJS.WriteStream,
          stderr: stderr as unknown as NodeJS.WriteStream,
          confirmPrompt: async (message) => {
            prompts.push(message);
            return true;
          },
          execCommand: async (file, args) => {
            executed.push({ file, args });
            if (args[0] === "prefix") {
              return { stdout: `${prefixDir}\n`, stderr: "" };
            }
            if (args[0] === "install") {
              return { stdout: "installed\n", stderr: "" };
            }
            throw new Error(`Unexpected command: ${file} ${args.join(" ")}`);
          }
        }
      );

      expect(result.status).toBe("updated");
      expect(prompts).toEqual(["Update cstack from v0.17.1 to v0.17.2?"]);
      expect(executed.some((call) => call.args[0] === "install")).toBe(true);
      const output = stdout.writes.join("");
      expect(output).toContain("Inspecting installation context");
      expect(output).toContain("Awaiting confirmation to update to v0.17.2");
      expect(output).toContain("Installing verified release tarball");
      expect(output).toContain("Updated cstack from v0.17.1 to v0.17.2.");
      expect(output).toContain("\u001B[?25h");
      expect(output).toContain("\u001B[?25l");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", originalDescriptor);
      } else {
        delete (process.stdin as { isTTY?: boolean }).isTTY;
      }
    }
  });
});
