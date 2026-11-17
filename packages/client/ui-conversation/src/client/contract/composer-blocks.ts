import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Why one session's composer is inert. */
export interface ComposerBlock {
  /** Localized placeholder owned by the plugin that raised the block. */
  readonly reason: string
}

/** The registry face other plugins reach through `ctx.conversation.blocks`. */
export interface ComposerBlocks {
  /**
   * Raise, replace, or clear one owner's block on this session. Each owner holds its own block, so
   * one owner never clears or replaces another's. The session shows the earliest block still raised;
   * replacing an owner's reason keeps its place.
   * @param sessionId - Session whose composer is affected.
   * @param owner - Stable name of the plugin that owns the block.
   * @param block - Block to raise, or undefined to clear this owner's block.
   */
  set(sessionId: SessionId, owner: string, block: ComposerBlock | undefined): void
  /**
   * Resolve the observable block state for one Session.
   * @param sessionId - Session to observe.
   * @returns Identity-stable store of the block the session shows, or undefined while no owner blocks it.
   */
  storeFor(sessionId: SessionId): SnapshotStore<ComposerBlock | undefined>
  /**
   * Drop one Session's store and every owner's block on it.
   * @param sessionId - Session being released.
   */
  forget(sessionId: SessionId): void
}
