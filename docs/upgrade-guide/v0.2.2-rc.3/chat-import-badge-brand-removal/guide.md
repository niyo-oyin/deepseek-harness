---
kind: upgrade-guide
description: "The DeepSeek chat import and badge skill bundles and the official brand package are removed, so profiles that selected or patched them get startup warnings until the leftovers are deleted."
---

# DeepSeek chat import, badge skill, and official brand packages removed

## Change

These packages are removed and receive no further releases:

- `@deepseek-ai/dsh-deepseek-chat-import`, the optional bundle that imported DeepSeek chat exports as Sessions, with its `deepseek-chat-import` row;
- `@deepseek-ai/dsh-experimental-badge-skill-bundle` and `@deepseek-ai/dsh-skill-badge`, the optional badge skill, with its `skill-badge` row;
- `@deepseek-ai/dsh-client-ui-brand-official`, the whale and wordmark artwork, with its `ui-brand-official` row in the Web and Desktop compositions.

The Plugins page no longer offers the two bundles. A profile that switched one on still names it in `dsh.profile.bundles`; the bundle no longer resolves, so every start skips it and prints `skipping profile bundle "<name>": … cannot resolve profile bundle …`, and the other bundles load as before. A profile patch that disables or configures one of the removed rows matches no entry, so boot warns `patch: entry "<id>" not found` and skips that patch. Sessions created by the importer stay ordinary Sessions.

## Migration

1. In `$DSH_HOME/profiles/<profile>/package.json` of every profile, including `web` and `desktop`, delete `@deepseek-ai/dsh-deepseek-chat-import` and `@deepseek-ai/dsh-experimental-badge-skill-bundle` from `dsh.profile.bundles`, and from `dependencies` if listed there.
2. Delete the patches whose `id` is `deepseek-chat-import`, `skill-badge`, or `ui-brand-official` from `$DSH_HOME/profiles/<profile>/cordis.patch.yml` and from any overlay passed with `--patch`.
3. Remove the removed packages from the dependencies of any package that lists them.
4. Restart and confirm that startup prints neither a `skipping profile bundle` line nor a `not found` warning for these names.
