/**
 * The Skills page's model: the skill list the skill manager streams, joined with the registry's
 * `disabled` setting, and the writes the page offers.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  ManagedSkillDocument, ManagedSkillView, SkillImportEntry, SkillImportRefusal, SkillImportResult, SkillWriteRefusal, SkillWriteResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Profile entry id of the skill registry, which is also its settings namespace. */
export const SKILL_NS = 'skill'

/** The registry settings the page reads and writes. */
export interface SkillSettings {
  /** Names of the skills switched off for every agent. */
  disabled?: string[]
}

/** A manager call that could not be made or completed, in the words to show. */
export interface CallFailure {
  readonly failed: string
}

/** What became of an export once the archive was handed to the platform's save. */
export type SkillExportOutcome =
  /** Saved to a known place (Desktop). */
  | { readonly status: 'saved'; readonly path: string }
  /** Handed to the browser's download manager, which reports no destination. */
  | { readonly status: 'requested' }
  /** The save dialog was dismissed. */
  | { readonly status: 'cancelled' }
  /** The skill is no longer listed or has no file to export. */
  | { readonly status: 'unavailable' }

/** The skill manager's operations this page calls, bound to the Remote and the file-save service by the plugin. */
export interface SkillManagerFace {
  /**
   * Follow the manager's skill list.
   * @param onList - receives the complete list at subscription and after every change.
   * @returns the disposer ending the subscription.
   */
  watch(onList: (skills: readonly ManagedSkillView[]) => void): () => void
  /**
   * Read one skill's editable text.
   * @param name - the skill to read.
   * @returns its text, `null` when it is no longer listed, or the reason it could not be read.
   */
  read(name: string): Promise<ManagedSkillDocument | null | CallFailure>
  /** Create a skill in the user's skill folder. */
  create(draft: ManagedSkillDocument): Promise<SkillWriteResult | CallFailure>
  /** Replace the text of a skill in the user's skill folders. */
  update(draft: ManagedSkillDocument): Promise<SkillWriteResult | CallFailure>
  /** Delete a skill in the user's skill folders. */
  remove(name: string): Promise<SkillWriteResult | CallFailure>
  /**
   * Import the skill bundles of a ZIP archive into the user's skill folder.
   * @param archive - the archive's bytes.
   * @param replace - whether a skill of the same name in that folder is replaced.
   */
  importArchive(archive: Blob, replace: boolean): Promise<SkillImportResult | CallFailure>
  /**
   * Export one skill's bundle as a ZIP archive and hand it to the platform's save.
   * @param name - the skill to export.
   */
  exportArchive(name: string): Promise<SkillExportOutcome | CallFailure>
}

/** Where a skill comes from, as the page names it. */
export type SkillOrigin = 'user' | 'shared' | 'builtIn' | 'plugin'

/** One skill as the page lists it. */
export interface SkillRow extends Omit<ManagedSkillView, 'source'> {
  readonly origin: SkillOrigin
  /** Whether agents see the skill: it is not in the registry's `disabled` list. */
  readonly enabled: boolean
}

/** A write or an operation that did not go through. */
export type SkillNotice =
  /** The settings write was not accepted. */
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed'; readonly message: string }
  /** The named skill is no longer listed, or is not one this page can change. */
  | { readonly kind: 'gone'; readonly name: string }

/** The latest import or export, shown until it is dismissed or the next one starts. */
export type SkillTransfer =
  | { readonly kind: 'importing' }
  /** What became of each skill of the archive; `replaceable` when repeating the import with replace would write more. */
  | { readonly kind: 'imported'; readonly skills: readonly SkillImportEntry[]; readonly replaceable: boolean }
  | { readonly kind: 'importRefused'; readonly reason: SkillImportRefusal }
  /** The named skill was saved; `path` where the platform reports the destination. */
  | { readonly kind: 'exported'; readonly name: string; readonly path?: string }

/** Why the editor could not save: the manager's refusal, or a failure in the words to show. */
export type SkillSaveProblem = { readonly kind: SkillWriteRefusal } | { readonly kind: 'failed'; readonly message: string }

/** What the Skills page renders. */
export interface SkillsPageState {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly writable: boolean
  /** Whether the manager's first list has arrived. */
  readonly listed: boolean
  readonly rows: readonly SkillRow[]
  readonly notice: SkillNotice | null
  readonly transfer: SkillTransfer | null
}

/** The registration-side face the page's slot entry injects. */
export interface SkillsFace {
  hooks: {
    /** Page snapshot bound by the renderer as useSkills. */
    skills: SnapshotStore<SkillsPageState>
  }
  /** Follow the skill list while the page is shown; returns the disposer. */
  observe: () => () => void
  setEnabled: (name: string, enabled: boolean) => void
  /**
   * Read one skill for the editor.
   * @param name - the skill to open.
   * @returns its text, or nothing when it could not be read; the reason becomes the page notice.
   */
  load: (name: string) => Promise<ManagedSkillDocument | undefined>
  /**
   * Create a skill, or replace the text of the existing skill named by the draft.
   * @param draft - the editor's fields.
   * @param existing - whether the draft edits a skill that is already listed.
   * @returns why it was not saved, or nothing once written.
   */
  save: (draft: ManagedSkillDocument, existing: boolean) => Promise<SkillSaveProblem | undefined>
  remove: (name: string) => void
  /** Import the skill bundles of a ZIP archive; skills whose name is already held are left for {@link SkillsFace.replaceImported}. */
  importArchive: (archive: Blob) => void
  /** Repeat the last import, replacing the skills it left because their name was already held. */
  replaceImported: () => void
  /** Save one skill's bundle as a ZIP archive. */
  exportArchive: (name: string) => void
  dismissNotice: () => void
  dismissTransfer: () => void
}

