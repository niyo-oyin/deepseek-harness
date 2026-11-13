/**
 * Skill manager (`ctx.skillManager`): what a management surface needs beyond
 * the session catalog. It lists every skill the default agent preset sees,
 * including the ones the registry's `disabled` setting switches off, and
 * creates, changes, and removes skills in the user's own skill folders —
 * `skills/` under the Harness home and under the shared agents home, the two
 * folders `@deepseek-ai/dsh-skill-filesystem` discovers as user skills. It
 * also moves whole skill bundles as ZIP archives: an export packs a skill's
 * folder, and an import unpacks every skill of an archive into the Harness
 * home's skill folder.
 *
 * Switching a skill on or off is not an operation here: it is the registry's
 * `disabled` setting, written through Settings like any other.
 *
 * Service package (default-exports the service class).
 *
 * @module @deepseek-ai/dsh-skill-manager
 */

import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import { canonicalizeWatchPath, resolveAgentsHome, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import type { SkillSummary, SkillViewOptions } from '@deepseek-ai/dsh-skill'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
// Type-only: the optional preset registry whose default preset selects the listed view.
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import {
  ArchiveLimitError, MAX_ARCHIVE_BYTES, isStorableName, packSkillBundle, readSkillFolder, unpackSkillArchive, type ArchivedSkill,
} from './archive.ts'
import { editedSkillFile, newSkillFile, skillHeader } from './skill-file.ts'
import type {
  ManagedSkillDocument, ManagedSkillView, SkillExportResult, SkillImportEntry, SkillImportRequest, SkillImportResult, SkillWriteResult,
} from './types.ts'

export type {
  ManagedSkillDocument, ManagedSkillView, SkillArchive, SkillExportRefusal, SkillExportResult, SkillImportEntry, SkillImportOutcome,
  SkillImportRefusal, SkillImportRequest, SkillImportResult, SkillWriteRefusal, SkillWriteResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillManager: SkillManager
  }
}

/** Skill manager configuration. */
export interface Config {
  /** DeepSeek Harness config root; new skills are created in its `skills/` folder. Defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Shared agent config root, whose `skills/` folder is the second user skill folder. Defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
}

const SKILL_FILE = 'SKILL.md'
/** How often a move is tried again while Windows still holds a handle on the file, and the first wait between tries. */
const MOVE_ATTEMPTS = 5
const MOVE_RETRY_MS = 40

/** The user skill folders in the one spelling the filesystem reports for the files inside them. */
interface UserRoots {
  /** The Harness home's skill folder, where new skills are created. */
  created: string
  /** Every user skill folder; a skill in one of them can be changed and removed. */
  all: readonly string[]
}

/** Where one editable skill lives: its Markdown file, and what a removal deletes. */
interface SkillLocation {
  /** The user skill folder that holds the skill. */
  root: string
  file: string
  /** The skill's own folder for a folder skill, or the single file for a flat one. */
  removal: string
}

/** The manager service. */
export default class SkillManager extends TypertRemoteService {
  /** Schema for {@link Config}. */
  static Config: z<Config> = z.object({
    dshHome: z.string(),
    agentsHome: z.string(),
  })

  static inject = ['skills']

  /** The user skill folders as configured, the Harness home's first. */
  private readonly configuredRoots: readonly [string, string]
  /** Wake callbacks of active `watch` streams. */
  private readonly watchers = new Set<() => void>()
  /** Aborted at service dispose so `watch` streams end. */
  private readonly lifetime = new AbortController()
  /** Settled tail of the writes: each one starts after the one before it, so their name checks stay true. */
  private tail: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - the manager's plugin context.
   * @param config - resolved manager configuration.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillManager')
    this.configuredRoots = [join(resolveDshHome(config.dshHome), 'skills'), join(resolveAgentsHome(config.agentsHome), 'skills')]
  }

