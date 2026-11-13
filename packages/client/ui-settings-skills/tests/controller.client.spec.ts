import { describe, expect, it, vi } from 'vitest'
import type { ManagedSkillView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { SkillsController, type SkillManagerFace, type SkillSettings } from '../src/client/controller.ts'

/** A page model over a scripted settings form and a scripted manager. */
function bench() {
  const host = stubConfigForm<SkillSettings>()
  let onList: ((skills: readonly ManagedSkillView[]) => void) | undefined
  let onFailure: ((reason: string) => void) | undefined
  const unwatch = vi.fn()
  const manager = {
    watch: vi.fn<SkillManagerFace['watch']>((listener, failed) => {
      onList = listener
      onFailure = failed
      return unwatch
    }),
    read: vi.fn<SkillManagerFace['read']>(),
    create: vi.fn<SkillManagerFace['create']>(async () => ({ ok: true })),
    update: vi.fn<SkillManagerFace['update']>(async () => ({ ok: true })),
    remove: vi.fn<SkillManagerFace['remove']>(async () => ({ ok: true })),
    importArchive: vi.fn<SkillManagerFace['importArchive']>(),
    exportArchive: vi.fn<SkillManagerFace['exportArchive']>(),
  }
  const controller = new SkillsController(host.scope, manager)
  const face = controller.inject()
  return {
    host, manager, unwatch, controller, face,
    state: () => face.hooks.skills.getSnapshot(),
    list: (skills: ManagedSkillView[]) => { onList?.(skills) },
    failList: (reason: string) => { onFailure?.(reason) },
  }
}

const READY = { status: 'ready', writable: true, revision: 1 } as const
const skill = (name: string, source: string, editable = false): ManagedSkillView => ({
  name, description: `${name} description`, source, modelInvocable: true, userInvocable: true, editable,
})
const draft = { name: 'review', description: 'Review a change', whenToUse: '', content: 'Steps.' }

describe('SkillsController', () => {
  it('lists the manager\'s skills by where they come from, switched by the registry setting', () => {
    const b = bench()
    expect(b.state()).toMatchObject({ status: 'loading', listed: false, rows: [] })
    b.host.publish({ ...READY, value: { disabled: ['office'] } })
    const stop = b.face.observe()
    b.list([
      skill('review', 'user-dsh', true), skill('notes', 'user-agents', true), skill('deploy', 'custom'),
      skill('office', 'bundled'), skill('badge', 'runtime'),
    ])
    expect(b.state()).toMatchObject({ status: 'ready', listed: true })
    expect(b.state().rows.map(row => [row.name, row.origin, row.enabled])).toEqual([
      ['review', 'user', true], ['notes', 'shared', true], ['deploy', 'builtIn', true], ['office', 'builtIn', false],
      ['badge', 'plugin', true],
    ])
    // The setting alone changes the switch; the list is not asked again.
    b.host.publish({ value: { disabled: [] } })
    expect(b.state().rows.every(row => row.enabled)).toBe(true)
    stop()
  })

  it('follows the skill list only while something observes it', () => {
    const b = bench()
    const first = b.face.observe()
    const second = b.face.observe()
    expect(b.manager.watch).toHaveBeenCalledOnce()
    first()
    expect(b.unwatch).not.toHaveBeenCalled()
    second()
    expect(b.unwatch).toHaveBeenCalledOnce()
    b.face.observe()
    b.controller.dispose()
    expect(b.unwatch).toHaveBeenCalledTimes(2)
    expect(b.host.listenerCount()).toBe(0)
  })

  it('writes the switch as the whole disabled list, keeping names that are not listed right now', async () => {
    const b = bench()
    b.host.publish({ ...READY, value: { disabled: ['project-only'] } })
    b.face.setEnabled('review', false)
    await vi.waitFor(() => { expect(b.host.mutate).toHaveBeenCalledTimes(1) })
    b.host.publish({ value: { disabled: ['project-only', 'review'] } })
    b.face.setEnabled('review', true)
    await vi.waitFor(() => { expect(b.host.mutate).toHaveBeenCalledTimes(2) })
    expect(b.host.mutate.mock.calls).toEqual([
      [[{ op: 'set', path: ['disabled'], value: ['project-only', 'review'] }]],
      [[{ op: 'set', path: ['disabled'], value: ['project-only'] }]],
    ])
  })

  it('keeps both switches when a second one is made before the first has been written', async () => {
    const b = bench()
    b.host.publish({ ...READY, value: { disabled: [] } })
    b.face.observe()
    b.list([skill('review', 'user-dsh', true), skill('notes', 'user-agents', true)])
    const first = Promise.withResolvers<boolean>()
    b.host.mutate.mockReturnValueOnce(first.promise)
    b.face.setEnabled('review', false)
    // The row shows the switch at once and marks it as being written.
    expect(b.state().rows.map(row => [row.name, row.enabled, row.switching])).toEqual([['review', false, true], ['notes', true, false]])
    b.face.setEnabled('notes', false)
    expect(b.host.mutate.mock.calls.map(call => call[0])).toEqual([
      [{ op: 'set', path: ['disabled'], value: ['review'] }],
      [{ op: 'set', path: ['disabled'], value: ['review', 'notes'] }],
    ])
    first.resolve(true)
    b.host.publish({ value: { disabled: ['review', 'notes'] } })
    await vi.waitFor(() => { expect(b.state().rows.map(row => [row.enabled, row.switching])).toEqual([[false, false], [false, false]]) })
  })

  it('says when the skill list can no longer be followed, and follows it again on the next visit', () => {
    const b = bench()
    const leave = b.face.observe()
    b.list([skill('review', 'user-dsh', true)])
    b.failList('gateway/internal: discovery failed')
    expect(b.state()).toMatchObject({ stale: 'gateway/internal: discovery failed', listed: true })
    // Another part of the page still observes; a new visit subscribes again all the same, and its list is current.
    b.face.observe()
    expect(b.manager.watch).toHaveBeenCalledTimes(2)
    b.list([skill('review', 'user-dsh', true)])
    expect(b.state().stale).toBeNull()
    leave()
  })

  it('reports a refused or failed switch as the page notice until it is dismissed', async () => {
    const b = bench()
    b.host.publish({ ...READY, value: {} })
    b.host.mutate.mockResolvedValueOnce(false)
    b.face.setEnabled('review', false)
    await vi.waitFor(() => { expect(b.state().notice).toEqual({ kind: 'refused' }) })
    b.host.mutate.mockRejectedValueOnce(new Error('carrier closed'))
    b.face.setEnabled('review', false)
    await vi.waitFor(() => { expect(b.state().notice).toEqual({ kind: 'failed', message: 'carrier closed' }) })
    b.face.dismissNotice()
    expect(b.state().notice).toBeNull()
  })

  it('creates a new skill and updates a listed one, returning why a draft was not saved', async () => {
    const b = bench()
    await expect(b.face.save(draft, false)).resolves.toBeUndefined()
    expect(b.manager.create).toHaveBeenCalledExactlyOnceWith(draft)
    await expect(b.face.save(draft, true)).resolves.toBeUndefined()
    expect(b.manager.update).toHaveBeenCalledExactlyOnceWith(draft)

    b.manager.create.mockResolvedValueOnce({ ok: false, refused: 'name-taken' })
    await expect(b.face.save(draft, false)).resolves.toEqual({ kind: 'name-taken' })
    b.manager.update.mockResolvedValueOnce({ failed: 'gateway/internal: EACCES' })
    await expect(b.face.save(draft, true)).resolves.toEqual({ kind: 'failed', message: 'gateway/internal: EACCES' })
  })

  it('reads a skill for the editor and reports one that cannot be read', async () => {
    const b = bench()
    b.manager.read.mockResolvedValueOnce(draft)
    await expect(b.face.load('review')).resolves.toEqual(draft)
    b.manager.read.mockResolvedValueOnce(null)
    await expect(b.face.load('review')).resolves.toBeUndefined()
    expect(b.state().notice).toEqual({ kind: 'gone', name: 'review' })
    b.manager.read.mockResolvedValueOnce({ failed: 'gateway/internal: EIO' })
    await expect(b.face.load('review')).resolves.toBeUndefined()
    expect(b.state().notice).toEqual({ kind: 'failed', message: 'gateway/internal: EIO' })
  })

  it('removes a skill and drops its name from the disabled list, so a later skill of that name starts switched on', async () => {
    const b = bench()
    b.host.publish({ ...READY, value: { disabled: ['review', 'office'] } })
    b.face.remove('review')
    await vi.waitFor(() => { expect(b.host.mutate).toHaveBeenCalledOnce() })
    expect(b.manager.remove).toHaveBeenCalledExactlyOnceWith('review')
    expect(b.host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['disabled'], value: ['office'] }])

    // A skill that was switched on leaves the setting alone; a refused removal is reported.
    b.face.remove('notes')
    b.manager.remove.mockResolvedValueOnce({ ok: false, refused: 'not-editable' })
    b.face.remove('deploy')
    await vi.waitFor(() => { expect(b.state().notice).toEqual({ kind: 'gone', name: 'deploy' }) })
    expect(b.host.mutate).toHaveBeenCalledOnce()
  })

  it('imports an archive and shows what became of each skill, replacing the ones it left only when asked', async () => {
    const b = bench()
    const archive = new Blob(['zip bytes'])
    const pending = Promise.withResolvers<Awaited<ReturnType<SkillManagerFace['importArchive']>>>()
    b.manager.importArchive.mockReturnValueOnce(pending.promise)
    b.face.importArchive(archive)
    expect(b.state().transfer).toEqual({ kind: 'importing' })
    expect(b.manager.importArchive).toHaveBeenCalledExactlyOnceWith(archive, false)
    const skills = [{ name: 'triage', outcome: 'imported' }, { name: 'review', outcome: 'exists' }] as const
    pending.resolve({ ok: true, skills: [...skills] })
    await vi.waitFor(() => { expect(b.state().transfer).toEqual({ kind: 'imported', skills, replaceable: true }) })

    b.manager.importArchive.mockResolvedValueOnce({ ok: true, skills: [{ name: 'triage', outcome: 'replaced' }, { name: 'review', outcome: 'replaced' }] })
    b.face.replaceImported()
    expect(b.manager.importArchive).toHaveBeenLastCalledWith(archive, true)
    await vi.waitFor(() => { expect(b.state().transfer).toMatchObject({ kind: 'imported', replaceable: false }) })
    // Nothing is left to replace, and a dismissed result is gone.
    b.face.replaceImported()
    expect(b.manager.importArchive).toHaveBeenCalledTimes(2)
    b.face.dismissTransfer()
    expect(b.state().transfer).toBeNull()
  })

  it('says why an archive was refused, and reports an import that could not be made as the page notice', async () => {
    const b = bench()
    b.manager.importArchive.mockResolvedValueOnce({ ok: false, refused: 'no-skill' })
    b.face.importArchive(new Blob(['x']))
    await vi.waitFor(() => { expect(b.state().transfer).toEqual({ kind: 'importRefused', reason: 'no-skill' }) })

    b.manager.importArchive.mockResolvedValueOnce({ failed: 'gateway/internal: EACCES' })
    b.face.importArchive(new Blob(['x']))
    await vi.waitFor(() => { expect(b.state().notice).toEqual({ kind: 'failed', message: 'gateway/internal: EACCES' }) })
    expect(b.state().transfer).toBeNull()
    // A file that cannot even be read ends the import the same way, not on "importing" forever.
    b.manager.importArchive.mockRejectedValueOnce(new Error('the file could not be read'))
    b.face.importArchive(new Blob(['x']))
    await vi.waitFor(() => { expect(b.state().notice).toEqual({ kind: 'failed', message: 'the file could not be read' }) })
    expect(b.state().transfer).toBeNull()
  })

  it('shows where an exported skill was saved, and stays quiet about a dismissed save', async () => {
    const b = bench()
    b.manager.exportArchive.mockResolvedValueOnce({ status: 'saved', path: '/downloads/review.zip' })
    b.face.exportArchive('review')
    await vi.waitFor(() => { expect(b.state().transfer).toEqual({ kind: 'exported', name: 'review', path: '/downloads/review.zip' }) })
    b.manager.exportArchive.mockResolvedValueOnce({ status: 'requested' })
    b.face.exportArchive('notes')
    await vi.waitFor(() => { expect(b.state().transfer).toEqual({ kind: 'exported', name: 'notes' }) })

    b.manager.exportArchive.mockResolvedValueOnce({ status: 'cancelled' })
    b.face.exportArchive('review')
    b.manager.exportArchive.mockResolvedValueOnce({ status: 'refused', reason: 'not-exportable' })
    b.face.exportArchive('office')
    await vi.waitFor(() => { expect(b.state().notice).toEqual({ kind: 'gone', name: 'office' }) })
    b.manager.exportArchive.mockResolvedValueOnce({ status: 'refused', reason: 'too-large' })
    b.face.exportArchive('datasets')
    await vi.waitFor(() => { expect(b.state().notice).toEqual({ kind: 'exportTooLarge', name: 'datasets' }) })
    expect(b.state().transfer).toEqual({ kind: 'exported', name: 'notes' })
    b.manager.exportArchive.mockResolvedValueOnce({ failed: 'disk full' })
    b.face.exportArchive('review')
    await vi.waitFor(() => { expect(b.state().notice).toEqual({ kind: 'failed', message: 'disk full' }) })
  })
})
