---
description: "Remote service that lists every skill, switched-off ones included, creates, edits, and removes skills in the user's skill folders, and imports and exports skill folders as ZIP archives; for maintainers of the Skills page and of skill storage."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-manager

## Summary

A management surface can list every skill an agent sees, including the ones switched off by the [skill registry](../skill/README.md)'s `disabled` setting. It can create, edit, and remove skills in the user's own skill folders, and move whole skill folders in and out as ZIP archives. Refusals come back as named reasons without a partial write. Project skills are out of reach, because the list is read without a working directory.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `dsh-web-app` bundle mounts the manager on the Host as the row `skill-manager`, and the [Skills page](../../client/ui-settings-skills/README.md) calls it over Remote.

### When to choose it

Mount the manager beside a surface that manages skills for the user. Agents do not need it: they read skills through the registry and the `skill` tool. Switching a skill on or off is not a method here; it is the registry's `disabled` setting, written through Settings under the registry's entry id.

### Minimal configuration

The manager needs the skill registry (`ctx.skills`). It uses the agent preset registry when one is mounted.

```yaml
- id: skill-manager
  name: '@deepseek-ai/dsh-skill-manager'
```

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home; new and imported skills are written to its `skills/` folder |
| `agentsHome` | `$DSH_AGENTS_HOME` or `~/.agents` | Shared agents home, whose `skills/` folder is the second user skill folder |

Leave both unset unless the deployment's `skill-filesystem` rows set the same fields: the manager writes where that provider discovers user skills. [`Config`](src/index.ts) is the source for both fields.

### Remote namespace `skillManager`

| Method | Does |
|---|---|
| `watch()` | Streams the skill list: once on subscription, then again whenever it differs after a catalog change |
| `read(name)` | Returns one skill's name, description, guidance, and instructions, or `null` when it is not listed |
| `create(draft)` | Writes `<name>/SKILL.md` in the Harness home's skill folder |
| `update(draft)` | Replaces the description, guidance, and instructions of a skill in the user's skill folders |
| `delete(name)` | Deletes a skill in the user's skill folders: its whole folder, or the single file of a flat skill |
| `exportArchive(name)` | Packs one skill's bundle as a base64 ZIP archive, or returns why it was not exported |
| `importArchive({ data, replace })` | Unpacks the skills of a base64 ZIP archive into the Harness home's skill folder |

Each listed skill carries its name, description, source, file path, invocation controls, and `editable`. A skill is editable when its file is `<folder>/SKILL.md` or a flat `<name>.md` directly inside one of the two user skill folders, and its folder is not a link to somewhere else. `update` and `delete` accept no other skill.

`create`, `update`, and `delete` return `{ ok: true }`, or `{ ok: false, refused }` without changing anything:

| `refused` | Meaning |
|---|---|
| `invalid-name` | The name is not kebab-case, or Windows reads it as a device name such as `con` |
| `name-taken` | A skill of that name is listed from any source, or a folder of that name exists |
| `no-description` | The description is empty |
| `not-found` | No skill of that name is listed |
| `not-editable` | The skill is not a file in the user's skill folders |

A filesystem failure is not a refusal: the call fails with the error's message. The writes, imports included, run one after another, so the name check of one write cannot be overtaken by another.

### Skill bundles as ZIP archives

A skill's folder holds its `SKILL.md` and the scripts, references, and assets beside it. The two archive methods move that folder whole.

`exportArchive` packs every file of the skill's folder under one top folder named after the skill, so `review` becomes `review.zip` holding `review/SKILL.md` and the rest. Any listed skill that is a file can be exported, built-in ones included. Symbolic links are left out. A flat skill is packed as `<name>/SKILL.md` alone, and so is a `SKILL.md` that sits directly in a folder that holds other skills. The result is `{ ok: true, archive: { fileName, data } }` or `{ ok: false, refused }`:

| `refused` | Meaning |
|---|---|
| `not-exportable` | No skill of that name is listed, or the listed one is not a file |
| `too-large` | The folder holds over 10,000 files or 256 MiB, or its archive is over 64 MiB |

`importArchive` treats every `SKILL.md` in the archive as one skill and copies its folder as `<name>/` into the Harness home's skill folder. The name comes from the skill's frontmatter, not from the archive's folder. The archive may hold `SKILL.md` at its top, one wrapping folder, or several skills. A `SKILL.md` inside another skill's folder is that skill's resource, and files outside every skill folder are left out. The call returns one outcome per skill:

