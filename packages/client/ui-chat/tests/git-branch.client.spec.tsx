// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceGitBranch } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { BranchPill } from '../src/client/chat/StatsPills.tsx'
import { GitBranchReadings } from '../src/client/git-branch.ts'

afterEach(cleanup)

const sid = (id: string): SessionId => id as SessionId
const ok = (value: WorkspaceGitBranch): RemoteResult<WorkspaceGitBranch> => ({ ok: true, value })

describe('GitBranchReadings', () => {
  it('starts without a checkout and publishes each changed reading once', async () => {
    const answers: WorkspaceGitBranch[] = [
      { kind: 'branch', name: 'main' }, { kind: 'branch', name: 'main' }, { kind: 'detached', head: 'abc1234' }, { kind: 'none' },
    ]
    const read = vi.fn(async () => ok(answers.shift()!))
    const readings = new GitBranchReadings(read)
    const source = readings.source(sid('one'))
    const seen: WorkspaceGitBranch[] = []
    source.subscribe(() => { seen.push(source.getSnapshot()) })
    expect(source.getSnapshot()).toEqual({ kind: 'none' })

    for (let index = 0; index < 4; index++) {
      readings.refresh(sid('one'))
      await vi.waitFor(() => { expect(read).toHaveBeenCalledTimes(index + 1) })
      await Promise.resolve()
    }

    // The second reading repeated the first, so subscribers heard nothing for it.
    await vi.waitFor(() => {
      expect(seen).toEqual([{ kind: 'branch', name: 'main' }, { kind: 'detached', head: 'abc1234' }, { kind: 'none' }])
    })
    expect(read).toHaveBeenCalledWith(sid('one'), expect.any(AbortSignal))
  })

  it('keeps the answer of the last request when an earlier one answers late', async () => {
    const first = Promise.withResolvers<RemoteResult<WorkspaceGitBranch>>()
    const second = Promise.withResolvers<RemoteResult<WorkspaceGitBranch>>()
    const signals: AbortSignal[] = []
    const read = vi.fn((_: SessionId, signal: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1 ? first.promise : second.promise
    })
    const readings = new GitBranchReadings(read)
    const source = readings.source(sid('one'))
    readings.refresh(sid('one'))
    readings.refresh(sid('one'))
    expect(signals[0]?.aborted).toBe(true)
    second.resolve(ok({ kind: 'branch', name: 'feature' }))
    await vi.waitFor(() => { expect(source.getSnapshot()).toEqual({ kind: 'branch', name: 'feature' }) })
    first.resolve(ok({ kind: 'branch', name: 'main' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(source.getSnapshot()).toEqual({ kind: 'branch', name: 'feature' })
  })

  it('reads a refused or failed request as no checkout, per Session', async () => {
    const read = vi.fn(async (sessionId: SessionId): Promise<RemoteResult<WorkspaceGitBranch>> => {
      if (sessionId === sid('refused')) return { ok: false, error: { code: 'gateway/internal', message: 'no service', details: {} } } as never
      if (sessionId === sid('thrown')) throw new Error('carrier closed')
      return ok({ kind: 'branch', name: 'main' })
    })
    const readings = new GitBranchReadings(read)
    for (const id of ['good', 'refused', 'thrown']) readings.refresh(sid(id))
    await vi.waitFor(() => { expect(readings.source(sid('good')).getSnapshot()).toEqual({ kind: 'branch', name: 'main' }) })
    expect(readings.source(sid('refused')).getSnapshot()).toEqual({ kind: 'none' })
    expect(readings.source(sid('thrown')).getSnapshot()).toEqual({ kind: 'none' })
  })

  it('drops the answer of a request abandoned at disposal', async () => {
    const pending = Promise.withResolvers<RemoteResult<WorkspaceGitBranch>>()
    const readings = new GitBranchReadings(() => pending.promise)
    readings.refresh(sid('one'))
    readings.dispose()
    pending.resolve(ok({ kind: 'branch', name: 'main' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(readings.source(sid('one')).getSnapshot()).toEqual({ kind: 'none' })
  })
})

describe('BranchPill', () => {
  function mount(initial: WorkspaceGitBranch = { kind: 'none' }) {
    const branch = createSnapshotStore<WorkspaceGitBranch>(initial, { flush: 'sync' })
    const session = createSnapshotStore({ running: false }, { flush: 'sync' })
    const refreshGitBranch = vi.fn()
    const props = {
      useGitBranch: bindSnapshotSelector(branch),
      useSession: bindSnapshotSelector(session),
      refreshGitBranch,
    } as ComponentProps<typeof BranchPill>
    const view = render(<BranchPill {...props} />)
    return { branch, session, refreshGitBranch, view }
  }

  it('shows the branch name, a detached commit with a leading @, and nothing outside a repository', () => {
    const { branch, view } = mount()
    expect(view.container.textContent).toBe('')
    act(() => { branch.set({ kind: 'branch', name: 'feature/branch-chip' }) })
    expect(screen.getByText('feature/branch-chip').closest('[data-composer-stat]')?.getAttribute('data-composer-stat')).toBe('branch')
    act(() => { branch.set({ kind: 'detached', head: 'abc1234' }) })
    expect(screen.getByText('@abc1234')).toBeTruthy()
    act(() => { branch.set({ kind: 'none' }) })
    expect(view.container.textContent).toBe('')
  })

  it('asks for a fresh reading when it mounts, when a turn starts or ends, and when the window comes back', () => {
    const { session, refreshGitBranch, view } = mount({ kind: 'branch', name: 'main' })
    expect(refreshGitBranch).toHaveBeenCalledTimes(1)
    act(() => { session.set({ running: true }) })
    act(() => { session.set({ running: false }) })
    expect(refreshGitBranch).toHaveBeenCalledTimes(3)
    act(() => { window.dispatchEvent(new Event('focus')) })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(refreshGitBranch).toHaveBeenCalledTimes(5)
    view.unmount()
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(refreshGitBranch).toHaveBeenCalledTimes(5)
  })
})