  /** Follow catalog changes for the `watch` streams, and end them with the service. */
  * [Service.init](): Generator<() => void, void, void> {
    yield () => { this.lifetime.abort() }
    this.ctx.on('skills/change', () => {
      for (const notify of this.watchers) notify()
    })
  }

  /**
   * List every skill the default agent preset sees outside a project, switched off or not.
   * @param signal - cancels discovery.
   * @returns the winning skill of each name, sorted by name.
   */
  async list(signal?: AbortSignal): Promise<ManagedSkillView[]> {
    const roots = await this.userRoots()
    const skills = await this.view(signal, options => this.ctx.skills.list(options))
    return await Promise.all(skills.map(skill => this.viewOf(skill, roots)))
  }

  /**
   * Stream the skill list for a management surface: the current list on
   * subscription, then the complete list again whenever it differs after a
   * catalog change.
   * @param signal - subscription lifetime; aborting ends only this stream.
   * @returns skill lists until the subscriber or the manager stops.
   */
  @Remote({ mode: 'stream' })
  async* watch(signal: AbortSignal): AsyncIterable<ManagedSkillView[]> {
    const ended = AbortSignal.any([signal, this.lifetime.signal])
    // Read through a call: the flag changes while the stream awaits.
    const aborted = (): boolean => ended.aborted
    let wake = Promise.withResolvers<void>()
    let dirty = true
    let sent: string | undefined
    const notify = (): void => {
      dirty = true
      wake.resolve()
    }
    this.watchers.add(notify)
    ended.addEventListener('abort', notify, { once: true })
    try {
      while (!aborted()) {
        if (!dirty) await wake.promise
        if (aborted()) break
        dirty = false
        wake = Promise.withResolvers<void>()
        const skills = await this.list(ended)
        // Discovery itself can report a change (a folder watched for the first time), which is no new list.
        const text = JSON.stringify(skills)
        if (text === sent) continue
        sent = text
        yield skills
      }
    } catch (error) {
      if (!aborted()) throw error
    } finally {
      this.watchers.delete(notify)
      ended.removeEventListener('abort', notify)
    }
  }

  /**
   * Read one skill's editable text, switched off or not.
   * @param name - skill name.
   * @param signal - cancels the read.
   * @returns the skill's fields and instructions, or `null` when no such skill is listed.
   */
  @Remote
  async read(name: string, signal: AbortSignal): Promise<ManagedSkillDocument | null> {
    const skill = await this.view(signal, options => this.ctx.skills.get(name, options))
    if (skill === undefined) return null
    return { name: skill.name, description: skill.description, whenToUse: skill.whenToUse ?? '', content: skill.content }
  }

  /**
   * Create a skill as `<name>/SKILL.md` in the Harness home's skill folder.
   * @param draft - the new skill's name, description, optional guidance, and instructions.
   * @param signal - cancels the name check; a started write completes.
   * @returns whether the skill was written, or why it was refused.
   */
  @Remote
  create(draft: ManagedSkillDocument, signal: AbortSignal): Promise<SkillWriteResult> {
    return this.exclusive(async () => {
      // Windows reads a device name such as `con` as the device, so no folder of that name can hold the skill.
      if (!isSkillName(draft.name) || !isStorableName(draft.name)) return refused('invalid-name')
      if (draft.description.trim() === '') return refused('no-description')
      if ((await this.list(signal)).some(skill => skill.name === draft.name)) return refused('name-taken')
      const { created } = await this.userRoots()
      const folder = join(created, draft.name)
      await mkdir(created, { recursive: true })
      try {
        // Not recursive: an existing folder of that name — an unlisted, broken skill included — is never written into.
        await mkdir(folder)
      } catch (error) {
        if (hasErrorCode(error, 'EEXIST')) return refused('name-taken')
        throw error
      }
      await writeFile(join(folder, SKILL_FILE), newSkillFile(draft.name, fieldsOf(draft)), { flag: 'wx' })
      return { ok: true }
    })
  }

