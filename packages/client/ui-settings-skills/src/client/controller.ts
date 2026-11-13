/**
 * The Skills page's model: the skill list the skill manager streams, joined with the registry's
 * `disabled` setting, and the writes the page offers.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  ManagedSkillDocument, ManagedSkillView, SkillExportRefusal, SkillImportEntry, SkillImportRefusal, SkillImportResult, SkillWriteRefusal,
  SkillWriteResult,
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
  /** The manager did not export the skill. */
  | { readonly status: 'refused'; readonly reason: SkillExportRefusal }

/** The skill manager's operations this page calls, bound to the Remote and the file-save service by the plugin. */
export interface SkillManagerFace {
  /**
   * Follow the manager's skill list.
   * @param onList - receives the complete list at subscription and after every change.
   * @param onFailure - receives the reason once when the list can no longer be followed; no list follows it.
   * @returns the disposer ending the subscription.
   */
  watch(onList: (skills: readonly ManagedSkillView[]) => void, onFailure: (reason: string) => void): () => void
  /**
   * Read one skill's editable text.
   * @param name - the skill to read.
   * @returns its text, `null` when it is no longer listed, or the reason it could not be read.
   */
  read(name: string): Promise<ManagedSkillDocument | null | CallFailure>
  /**
   * Create a skill in the user's skill folder.
   * @param draft - the new skill's name and text.
   * @returns whether it was written or why it was refused, or the reason the call failed.
   */
  create(draft: ManagedSkillDocument): Promise<SkillWriteResult | CallFailure>
  /**
   * Replace the text of a skill in the user's skill folders.
   * @param draft - the skill's name and its edited text.
   * @returns whether it was written or why it was refused, or the reason the call failed.
   */
  update(draft: ManagedSkillDocument): Promise<SkillWriteResult | CallFailure>
  /**
   * Delete a skill in the user's skill folders.
   * @param name - the skill to delete.
   * @returns whether it was deleted or why it was refused, or the reason the call failed.
   */
  remove(name: string): Promise<SkillWriteResult | CallFailure>
  /**
   * Import the skill bundles of a ZIP archive into the user's skill folder.
   * @param archive - the archive's bytes.
   * @param replace - whether a skill of the same name in that folder is replaced.
   * @returns what became of each skill or why the archive was refused, or the reason the call failed.
   */
  importArchive(archive: Blob, replace: boolean): Promise<SkillImportResult | CallFailure>
  /**
   * Export one skill's bundle as a ZIP archive and hand it to the platform's save.
   * @param name - the skill to export.
   * @returns what became of the export, or the reason the call or the save failed.
   */
  exportArchive(name: string): Promise<SkillExportOutcome | CallFailure>
}

/** Where a skill comes from, as the page names it. */
export type SkillOrigin = 'user' | 'shared' | 'builtIn' | 'plugin'

/** One skill as the page lists it. */
export interface SkillRow extends Omit<ManagedSkillView, 'source'> {
  readonly origin: SkillOrigin
  /** Whether agents see the skill: it is not in the registry's `disabled` list, counting a switch still being written. */
  readonly enabled: boolean
  /** Whether a switch of this skill is still being written. */
  readonly switching: boolean
}

/** A write or an operation that did not go through. */
export type SkillNotice =
  /** The settings write was not accepted. */
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed'; readonly message: string }
  /** The named skill is no longer listed, or is not one this page can change. */
  | { readonly kind: 'gone'; readonly name: string }
  /** The named skill's folder is over the limits of an archive. */
  | { readonly kind: 'exportTooLarge'; readonly name: string }

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
  /** Why the skill list is no longer followed; what is listed may be out of date until the page is opened again. */
  readonly stale: string | null
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
  /** Switch one skill on or off for every agent. */
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
  /** Delete one of the user's skills; a failure becomes the page notice. */
  remove: (name: string) => void
  /** Import the skill bundles of a ZIP archive; skills whose name is already held are left for {@link SkillsFace.replaceImported}. */
  importArchive: (archive: Blob) => void
  /** Repeat the last import, replacing the skills it left because their name was already held. */
  replaceImported: () => void
  /** Save one skill's bundle as a ZIP archive. */
  exportArchive: (name: string) => void
  /** Clear the page notice. */
  dismissNotice: () => void
  /** Clear the import or export result, and release the archive kept for a replacement. */
  dismissTransfer: () => void
}

