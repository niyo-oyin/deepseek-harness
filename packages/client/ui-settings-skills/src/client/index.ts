/**
 * The Skills page, browser half: every skill the skill manager lists, with
 * the switch that turns one off for every agent and the editor that adds,
 * changes, or removes the user's own. The switch is the skill registry's
 * `disabled` setting, written through its settings namespace, so it takes
 * effect without a restart; the list, the file writes, and ZIP import and
 * export go through the skill manager's Remote namespace, and an exported
 * archive is saved through the file-actions service. The page registers into the Plugins page's
 * `plugins.item` slot while the Host serves that settings namespace.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.fileActions Context merge, which saves an exported archive.
import type {} from '@deepseek-ai/dsh-client-ui-file-actions/client'
// Type-only: ctx.remote and its skillManager namespace.
import type { ManagedSkillView } from '@deepseek-ai/dsh-api-remotes/client'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SkillsCard } from './SkillsCard.tsx'
import {
  SKILL_NS, SkillsController, type CallFailure, type SkillExportOutcome, type SkillManagerFace, type SkillSettings,
} from './controller.ts'
import { en, ja, es, fr, de, ru, pt, zh, type SkillSettingsLocaleKey } from './locales.ts'

export type { SkillsCardProps } from './SkillsCard.tsx'
export type {
  CallFailure, SkillExportOutcome, SkillManagerFace, SkillNotice, SkillOrigin, SkillRow, SkillSaveProblem, SkillSettings, SkillsFace,
  SkillsPageState, SkillTransfer,
} from './controller.ts'
export type { SkillSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skills page copy. */
    'settings.skills': SkillSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.skills'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.skillManager', 'fileActions']

/** The outcome of one Remote call, as every namespace method resolves it. */
type Outcome<T> = { ok: true; value: T } | { ok: false; error: { readonly code: string; readonly message: string } }

/** A Remote call's value, or its failure in the words to show: its stable code, then its message. */
async function valueOf<T>(call: Promise<Outcome<T>>): Promise<T | CallFailure> {
  const result = await call
  return result.ok ? result.value : { failed: `${result.error.code}: ${result.error.message}` }
}

/**
 * Mount the Skills page while the Host serves the skill registry's namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-settings-skills: dictionaries')
  const manager: SkillManagerFace = {
    watch: (onList) => {
      const stream = ctx.remote.$stream<ManagedSkillView[]>({
        name: 'skills',
        open: signal => ctx.remote.skillManager.watch(signal),
        ended: () => new Error('skill list ended'),
      })
      void (async () => {
        for await (const frame of stream) {
          onList(frame.value)
          frame.accept()
        }
      })().catch(() => {
        // A list that cannot be followed leaves the last one on screen; reopening the page subscribes again.
      })
      return () => { void stream.dispose() }
    },
    read: name => valueOf(ctx.remote.skillManager.read(name)),
    create: draft => valueOf(ctx.remote.skillManager.create(draft)),
    update: draft => valueOf(ctx.remote.skillManager.update(draft)),
    remove: name => valueOf(ctx.remote.skillManager.delete(name)),
    importArchive: async (archive, replace) => {
      const data = bytesToBase64(new Uint8Array(await archive.arrayBuffer()))
      return await valueOf(ctx.remote.skillManager.importArchive({ data, replace }))
    },
    exportArchive: async (name): Promise<SkillExportOutcome | CallFailure> => {
      const archive = await valueOf(ctx.remote.skillManager.exportArchive(name))
      if (archive === null) return { status: 'unavailable' }
      if ('failed' in archive) return archive
      const bytes = Uint8Array.from(atob(archive.data), character => character.charCodeAt(0))
      try {
        // Desktop asks where to save; a browser hands the archive to its download manager.
        return await ctx.fileActions.save({
          url: '',
          read: () => Promise.resolve(new Blob([bytes], { type: 'application/zip' })),
          name: archive.fileName,
          mediaType: 'application/zip',
        }, ctx.fileActions.canSaveAs ? 'saveAs' : 'download')
      } catch (error) {
        return { failed: error instanceof Error ? error.message : String(error) }
      }
    },
  }
  const controller = new SkillsController(ctx.configForms.get<SkillSettings>(SKILL_NS), manager)
  ctx.effect(() => () => { controller.dispose() }, 'ui-settings-skills: form subscription')
  ctx.effect(() => ctx.configForms.whileServed([SKILL_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'skills', order: 26, label: () => t('title'), locale: NS, inject: () => controller.inject(),
  }, SkillsCard))), 'ui-settings-skills: page')
}