| `outcome` | Meaning |
|---|---|
| `imported` | Written as a new skill |
| `replaced` | Written in place of the listed skill of that name in the Harness home's skill folder |
| `exists` | Not written: the Harness home's skill folder already holds a skill of that name. Import again with `replace: true` to overwrite it |
| `name-taken` | Not written: a skill of that name comes from another place, such as a built-in skill or the shared agents home, or the folder of that name in the Harness home's skill folder holds something else |
| `invalid` | Not written: its `SKILL.md` has no frontmatter with a `description` and a kebab-case `name` that can be stored as a folder name |
| `failed` | Not written: its files could not be stored. A skill it was to replace is put back, and the Host log records the reason |

Discovery names a skill by its frontmatter, so the folder `foo/` can hold the skill `bar`. `replace` only replaces the listed skill that carries the name, and it swaps the whole folder: no file of the old bundle survives beside the new ones.

The archive is refused as a whole, with `{ ok: false, refused }` and nothing written, in these cases:

| `refused` | Meaning |
|---|---|
| `not-zip` | The bytes are not a readable ZIP archive, or an entry unpacks to another size than it declares |
| `too-large` | The archive is over 64 MiB, unpacks to over 256 MiB, or holds over 10,000 files |
| `no-skill` | The archive holds no `SKILL.md` |
| `unsafe-path` | A path leaves its folder (`..`, an absolute path, a drive letter), carries a character a file name cannot hold, is a Windows device name, or ends in a dot or a space; or two entries collide: the same name, names that differ only by case, or one name used as both a file and a folder |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) holds the service. Every read goes through the registry with `includeDisabled`, over the standing scope of the default agent preset and without a working directory: that is the view an agent has outside any project. Where no preset registry is mounted, or the default preset cannot be acquired, the read falls back to the registry's global layer.

The user skill folders are compared in the spelling the filesystem reports for them, so a home behind a symbolic link, a junction, or a Windows short name still matches the paths discovery reports for its skills.

`watch` wakes on the registry's `skills/change` event and sends a list only when it differs from the last one sent, because discovery can report a change of its own when it first watches a folder. The manager does not invalidate the catalog after a write: the filesystem provider's watcher sees the changed file, so the new list follows shortly after the write returns.

[`src/archive.ts`](src/archive.ts) reads and writes the archives with `fflate`. Before an entry is unpacked, its size — the larger of its stored and declared size — and the running file count are checked against the limits. An import stages each skill in a temporary folder beside the skill folder. It sets a replaced skill aside, moves the new folder into place, and puts the old skill back if that move fails, so discovery never reads a half-written skill. Moves are retried briefly while Windows still holds a handle on the file.

[`src/skill-file.ts`](src/skill-file.ts) renders the Markdown file. An edit parses the existing frontmatter as a YAML document and replaces only `description` and `whenToUse`, so the name, the invocation controls, metadata, and comments stay as written. `create` makes the skill's folder non-recursively and writes the file exclusively, so it never writes into an existing folder.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-skill](../skill/README.md) — the registry, its `disabled` setting, and the `includeDisabled` view.
- [dsh-skill-filesystem](../skill-filesystem/README.md) — the provider that discovers the user skill folders this package writes.
- [ui-settings-skills](../../client/ui-settings-skills/README.md) — the Skills page that calls this namespace.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the skill registry's catalog and the `skill` tool of [`dsh-tool-skill`](../tool-skill/README.md), which present a skill this manager writes like any other skill file.

#### KV Cache effect

None directly; a write changes the skill catalog that `dsh-tool-skill` renders, with the cache effect that package documents.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Project skills are not listed** — the list is read without a working directory, so skills in a project's `.dsh/skills` or `.agents/skills` folder do not appear.
- **One preset's view** — the list is the default preset's. A skill that only another preset mounts is not listed.
- **A skill cannot be renamed** — remove it and create it again.
- **Invocation controls are not editable** — `disable-model-invocation` and `user-invocable` are shown in the list and kept by an edit, but changed only in the file.
- **File names in an archive are read as UTF-8** — an archive written with another encoding for non-ASCII names imports those names garbled.
- **Archives travel as base64 over Remote** — each archive, up to 64 MiB, is held whole in memory on both ends and grows by a third in transit.
- **Removal is permanent** — a removed skill's folder is deleted, not moved to the system trash.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