function originOf(source: string): SkillOrigin {
  switch (source) {
    case 'user-dsh': return 'user'
    case 'user-agents': return 'shared'
    // A preset's own skill folder and the skills packaged with the application.
    case 'custom':
    case 'bundled': return 'builtIn'
    default: return 'plugin'
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Joins the manager's skill list with the registry's `disabled` setting and carries the page's writes. */
export class SkillsController {
  private readonly store: SnapshotStore<SkillsPageState>
  private readonly unsubscribe: () => void
  private live: readonly ManagedSkillView[] | undefined
  private notice: SkillNotice | null = null
  private transfer: SkillTransfer | null = null
  /** The archive of the last import that left skills unreplaced; released when the result is dismissed. */
  private replaceable: Blob | undefined
  private observers = 0
  private unwatch: (() => void) | undefined

  /**
   * @param form - the shared configuration form of the skill registry's entry.
   * @param manager - the skill manager's operations.
   */
  constructor(private readonly form: ConfigForm<SkillSettings>, private readonly manager: SkillManagerFace) {
    this.store = createSnapshotStore<SkillsPageState>(this.projection(), { flush: 'sync' })
    this.unsubscribe = form.subscribe(() => { this.publish() })
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  private disabled(): readonly string[] {
    return this.form.getSnapshot().value?.disabled ?? []
  }

  private projection(): SkillsPageState {
    const snapshot = this.form.getSnapshot()
    const disabled = new Set(this.disabled())
    const rows = (this.live ?? []).map(({ source, ...skill }): SkillRow => ({
      ...skill, origin: originOf(source), enabled: !disabled.has(skill.name),
    }))
    return {
      status: snapshot.status, writable: snapshot.writable, listed: this.live !== undefined, rows,
      notice: this.notice, transfer: this.transfer,
    }
  }

  private report(notice: SkillNotice): void {
    this.notice = notice
    this.publish()
  }

  private show(transfer: SkillTransfer | null): void {
    this.transfer = transfer
    this.publish()
  }

  /** Send one archive to the manager and show what became of its skills. */
  private async import(archive: Blob, replace: boolean): Promise<void> {
    this.replaceable = undefined
    this.show({ kind: 'importing' })
    const result = await this.manager.importArchive(archive, replace)
    if ('failed' in result) {
      this.transfer = null
      return this.report({ kind: 'failed', message: result.failed })
    }
    if (!result.ok) return this.show({ kind: 'importRefused', reason: result.refused })
    const replaceable = result.skills.some(skill => skill.outcome === 'exists')
    if (replaceable) this.replaceable = archive
    this.show({ kind: 'imported', skills: result.skills, replaceable })
  }

  /** Write the whole `disabled` list and report a refusal or a carrier failure as the page notice. */
  private async writeDisabled(names: readonly string[]): Promise<void> {
    try {
      this.notice = await this.form.mutate([{ op: 'set', path: ['disabled'], value: [...names] }]) ? null : { kind: 'refused' }
    } catch (error) {
      this.notice = { kind: 'failed', message: messageOf(error) }
    }
    this.publish()
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its actions.
   */
  inject(): SkillsFace {
    return {
      hooks: { skills: this.store },
      observe: () => {
        if (this.observers++ === 0) {
          this.unwatch = this.manager.watch((skills) => {
            this.live = skills
            this.publish()
          })
        }
        return () => {
          if (--this.observers > 0) return
          this.unwatch?.()
          this.unwatch = undefined
        }
      },
      setEnabled: (name, enabled) => {
        // Names of skills that are not listed right now stay in the list: their skill may return.
        const others = this.disabled().filter(entry => entry !== name)
        void this.writeDisabled(enabled ? others : [...others, name])
      },
      load: async (name) => {
        const result = await this.manager.read(name)
        if (result !== null && !('failed' in result)) return result
        this.report(result === null ? { kind: 'gone', name } : { kind: 'failed', message: result.failed })
        return undefined
      },
      save: async (draft, existing) => {
        const result = await (existing ? this.manager.update(draft) : this.manager.create(draft))
        if ('failed' in result) return { kind: 'failed', message: result.failed }
        return result.ok ? undefined : { kind: result.refused }
      },
      remove: (name) => {
        void this.manager.remove(name).then(async (result) => {
          if ('failed' in result) return this.report({ kind: 'failed', message: result.failed })
          if (!result.ok) return this.report({ kind: 'gone', name })
          // A removed skill's switch goes with it, so a later skill of the same name starts switched on.
          if (this.disabled().includes(name)) await this.writeDisabled(this.disabled().filter(entry => entry !== name))
        })
      },
      importArchive: (archive) => { void this.import(archive, false) },
      replaceImported: () => {
        if (this.replaceable !== undefined) void this.import(this.replaceable, true)
      },
      exportArchive: (name) => {
        void this.manager.exportArchive(name).then((outcome) => {
          if ('failed' in outcome) return this.report({ kind: 'failed', message: outcome.failed })
          if (outcome.status === 'unavailable') return this.report({ kind: 'gone', name })
          // A dismissed save dialog leaves nothing to say.
          if (outcome.status === 'cancelled') return
          this.show({ kind: 'exported', name, ...outcome.status === 'saved' ? { path: outcome.path } : {} })
        })
      },
      dismissNotice: () => {
        this.notice = null
        this.publish()
      },
      dismissTransfer: () => {
        this.replaceable = undefined
        this.show(null)
      },
    }
  }

  /** Release the form subscription and the skill list. */
  dispose(): void {
    this.unsubscribe()
    this.unwatch?.()
    this.unwatch = undefined
  }
}