  /**
   * Replace the description, guidance, and instructions of a skill in the user's skill folders.
   * @param draft - the skill's name and its edited text.
   * @param signal - cancels the lookup; a started write completes.
   * @returns whether the skill was written, or why it was refused.
   */
  @Remote
  update(draft: ManagedSkillDocument, signal: AbortSignal): Promise<SkillWriteResult> {
    return this.exclusive(async () => {
      if (draft.description.trim() === '') return refused('no-description')
      const location = await this.locate(draft.name, signal)
      if (typeof location === 'string') return refused(location)
      await writeFile(location.file, editedSkillFile(await readFile(location.file, 'utf8'), fieldsOf(draft)))
      return { ok: true }
    })
  }

  /**
   * Delete a skill in the user's skill folders: its whole folder, or the single file of a flat skill.
   * @param name - skill name.
   * @param signal - cancels the lookup; a started deletion completes.
   * @returns whether the skill was deleted, or why it was refused.
   */
  @Remote
  delete(name: string, signal: AbortSignal): Promise<SkillWriteResult> {
    return this.exclusive(async () => {
      const location = await this.locate(name, signal)
      if (typeof location === 'string') return refused(location)
      await rm(location.removal, { recursive: true })
      return { ok: true }
    })
  }

  /**
   * Pack one skill's bundle as a ZIP archive: the whole folder of a folder skill, symbolic links left out, or
   * the single file of a flat skill as `SKILL.md`. The archive's top folder is the skill's name.
   * @param name - skill name.
   * @param signal - cancels the lookup.
   * @returns the archive, or why the skill was not exported.
   */
  @Remote
  async exportArchive(name: string, signal: AbortSignal): Promise<SkillExportResult> {
    const skills = await this.list(signal)
    const skill = skills.find(entry => entry.name === name)
    if (skill?.path === undefined) return { ok: false, refused: 'not-exportable' }
    const folder = await this.bundleFolderOf(skill, skills)
    try {
      const files = folder === undefined
        ? [{ path: SKILL_FILE, data: await readFile(skill.path) }]
        : await readSkillFolder(folder)
      const data = Buffer.from(packSkillBundle(name, files)).toString('base64')
      return { ok: true, archive: { fileName: `${name}.zip`, data } }
    } catch (error) {
      if (error instanceof ArchiveLimitError) return { ok: false, refused: 'too-large' }
      throw error
    }
  }

  /**
   * Unpack the skills of a ZIP archive into the Harness home's skill folder. Every `SKILL.md` in the archive
   * marks one skill, whose folder is copied whole as `<name>/`, named by the skill's frontmatter. A skill
   * whose name the folder already holds is written only with `replace`.
   * @param request - the archive and whether it may replace skills of the same name.
   * @param signal - cancels the name checks; a started write completes.
   * @returns what became of each skill found, or why the archive was refused as a whole.
   */
  @Remote
  importArchive(request: SkillImportRequest, signal: AbortSignal): Promise<SkillImportResult> {
    return this.exclusive(async () => {
      // Base64 carries three bytes in four characters; an archive over the limit is not decoded at all.
      if (request.data.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4) return { ok: false, refused: 'too-large' }
      const unpacked = unpackSkillArchive(Buffer.from(request.data, 'base64'))
      if (typeof unpacked === 'string') return { ok: false, refused: unpacked }
      const skills: SkillImportEntry[] = []
      for (const bundle of unpacked) skills.push(await this.importBundle(bundle, request.replace, signal))
      return { ok: true, skills }
    })
  }

