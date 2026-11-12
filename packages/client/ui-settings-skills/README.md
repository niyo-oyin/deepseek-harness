---
description: "Skills page of the dsh web client's Plugins page, for users managing skills and maintainers changing the page."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-skills

## Summary

This package adds the **Skills** page to the Plugins page's built-in settings. It lists every skill the agent can use, lets the user switch one off, adds, edits, and removes skills in the user's own skill folders, and imports and exports whole skill bundles as ZIP archives. A change takes effect at once, without restarting the application, and the page is available in all eight interface languages.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The `dsh-web-app` bundle mounts the page as the row `ui-settings-skills`. It appears as the **Skills** card under the Plugins page's built-in settings while the Host serves the skill registry's settings namespace (`skill`) and the [skill manager](../../skill/skill-manager/README.md)'s Remote namespace.

### What the page shows

Each skill is one row: its name, where it comes from, its description, the path of its file, and a switch.

| Where it comes from | Meaning | Controls |
|---|---|---|
| Yours | A file in the Harness home's skill folder | Switch, Edit, Export, Remove |
| Yours (.agents) | A file in the shared agents home's skill folder | Switch, Edit, Export, Remove |
| Built in | Shipped with the application or with an agent preset | Switch, View, and Export when it is a file |
| Plugin | Registered by an installed plugin | Switch, View |

A row also says when a skill is **Manual only** (the model does not load it by itself) or **Model only** (the user cannot invoke it by name).

The switch turns a skill off for every agent: it leaves the model's skill list and the `/` menu, and it cannot be loaded. Nothing in the skill's file changes, so built-in and plugin skills can be switched off too, and switching one back on restores it as it was.

### Adding or changing a skill

**Add skill** opens the editor. The name is the skill's identity, so it cannot be changed afterwards; remove the skill and add it again to rename it.

| Field | Meaning |
|---|---|
| Name | Lowercase letters, digits, and single hyphens between them |
| Description | One line saying what the skill is for; the model reads it to decide whether to load the skill |
| When to use | Optional; the situations in which the model should load the skill |
| Instructions | What the model follows once the skill is loaded, in Markdown |

A new skill is saved as `<name>/SKILL.md` in the Harness home's skill folder. **Edit** changes these fields of one of the user's own skills and keeps everything else in its file. **View** shows a built-in or plugin skill read-only. **Remove** deletes the skill's folder with every file in it, after a confirmation.

### Importing and exporting a skill bundle

A skill is often a folder: `SKILL.md` with scripts, references, and assets beside it. **Export** on a skill's row saves that whole folder as `<name>.zip`. Desktop asks where to save it and then shows the path; a browser hands it to its download manager.

**Import ZIP** takes such an archive and adds every skill in it to the Harness home's skill folder (`~/.dsh/skills` by default). The archive may hold `SKILL.md` at its top, one wrapping folder, or several skills. The page then lists what became of each skill:

| Result | Meaning |
|---|---|
| Added | The skill is new and was written with all its files |
| Replaced | The skill replaced the one of the same name |
| Not added — you already have a skill with this name | Nothing was written; **Replace existing skills** repeats the import and overwrites those skills |
| Not added — a built-in, plugin, or shared skill uses this name | Nothing was written; the name belongs to a skill this page cannot replace |
| Not added — no valid name and description | Its `SKILL.md` has no frontmatter naming the skill |

An archive that is not a ZIP, holds no `SKILL.md`, is too large, or carries a file path that leaves its folder is refused as a whole.

<a id="understand-the-implementation"></a>
## Understand the implementation

[`SkillsController`](src/client/controller.ts) joins two sources. The skill list comes from `ctx.remote.skillManager.watch`, opened when the first page mounts and disposed when the last one unmounts. Whether a skill is switched on comes from `ctx.configForms.get('skill')`: a skill is on unless its name is in the registry's `disabled` list.

The switch writes the whole `disabled` list in one settings write. Names in the list that are not listed right now are kept, because their skill may return. Removing a skill also takes its name out of the list, so a later skill of the same name starts switched on.

Creating, editing, and removing go to the skill manager, which owns the name rules and the files. The page does not repeat those rules: it shows the manager's refusal in the editor and keeps the editor open. These writes do not depend on the settings document being writable, so a read-only deployment locks only the switches.

Import and export go to the skill manager as well. The page reads the chosen file and sends its bytes as base64; for an export it turns the returned base64 into a file and saves it through `ctx.fileActions`, with the save dialog where the platform has one. The controller keeps the archive of an import that left skills unreplaced until its result is dismissed, so replacing them needs no second file choice.

[`SkillsCard.tsx`](src/client/SkillsCard.tsx) renders the Plugins page's two views: the one-line summary and the page. The editor reads a skill once when it opens, so a list update behind it never replaces what is being typed.

<a id="model-experience"></a>
## Model Experience

None directly. The page registers nothing model-facing. Switching a skill off removes it from the catalog that [`dsh-tool-skill`](../../skill/tool-skill/README.md) presents to the model, and a skill added here appears there, as those packages document.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Project skills are not listed** — skills in a project's `.dsh/skills` or `.agents/skills` folder follow their project and do not appear here.
- **A skill cannot be renamed** — its name is its identity.
- **Invocation controls are shown, not edited** — change `disable-model-invocation` and `user-invocable` in the skill's file.
- **An import cannot replace a skill in the shared agents home** — skills are always imported into the Harness home's skill folder.
- **Removal is permanent** — a removed skill's folder is not moved to the system trash.
