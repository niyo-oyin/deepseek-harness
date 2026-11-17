/**
 * Composer blocks: the one way another plugin stops a session's input.
 *
 * The composer cannot read the plugins that would know — the dependency runs
 * ui-model-selection → ui-conversation, never back — so a blocker pushes here and the
 * bar reads its own session's store. A block carries the localized reason it
 * exists, because the plugin that raised it owns that copy; the composer only
 * knows how to render an inert textarea with a placeholder, exactly as it
 * already does for a session with no workspace. Several plugins can block one
 * session at once, so each block is held under its owner's name.
 *
 * This is an affordance, not enforcement: the Host refuses a prompt it cannot
 * route regardless of what any client disables.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerBlock, ComposerBlocks } from '../contract/composer-blocks.ts'

/** One session's raised blocks by owner, in raise order, and the store showing the earliest. */
interface SessionBlocks {
  readonly owners: Map<string, ComposerBlock>
  readonly store: SnapshotStore<ComposerBlock | undefined>
}

/** The per-session composer-block registry (one instance per plugin fiber). */
export class ComposerBlockRegistry implements ComposerBlocks {
  private readonly sessions = new Map<SessionId, SessionBlocks>()

  /** @inheritdoc */
  set(sessionId: SessionId, owner: string, block: ComposerBlock | undefined): void {
    const { owners, store } = this.sessionFor(sessionId)
    if (block === undefined) owners.delete(owner)
    else owners.set(owner, block)
    const shown = owners.values().next().value
    if (store.getSnapshot()?.reason === shown?.reason) return
    store.set(shown)
  }

  /** @inheritdoc */
  storeFor(sessionId: SessionId): SnapshotStore<ComposerBlock | undefined> {
    return this.sessionFor(sessionId).store
  }

  /** @inheritdoc */
  forget(sessionId: SessionId): void {
    this.sessions.delete(sessionId)
  }

  private sessionFor(sessionId: SessionId): SessionBlocks {
    const existing = this.sessions.get(sessionId)
    if (existing !== undefined) return existing
    const created: SessionBlocks = { owners: new Map(), store: createSnapshotStore<ComposerBlock | undefined>(undefined) }
    this.sessions.set(sessionId, created)
    return created
  }
}