  /** Write one archived skill as `<name>/` in the Harness home's skill folder, unless its name is not free. */
  private async importBundle(bundle: ArchivedSkill, replace: boolean, signal: AbortSignal): Promise<SkillImportEntry> {
    const manifest = bundle.files.find(file => file.path === SKILL_FILE)
    const header = manifest === undefined ? undefined : skillHeader(new TextDecoder().decode(manifest.data))
    if (header === undefined || !isStorableName(header.name)) {
      return { name: bundle.folder === '' ? SKILL_FILE : bundle.folder, outcome: 'invalid' }
    }
    const { name } = header
    const roots = await this.userRoots()
    const target = join(roots.created, name)
    const listed = (await this.list(signal)).find(entry => entry.name === name)
    const held = listed?.path === undefined ? undefined : await this.locationOf(listed.path, roots)
    // A skill of that name from any other place would be shadowed by, or would shadow, the imported one.
    if (listed !== undefined && held?.root !== roots.created) return { name, outcome: 'name-taken' }
    // Discovery names a skill by its frontmatter, so the folder of this name can belong to another skill, or to none.
    const replacesTarget = held !== undefined && samePath(held.removal, target)
    if (!replacesTarget && await exists(target)) return { name, outcome: 'name-taken' }
    if (held !== undefined && !replace) return { name, outcome: 'exists' }
    try {
      await this.place(bundle, target, held?.removal)
    } catch (error) {
      // The other skills of the archive still get their outcome; the reason stays in the Host log.
      this.ctx.logger.warn(`skill "${name}" was not imported: ${String(error)}`)
      return { name, outcome: 'failed' }
    }
    return { name, outcome: held === undefined ? 'imported' : 'replaced' }
  }

