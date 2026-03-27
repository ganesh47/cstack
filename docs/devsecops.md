# DevSecOps Baseline

This repository's package-manager contract is `npm` with the committed `package-lock.json`.
Security workflows, release automation, and update automation should target `npm` and must not assume `pnpm`.

## Required Pull Request Checks

- `validate`
- `dependency-review`
- `CodeQL`
- `Gitleaks`

`Live Codex Smoke` is informational and must remain non-blocking.

## Required Repository Settings

- Protect `main` and require the checks listed above before merge.
- Enable Dependabot alerts and security updates.
- Enable GitHub secret scanning if available for the repository.
- Keep release tagging and GitHub Release publishing limited to the release workflows.

## Release Expectations

The release pipeline publishes GitHub Release assets only. A successful release should publish:

- the versioned package tarball
- `cstack-latest.tgz`
- `SHA256SUMS.txt`
- `cstack-<version>.sbom.spdx.json`
- build provenance attestation for the release artifacts
