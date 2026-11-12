// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { McpManagedServerView } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { McpServersCard } from '../src/client/McpServersCard.tsx'
import { McpServersController, type McpManagerFace } from '../src/client/controller.ts'
import type { McpServerEntry, McpSettings } from '../src/client/mcp-entry.ts'
import { en, type McpSettingsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: McpSettingsLocaleKey, params?: Record<string, string | number>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])) as ComponentProps<typeof McpServersCard>['t']

const github: McpServerEntry = {
  transport: 'stdio', command: 'npx', args: ['-y', 'server-github'], env: { TOKEN: '${credential:GH}' }, enabled: true,
}

/** The page over a scripted settings form and manager, as the Plugins page renders it. */
function mount(view: 'summary' | 'page' = 'page') {
  const host = stubConfigForm<McpSettings>()
  host.publish({ status: 'ready', writable: true, revision: 1, value: { servers: { github } }, user: { servers: { github } } })
  let onList: ((servers: readonly McpManagedServerView[]) => void) | undefined
  const unwatch = vi.fn()
  const manager = {
    watch: vi.fn<McpManagerFace['watch']>((listener) => {
      onList = listener
      return unwatch
    }),
    probe: vi.fn<McpManagerFace['probe']>(async () => ({ ok: true, toolNames: ['search'], truncated: false, durationMs: 40, closeConfirmed: true })),
    restart: vi.fn<McpManagerFace['restart']>(async () => undefined),
  }
  const { hooks, ...actions } = new McpServersController(host.scope, manager).inject()
  const props = {
    view, t, useMcpServers: bindSnapshotSelector(hooks.mcpServers), ...actions,
  } as unknown as ComponentProps<typeof McpServersCard>
  const rendered = render(<McpServersCard {...props} />)
  return { host, manager, unwatch, rendered, list: (servers: McpManagedServerView[]) => { act(() => { onList?.(servers) }) } }
}

