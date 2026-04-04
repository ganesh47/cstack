import type { EnvironmentBlockerCategory } from "./types.js";

export interface ExecutionBlockerClassification {
  category: EnvironmentBlockerCategory;
  detail: string;
}

function normalize(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function firstUsefulLine(input: string): string {
  return (
    input
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !/^session id:/i.test(line)) ?? "Command failed without a diagnostic line."
  );
}

function commandLooksLikeRepoCheck(command: string): boolean {
  return /\b(test|pytest|vitest|jest|mvn test|gradle test|cargo test|ruff|mypy|eslint|tsc|typecheck|lint|check)\b/i.test(command);
}

export function classifyExecutionBlocker(command: string, output: string): ExecutionBlockerClassification | null {
  const detail = firstUsefulLine(output);
  const normalized = normalize(output);
  if (!normalized) {
    return null;
  }

  if (
    /\b(command not found|no such file or directory|not recognized as an internal or external command|cannot find (?:the )?(?:file|module|executable)|executable file not found)\b/i.test(
      normalized
    )
  ) {
    return { category: "host-tool-missing", detail };
  }

  if (
    /\b(no valid Docker environment|docker daemon|could not connect to the Docker daemon|permission denied while trying to connect to the Docker daemon|error while loading shared libraries: libdocker|docker: cannot connect to the Docker daemon)\b/i.test(
      normalized
    )
  ) {
    return { category: "host-tool-missing", detail };
  }

  if (
    /\b(permission denied|operation not permitted|read-only file system|eacces|eperm|sandbox(?:ing)? .*denied|cannot write|failed to create|failed to open)\b/i.test(
      normalized
    ) &&
    /\b(file|directory|path|workspace|artifact|output|write|open|mkdir|mkdtemp|rename|unlink|chmod|touch|access)\b/i.test(normalized)
  ) {
    return { category: "permission-blocked", detail };
  }

  if (
    /\b(java version|unsupported major.minor|unsupported release|unsupported class file major version|no suitable java|python .* not found)\b/i.test(normalized)
  ) {
    return { category: "toolchain-mismatch", detail };
  }

  if (
    /\bbetter-sqlite3\b/i.test(normalized) &&
    /\b(could not locate the bindings file|compiled against a different node\.js version|node_module_version|module did not self-register|invalid elf header|cannot open shared object file)\b/i.test(
      normalized
    )
  ) {
    return { category: "toolchain-mismatch", detail };
  }

  if (
    /\b(unsupportedclassversionerror|release version .* not supported|source option \d+ is no longer supported|target option \d+ is no longer supported|requires node >=|engine .* unsupported|requires python|java_home|python \d+\.\d+ not found|version mismatch|unsupported runtime)\b/i.test(
      normalized
    )
  ) {
    return { category: "toolchain-mismatch", detail };
  }

  if (
    /\b(registry|npmjs\.org|pypi|repo\.maven|repo1\.maven|maven central|artifactory|package index|simple index|crates\.io)\b/i.test(normalized) &&
    /\b(enotfound|eai_again|econrefused|econnreset|network is unreachable|could not resolve|temporary failure|service unavailable|timed? out|tls|ssl)\b/i.test(
      normalized
    )
  ) {
    return { category: "registry-unreachable", detail };
  }

  if (
    /\b(enotfound|eai_again|econrefused|econnreset|network is unreachable|failed to lookup address information|could not resolve host|temporary failure in name resolution|timed? out|tls handshake timeout)\b/i.test(
      normalized
    )
  ) {
    return { category: "network-blocked", detail };
  }

  if (commandLooksLikeRepoCheck(command)) {
    return { category: "repo-test-failure", detail };
  }

  return null;
}

export function uniqueBlockerCategories(
  categories: Array<EnvironmentBlockerCategory | undefined>
): EnvironmentBlockerCategory[] {
  return [...new Set(categories.filter((value): value is EnvironmentBlockerCategory => Boolean(value)))];
}
