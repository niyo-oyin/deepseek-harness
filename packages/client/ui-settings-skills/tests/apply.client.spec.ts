/** What the browser half registers, when, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, NS } from '../src/client/index.ts'
import type { SkillsFace } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

/** One Host view of a served namespace. */
function view(ns: string) {
  return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision: 0 }
}

/**
 * A client with the settings mirror and the skill manager's Remote namespace.
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
  const draft = { name: 'review', description: 'Review a change', whenToUse: '', content: 'Steps.' }
  const read = vi.fn(() => Promise.resolve({ ok: true, value: draft }))
  const create = vi.fn(() => Promise.resolve({ ok: true, value: { ok: false, refused: 'name-taken' } }))
  const update = vi.fn(() => Promise.resolve({ ok: false, error: { code: 'gateway/internal', message: 'EACCES', details: {} } }))
  const remove = vi.fn(() => Promise.resolve({ ok: true, value: { ok: true } }))
  const importArchive = vi.fn(() => Promise.resolve({ ok: true, value: { ok: true, skills: [{ name: 'review', outcome: 'imported' }] } }))
  const exportArchive = vi.fn(() => Promise.resolve({ ok: true, value: { fileName: 'review.zip', data: btoa('zip bytes') } }))
  const remote = new TestRemote(ctx, {
    settings: { describe: describeSettings },
    skillManager: { read, create, update, delete: remove, importArchive, exportArchive },
  })
  const save = vi.fn((_source: { read?: (signal: AbortSignal) => Promise<Blob>; name?: string }, _mode: string) =>
    Promise.resolve({ status: 'saved', path: '/downloads/review.zip' }))
  ctx.provide('fileActions', { save, canSaveAs: true } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'plugins.item': { kind: 'list', scope: 'root' } } } as never, () => null)
  return { ctx, slots, describeSettings, remote, draft, read, create, update, remove, importArchive, exportArchive, save }
}

describe('ui-settings-skills apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the page while the Host serves the skill registry, titled in the active locale', async () => {
    const { ctx, slots } = await bench([view('skill')])
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    const entry = slots.entries('plugins.item')[0]!
    expect(entry.options).toMatchObject({ id: 'skills', order: 26 })
    expect(resolveSlotLabel(entry.options.label)).toBe('技能')
    expect(entry.locale).toBe(NS)
    const face = (entry.inject as () => Pick<SkillsFace, 'hooks'>)()
    expect(Object.keys(face.hooks)).toEqual(['skills'])

    await fiber.dispose()
    expect(slots.entries('plugins.item')).toHaveLength(0)
  })

  it('registers nothing on a deployment without the skill registry\'s namespace', async () => {
    const { ctx, slots, describeSettings } = await bench([view('agent-loop')])
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
    expect(slots.entries('plugins.item')).toHaveLength(0)
  })

  it('sends reads and writes to the skill manager, and reports a failed call in its stable code and message', async () => {
    const { ctx, slots, draft, read, create, remove } = await bench([view('skill')])
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    const face = (slots.entries('plugins.item')[0]!.inject as () => Pick<SkillsFace, 'hooks' | 'load' | 'save' | 'remove'>)()

    await expect(face.load('review')).resolves.toEqual(draft)
    expect(read).toHaveBeenCalledWith('review')
    await expect(face.save(draft, false)).resolves.toEqual({ kind: 'name-taken' })
    expect(create).toHaveBeenCalledWith(draft)
    await expect(face.save(draft, true)).resolves.toEqual({ kind: 'failed', message: 'gateway/internal: EACCES' })
    face.remove('review')
    await vi.waitFor(() => { expect(remove).toHaveBeenCalledWith('review') })
  })

  it('sends a chosen archive as base64, and saves an exported one through the file actions', async () => {
    const { ctx, slots, importArchive, exportArchive, save } = await bench([view('skill')])
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    const face = (slots.entries('plugins.item')[0]!.inject as () => Pick<SkillsFace, 'hooks' | 'importArchive' | 'exportArchive'>)()

    face.importArchive(new Blob(['zip bytes']))
    await vi.waitFor(() => { expect(importArchive).toHaveBeenCalledWith({ data: btoa('zip bytes'), replace: false }) })
    await vi.waitFor(() => {
      expect(face.hooks.skills.getSnapshot().transfer).toEqual({
        kind: 'imported', skills: [{ name: 'review', outcome: 'imported' }], replaceable: false,
      })
    })

    face.exportArchive('review')
    await vi.waitFor(() => {
      expect(face.hooks.skills.getSnapshot().transfer).toEqual({ kind: 'exported', name: 'review', path: '/downloads/review.zip' })
    })
    expect(exportArchive).toHaveBeenCalledWith('review')
    // Desktop offers the save dialog; the archive's bytes arrive as they left the Host.
    const [source, mode] = save.mock.calls[0]!
    expect([source.name, mode]).toEqual(['review.zip', 'saveAs'])
    expect(await (await source.read!(new AbortController().signal)).text()).toBe('zip bytes')
  })
})
