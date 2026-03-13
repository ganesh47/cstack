# Spec: `cstack update`

## 1. **One-Line Thesis**

`cstack update` is a GitHub-release-aware self-update command that checks the latest stable release for this project, verifies its integrity locally, and installs the exact versioned tarball through `npm`.

## 2. **Product Decision**

`cstack update` is a self-update command for the installed `cstack` CLI.

It is not:

- a repo refresh command
- a prompt asset sync command
- a config migration tool
- a `.cstack/` scaffolding updater

MVP scope is deliberately narrow. The command updates the installed CLI package only.

## 3. **User Stories**

- As a user who installed `cstack` from GitHub Releases, I want one command that tells me whether I am current and updates me safely.
- As a user in a normal terminal, I want an explicit confirmation before global mutation.
- As a user in CI or another non-interactive shell, I want `cstack update` to avoid hidden mutation unless I opt in with `--yes`.
- As a user who cannot self-update, I want the command to tell me exactly why and print the manual install command.
- As a user who wants auditability, I want updates to install from an immutable versioned tarball after checksum verification.

## 4. **Command Surface**

| Command | Meaning |
| --- | --- |
| `cstack update` | Check the latest stable GitHub release and, in an interactive terminal, prompt before applying it |
| `cstack update --check` | Check only; do not mutate |
| `cstack update --dry-run` | Resolve the target release and print the plan without installing |
| `cstack update --yes` | Apply without prompting |
| `cstack update --version 0.3.0` | Install that exact stable release version, even if it is not the latest |
| `cstack update --channel stable` | Explicitly select the only supported channel in MVP |
| `cstack update --verbose` | Print extra operational details such as release URL and npm command |

## 5. **Default Behavior**

With no flags, `cstack update`:

1. reads the currently running `cstack` version
2. fetches the latest stable GitHub release for `ganesh47/cstack`
3. compares current versus latest
4. exits cleanly if already current
5. in an interactive terminal, prompts before applying the update
6. in a non-interactive session, refuses mutation unless `--yes` is present

## 6. **Release Discovery Model**

Source of truth:

- GitHub Releases API for `ganesh47/cstack`

Primary lookup paths:

- latest stable: `GET /repos/ganesh47/cstack/releases/latest`
- exact version: `GET /repos/ganesh47/cstack/releases/tags/v<version>`

Fallback:

- if direct API access fails, the command may fall back to `gh api` for the same endpoints

Rejected for MVP:

- scraping release HTML
- trusting the moving `cstack-latest.tgz` asset for the actual install target

## 7. **Current Install Detection**

Current version:

- read from the installed package’s `package.json` relative to the running `dist/` runtime

Install shape detection:

- resolve the running script path
- infer package root from `bin/cstack.js`
- treat the command as a source checkout when the inferred package root contains both `.git` and `src/cli.ts`

Self-update support in MVP:

- supported for installed package executions
- unsupported for direct source-checkout executions

## 8. **Update Execution Strategy**

MVP install path:

1. resolve the target GitHub release
2. select the immutable versioned tarball `cstack-<version>.tgz`
3. download that tarball plus `SHA256SUMS.txt` into a temp directory
4. verify the tarball’s SHA-256 against `SHA256SUMS.txt`
5. run `npm install -g <downloaded-tarball>`
6. clean up temp files

Why versioned tarball instead of `cstack-latest.tgz`:

- exact version is auditable
- checksum verification is clearer
- retry behavior is deterministic

## 9. **Integrity and Safety**

Checksum:

- required for every applied update
- failure to find or verify the checksum is a hard stop

Confirmation:

- interactive terminal: prompt by default
- `--yes`: skip prompt
- non-interactive session without `--yes`: refuse mutation

Failure behavior:

- the command never deletes the current install first
- if download, checksum, permission, or npm install fails, the current install remains in place
- the command prints the exact manual install fallback

## 10. **Unsupported or Limited Cases**

| Case | MVP behavior |
| --- | --- |
| Source checkout execution | Refuse self-update and print the manual GitHub-release install command |
| Unwritable global npm prefix | Refuse self-update and print the manual install command |
| Missing `npm` | Refuse self-update and explain that `npm` is required |
| Offline / GitHub unreachable | Fail with a release lookup error |
| Unsupported channel | Reject anything other than `stable` |
| Explicit older version | Allow it as an intentional targeted install; treat it as a selected version rather than blocking it as a downgrade |

## 11. **User Experience**

Normal output:

- short progress feed for checking release, downloading, verifying, installing, and finishing
- clear current version and target version

Verbose output:

- release URL
- temp directory path
- npm command used for installation

Progress behavior:

- interactive terminals use the existing bounded ANSI dashboard style
- non-interactive shells get plain progress lines

Exit codes:

- `0`: already current, dry run complete, or update applied successfully
- `20`: update available but not applied, for example `--check` or non-interactive without `--yes`
- `1`: failure

## 12. **Repo Interaction**

`cstack update` does not mutate:

- `.cstack/config.toml`
- prompt assets
- docs
- source files
- git state
- run artifacts under `.cstack/runs/`

## 13. **Artifact and Logging Contract**

MVP does not create `.cstack` workflow run artifacts for self-update.

Local logging contract:

- progress and summary to stdout/stderr
- temp download directory removed after use
- no persistent local update ledger in MVP

## 14. **Implementation Plan**

Smallest viable slice:

1. top-level `update` command
2. GitHub release discovery
3. current-version detection
4. `--check` and `--dry-run`
5. tarball download plus checksum verification
6. `npm install -g <local-tarball>`
7. source-checkout and permission refusal paths

Follow-on improvements:

- persistent update audit log outside `.cstack/runs/`
- richer install-method detection
- explicit `--force` or `--allow-downgrade` if downgrade semantics need tightening
- release channel expansion if prerelease testing becomes useful

## 15. **Open Questions**

- Should a future version record update history in a user-local cache directory?
- Should downgrade via `--version` remain implicit or require an explicit `--allow-downgrade` flag later?
- Should MVP print the detected global npm prefix in normal output or reserve that for `--verbose` only?

## 16. **Recommended Default Design**

Build `cstack update` as a conservative GitHub-release self-updater:

- default to check-and-apply with prompt in interactive terminals
- require `--yes` for non-interactive mutation
- use GitHub Releases API as the source of truth
- install from the exact versioned tarball, not the moving latest alias
- verify integrity before invoking `npm`
- refuse repo-local or source-checkout mutation

## **Build Recommendation**

Implement the command in one vertical slice around `--check`, `--dry-run`, interactive prompt, verified tarball install, and explicit failure messaging for unsupported installs.