const row = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-mcp-server="${name}"]`)!

describe('McpServersCard', () => {
  it('renders the one-liner for the summary view without following the live list', () => {
    const { manager, rendered } = mount('summary')
    expect(rendered.container.textContent).toBe(en.description)
    expect(manager.watch).not.toHaveBeenCalled()
  })

  it('lists a server with where it is stored, what it runs, and its live status, and stops following on unmount', () => {
    const { manager, unwatch, rendered, list } = mount()
    expect(manager.watch).toHaveBeenCalledOnce()
    expect(within(row('github')).getByText('This profile')).toBeTruthy()
    expect(within(row('github')).getByText('npx -y server-github')).toBeTruthy()
    expect(within(row('github')).getByText(en.statusUnknown)).toBeTruthy()

    list([
      { name: 'github', configured: true, status: { state: 'reconnecting', attempt: 2, maxAttempts: 5, nextRetryAtMs: 0, lastError: 'spawn npx ENOENT' } },
      { name: 'from-plugin', configured: true, status: { state: 'connected', toolCount: 4, connectedAt: 1 } },
    ])
    expect(within(row('github')).getByText('Reconnecting (2/5)')).toBeTruthy()
    expect(within(row('github')).getByText('spawn npx ENOENT')).toBeTruthy()
    // A plugin's server is shown with its status and can be restarted, but not switched, tested, edited, or removed here.
    const plugin = within(row('from-plugin'))
    expect(plugin.getByText('From a plugin')).toBeTruthy()
    expect(plugin.getByText('Connected · 4 tools')).toBeTruthy()
    expect(plugin.getAllByRole('button').map(button => button.textContent)).toEqual([en.restart])
    expect(plugin.queryByRole('switch')).toBeNull()

    rendered.unmount()
    expect(unwatch).toHaveBeenCalledOnce()
  })

  it('switches, tests, and restarts a server from its row', async () => {
    const { host, manager } = mount()
    fireEvent.click(within(row('github')).getByRole('switch', { name: 'Enable github' }))
    expect(host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['servers', 'github', 'enabled'], value: false }])
    fireEvent.click(within(row('github')).getByRole('button', { name: en.test }))
    expect(await within(row('github')).findByText('Connected in 40 ms. 1 tools: search')).toBeTruthy()
    fireEvent.click(within(row('github')).getByRole('button', { name: en.restart }))
    expect(manager.restart).toHaveBeenCalledExactlyOnceWith('github')
  })

  it('removes a server only after the removal is confirmed', () => {
    const { host } = mount()
    fireEvent.click(within(row('github')).getByRole('button', { name: en.remove }))
    expect(within(row('github')).getByText('Remove github?')).toBeTruthy()
    fireEvent.click(within(row('github')).getByRole('button', { name: en.cancel }))
    expect(host.mutate).not.toHaveBeenCalled()
    fireEvent.click(within(row('github')).getByRole('button', { name: en.remove }))
    fireEvent.click(within(row('github')).getByRole('button', { name: en.remove }))
    expect(host.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'unset', path: ['servers', 'github'] }])
  })

  it('adds a server through the editor, explaining a draft it cannot write', async () => {
    const { host } = mount()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const editor = within(document.querySelector<HTMLElement>('[data-mcp-editor]')!)
    fireEvent.change(editor.getByLabelText(en.fieldName), { target: { value: 'docs server' } })
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: en.save })) })
    expect(editor.getByRole('alert').textContent).toBe(en.problemName)
    expect(host.mutate).not.toHaveBeenCalled()

    fireEvent.change(editor.getByLabelText(en.fieldName), { target: { value: 'docs' } })
    fireEvent.change(editor.getByLabelText(en.fieldTransport), { target: { value: 'streamable-http' } })
    // The fields follow the connection: an HTTP server has a URL and headers, not a command.
    expect(editor.queryByLabelText(en.fieldCommand)).toBeNull()
    fireEvent.change(editor.getByLabelText(en.fieldUrl), { target: { value: 'https://docs.example/mcp' } })
    fireEvent.change(editor.getByLabelText(en.fieldHeaders), { target: { value: 'Authorization: Bearer x' } })
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: en.save })) })
    expect(host.mutate.mock.calls[0]![0]).toEqual(expect.arrayContaining([
      { op: 'set', path: ['servers', 'docs', 'transport'], value: 'streamable-http' },
      { op: 'set', path: ['servers', 'docs', 'url'], value: 'https://docs.example/mcp' },
      { op: 'set', path: ['servers', 'docs', 'headers'], value: { Authorization: 'Bearer x' } },
    ]))
    // A written entry closes the editor.
    expect(document.querySelector('[data-mcp-editor]')).toBeNull()
  })

  it('edits a server in place with its name fixed, and keeps the editor open when the Host refuses', async () => {
    const { host } = mount()
    fireEvent.click(within(row('github')).getByRole('button', { name: en.edit }))
    const editor = within(row('github').querySelector<HTMLElement>('[data-mcp-editor]')!)
    expect((editor.getByLabelText(en.fieldName) as HTMLInputElement).disabled).toBe(true)
    expect((editor.getByLabelText(en.fieldArgs) as HTMLTextAreaElement).value).toBe('-y\nserver-github')
    expect((editor.getByLabelText(en.fieldEnv) as HTMLTextAreaElement).value).toBe('TOKEN=${credential:GH}')
    host.mutate.mockResolvedValueOnce(false)
    fireEvent.change(editor.getByLabelText(en.fieldCommand), { target: { value: 'node' } })
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: en.save })) })
    expect(editor.getByText(en.refused)).toBeTruthy()
    expect(screen.getByText(en.noticeRefused)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.dismiss }))
    expect(screen.queryByText(en.noticeRefused)).toBeNull()
  })

  it('disables every write on a read-only document and says so', () => {
    const { host } = mount()
    act(() => { host.publish({ writable: false }) })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect((screen.getByRole('button', { name: en.add }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(row('github')).getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    expect((within(row('github')).getByRole('button', { name: en.edit }) as HTMLButtonElement).disabled).toBe(true)
    // Testing and restarting change no stored setting.
    expect((within(row('github')).getByRole('button', { name: en.test }) as HTMLButtonElement).disabled).toBe(false)
  })
})
