/**
 * Views and requests of the skill manager's Remote namespace.
 * Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-skill-manager/types
 */

/** One skill as a management surface lists it, whether or not the registry's `disabled` setting switches it off. */
export interface ManagedSkillView {
  /** Kebab-case skill name; unique in the list. */
  name: string
  /** One-line description the model and the user see. */
  description: string
  /** Guidance on when the model should load the skill, when the skill declares it. */
  whenToUse?: string
  /** Where the winning skill comes from, such as `user-dsh`, `user-agents`, `custom`, `bundled`, or `runtime`. */
  source: string
  /** Host path of the skill's Markdown file, when it is a file. */
  path?: string
  /** Whether the model may load the skill by itself. */
  modelInvocable: boolean
  /** Whether the user may invoke the skill by name. */
  userInvocable: boolean
  /** Whether the skill is a file in the user's own skill folders, so `update` and `delete` accept it. */
  editable: boolean
}

/** The editable text of one skill. */
export interface ManagedSkillDocument {
  /** Kebab-case skill name. */
  name: string
  /** One-line description. */
  description: string
  /** Guidance on when the model should load the skill; `''` when the skill declares none. */
  whenToUse: string
  /** Markdown instructions below the frontmatter. */
  content: string
}

/** Why a write was refused without changing anything. */
export type SkillWriteRefusal =
  /** The name is not kebab-case (`a-z`, `0-9`, single hyphens between), or Windows reads it as a device name such as `con`. */
  | 'invalid-name'
  /** A skill or a folder of that name already exists. */
  | 'name-taken'
  /** The description is empty. */
  | 'no-description'
  /** No skill of that name is listed. */
  | 'not-found'
  /** The skill is not a file in the user's own skill folders. */
  | 'not-editable'

/** One skill's bundle — its `SKILL.md` and every resource beside it — as a ZIP archive. */
export interface SkillArchive {
  /** Suggested file name, `<skill name>.zip`. */
  fileName: string
  /** The archive's bytes in base64. */
  data: string
}

/** Why a skill was not exported. */
export type SkillExportRefusal =
  /** No skill of that name is listed, or the listed one is not a file. */
  | 'not-exportable'
  /** The skill's folder is over the size or file-count limits an import accepts. */
  | 'too-large'

/** Outcome of `exportArchive`. */
export type SkillExportResult = { ok: true; archive: SkillArchive } | { ok: false; refused: SkillExportRefusal }

/** A ZIP archive of skill bundles to import. */
export interface SkillImportRequest {
  /** The archive's bytes in base64. */
  data: string
  /** Whether a skill already in the Harness home's skill folder is replaced by the archive's skill of the same name. */
  replace: boolean
}

/** What became of one skill found in an imported archive. */
export type SkillImportOutcome =
  /** Written as a new skill. */
  | 'imported'
  /** Written in place of the skill of that name in the Harness home's skill folder. */
  | 'replaced'
  /** Not written: the Harness home's skill folder already holds that name. Import again with `replace` to overwrite it. */
  | 'exists'
  /** Not written: another source supplies a skill of that name, or something else holds its folder in the Harness home's skill folder. */
  | 'name-taken'
  /** Not written: its `SKILL.md` has no frontmatter with a storable kebab-case `name` and a `description`. */
  | 'invalid'
  /** Not written: the files could not be stored. A skill it was to replace is kept. */
  | 'failed'

/** One skill found in an imported archive. */
export interface SkillImportEntry {
  /** The skill's name; for an `invalid` skill, the archive folder that holds its `SKILL.md`. */
  name: string
  /** What became of the skill. */
  outcome: SkillImportOutcome
}

/** Why an archive was refused as a whole, without writing anything. */
export type SkillImportRefusal =
  /** The bytes are not a readable ZIP archive, or an entry unpacks to another size than it declares. */
  | 'not-zip'
  /** The archive, its unpacked size, or its file count is over the limit. */
  | 'too-large'
  /** The archive holds no `SKILL.md`. */
  | 'no-skill'
  /** A file's path leaves its folder, cannot be stored on every platform, or collides with another entry's path. */
  | 'unsafe-path'

/** Outcome of `importArchive`. */
export type SkillImportResult = { ok: true; skills: SkillImportEntry[] } | { ok: false; refused: SkillImportRefusal }

/** Outcome of `create`, `update`, and `delete`. */
export type SkillWriteResult = { ok: true } | { ok: false; refused: SkillWriteRefusal }
