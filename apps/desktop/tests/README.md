# Desktop local verification

## Summary

Local verification covers fault reports, the shell dialog palette, and the in-window shell overlay carrier. These checks run against built Desktop sources with private profiles; they are separate from visual acceptance and installed-application testing.

## Table of Contents

- [Fault-report verification](#verification-diagnostics)
- [Shell dialog themes](#verification-theme)
- [Native overlay visibility](#verification-overlay)
- [Evidence](#verification-evidence)
- [Open verification](#verification-open)

<a id="verification-diagnostics"></a>

## Fault-report verification

See [recovery and diagnostics](../docs/diagnostics/README.md) for product behavior and limitations.

Use a disposable profile and separate Electron `userData` with the actual packaged client. Construct a minimal local bundle with `package.json`, `dsh.bundle.patch` pointing to `cordis.patch.yml`, and an optional plugin module; archive it as a local `.tgz`. These packages deliberately break the application and must not be published or installed in a daily profile.

Exercise import and plugin-initialization exceptions, an asynchronous exception after `appReady`, and a nonzero Host exit. A patch disabling the `agent`, `session`, `llm`, and `tools` providers exercises missing-service diagnostics. To check cross-restart history, select that bundle through `pluginManager`, then restart the same profile. Runtime scenarios require observing actual client readiness; `appReady` alone does not establish that the window is visible.

Check the original error and cause or exit code, operation and Host run IDs across restart, report-collection completion and omissions, file retrieval from the native dialog, and startup after plugin recovery. Record the package version and source commit; successful package generation or a management result alone does not establish client functionality. Restore protocol associations and stop test processes afterward.

For resource checks, use large sparse history files, unrelated files, dense records, and malformed or unfinished lines. Measure setup separately from collection in fresh processes, recording actual bytes read, output size, time, and peak memory. To check Worker cancellation, a test-only module hook can hold an asynchronous file open after writing an entry marker. Confirm that marker, observe Worker exit after the deadline, and compare the basic report bytes. This does not reproduce a kernel-hung system call or establish packaged-client behavior.

<a id="verification-theme"></a>

## Shell dialog themes

After `pnpm --dir apps/desktop run build`, run the real Electron palette fixture on macOS:

```sh
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/shell-theme.mjs
```

The fixture creates a private profile, loads the production shell dialog HTML, sandboxed preload, renderer script, and bundled design tokens, and substitutes only a fixed IPC status response. Its six cases start the dialog in light and dark mode, switch the palette while it is open, and follow system appearance. It checks that the bundled `design-platform.css` matches the Client theme source, transparent document backgrounds, surface/text/button/mask colors, the technical-details surface, the dark-only 1 CSS px inset outline, and the close icon, then writes two screenshots and `result.json` to `.desktop-build/qualification/shell-theme-*`. It does not start a Host or qualify Windows native rendering.

<a id="verification-overlay"></a>

## Native overlay visibility

On macOS, reuse the cached Electron runtime after compiling the Desktop Host sources:

```sh
pnpm exec tsc -b apps/desktop/tsconfig.host.json
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/shell-overlay-visibility.mjs
```

The fixture owns a unique profile and writes `result.json` under `.desktop-build/qualification/shell-overlay-*`. It checks visible and hidden owners, absence of native child windows, retention of a separate control window’s focus after owner visibility notifications, and view/input cleanup including owner destruction, and compares the result with `expected/shell-overlay-visibility.json`. It uses no network, product login, or dsh Host. It qualifies the in-window carrier, not a complete dialog flow.

<a id="verification-evidence"></a>

## Evidence

Packaging supervision fixtures control their Git metadata and use real file hashes with inert child processes. Git-head and worktree changes still refuse packaging; concurrent tests cannot change the fixture’s recorded Git inputs.

<a id="verification-open"></a>

## Open verification

The following items are not passing evidence and must remain visible during review:

- Electron `capturePage()` captures individual windows. Cross-platform layout acceptance of the shell dialog and a complete recording remain unverified.
- The fixtures do not execute an installer, overwrite an installed application, or establish that a new version starts successfully. Signed Windows and macOS installed-version qualification remains required for release.
- Full `doc-sync` encounters Windows file-symlink `EPERM` in the documentation-site test, so a Windows run does not make the full documentation gate green.
