# AGENTS.md — GitHub Actions

Every workflow starts only on manual `workflow_dispatch`; do not add `push`, `pull_request`, `pull_request_target`, or `schedule` triggers. Jobs run on plain GitHub-hosted labels (`ubuntu-24.04`, `ubuntu-24.04-arm`, `windows-2025`, `macos-latest`, `macos-15-intel`), read no repository secrets or `vars.*` values, never call a real model provider, and publish nothing. A run's own status is its result, so workflows define no aggregate verdict job. The [manual hosted CI Agent Note](../.agents/notes/implemented/process/2026-11-17-manual-hosted-ci.md) records the rationale.

- [CI](workflows/ci.yml) runs the keyless Linux static, coverage, lint, benchmark, and built-artifact consumer jobs plus the Node compatibility matrix.
- [CI Windows](workflows/ci-windows.yml) runs the native Windows build, coverage, and targeted native-test jobs.
- [CI Python](workflows/ci-python.yml) runs the keyless Python SDK suite, then calls the reusable [single-exe builder](workflows/build-exe-for-python-sdk.yml) for Linux x64 and Windows x64. Dispatch the builder directly for Linux arm64 or either macOS architecture.
- [Release (dsh)](workflows/release.yml) and [Release (vendor)](workflows/release-vendor.yml) pack and verify npm tarballs and retain them as run artifacts.
- [Node Addon System](workflows/node-addon-system.yml), [Sandbox](workflows/sandbox.yml), the [SSH helper builder](workflows/build-exe-for-ssh-helper.yml), and the [Windows CUA helper package](workflows/cua-helper-package-windows.yml) build or test their components on demand.

Windows run steps use native `pwsh`; shared entrypoints are Node scripts. Desktop installers and the macOS CUA helper are built locally, not in Actions.

The `workflow definitions` pre-commit job in [lefthook.yml](../lefthook.yml) runs `actionlint` over every workflow when a workflow file is staged; [development.md](../docs/development.md#git-integrations) covers installing it.
