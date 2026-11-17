# Agent Note: Manual GitHub-hosted CI

Status: implemented

## Problem

This repository is a solo developer's fork. Its working branch is `fork/main`, and `master` only mirrors upstream. The fork has no repository secrets or variables, no self-hosted or organization-owned larger runners, publishes nothing to npm, PyPI, GitHub Releases, or GitHub Pages, and does not use upstream's Issue, approval, or merge-policy process.

The inherited workflows assumed all of those. Pull-request and master-push triggers did not match the fork's direct pushes to `fork/main`, so the gates never ran there, while six workflows whose `env:` block had been left empty failed as invalid definitions on every push. Failover routing selected self-hosted and Blacksmith pools through `DSH_CI_FAILOVER_*` variables. Publication, Pages, and Cloudflare preview workflows needed credentials. Real-API workflows needed a provider key. `Policy` workflows, weighted approval, and Issue lifecycle automation enforced a review process the fork does not run. Aggregate verdict jobs existed only to satisfy branch protection.

## Decision

Every workflow under [.github/workflows](../../../../.github/workflows) starts only on manual `workflow_dispatch`, and [build-exe-for-python-sdk.yml](../../../../.github/workflows/build-exe-for-python-sdk.yml) is also callable through `workflow_call`. Jobs run on plain GitHub-hosted labels, read no secrets or `vars.*` values, never call a real model provider, and publish nothing. A run's own status is its result, so no workflow defines an aggregate verdict job. The [.github instructions](../../../../.github/AGENTS.md) list the remaining workflows.

### Removed

- **Upstream review and Issue process:** the `Policy` pull-request checks, weighted approval, Issue lifecycle and Issue policy workflows, `.github/issue-management/`, `.github/review-ownership/`, `.github/preview-sizing/`, `scripts/pre-merge-check.ts`, and the approval and Issue-management test scripts.
- **Publication:** npm publication for dsh, vendor, and the native addon, Python publication on GitHub and in `.gitlab-ci.yml`, SSH helper release attachment with `scripts/ssh-helper/release.ts`, macOS CUA helper artifact reuse with `scripts/cua-helper/select-artifact.ts`, documentation Pages deployment, and Cloudflare pull-request previews with `scripts/snapshot-diff-page.ts`. `release.yml` and `release-vendor.yml` keep packing and packed-install verification.
- **Self-hosted and larger runners:** `ci-master.yml` with its serial standbys, Wine job, and runner benchmarks, the `DSH_CI_FAILOVER_LINUX` and `DSH_CI_FAILOVER_WINDOWS` routing, the Desktop and macOS CUA helper packaging workflows that used dedicated trial runners, their runner-service scripts, and the CI-only Desktop packaging adapters. Desktop installers and the macOS CUA helper are built locally.
- **Real-provider CI:** the real-API e2e workflow, the pi-ai provider e2e workflow, and the live installed-wheel step of the Python runtime builder. `pnpm run test:e2e` and `scripts/smoke-python-runtime.py --scenario sdk-live --installed-wheel` remain local checks.
- **Workflow-structure specs** and the `ci-primary`, `ci-linux-primary`, `ci-windows-complete`, `ci-snapshot`, and `ci-artifacts` run-gates modes that only served removed jobs. The tracked-filename check runs in the `node 24 / static` job instead of its own workflow.

### Remaining

[CI](../../../../.github/workflows/ci.yml) keeps the Linux static, coverage, lint, benchmark, and consumer jobs plus the Node 24.9 and 26 compatibility matrix. [CI Windows](../../../../.github/workflows/ci-windows.yml) keeps the native build, coverage, and targeted native-test jobs on `windows-2025` under native PowerShell ([native Windows decision](2026-08-08-native-windows-pull-request-ci.md)). [CI Python](../../../../.github/workflows/ci-python.yml) runs the keyless SDK suite, then calls the single-exe builder for Linux and Windows x64 ([installed-wheel decision](../testing/2026-08-23-installed-python-wheel-black-box-ci.md)). The Node addon, Sandbox, SSH helper, and Windows CUA helper workflows build or test their components on demand. `pnpm run check:windows-wine` stays an optional local diagnostic.

