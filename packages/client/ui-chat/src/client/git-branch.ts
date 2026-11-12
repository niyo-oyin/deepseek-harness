/**
 * What Git has checked out in each viewed Session's workspace, as the composer dock reads it. A reading
 * is taken on request, when the pill mounts, when a turn starts or ends, and when the window regains
 * focus, so a checkout made by the agent or in another terminal shows without a polling timer.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceGitBranch } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

const NONE: WorkspaceGitBranch = { kind: 'none' }

/** One Session's reading and the request that is replacing it, if any. */
interface Reading {
  readonly store: SnapshotStore<WorkspaceGitBranch>
  pending: AbortController | undefined
}

/** Per-Session Git branch readings backed by the Host's `workspaceFiles/gitBranch`. */
export class GitBranchReadings {
  private readonly readings = new Map<SessionId, Reading>()

  /**
   * @param read - the bound Remote call; a failed result reads as no checkout.
   */
  constructor(
    private readonly read: (sessionId: SessionId, signal: AbortSignal) => Promise<RemoteResult<WorkspaceGitBranch>>,
  ) {}

  /**
   * The observable reading of one Session; `none` until the first answer arrives.
   * @param sessionId - Session whose workspace is read.
   * @returns the stable source for that Session.
   */
  source(sessionId: SessionId): SnapshotStore<WorkspaceGitBranch> {
    return this.reading(sessionId).store
  }

  /**
   * Take a fresh reading. A request still in flight is superseded, so the last one asked decides; an
   * unchanged answer publishes nothing.
   * @param sessionId - Session whose workspace is read.
   */
  refresh(sessionId: SessionId): void {
    const reading = this.reading(sessionId)
    reading.pending?.abort()
    const request = new AbortController()
    reading.pending = request
    void this.read(sessionId, request.signal).then(
      result => result.ok ? result.value : NONE,
      () => NONE,
    ).then((next) => {
      if (request.signal.aborted) return
      reading.pending = undefined
      const current = reading.store.getSnapshot()
      const same = current.kind === next.kind
        && (current.kind !== 'branch' || (next.kind === 'branch' && current.name === next.name))
        && (current.kind !== 'detached' || (next.kind === 'detached' && current.head === next.head))
      if (!same) reading.store.set(next)
    })
  }

  /** Abandon every request in flight; their answers are dropped. */
  dispose(): void {
    for (const reading of this.readings.values()) reading.pending?.abort()
  }

  private reading(sessionId: SessionId): Reading {
    let reading = this.readings.get(sessionId)
    if (reading === undefined) {
      reading = { store: createSnapshotStore<WorkspaceGitBranch>(NONE), pending: undefined }
      this.readings.set(sessionId, reading)
    }
    return reading
  }
}
