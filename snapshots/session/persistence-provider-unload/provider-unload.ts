/** Persist an injected consumer's final event during provider-only unload. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-tool-todo'
import { AsyncLocalStorage } from 'node:async_hooks'
import { scheduler } from 'node:timers/promises'

export const name = 'snapshot-persistence-provider-unload'
export const inject = ['loader', 'sessions']

/**
 * Hold every checkpoint after the completed turn until persistence and its consumer unload.
 * Later flushes join the same unload, including the one the run awaits before it exits,
 * so the Session stays live in its store until the consumer's final append lands.
 * @param ctx - Shipped profile context with the Loader-owned persistence entry.
 */
export async function apply(ctx: Context): Promise<void> {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  // Marks the fixture's own checkpoint, whose nested callback is skipped.
  const checkpoint = new AsyncLocalStorage<true>()
  let live: Session | undefined
  let unloaded: Promise<void> | undefined
  await ctx.plugin({
    name: 'snapshot-persistence-consumer',
    inject: ['sessionPersistence'],
    apply(consumer: Context) {
      consumer.effect(() => async () => {
        if (live === undefined) return
        entered.resolve()
        await release.promise
        live.append('todo/write', {
          todos: [{ content: 'Persistence consumer cleanup completed', status: 'completed' }],
        })
      })
    },
  })
  /**
   * Checkpoint, then unload only the persistence provider and verify it awaited its consumer.
   * @param session - the Session whose turn completed.
   * @param provider - the Loader-owned persistence entry's fiber.
   * @returns resolves once the provider and its consumer have unloaded.
   */
  const unload = async (session: Session, provider: { dispose: () => Promise<void> }): Promise<void> => {
    // Finish the checkpoint before removing its writer.
    await checkpoint.run(true, () => ctx.sessions.flush(session))
    live = session
    let finished = false
    const unloading = provider.dispose().then(() => { finished = true })
    try {
      await Promise.race([
        entered.promise,
        unloading.then(() => { throw new Error('Persistence unloaded before its consumer cleanup') }),
      ])
      await scheduler.yield()
      if (finished) throw new Error('Persistence did not await its consumer cleanup')
    } finally {
      release.resolve()
      await unloading
    }
  }
  ctx.on('session/flush', (session) => {
    if (checkpoint.getStore() === true) return undefined
    if (unloaded !== undefined) return unloaded
    if (!session.snapshotEvents().some(event => event.type === 'turn/end')) return undefined
    const provider = [...ctx.loader.entries()].find(entry => entry.options.id === 'session-persistence-jsonl')
    if (provider?.fiber === undefined) throw new Error('Snapshot persistence provider is missing')
    unloaded = unload(session, provider.fiber)
    return unloaded
  })
}
