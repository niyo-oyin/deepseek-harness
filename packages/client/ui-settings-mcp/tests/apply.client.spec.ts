/** What the browser half registers, when, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, NS } from '../src/client/index.ts'
import type { McpServersFace } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

/** One Host view of a served namespace. */
function view(ns: string) {
  return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision: 0 }
}

/**
 * A client with the settings mirror and the MCP manager's Remote namespace.
 * @param served - namespaces the Host describes.
 */
async function bench(served: ReturnType<typeof view>[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  // A bare runtime registers Chinese and English only; the page's own Japanese copy is exercised in the application.
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const describeSettings = vi.fn(() => Promise.resolve({ ok: true, value: { writable: true, hasDocument: true, namespaces: served } }))
  const probe = vi.fn(() => Promise.resolve({ ok: false, error: { code: 'gateway/internal', message: 'no manager', details: {} } }))
  const restart = vi.fn(() => Promise.resolve({ ok: true, value: undefined }))
  const remote = new TestRemote(ctx, { settings: { describe: describeSettings }, mcpManager: { probe, restart } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'plugins.item': { kind: 'list', scope: 'root' } } } as never, () => null)
  return { ctx, slots, describeSettings, remote, probe, restart }
}

describe('ui-settings-mcp apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the page while the Host serves the MCP manager, titled in the active locale', async () => {
    const { ctx, slots } = await bench([view('mcp-manager')])
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    const entry = slots.entries('plugins.item')[0]!
    expect(entry.options).toMatchObject({ id: 'mcp', order: 25 })
    expect(resolveSlotLabel(entry.options.label)).toBe('MCP 服务器')
    expect(entry.locale).toBe(NS)
    const face = (entry.inject as () => Pick<McpServersFace, 'hooks'>)()
    expect(Object.keys(face.hooks)).toEqual(['mcpServers'])

    await fiber.dispose()
    expect(slots.entries('plugins.item')).toHaveLength(0)
  })

  it('registers nothing on a deployment without the MCP manager', async () => {
    const { ctx, slots, describeSettings } = await bench([view('agent-loop')])
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
    expect(slots.entries('plugins.item')).toHaveLength(0)
  })

  it('sends a test and a restart to the manager, and reports a refused restart in its stable code and message', async () => {
    const { ctx, slots, probe, restart } = await bench([view('mcp-manager')])
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    const face = (slots.entries('plugins.item')[0]!.inject as () => Pick<McpServersFace, 'hooks' | 'probe' | 'restart'>)()

    face.probe('github')
    await vi.waitFor(() => { expect(probe).toHaveBeenCalledWith('github') })

    restart.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'unknown server', details: {} } } as never)
    face.restart('github')
    await vi.waitFor(() => {
      expect(face.hooks.mcpServers.getSnapshot().notice).toEqual({ kind: 'failed', message: 'gateway/internal: unknown server' })
    })
  })
})
