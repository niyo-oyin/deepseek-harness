---
description: "Skills settings page for users who switch skills off for every agent, write their own SKILL.md skills, or import and export skill folders as ZIP archives, and for maintainers changing that page."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-skills

## Summary

Open **Plugins** and select **Skills** to see every skill an agent can load and switch any of them off for every agent. You can add, edit, and remove your own skills, and import or export whole skill folders as ZIP archives. A change applies without restarting the application. Skills in a project's folder are not listed.

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

The `dsh-web-app` bundle mounts the page as the row `ui-settings-skills`. It appears as the **Skills** card under the Plugins page's built-in settings while the Host serves the skill registry's settings namespace (`skill`) and the [skill manager](../../skill/skill-manager/README.md)'s Remote namespace.

### What the page shows

Each skill is one row: its name, where it comes from, its description, the path of its file, and a switch. The list shows placeholder rows until the first list arrives.

| Where it comes from | Meaning | Controls |
|---|---|---|
| Yours | A file in the Harness home's skill folder | Switch, Edit, Export, Remove |
| Yours (.agents) | A file in the shared agents home's skill folder | Switch, Edit, Export, Remove |
| Built in | Shipped with the application, packaged by a plugin, or found in a configured custom skill folder such as an agent preset's | Switch, View, and Export when it is a file |
| Plugin | Registered at runtime by a plugin, or supplied by another skill provider | Switch, View, and Export when it is a file |

A row also says when a skill is **Manual only** (the model does not load it by itself) or **Model only** (the user cannot invoke it by name).

The switch turns a skill off for every agent: it leaves the model's skill list and the `/` menu, and it cannot be loaded. Nothing in the skill's file changes, so built-in and plugin skills can be switched off too, and switching one back on restores it as it was. A switch shows a busy mark until its write returns. When the deployment stores settings read-only, the switches are locked; the skill files can still be changed.

If the page stops receiving list updates, it says so in a line that stays until the page is opened again; the rows shown may be out of date until then. A failed operation and a finished export appear as a message that fades on its own.

### Adding or changing a skill

**Add skill** opens the editor. While an editor is open, the other **Edit**, **View**, **Add skill**, and **Import ZIP** buttons are disabled. The name is the skill's identity, so it cannot be changed afterwards; remove the skill and add it again to rename it.

| Field | Meaning |
|---|---|
| Name | Lowercase letters and digits, joined by single hyphens |
| Description | One line saying what the skill is for; the model reads it to decide whether to load the skill |
| When to use | Optional; the situations in which the model should load the skill |
| Instructions | What the model follows once the skill is loaded, in Markdown |

A new skill is saved as `<name>/SKILL.md` in the Harness home's skill folder. **Edit** changes these fields of one of the user's own skills and keeps everything else in its file. **View** shows any other skill read-only. **Remove** asks for confirmation in a dialog, then deletes the skill permanently: its folder with every file in it, or the single file of a flat skill.

### Importing and exporting a skill bundle

A skill is often a folder: `SKILL.md` with scripts, references, and assets beside it. **Export** on a skill's row saves that whole folder as `<name>.zip`. Desktop asks where to save it and then shows the path; a browser hands it to its download manager. A folder over 10,000 files or 256 MiB, or with an archive over 64 MiB, is not exported, and the page says so.

**Import ZIP** takes such an archive, as a `.zip` or `.skill` file, and adds every skill in it to the Harness home's skill folder (`~/.dsh/skills` by default). The archive may hold `SKILL.md` at its top, one wrapping folder, or several skills. The page then lists one line per skill, `<name>: ` followed by:

| Shown after the name | Meaning |
|---|---|
| `added` | The skill is new and was written with all its files |
| `replaced` | The skill replaced your skill of the same name |
| `not added, because you already have a skill with this name` | Nothing was written; **Replace existing skills** repeats the import and overwrites those skills |
| `not added, because a built-in, plugin, or shared skill already uses this name, or your skill folder has a folder of this name …` | Nothing was written; the name belongs to a skill this page cannot replace, or its folder holds something else |
| `not added, because its SKILL.md has no valid name and description` | Its `SKILL.md` has no frontmatter naming and describing the skill |
| `not added, because its files could not be stored; …` | Nothing was written for this skill; a skill it was to replace is kept |

An archive that is not a ZIP, holds no `SKILL.md`, is over the limits, or carries a file path that leaves its folder or cannot be stored is refused as a whole, and the page names the reason.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`SkillsController`](src/client/controller.ts) joins two sources. The skill list comes from `ctx.remote.skillManager.watch`, opened when the first page mounts and disposed when the last one unmounts. Whether a skill is switched on comes from `ctx.configForms.get('skill')`: a skill is on unless its name is in the registry's `disabled` list.

The switch writes the whole `disabled` list in one settings write. A switch made while an earlier one is still being written is computed from the list the earlier one leaves, so quick successive switches all hold. Names in the list that are not listed right now are kept, because their skill may return. Removing a skill also takes its name out of the list, so a later skill of the same name starts switched on.

Creating, editing, and removing go to the skill manager, which owns the name rules and the files. The page does not repeat those rules: it shows the manager's refusal beside the field at fault and keeps the editor open. These writes do not depend on the settings document being writable, so a read-only deployment locks only the switches.

Import and export go to the skill manager as well. The page reads the chosen file and sends its bytes as base64; for an export it turns the returned base64 into a file and saves it through `ctx.fileActions`, with the save dialog where the platform has one. The controller keeps the archive of an import that left skills unreplaced until its result is dismissed, so replacing them needs no second file choice.

[`SkillsCard.tsx`](src/client/SkillsCard.tsx) renders the Plugins page's two views: the one-line summary and the page. The editor reads a skill once when it opens, so a list update behind it never replaces what is being typed.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings forms the switch writes through.
- [dsh-skill-manager](../../skill/skill-manager/README.md) — the Host service behind the list, the editor, and the archives.
- [dsh-skill](../../skill/skill/README.md) — the registry and its `disabled` setting.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Project skills are not listed** — skills in a project's `.dsh/skills` or `.agents/skills` folder follow their project and do not appear here.
- **A skill cannot be renamed** — its name is its identity.
- **Invocation controls are shown, not edited** — change `disable-model-invocation` and `user-invocable` in the skill's file.
- **An import cannot replace a skill in the shared agents home** — skills are always imported into the Harness home's skill folder.
- **Removal is permanent** — a removed skill's folder is not moved to the system trash.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
