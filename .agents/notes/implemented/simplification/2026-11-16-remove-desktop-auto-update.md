# Agent Note: Remove the Desktop auto-update and publishing subsystem

Status: implemented

## Problem

The fork has no update channel and will not use the vendor's distribution infrastructure. Desktop still carried the complete upstream release machinery: `electron-updater` checks on startup, focus, resume, and a polling schedule; a channel selector in Settings; a mandatory-update policy client with a Feishu test login; an installer handoff that locked Host request admission and required a clean Host stop; the NSIS update restart banner; and the `@deepseek-ai/dsh-desktop-publisher` workspace with COS upload, EdgeOne purge, rollout, rollback, website installer, and installed-update qualification tooling, all wired to `download.deepseek.com` or test origins supplied through `.env` files. None of it could do anything useful for this fork, every packaging run had to satisfy or strip its settings, and a configured origin would have made the application contact a server the owner does not operate.

## Decision

The subsystem is deleted, not disabled:

- **Runtime:** the update coordinator, schedule, journal, presentation, channel and settings modules, the `electron-updater` adapters and dependency, the mandatory-update policy, window, overlay, and preloads, the policy test login, client identity headers, the `Check for Updates…` menu item, the `dshDesktop.updates` bridge and its IPC channels, and the Electron-owned `userData/desktop/settings.json` reader (it held only update fields). The Host loses its `update-tasks` admission lock; the quit inspection remains the only task inspection.
- **Kept and renamed:** the in-window dialog becomes the general shell dialog (`shell-dialog.ts`, `shell-overlay.ts`, `preload-shell-dialog.ts`), still used by the Windows About dialog, Manage dsh Command, and the Windows first-close notice. `release.ts`, crash and operation reports, and the version shown in About and Settings are unaffected.
- **Installer:** the `--updated` relaunch argument, the restart status process, and the ten-second wait for an updating application are gone; setup refuses while the application runs. The uninstaller keeps its `--updated`/`/KEEP_APP_DATA` data-retention check because electron-builder passes those flags when its installer replaces an existing installation.
- **Packaging:** `publish: null`, no `app-update.yml` or channel YAML, `nsis.differentialPackage: false` (no blockmap), and DMG-only macOS output, because the ZIP existed only as the Squirrel.Mac update payload. The `.env` loaders reject the former update, download, and policy settings.
- **Publishing:** the publisher workspace, upload, purge, rollout and retention scripts, their CI workflows and configuration templates, and the installed-update qualification tooling.
- **UI:** the Settings update indicator, channel row, their locale keys, and the `ui-settings-general/types` export.

New versions are installed by building an installer locally, for example `pnpm --dir apps/desktop run package:win:x64:unsigned --build-version <version>`, and running it over the installation. The [upgrade guide](../../../../docs/upgrade-guide/v0.2.2-rc.3/desktop-auto-update-removal/guide.md) lists the manual edits. The [packaging decision](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md) keeps release binding, signing, and installation; the decisions that existed only for updates are archived: [local updater qualification](../../archived/testing/2026-09-10-desktop-local-updater-qualification.md), [installed-update journal](../../archived/testing/2026-09-14-desktop-installed-update-journal.md), [installed-update materials](../../archived/testing/2026-09-14-desktop-installed-update-materials.md), [parallel macOS notarization](../../archived/process/2026-09-09-parallel-macos-notarization.md), and [shell configuration](../../archived/architecture/2026-10-08-desktop-shell-configuration.md). The three update proposals (policy and installation, mandatory-update API, deferred extensions) are deleted.

## Alternatives considered

**Keep the code with no feed URL configured.** Packaging already supported builds without an update origin. The runtime code, its tests, its locale strings, and its Settings UI would still have to be maintained, and one configuration value would bring vendor traffic back.

**Point the updater at a fork-owned feed.** The owner builds installers locally and has no hosting, signing pipeline, or release cadence that would make an update channel worth operating.

**Keep the restart banner and `--updated` handling in the installer.** Only the in-app update flow launched the installer silently with those arguments; an interactive reinstall never reaches them.

## Consequences

Gained: Desktop makes no update or policy request, packaging needs only the application ID, signing settings, version, and tuning values, and roughly the publisher workspace plus several thousand lines of update code and tests are gone.

Given up: users learn about a new version and install it by hand, a running application must be quit before reinstalling, there is no differential download, and macOS ships no ZIP. An existing `userData/desktop/settings.json` and the updater cache under the per-application cache directory are left on disk and ignored.

Reintroducing updates needs a new decision covering who hosts the feed, how releases are signed and qualified, and what the application may send to that host.

## Verification

`pnpm run typecheck`, `pnpm run constraints`, `pnpm run doc-sync`, the Desktop, Desktop Host, and `ui-settings-general` unit tests, and the Windows installer helper build with `prepare-windows-installer.ps1 -TestProgress` pass. No source file outside archived notes and historical upgrade guides names `electron-updater`, the publisher package, or the removed environment variables.
