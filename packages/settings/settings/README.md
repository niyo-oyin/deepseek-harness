---
description: "Inspect and edit live plugin configuration through Config-derived forms."
kind: "package-reference"
---

# @deepseek-ai/dsh-settings

## Summary

Edit fields that plugins declare with `.volatile()` and inspect their effective values. Forms identify each plugin by its profile entry id, preserve secret values, and refuse stale writes. Changes persist through the active profile’s Cordis patch.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this plugin with Loader and [config-editor](../../boot/config-editor/README.md). The base bundle provides this composition.

```yaml
- id: settings
  name: '@deepseek-ai/dsh-settings'
```

This plugin has no configuration fields. Forms expose only volatile fields from active, uniquely addressed profile entries. Ordinary configuration remains editable through Cordis configuration files.

Once the Loader has settled every entry after Settings starts, a `settings.yaml` left in the harness home by earlier releases is imported once: each section is written into the entry of the same id (`ui-developer-tools` → `ui-settings`, `ui-onboarding` → `ui-settings-general`, `shell` → the platform's shell executor entry), the file is renamed to `settings.yaml.imported` before the first write, and a section the running composition rejects is logged and stays only in the renamed file.

Reset restores the value beneath the profile override, including schema defaults. Home patches and command-line overlays take precedence; a form write that they would override is refused.

Each form reports `autoGenerate`, enabled by default, for clients that build pages from the schema; no shipped client does so yet. A plugin that ships its own page registers `configure({ auto: false }, ctx.fiber)` as an effect inside an optional `ctx.inject(['settings'], ...)` child from `apply`: the child names the plugin fiber the policy belongs to, a late-loading or replaced Settings service picks the policy up, and the business plugin runs without Settings. The policy does not remove configuration reads or writes.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [form projection](src/schema.ts) strips runtime references and ordinary fields. The [service](src/index.ts) supplies revisioned descriptors and validates edits against the full plugin Config before delegating persistence. Business plugins read their Config references directly.

Secret roles are redacted from values, inherited values, profile overrides, and schema defaults; clients receive presence markers. Path edits preserve fields a client did not receive.

On Windows a write stores the text of every secret-role field protected: the profile patch holds `{ __dpapi: <ciphertext> }` in its place, encrypted for the current Windows account through [`dsh-secret-protection`](../../util/secret-protection/README.md), and the launcher opens it before the plugin reads its configuration. A secret that repeats the inherited layer's value is left as written, so a field that only restates its default stays equal to it. After startup the service rewrites any profile entry that still stores secret text, such as one written by an earlier build or by hand. Linux and macOS store secret fields as written.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Settings reference](../../../docs/subsystems/settings.md) — form values and mutations.
- [Volatile configuration](../../../vendor/loader/README.md) — reference lifetime and notifications.
- [Configuration editor](../../boot/config-editor/README.md) — persistence and reload ordering.

<a id="model-experience"></a>
## Model Experience

Indirectly, through configuration values consumed by model-facing plugins.

#### KV Cache effect

Consumers that change request prefixes determine cache effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Nested Includes own separate configurations and are not editable through the active profile’s form.
- Only fields declared `role('secret')` and editable through a form are protected. A secret a plugin keeps in an ordinary field, a field that is not volatile, or a bundle's own patch file stays plain text.
- A protected secret copied to another machine or Windows account cannot be opened there; its entry does not start until the value is set again.
- Field-level resets restore inherited values; they cannot delete a value supplied by a lower configuration layer. Unsetting an array index removes that element.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
