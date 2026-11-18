---
kind: upgrade-guide
description: "Desktop is named Not DSH instead of DSH Fork, so its executable, installation directory, Electron user data, and installer cache directory change names and nothing is carried over."
---

# Desktop is named Not DSH

## Change

The packaged Desktop application was named "DSH Fork" with the manifest name `dsh-fork-desktop`. It is now named "Not DSH" with the manifest name `ndsh-desktop` ([`desktop-product.mjs`](../../../../apps/desktop/scripts/desktop-product.mjs)). As a result:

- The executable, default installation directory, shortcuts, uninstall entry, and macOS bundle are `Not DSH` (`Not DSH.exe`, `Not DSH.app`).
- Electron user data (keyboard shortcuts, the cached interface language, plugin operation reports, and the close-to-background acknowledgement) moves from `%APPDATA%\dsh-fork-desktop` to `%APPDATA%\ndsh-desktop` on Windows and from `~/Library/Application Support/dsh-fork-desktop` to `~/Library/Application Support/ndsh-desktop` on macOS.
- The per-application cache directory that holds installer failure reports moves from `dsh-fork-desktop-updater` to `ndsh-desktop-updater` under `%LOCALAPPDATA%` (macOS `~/Library/Caches`).
- The installer publisher and the executable's company name are `Not DSH` instead of the upstream company name.
- On Windows, the record of the `dsh` command registration moves from `HKCU\Software\DeepSeekHarness\Command` to `HKCU\Software\NotDSH\Command`, so Not DSH no longer shares it with an upstream DeepSeek Harness installation and does not manage a registration that DSH Fork made.
- Installer files are named `ndsh-<version>-<os>-<arch>…`, and the example packaging environment files set `DSH_DESKTOP_APP_ID=app.ndsh.desktop`.

Nothing is read from or moved out of the previous directories. On Windows, the installer registers the application under a key derived from `DSH_DESKTOP_APP_ID`: built with a different app ID than DSH Fork, it installs beside DSH Fork instead of replacing it; built with the same app ID, it runs the DSH Fork uninstaller and keeps that uninstaller's application data. Sessions and settings live in the Harness home, which [moves separately](../home-directory-ndsh/guide.md).

## Migration

1. If you registered the `dsh` command from DSH Fork, select **Manage dsh Command… → Remove** in its application menu; the registration points into the DSH Fork installation, and Not DSH cannot remove it. If DSH Fork is already gone, delete its directory from the user `Path` variable and delete `HKCU\Software\DeepSeekHarness\Command` unless an upstream DeepSeek Harness installation still uses it.
2. Quit DSH Fork, including its background process. To keep keyboard shortcuts, copy `keybindings.json` from the previous user-data directory to the same place under `ndsh-desktop`.
3. Uninstall DSH Fork: on Windows through Settings → Apps → Installed apps, which also removes `%APPDATA%\dsh-fork-desktop`, `%APPDATA%\DSH Fork`, and `%LOCALAPPDATA%\dsh-fork-desktop-updater`; on macOS by deleting `DSH Fork.app`, then deleting `~/Library/Application Support/dsh-fork-desktop`, `~/Library/Caches/dsh-fork-desktop-updater`, and `~/Library/Logs/DSH Fork` if present.
4. Move the Harness home as described in [its guide](../home-directory-ndsh/guide.md).
5. Install Not DSH and register the `dsh` command again from **Manage dsh Command…** if you use it.
6. Confirm: only one Desktop entry remains in the installed apps list, and Not DSH lists your previous Sessions.
