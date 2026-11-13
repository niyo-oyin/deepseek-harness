import { describe, expect, it, vi } from 'vitest'
import type { McpManagedServerView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { McpServersController, type McpManagerFace } from '../src/client/controller.ts'
import { EMPTY_DRAFT, type McpServerEntry, type McpSettings } from '../src/client/mcp-entry.ts'

/** A page model over a scripted settings form and a scripted manager. */
function bench() {
  const host = stubConfigForm<McpSettings>()
  let onList: ((servers: readonly McpManagedServerView[]) => void) | undefined
  let onFailure: ((reason: string) => void) | undefined
  const unwatch = vi.fn()
  const manager = {
    watch: vi.fn<McpManagerFace['watch']>((listener, failed) => {
      onList = listener
      onFailure = failed
      return unwatch
    }),
    probe: vi.fn<McpManagerFace['probe']>(),
    restart: vi.fn<McpManagerFace['restart']>(async () => undefined),
  }
  const controller = new McpServersController(host.scope, manager)
  const face = controller.inject()
  return {
    host, manager, unwatch, controller, face,
    state: () => face.hooks.mcpServers.getSnapshot(),
    list: (servers: McpManagedServerView[]) => { onList?.(servers) },
    failList: (reason: string) => { onFailure?.(reason) },
  }
}

const READY = { status: 'ready', writable: true, revision: 1 } as const
const github: McpServerEntry = { transport: 'stdio', command: 'npx', args: ['-y', 'server-github'], env: {}, enabled: true }
const docs: McpServerEntry = { transport: 'streamable-http', url: 'https://docs.example/mcp', headers: {}, enabled: false }

describe('McpServersController', () => {
  it('lists configured servers by where they are stored, joined with the live status once it is followed', () => {
    const b = bench()
    expect(b.state()).toMatchObject({ status: 'loading', writable: false, rows: [] })
    b.host.publish({ ...READY, value: { servers: { github, docs } }, user: { servers: { github } } })
    expect(b.state().rows).toMatchObject([
      { name: 'github', origin: 'profile', enabled: true, status: undefined },
      { name: 'docs', origin: 'composition', enabled: false, status: undefined },
    ])

    const stop = b.face.observe()
    b.list([
      { name: 'github', configured: true, status: { state: 'connected', toolCount: 3, connectedAt: 1 } },
      { name: 'docs', configured: true, status: { state: 'disabled' } },
      { name: 'from-plugin', configured: true, status: { state: 'connecting', attempt: 0 } },
      // No longer configured or registered: listed by the manager only while its cleanup failure stands.
      { name: 'gone', configured: false, status: { state: 'failed', reason: 'cleanup', result: { closeConfirmed: false } } },
    ])
    expect(b.state().rows).toMatchObject([
      { name: 'github', status: { state: 'connected', toolCount: 3 } },
      { name: 'docs', status: { state: 'disabled' } },
      { name: 'from-plugin', origin: 'plugin', entry: undefined, enabled: true, status: { state: 'connecting' } },
    ])
    stop()
  })

  it('follows the live list only while something observes it', () => {
    const b = bench()
    const first = b.face.observe()
    const second = b.face.observe()
    expect(b.manager.watch).toHaveBeenCalledOnce()
    first()
    expect(b.unwatch).not.toHaveBeenCalled()
    second()
    expect(b.unwatch).toHaveBeenCalledOnce()
    b.face.observe()
    expect(b.manager.watch).toHaveBeenCalledTimes(2)
    b.controller.dispose()
    expect(b.unwatch).toHaveBeenCalledTimes(2)
    expect(b.host.listenerCount()).toBe(0)
  })

  it('says when the server list can no longer be followed, and follows it again on the next visit', () => {
    const b = bench()
    b.host.publish({ ...READY, value: { servers: { github } }, user: { servers: { github } } })
    const leave = b.face.observe()
    b.list([{ name: 'github', configured: true, status: { state: 'connected', toolCount: 3, connectedAt: 1 } }])
    b.failList('gateway/internal: manager stopped')
    expect(b.state().stale).toBe('gateway/internal: manager stopped')
    expect(b.state().rows[0]?.status).toMatchObject({ state: 'connected' })
    b.face.observe()
    expect(b.manager.watch).toHaveBeenCalledTimes(2)
    b.list([{ name: 'github', configured: true, status: { state: 'connected', toolCount: 3, connectedAt: 1 } }])
    expect(b.state().stale).toBeNull()
    leave()
  })

  it('marks a server as switching until its switch has been written', async () => {
    const b = bench()
    b.host.publish({ ...READY, value: { servers: { github } }, user: { servers: { github } } })
    const written = Promise.withResolvers<boolean>()
    b.host.mutate.mockReturnValueOnce(written.promise)
    b.face.setEnabled('github', false)
    expect(b.state().rows[0]?.switching).toBe(true)
    written.resolve(true)
    await vi.waitFor(() => { expect(b.state().rows[0]?.switching).toBe(false) })
  })

  it('writes the switch and a removal as single path edits', async () => {
    const b = bench()
    b.host.publish({ ...READY, value: { servers: { github } }, user: { servers: { github } } })
    b.face.setEnabled('github', false)
    b.face.remove('github')
    await vi.waitFor(() => { expect(b.host.mutate).toHaveBeenCalledTimes(2) })
    expect(b.host.mutate.mock.calls).toEqual([
      [[{ op: 'set', path: ['servers', 'github', 'enabled'], value: false }]],
      [[{ op: 'unset', path: ['servers', 'github'] }]],
    ])
  })

  it('adds a server in one write of its fields, and keeps the other stored fields of an edited one', async () => {
    const b = bench()
    b.host.publish({ ...READY, value: { servers: { github } }, user: { servers: { github } } })

    await expect(b.face.save({ ...EMPTY_DRAFT, name: 'docs', transport: 'streamable-http', url: 'https://docs.example/mcp' }, false))
      .resolves.toBeUndefined()
    const fieldsWritten = (call: number): string[] => b.host.mutate.mock.calls[call]![0].map(op => op.path.join('.'))
    expect(fieldsWritten(0)).toEqual([
      'servers.docs.transport', 'servers.docs.command', 'servers.docs.args', 'servers.docs.env', 'servers.docs.cwd',
      'servers.docs.url', 'servers.docs.headers',
    ])
    expect(b.host.mutate.mock.calls[0]![0]).toContainEqual({ op: 'set', path: ['servers', 'docs', 'url'], value: 'https://docs.example/mcp' })

    // An edit names the same server: nothing but the edited fields is written, so `enabled` and the timeouts stay.
    await b.face.save({ ...EMPTY_DRAFT, name: 'github', command: 'node', args: 'server.js' }, true)
    expect(fieldsWritten(1)).not.toContain('servers.github.enabled')
    expect(b.host.mutate.mock.calls[1]![0]).toContainEqual({ op: 'set', path: ['servers', 'github', 'args'], value: ['server.js'] })
  })

  it('refuses a new server whose name is configured or registered by a plugin, without writing', async () => {
    const b = bench()
    b.host.publish({ ...READY, value: { servers: { github } }, user: { servers: { github } } })
    b.face.observe()
    b.list([{ name: 'from-plugin', configured: true, status: { state: 'connecting', attempt: 0 } }])
    await expect(b.face.save({ ...EMPTY_DRAFT, name: 'github', command: 'x' }, false)).resolves.toEqual({ kind: 'nameTaken' })
    await expect(b.face.save({ ...EMPTY_DRAFT, name: 'from-plugin', command: 'x' }, false)).resolves.toEqual({ kind: 'nameTaken' })
    await expect(b.face.save({ ...EMPTY_DRAFT, name: 'new' }, false)).resolves.toEqual({ kind: 'command' })
    expect(b.host.mutate).not.toHaveBeenCalled()
  })

  it('reports a refused write and a carrier failure as the page notice until it is dismissed', async () => {
    const b = bench()
    b.host.publish({ ...READY, value: { servers: {} } })
    b.host.mutate.mockResolvedValueOnce(false)
    await expect(b.face.save({ ...EMPTY_DRAFT, name: 'docs', command: 'x' }, false)).resolves.toEqual({ kind: 'refused' })
    expect(b.state().notice).toEqual({ kind: 'refused' })

    b.host.mutate.mockRejectedValueOnce(new Error('carrier closed'))
    b.face.setEnabled('docs', true)
    await vi.waitFor(() => { expect(b.state().notice).toEqual({ kind: 'failed', message: 'carrier closed' }) })
    b.face.dismissNotice()
    expect(b.state().notice).toBeNull()

    // An accepted write clears an earlier notice by itself.
    b.host.mutate.mockResolvedValueOnce(false)
    b.face.setEnabled('docs', true)
    await vi.waitFor(() => { expect(b.state().notice).toEqual({ kind: 'refused' }) })
    b.face.setEnabled('docs', false)
    await vi.waitFor(() => { expect(b.state().notice).toBeNull() })
  })

  it('shows a connection test while it runs and what it found', async () => {
    const b = bench()
    b.host.publish({ ...READY, value: { servers: { github, docs } } })
    const pending = Promise.withResolvers<Awaited<ReturnType<McpManagerFace['probe']>>>()
    b.manager.probe.mockReturnValueOnce(pending.promise)
    b.face.probe('github')
    expect(b.state().rows[0]?.probe).toEqual({ state: 'running' })
    pending.resolve({ ok: true, toolNames: ['search', 'fetch'], truncated: false, durationMs: 120, closeConfirmed: true })
    await vi.waitFor(() => {
      expect(b.state().rows[0]?.probe).toEqual({ state: 'ok', toolNames: ['search', 'fetch'], truncated: false, durationMs: 120 })
    })

    b.manager.probe.mockResolvedValueOnce({ ok: false, stage: 'connect', message: 'ECONNREFUSED', durationMs: 5, closeConfirmed: true })
    b.face.probe('docs')
    await vi.waitFor(() => { expect(b.state().rows[1]?.probe).toEqual({ state: 'failed', message: 'ECONNREFUSED' }) })
    b.manager.probe.mockResolvedValueOnce({ failed: 'gateway/internal: no manager' })
    b.face.probe('docs')
    await vi.waitFor(() => { expect(b.state().rows[1]?.probe).toEqual({ state: 'failed', message: 'gateway/internal: no manager' }) })
  })

  it('restarts a server and reports a restart the manager could not perform', async () => {
    const b = bench()
    b.host.publish({ ...READY, value: { servers: { github } } })
    b.face.restart('github')
    expect(b.manager.restart).toHaveBeenCalledExactlyOnceWith('github')
    await Promise.resolve()
    expect(b.state().notice).toBeNull()
    b.manager.restart.mockResolvedValueOnce({ failed: 'gateway/internal: unknown server "github"' })
    b.face.restart('github')
    await vi.waitFor(() => {
      expect(b.state().notice).toEqual({ kind: 'failed', message: 'gateway/internal: unknown server "github"' })
    })
  })
})
