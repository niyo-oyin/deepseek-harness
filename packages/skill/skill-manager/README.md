---
description: "Skill manager: the full skill list, the writes to the user's skill folders, and ZIP import and export of skill bundles that a management surface calls over Remote, for maintainers of the Skills page and of skill storage."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-manager

## Summary

This package serves skill management over Remote. It lists every skill the default agent preset sees, including the ones switched off by the [skill registry](../skill/README.md)'s `disabled` setting, and it creates, changes, and removes skills in the user's own skill folders. It also exports a skill's whole folder as a ZIP archive and imports the skills of an archive. The [Skills page](../../client/ui-settings-skills/README.md) is its consumer.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The `dsh-web-app` bundle mounts the manager on the Host as the row `skill-manager`. It needs the skill registry (`ctx.skills`) and uses the agent preset registry when one is mounted.

```yaml
- id: skill-manager
  name: '@deepseek-ai/dsh-skill-manager'
```

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home; new skills are created in its `skills/` folder |
| `agentsHome` | `$DSH_AGENTS_HOME` or `~/.agents` | Shared agents home, whose `skills/` folder is the second user skill folder |

Leave both unset unless the deployment's `skill-filesystem` rows set the same fields: the manager writes where that provider discovers user skills.

### Remote namespace `skillManager`

| Method | Does |
|---|---|
| `watch()` | Streams the skill list: once on subscription, then again whenever it differs after a catalog change |
| `read(name)` | Returns one skill's name, description, guidance, and instructions, or `null` when it is not listed |
| `create(draft)` | Writes `<name>/SKILL.md` in the Harness home's skill folder |
| `update(draft)` | Replaces the description, guidance, and instructions of a skill in the user's skill folders |
| `delete(name)` | Deletes a skill in the user's skill folders: its whole folder, or the single file of a flat skill |
| `exportArchive(name)` | Packs one skill's bundle as a ZIP archive in base64, or returns `null` when the skill is not listed or is not a file |
| `importArchive({ data, replace })` | Unpacks the skills of a base64 ZIP archive into the Harness home's skill folder |

Each listed skill carries its name, description, source, file path, invocation controls, and `editable`. A skill is editable when its file is `<folder>/SKILL.md` or a flat `<name>.md` directly inside one of the two user skill folders; `update` and `delete` accept no other skill.

The three writes return `{ ok: true }`, or `{ ok: false, refused }` without changing anything:

| `refused` | Meaning |
|---|---|
| `invalid-name` | The name is not kebab-case |
| `name-taken` | A skill of that name is listed from any source, or a folder of that name exists |
| `no-description` | The description is empty |
| `not-found` | No skill of that name is listed |
| `not-editable` | The skill is not a file in the user's skill folders |

A filesystem failure is not a refusal: the call fails with the error's message.

### Skill bundles as ZIP archives

A skill is more than its `SKILL.md`: scripts, references, and assets sit beside it, and the two archive methods move the folder whole.

`exportArchive` packs every file of the skill's folder under one top folder named after the skill, so `review` becomes `review.zip` holding `review/SKILL.md` and the rest. Any listed skill that is a file can be exported, built-in ones included. A flat skill is packed as `<name>/SKILL.md`. Symbolic links are left out.

`importArchive` treats every `SKILL.md` in the archive as one skill and copies its folder as `<name>/` into the Harness home's skill folder — `$DSH_HOME/skills`, `~/.dsh/skills` by default. The name comes from the skill's frontmatter, not from the archive's folder. The archive may hold `SKILL.md` at its top, one wrapping folder, or several skills; a `SKILL.md` inside another skill's folder is that skill's resource, and files outside every skill folder are left out. It returns one outcome per skill:

| `outcome` | Meaning |
|---|---|
| `imported` | Written as a new skill |
| `replaced` | Written in place of the skill of that name in the Harness home's skill folder |
| `exists` | Not written: that folder already holds the name. Import again with `replace: true` to overwrite it |
| `name-taken` | Not written: a skill of that name comes from another place, such as a built-in skill or the shared agents home |
| `invalid` | Not written: its `SKILL.md` has no frontmatter with a kebab-case `name` and a `description` |

A replacement swaps the whole folder, so no file of the old bundle survives beside the new ones. The archive is refused as a whole, with `{ ok: false, refused }` and nothing written, in these cases:

| `refused` | Meaning |
|---|---|
| `not-zip` | The bytes are not a readable ZIP archive |
| `too-large` | The archive is over 64 MiB, unpacks to over 256 MiB, or holds over 10,000 files |
| `no-skill` | The archive holds no `SKILL.md` |
| `unsafe-path` | A file's path leaves its folder (`..`, an absolute path, a drive letter) or carries a character a file name cannot hold |

Switching a skill on or off is not a method here. It is the registry's `disabled` setting, written through Settings under the registry's entry id.

<a id="understand-the-implementation"></a>
## Understand the implementation

[`src/index.ts`](src/index.ts) holds the service. Every read goes through the registry with `includeDisabled`, over the standing scope of the default agent preset and without a working directory: that is the view an agent has outside any project. Where no preset registry is mounted, or the default preset cannot be acquired, the read falls back to the registry's global layer.

`watch` wakes on the registry's `skills/change` event and sends a list only when it differs from the last one sent, because discovery can report a change of its own when it first watches a folder. The manager does not invalidate the catalog after a write: the filesystem provider's watcher sees the changed file, so the new list follows shortly after the write returns.

[`src/archive.ts`](src/archive.ts) reads and writes the archives with `fflate`. The limits are checked from the archive's directory before any file is inflated. An import stages each skill in a temporary folder beside the skill folder and renames it into place, so discovery never reads a half-written skill; a failed write removes the staging folder.

[`src/skill-file.ts`](src/skill-file.ts) renders the Markdown file. An edit parses the existing frontmatter as a YAML document and replaces only `description` and `whenToUse`, so the name, the invocation controls, metadata, and comments stay as written. `create` makes the skill's folder non-recursively and writes the file exclusively, so it never writes into an existing folder.

<a id="model-experience"></a>
## Model Experience

None directly. The manager registers nothing model-facing. A skill it writes reaches the model through the registry's catalog and the `skill` tool of [`dsh-tool-skill`](../tool-skill/README.md), like any other skill file.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Project skills are not listed** — the list is read without a working directory, so skills in a project's `.dsh/skills` or `.agents/skills` folder do not appear.
- **One preset's view** — the list is the default preset's. A skill that only another preset mounts is not listed.
- **A skill cannot be renamed** — remove it and create it again.
- **Invocation controls are not editable** — `disable-model-invocation` and `user-invocable` are shown in the list and kept by an edit, but changed only in the file.
- **File names in an archive are read as UTF-8** — an archive written with another encoding for non-ASCII names imports those names garbled.
- **Archives travel as base64 over Remote** — fine for skill bundles, which the 64 MiB limit bounds; it is not a general file transfer.
- **Removal is permanent** — a removed skill's folder is deleted, not moved to the system trash.