function originOf(source: string): SkillOrigin {
  switch (source) {
    case 'user-dsh': return 'user'
    case 'user-agents': return 'shared'
    // Custom skill folders (an agent preset's own included) and packaged skills.
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
  private stale: string | null = null
  private transfer: SkillTransfer | null = null
  /** The archive of the last import that left skills unreplaced; released when the result is dismissed. */
  private replaceable: Blob | undefined
  /**
   * The `disabled` list as the latest queued switch leaves it. The form's snapshot follows only the last write
   * of a burst, so a second switch made before the first returns is computed from this, not from the snapshot.
   */
  private desired: readonly string[] | undefined
  /** Switch writes still in flight, by the skill each one switches. */
  private readonly switching = new Map<string, number>()
  private observers = 0
  private unwatch: (() => void) | undefined
  private disposed = false

  /**
   * @param form - the shared configuration form of the skill registry's entry.
   * @param manager - the skill manager's operations.
   */
  constructor(private readonly form: ConfigForm<SkillSettings>, private readonly manager: SkillManagerFace) {
    this.store = createSnapshotStore<SkillsPageState>(this.projection(), { flush: 'sync' })
    this.unsubscribe = form.subscribe(() => { this.publish() })
  }

  /** Publish the page; a result that arrives after the page's plugin is gone has nobody to show it to. */
  private publish(): void {
    if (!this.disposed) this.store.set(this.projection())
  }

  private disabled(): readonly string[] {
    return this.desired ?? this.form.getSnapshot().value?.disabled ?? []
  }

  private projection(): SkillsPageState {
    const snapshot = this.form.getSnapshot()
    const disabled = new Set(this.disabled())
    const rows = (this.live ?? []).map(({ source, ...skill }): SkillRow => ({
      ...skill, origin: originOf(source), enabled: !disabled.has(skill.name), switching: this.switching.has(skill.name),
    }))
    return {
      status: snapshot.status, writable: snapshot.writable, listed: this.live !== undefined, stale: this.stale, rows,
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

  /** Follow the manager's list unless it is followed already; a subscription that failed is opened again. */
  private follow(): void {
    if (this.unwatch !== undefined) return
    const stop = this.manager.watch((skills) => {
      this.live = skills
      this.stale = null
      this.publish()
    }, (reason) => {
      if (this.unwatch !== stop) return
      // The list on screen may be out of date from here on; the next visit to the page subscribes again.
      this.unwatch = undefined
      this.stale = reason
      this.publish()
    })
    this.unwatch = stop
  }

  /** Send one archive to the manager and show what became of its skills. */
  private async import(archive: Blob, replace: boolean): Promise<void> {
    this.replaceable = undefined
    this.show({ kind: 'importing' })
    let result: SkillImportResult | CallFailure
    try {
      result = await this.manager.importArchive(archive, replace)
    } catch (error) {
      // Reading or encoding the chosen file can fail before any call is made.
      result = { failed: messageOf(error) }
    }
    if (this.disposed) return
    if ('failed' in result) {
      this.transfer = null
      return this.report({ kind: 'failed', message: result.failed })
    }
    if (!result.ok) return this.show({ kind: 'importRefused', reason: result.refused })
    const replaceable = result.skills.some(skill => skill.outcome === 'exists')
    if (replaceable) this.replaceable = archive
    this.show({ kind: 'imported', skills: result.skills, replaceable })
  }

  /**
   * Write the whole `disabled` list and report a refusal or a carrier failure as the page notice.
   * @param names - the list to store.
   * @param switched - the skill whose switch this write carries, shown as busy until it returns.
   */
  private async writeDisabled(names: readonly string[], switched?: string): Promise<void> {
    this.desired = [...names]
    if (switched !== undefined) this.switching.set(switched, (this.switching.get(switched) ?? 0) + 1)
    this.publish()
    let notice: SkillNotice | null
    try {
      notice = await this.form.mutate([{ op: 'set', path: ['disabled'], value: [...names] }]) ? null : { kind: 'refused' }
    } catch (error) {
      notice = { kind: 'failed', message: messageOf(error) }
    }
    if (switched !== undefined) {
      const left = (this.switching.get(switched) ?? 1) - 1
      if (left === 0) this.switching.delete(switched)
      else this.switching.set(switched, left)
    }
    // Once nothing is in flight the form's snapshot is what the Host holds, accepted or reloaded after a refusal.
    if (this.switching.size === 0) this.desired = undefined
    this.notice = notice
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
        this.observers += 1
        this.follow()
        return () => {
          if (--this.observers > 0) return
          this.unwatch?.()
          this.unwatch = undefined
        }
      },
      setEnabled: (name, enabled) => {
        // Names of skills that are not listed right now stay in the list: their skill may return.
        const others = this.disabled().filter(entry => entry !== name)
        void this.writeDisabled(enabled ? others : [...others, name], name)
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
          if (this.disabled().includes(name)) await this.writeDisabled(this.disabled().filter(entry => entry !== name), name)
        })
      },
      importArchive: (archive) => { void this.import(archive, false) },
      replaceImported: () => {
        if (this.replaceable !== undefined) void this.import(this.replaceable, true)
      },
      exportArchive: (name) => {
        void this.manager.exportArchive(name).then((outcome) => {
          if ('failed' in outcome) return this.report({ kind: 'failed', message: outcome.failed })
          if (outcome.status === 'refused') {
            return this.report(outcome.reason === 'too-large' ? { kind: 'exportTooLarge', name } : { kind: 'gone', name })
          }
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

  /** Release the form subscription, the skill list, and the archive kept for a replacement. */
  dispose(): void {
    this.disposed = true
    this.replaceable = undefined
    this.unsubscribe()
    this.unwatch?.()
    this.unwatch = undefined
  }
}
