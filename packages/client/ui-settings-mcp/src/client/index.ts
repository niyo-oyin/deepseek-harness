/**
 * The MCP servers page, browser half: the servers of the MCP manager with
 * their live status, and the controls that add, change, enable, test,
 * restart, and remove one. Entries are read and written through the manager's
 * settings namespace, so a change takes effect without a restart; status,
 * tests, and restarts go through the manager's Remote namespace. The page
 * registers into the Plugins page's `plugins.item` slot while the Host serves
 * that settings namespace, so a deployment without the manager shows no trace
 * of it.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: ctx.remote and its mcpManager namespace.
import type { McpManagedServerView } from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { McpServersCard } from './McpServersCard.tsx'
import { MCP_NS, McpServersController, type McpManagerFace } from './controller.ts'
import type { McpSettings } from './mcp-entry.ts'
import { en, ja, es, fr, de, ru, pt, zh, type McpSettingsLocaleKey } from './locales.ts'

export type { McpServersCardProps } from './McpServersCard.tsx'
export type { McpManagerFace, McpPageState, McpProbeState, McpServerRow, McpServersFace } from './controller.ts'
export type { McpServerDraft, McpServerEntry, McpSettings } from './mcp-entry.ts'
export type { McpSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP servers page copy. */
    'settings.mcp': McpSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.mcp'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.mcpManager']

/** The words a failed Remote call is reported in: its stable code, then its message. */
function failureText(failure: { readonly code: string; readonly message: string }): string {
  return `${failure.code}: ${failure.message}`
}

/**
 * Mount the MCP servers page while the Host serves the manager's namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-settings-mcp: dictionaries')
  const manager: McpManagerFace = {
    watch: (onList) => {
      const stream = ctx.remote.$stream<McpManagedServerView[]>({
        name: 'MCP servers',
        open: signal => ctx.remote.mcpManager.watch(signal),
        ended: () => new Error('MCP server list ended'),
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
    probe: async (name) => {
      const result = await ctx.remote.mcpManager.probe(name)
      return result.ok ? result.value : { failed: failureText(result.error) }
    },
    restart: async (name) => {
      const result = await ctx.remote.mcpManager.restart(name)
      return result.ok ? undefined : { failed: failureText(result.error) }
    },
  }
  const controller = new McpServersController(ctx.configForms.get<McpSettings>(MCP_NS), manager)
  ctx.effect(() => () => { controller.dispose() }, 'ui-settings-mcp: form subscription')
  ctx.effect(() => ctx.configForms.whileServed([MCP_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'mcp', order: 25, label: () => t('title'), locale: NS, inject: () => controller.inject(),
  }, McpServersCard))), 'ui-settings-mcp: page')
}