The frozen Agent Note archive check needs a baseline. The `node 24 / static` job checks out complete history and sets `DSH_ARCHIVE_BASE_REF` to `git merge-base HEAD origin/fork/main`, so a dispatch on a topic branch compares against the point where it left the working branch, and a dispatch on `fork/main` compares against itself.

The `workflow definitions` job of the Lefthook pre-commit hook runs `actionlint` over every workflow when a workflow file is staged. `actionlint` is not a repository dependency: each contributor installs it on `PATH`, on Windows with `winget install rhysd.actionlint`.

## Alternatives considered

**Keep pull-request and push triggers.** Every push to the fork and every upstream cherry-pick would consume hosted minutes, including on branches the owner does not intend to verify. The owner wants each run to be an explicit request.

**Keep failover and self-hosted routing disabled behind variables.** Unset variables would leave the jobs on hosted labels, but the routing expressions would remain dead configuration that one repository variable could revive onto runners the fork does not own.

**Keep the live provider steps and skip them without a key.** Missing-key preflights were written to fail rather than skip, and a self-skipping step is a green result that proves nothing. A local SSE model cannot prove authentication, request compatibility, streaming, tool-call interpretation, or a complete real turn, so that evidence now exists only when a contributor runs the local live checks. A key in CI would also bring back the `pull_request_target` exposure the [archived real-API e2e decision](../../archived/testing/2026-06-19-real-api-e2e-ci.md) prohibited.

**Keep the workflow-structure specs.** They restated YAML as assertions, so every workflow edit changed two files. `actionlint` covers syntax, expressions, job dependencies, and reusable-workflow inputs, while the owner reads workflow behavior from the YAML itself.

**Keep aggregate verdict jobs.** They existed for branch protection, which the fork does not configure. With manual dispatch the run status already answers whether every job passed.

## Consequences

No CI result exists unless the owner dispatches it, so a regression that local checks miss can stay on `fork/main` until the next dispatch. Platform evidence for native Windows, Python runtime targets, macOS, and real kernels comes from explicit runs, and real-provider compatibility comes only from local key-backed runs.

Job timeouts and partition layouts were tuned on 16-core runners and are unverified on standard hosted runners, so the first runs may need longer timeouts. Contributors who commit workflow changes need `actionlint` installed, or the pre-commit hook fails.

The fork no longer carries credentials, branch-protection names, or organization runner labels that it could not use, and every remaining workflow can run in a fresh fork without configuration. Restoring publication or real-provider CI requires a new decision that adds the credential and its trust boundary deliberately. The [failover runbook](../../archived/process/2026-07-26-ci-failover-runbook.md), [Blacksmith failover leg](../../archived/process/2026-09-09-blacksmith-failover-leg.md), [serial cross-platform reference](../../archived/process/2026-07-21-serial-cross-platform-ci-reference.md), [hosted Windows Python runtime](../../archived/process/2026-09-06-python-runtime-windows-hosted.md), [weighted approval gate](../../archived/process/2026-10-20-weighted-approval-status-gate-with-check-run-label.md), and [event-directed review status](../../archived/process/2026-08-10-event-directed-pr-review-status.md) notes record the removed designs. The [npm release sequences](2026-08-10-npm-release-sequences.md), [CI artifact builds](2026-10-05-pr-artifact-typechecks.md), [build check split](2026-10-11-build-artifacts-check-split.md), and [label taxonomy](2026-08-08-unified-github-label-taxonomy.md) notes describe what remains of their decisions.

## Verification

`actionlint` accepts every remaining workflow. `pnpm run verify-archived-agent-notes` accepts the archived notes, and `pnpm run doc-sync` accepts the updated documentation and links.
