# Release

Pre-1.0: treat this as a release checklist, not a stability policy.

## Versioning

The native workspace root and every platform/entry package share one version. Run the bump helper from the repository root:

```sh
pnpm --dir native/system release:bump patch          # or minor / major / x.y.z
```

It updates `native/system/package.json` and every `native/system/packages/*` manifest, refreshes the repository root lockfile (`--ignore-scripts --lockfile-only`), and runs `release:verify`. Explicit versions accept full semver including prereleases (`pnpm --dir native/system release:bump 0.0.0-test.0`); [`publish-release.mjs`](../scripts/publish-release.mjs) puts prerelease versions under the `next` dist-tag, so `latest` never points at a test build. Keep `workspace:*` dependencies in source; pnpm converts them to concrete versions during pack.

Version bumps are normal source changes: open a release PR (or commit) with the launcher manifests and root lockfile, merge it, then create the matching `node-addon-system-vX.Y.Z` tag from that commit. The namespace avoids colliding with release tags for other package families in the repository.

```sh
pnpm --dir native/system release:commit patch        # bump + stage + commit in one command
git tag node-addon-system-v0.0.2
```

## Preflight

```sh
pnpm install --frozen-lockfile
pnpm --dir native/system build:ts
pnpm --dir native/system typecheck
pnpm --dir native/system test:entry
```

On a supported Linux or macOS host, also rehearse the pack path locally:

```sh
pnpm --dir native/system build:native
pnpm --dir native/system build:test-oracle
pnpm --dir native/system test:launcher
pnpm --dir native/system test:flock
pnpm --dir native/system test:packaging
node native/system/scripts/pack-release.mjs native/system/.release/npm --current-platform-only
node native/system/scripts/verify-packed-install.mjs native/system/.release/npm --current-platform-only
```

## Publish

This repository does not publish the addon packages, and no workflow publishes them. The manual [Node Addon System workflow](../../../.github/workflows/node-addon-system.yml) builds and tests each platform binary on its matching hosted runner.

A publication from a local checkout covers only the current platform's packages and always goes through `pack-release.mjs`, never `pnpm publish` directly (pnpm's pack path strips the launcher's executable bit; see [packaging.md](packaging.md)):

```sh
node native/system/scripts/pack-release.mjs native/system/dist/npm --current-platform-only
node native/system/scripts/verify-packed-install.mjs native/system/dist/npm --current-platform-only
while IFS= read -r tarball; do npm publish "native/system/dist/npm/${tarball}" --access public; done < native/system/dist/npm/publish-order.txt
```

Do not commit `.npmrc` files with tokens or registry overrides.
