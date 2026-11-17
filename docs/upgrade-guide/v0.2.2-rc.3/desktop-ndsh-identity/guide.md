---
kind: upgrade-guide
description: "Desktop is named Not DeepSeek Harness instead of DSH Fork, so its executable, installation directory, Electron user data, and installer cache directory change names and nothing is carried over."
---

# Desktop is named Not DeepSeek Harness

## Change

The packaged Desktop application was named "DSH Fork" with the manifest name `dsh-fork-desktop`. It is now named "Not DeepSeek Harness" with the manifest name `ndsh-desktop` ([`desktop-product.mjs`](../../../../apps/desktop/scripts/desktop-product.mjs)). As a result:

- The executable, default installation directory, shortcuts, uninstall entry, and macOS bundle are `Not DeepSeek Harness` (`Not DeepSeek Harness.exe`, `Not DeepSeek Harness.app`).
- Electron user data (keyboard shortcuts, the cached interface language, plugin operation reports, and the close-to-background acknowledgement) moves from `%APPDATA%\dsh-fork-desktop` to `%APPDATA%\ndsh-desktop` on Windows and from `~/Library/Application Support/dsh-fork-desktop` to `~/Library/Application Support/ndsh-desktop` on macOS.
- The per-application cache directory that holds installer failure reports moves from `dsh-fork-desktop-updater` to `ndsh-desktop-updater` under `%LOCALAPPDATA%` (macOS `~/Library/Caches`).
- Installer files are named `ndsh-<version>-<os>-<arch>…`, and the example packaging environment files set `DSH_DESKTOP_APP_ID=app.ndsh.desktop`.

Nothing is read from or moved out of the previous directories. On Windows, the installer registers the application under a key derived from `DSH_DESKTOP_APP_ID`: built with a different app ID than DSH Fork, it installs beside DSH Fork instead of replacing it; built with the same app ID, it runs the DSH Fork uninstaller and keeps that uninstaller's application data. Sessions and settings live in the Harness home, which [moves separately](../home-directory-ndsh/guide.md).

## Migration

1. If you registered the `dsh` command from DSH Fork, select **Manage dsh Command… → Remove** in its application menu; the registration points into the DSH Fork installation.
2. Quit DSH Fork, including its background process. To keep keyboard shortcuts, copy `keybindings.json` from the previous user-data directory to the same place under `ndsh-desktop`.
3. Uninstall DSH Fork: on Windows through Settings → Apps → Installed apps, which also removes `%APPDATA%\dsh-fork-desktop`, `%APPDATA%\DSH Fork`, and `%LOCALAPPDATA%\dsh-fork-desktop-updater`; on macOS by deleting `DSH Fork.app`, then deleting `~/Library/Application Support/dsh-fork-desktop`, `~/Library/Caches/dsh-fork-desktop-updater`, and `~/Library/Logs/DSH Fork` if present.
4. Move the Harness home as described in [its guide](../home-directory-ndsh/guide.md).
5. Install Not DeepSeek Harness and register the `dsh` command again from **Manage dsh Command…** if you use it.
6. Confirm: only one Desktop entry remains in the installed apps list, and Not DeepSeek Harness lists your previous Sessions.
