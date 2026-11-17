---
kind: upgrade-guide
description: "The default Harness home moves from ~/.dsh-fork to ~/.ndsh, and nothing is read from or moved out of the previous directory."
---

# The default Harness home is `~/.ndsh`

## Change

Without `DSH_HOME`, `dsh`, Web, and Desktop keep sessions, profiles, settings, credentials, plugins, and caches in `~/.ndsh` instead of `~/.dsh-fork` (`%USERPROFILE%\.ndsh` on Windows). The previous directory is neither read nor moved, so after the upgrade an existing installation starts with an empty home: no Sessions, no stored API keys, and freshly initialized profiles. A `DSH_HOME` setting still takes precedence and is unaffected.

The other guides of this release name files under `$DSH_HOME`; that is the home `dsh` resolves, `~/.ndsh` by default. Move the directory first, then follow them.

## Migration

1. Quit every `dsh` process, Web server, and Desktop window that uses the home, including Desktop running in the background.
2. Move the directory, for example `mv ~/.dsh-fork ~/.ndsh` on macOS or Linux, or `Move-Item "$env:USERPROFILE\.dsh-fork" "$env:USERPROFILE\.ndsh"` in PowerShell. If you started a release that already created `~/.ndsh`, delete that new directory first when it holds nothing you want to keep. Alternatively, keep the old directory and set `DSH_HOME` to it for every process that runs `dsh`, Web, or Desktop.
3. Confirm: start Web or Desktop and check that your previous Sessions are listed and the Models page shows your providers.
