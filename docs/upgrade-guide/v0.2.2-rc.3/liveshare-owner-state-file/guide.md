---
kind: upgrade-guide
description: "The Liveshare share host requires ownerStateFile in its config; the bundle patch derives the default from the product home, and the plugin no longer reads LIVESHARE_OWNER_STATE_FILE or DSH_HOME itself."
---

# Liveshare share host requires `ownerStateFile`

## Change

`@deepseek-ai/dsh-experimental-liveshare` resolved its owner state file inside the plugin: the `ownerStateFile` config field, then the `LIVESHARE_OWNER_STATE_FILE` environment variable, then `owner-shares.json` under a product home it located by itself. The plugin now reads only its config, and the default lives in the bundle's own [patch](../../../../packages/experimental/liveshare/cordis.patch.yml), which resolves the product home the same way every other profile path does:

```yaml
ownerStateFile: !!js process.env.LIVESHARE_OWNER_STATE_FILE || dshHomePath('liveshare', 'owner-shares.json')
```

A profile that selects the bundle through `dsh.profile.bundles` behaves as before. A hand-written `liveshare-share-host` entry that omits `ownerStateFile` no longer mounts; it fails with `liveshare-share-host: ownerStateFile must name a file`.

## Migration

1. If the profile's `cordis.patch.yml` inserts `liveshare-share-host` by hand, give the entry an `ownerStateFile`: an absolute path, or the bundle's expression above to keep the previous default and the `LIVESHARE_OWNER_STATE_FILE` override.
2. Leave the existing `owner-shares.json` where it is; its location and format are unchanged.
3. Confirm: `dsh` starts without the `ownerStateFile must name a file` error, and the Share dialog lists the shares created before the upgrade.
