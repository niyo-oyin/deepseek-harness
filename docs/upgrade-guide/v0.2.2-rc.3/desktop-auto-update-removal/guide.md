---
kind: upgrade-guide
description: Desktop no longer checks for or installs updates, its update channel setting and mandatory-update policy are removed, and packaging rejects the former update and publishing settings.
---

# Desktop auto-update removed

## Change

Desktop no longer checks for updates. The **Check for Updates…** menu item, the update indicator and **Update channel** row in Settings, the mandatory-update policy and its test login, and the `dshDesktop.updates` preload bridge are removed. Desktop no longer reads `userData/desktop/settings.json`; its `updates.channel` and `updates.allowTestAuthPopupWindow` fields have no effect, and the file is left on disk. The `DSH_DESKTOP_UPDATE_CHECK_*`, `DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS`, `DSH_DESKTOP_UPDATE_JOURNAL_DIR`, and `DSH_DESKTOP_MANDATORY_UPDATE_CONFIG` runtime variables are ignored.

A new version is installed by building an installer, for example `pnpm --dir apps/desktop run package:win:x64:unsigned --build-version <version>`, quitting Desktop, and running the installer. The Windows installer refuses to run while Desktop is running, including in silent mode, and no longer accepts the `--updated` relaunch argument.

Packaging no longer produces update metadata, blockmaps, or a macOS ZIP; macOS ships a DMG only. The `.env.windows`, `.env.macos`, and machine preset files reject `DSH_DESKTOP_AUTO_UPDATE_ENV`, `DSH_DESKTOP_MANDATORY_UPDATE_*`, `DOWNLOAD_TEST_*`, and `DOWNLOAD_PROD_*`; the `DSH_DESKTOP_UPDATE_CHANNEL`, `PACKAGE_TEST_RELEASE_ID`, and `PACKAGE_MACOS_ZIP_COMPRESSION_LEVEL` environment variables are ignored. The `upload:*`, `purge:latest`, and `test:updates:*` scripts, the `@deepseek-ai/dsh-desktop-publisher` workspace, and the `@deepseek-ai/dsh-client-ui-settings-general/types` export are removed.

## Migration

1. Delete the update, download, and mandatory-update lines listed above from `apps/desktop/.env.windows`, `apps/desktop/.env.macos`, and any `presets/*.env` under `DSH_PACKAGING_CONFIG_DIR`; packaging fails with an unsupported-setting error until they are gone. Remove the publishing `secrets/cos-*.json` files and `publishing/*.json` configuration if you created them.
2. Optionally delete `desktop/settings.json` under Desktop's Electron user-data directory, which Electron names after the packaged manifest name under `%APPDATA%` on Windows or `~/Library/Application Support` on macOS.
3. Code that read `dshDesktop.updates` or imported `@deepseek-ai/dsh-client-ui-settings-general/types` removes that code.
4. Confirm with `pnpm --dir apps/desktop run check:package win-x64 --unsigned` (or `mac-arm64`, `mac-x64`): it passes with the edited files, and the installed application menu has no **Check for Updates…** item.