  /**
   * Put a bundle's files in place as one folder. The files are staged beside the skill folder and moved in
   * whole, so discovery never reads a half-written skill, and a skill being replaced is set aside until the new
   * one is in place and put back when it is not.
   * @param bundle - the skill's files.
   * @param target - the folder the skill becomes.
   * @param replaced - the folder or flat file of the skill it replaces, if any.
   * @throws when the files cannot be stored; the replaced skill is back in place unless the error says where it is kept.
   */
  private async place(bundle: ArchivedSkill, target: string, replaced: string | undefined): Promise<void> {
    const root = dirname(target)
    await mkdir(root, { recursive: true })
    // Beside the skill folder under its own spelling: the same volume, so a move is a rename, and no link on the way.
    const staging = await mkdtemp(join(dirname(root), '.skill-import-'))
    let keepStaging = false
    try {
      const fresh = join(staging, 'new')
      for (const file of bundle.files) {
        const path = join(fresh, ...file.path.split('/'))
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, file.data)
      }
      const aside = replaced === undefined ? undefined : join(staging, 'old')
      if (replaced !== undefined && aside !== undefined) await move(replaced, aside)
      try {
        await move(fresh, target)
      } catch (error) {
        if (replaced !== undefined && aside !== undefined) {
          try {
            await move(aside, replaced)
          } catch (restoreError) {
            keepStaging = true
            throw new AggregateError([error, restoreError], `the skill being replaced could not be put back; its files are kept in ${aside}`)
          }
        }
        throw error
      }
    } finally {
      if (!keepStaging) await rm(staging, { recursive: true, force: true })
    }
  }

  /**
   * The folder a skill's bundle is, or nothing for a flat skill whose file sits directly in a skill root. A
   * folder that holds another listed skill is such a root, whichever provider discovers it.
   */
  private async bundleFolderOf(skill: ManagedSkillView, skills: readonly ManagedSkillView[]): Promise<string | undefined> {
    if (skill.path === undefined || basename(skill.path) !== SKILL_FILE) return undefined
    const folder = dirname(skill.path)
    const { all } = await this.userRoots()
    const canonical = await canonicalizeWatchPath(folder)
    if (all.some(root => samePath(root, canonical))) return undefined
    const holdsAnother = skills.some((other) => {
      return other.name !== skill.name && other.path !== undefined && insideOf(folder, other.path) !== undefined
    })
    return holdsAnother ? undefined : folder
  }

  /** Find the listed skill's file, or say why a write to it is refused. */
  private async locate(name: string, signal: AbortSignal): Promise<SkillLocation | 'not-found' | 'not-editable'> {
    const skill = (await this.list(signal)).find(entry => entry.name === name)
    if (skill === undefined) return 'not-found'
    return (skill.path === undefined ? undefined : await this.locationOf(skill.path, await this.userRoots())) ?? 'not-editable'
  }

  /** Run a registry read over the default preset's view, switched-off skills included. */
  private async view<T>(signal: AbortSignal | undefined, read: (options: SkillViewOptions) => Promise<T>): Promise<T> {
    await using lease = await this.presetScope()
    return await read({ scope: lease?.key, includeDisabled: true, signal })
  }

  /** The default preset's standing scope, or none where no preset registry is mounted or the preset is unusable. */
  private async presetScope(): Promise<({ key: object } & AsyncDisposable) | undefined> {
    try {
      return await this.ctx.get('agentPresets')?.acquireScope()
    } catch {
      // The global layer alone still lists deployment-level skills.
      return undefined
    }
  }

  /** Run one write after every write queued before it. */
  private exclusive<T>(write: () => Promise<T>): Promise<T> {
    const result = this.tail.then(write)
    // The tail only orders the writes; each caller receives its own failure.
    this.tail = result.catch(() => undefined)
    return result
  }

  /**
   * The user skill folders as the filesystem spells them. A home behind a symbolic link, a junction, or a
   * Windows short name is otherwise a different string from the paths discovery reports for its skills.
   */
  private async userRoots(): Promise<UserRoots> {
    const created = await canonicalizeWatchPath(this.configuredRoots[0])
    const shared = await canonicalizeWatchPath(this.configuredRoots[1])
    return { created, all: [created, shared] }
  }

  private async viewOf(skill: SkillSummary, roots: UserRoots): Promise<ManagedSkillView> {
    return {
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      source: skill.source,
      ...skill.path === undefined ? {} : { path: skill.path },
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable,
      editable: skill.path !== undefined && await this.locationOf(skill.path, roots) !== undefined,
    }
  }

  /**
   * Place a skill file in a user skill folder: `<root>/<folder>/SKILL.md` or the flat `<root>/<file>.md`.
   * Anything else — another root, a deeper path, the root itself, a skill folder that is a link to elsewhere —
   * is not the manager's to write.
   */
  private async locationOf(path: string, roots: UserRoots): Promise<SkillLocation | undefined> {
    const file = await canonicalizeWatchPath(path)
    for (const root of roots.all) {
      const segments = insideOf(root, file)
      if (segments?.length === 1) return { root, file, removal: file }
      if (segments?.length === 2 && segments[1] === SKILL_FILE) return { root, file, removal: dirname(file) }
    }
    return undefined
  }
}

/** The path segments from a folder down to a path inside it, or nothing when the path is the folder or outside it. */
function insideOf(folder: string, path: string): string[] | undefined {
  const inside = relative(folder, path)
  return inside === '' || inside.startsWith('..') || isAbsolute(inside) ? undefined : inside.split(sep)
}

function samePath(left: string, right: string): boolean {
  return relative(left, right) === ''
}

/** Move a file or folder, trying again while Windows still holds a handle on it. */
async function move(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const held = hasErrorCode(error, 'EPERM') || hasErrorCode(error, 'EBUSY') || hasErrorCode(error, 'EACCES')
      if (!held || attempt === MOVE_ATTEMPTS) throw error
      await delay(MOVE_RETRY_MS * attempt)
    }
  }
}

function fieldsOf(draft: ManagedSkillDocument): { description: string; whenToUse: string; content: string } {
  return { description: draft.description.trim(), whenToUse: draft.whenToUse.trim(), content: draft.content }
}

function refused(reason: Exclude<SkillWriteResult, { ok: true }>['refused']): SkillWriteResult {
  return { ok: false, refused: reason }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
