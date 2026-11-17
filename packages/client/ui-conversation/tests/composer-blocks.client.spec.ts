import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ComposerBlockRegistry } from '../src/client/input/blocks.ts'

const SESSION = 'blocked-session' as SessionId

describe('ComposerBlockRegistry', () => {
  it('republishes only when the copy changes', () => {
    const registry = new ComposerBlockRegistry()
    const listener = vi.fn()
    const store = registry.storeFor(SESSION)
    store.subscribe(listener)

    registry.set(SESSION, 'model', { reason: 'select a model first' })
    expect(store.getSnapshot()).toEqual({ reason: 'select a model first' })
    expect(listener).toHaveBeenCalledTimes(1)

    // Identical copy: no publication at all.
    registry.set(SESSION, 'model', { reason: 'select a model first' })
    expect(listener).toHaveBeenCalledTimes(1)

    registry.set(SESSION, 'model', undefined)
    expect(store.getSnapshot()).toBeUndefined()

    registry.forget(SESSION)
    expect(registry.storeFor(SESSION).getSnapshot()).toBeUndefined()
  })

  it.each([
    ['the viewer first', ['viewer', 'model']],
    ['the model first', ['model', 'viewer']],
  ] as const)('keeps each owner\'s block until that owner clears it, raising %s', (_order, raised) => {
    const registry = new ComposerBlockRegistry()
    const store = registry.storeFor(SESSION)
    const reasons = { viewer: 'view only', model: 'select a model first' }
    for (const owner of raised) registry.set(SESSION, owner, { reason: reasons[owner] })
    // A later owner does not replace the block already shown.
    expect(store.getSnapshot()).toEqual({ reason: reasons[raised[0]] })

    registry.set(SESSION, 'model', undefined)
    expect(store.getSnapshot()).toEqual({ reason: 'view only' })
    // Clearing again, as an unmounting seat does, leaves the other owner's block standing.
    registry.set(SESSION, 'model', undefined)
    expect(store.getSnapshot()).toEqual({ reason: 'view only' })

    registry.set(SESSION, 'viewer', undefined)
    expect(store.getSnapshot()).toBeUndefined()
  })
})
