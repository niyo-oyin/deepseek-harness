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

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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
  } as ComponentProps<typeof McpServersCard>
  const rendered = render(<McpServersCard {...props} />)
  return { host, manager, unwatch, rendered, list: (servers: McpManagedServerView[]) => { act(() => { onList?.(servers) }) } }
}

const row = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-mcp-server="${name}"]`)!
const button = (scope: HTMLElement, name: string): HTMLButtonElement => within(scope).getByRole('button', { name })
const editorIn = (scope: ParentNode): ReturnType<typeof within> => within(scope.querySelector<HTMLElement>('[data-mcp-editor]')!)

describe('McpServersCard', () => {
  it('renders the one-liner for the summary view without following the live list', () => {
    const { manager, rendered } = mount('summary')
    expect(rendered.container.textContent).toBe(en.description)
    expect(manager.watch).not.toHaveBeenCalled()
  })

  it('shows placeholders until the settings are read, and says when there is nothing to list', () => {
    const { host } = mount()
    act(() => { host.publish({ status: 'loading' }) })
    expect(screen.getByRole('status', { name: en.loading })).toBeTruthy()
    act(() => { host.publish({ status: 'ready', value: { servers: {} }, user: { servers: {} } }) })
    expect(screen.queryByRole('status', { name: en.loading })).toBeNull()
    expect(screen.getByText(en.empty)).toBeTruthy()
    act(() => { host.publish({ status: 'unavailable' }) })
    expect(screen.getByText(en.unavailable)).toBeTruthy()
    expect(screen.queryByRole('status', { name: en.loading })).toBeNull()
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
    expect(plugin.getByText('Connected · tools: 4')).toBeTruthy()
    expect(plugin.getAllByRole('button').map(control => control.getAttribute('aria-label'))).toEqual(['Restart from-plugin'])
    expect(plugin.queryByRole('switch')).toBeNull()

    rendered.unmount()
    expect(unwatch).toHaveBeenCalledOnce()
  })

  it.each<[McpManagedServerView['status'], string, string | undefined]>([
    [{ state: 'connecting', attempt: 0 }, en.statusConnecting, undefined],
    [{ state: 'waiting-credentials', lastError: 'GH is not set' }, en.statusWaitingCredentials, 'GH is not set'],
    [{ state: 'disabled' }, en.statusDisabled, undefined],
    [{ state: 'closed', result: { closeConfirmed: true } }, en.statusClosed, undefined],
    [{ state: 'failed', reason: 'load', lastError: 'bad entry' }, en.statusFailed, 'bad entry'],
    [{ state: 'failed', reason: 'cleanup', result: { closeConfirmed: false, cleanupError: 'still running' } }, en.statusFailed, 'still running'],
    [{ state: 'failed', reason: 'cleanup', result: { closeConfirmed: true } }, en.statusFailed, undefined],
    [{ state: 'failed', reason: 'gave-up' }, en.statusFailed, undefined],
  ])('names the %o status and any diagnostic beside it', (status, label, detail) => {
    const { list } = mount()
    list([{ name: 'github', configured: true, status }])
    expect(within(row('github')).getByText(label)).toBeTruthy()
    if (detail !== undefined) expect(within(row('github')).getByText(detail)).toBeTruthy()
    else expect(row('github').querySelectorAll('p')).toHaveLength(1)
  })

  it('switches, tests, and restarts a server from its row', async () => {
    const { host, manager } = mount()
    const toggle = within(row('github')).getByRole('switch', { name: 'Enable github' })
    let accept: (accepted: boolean) => void = () => undefined
    host.mutate.mockReturnValueOnce(new Promise((resolve) => { accept = resolve }))
    fireEvent.click(toggle)
    expect(host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['servers', 'github', 'enabled'], value: false }])
    // The switch waits for its write before it can be used again.
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { accept(true) })
    expect((toggle as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(button(row('github'), 'Test github'))
    expect(await within(row('github')).findByText('Connected in 40 ms. Tools (1): search')).toBeTruthy()
    fireEvent.click(button(row('github'), 'Restart github'))
    expect(manager.restart).toHaveBeenCalledExactlyOnceWith('github')
  })

  it('says what a connection test is doing and what it found', async () => {
    const { manager } = mount()
    let finish: () => void = () => undefined
    manager.probe.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => { resolve({ ok: false, stage: 'connect', message: 'spawn npx ENOENT', durationMs: 5, closeConfirmed: true }) }
    }))
    const test = button(row('github'), 'Test github')
    fireEvent.click(test)
    expect(within(row('github')).getByRole('status').textContent).toBe(en.testing)
    expect(test.disabled).toBe(true)
    await act(async () => { finish() })
    expect(within(row('github')).getByRole('status').textContent).toBe('Could not connect: spawn npx ENOENT')

    const names = Array.from({ length: 9 }, (_, index) => `tool${String(index)}`)
    manager.probe.mockResolvedValueOnce({ ok: true, toolNames: names, truncated: false, durationMs: 7, closeConfirmed: true })
    await act(async () => { fireEvent.click(test) })
    expect(within(row('github')).getByRole('status').textContent)
      .toBe(`Connected in 7 ms. Tools (9): ${names.slice(0, 8).join(', ')}, and more`)
    manager.probe.mockResolvedValueOnce({ ok: true, toolNames: [], truncated: false, durationMs: 3, closeConfirmed: true })
    await act(async () => { fireEvent.click(test) })
    expect(within(row('github')).getByRole('status').textContent).toBe('Connected in 3 ms. The server offers no tools.')
  })

  it('lists the entries that ship with the deployment with what they run, and offers no removal for them', () => {
    const { host } = mount()
    act(() => {
      host.publish({
        value: { servers: { github, docs: { transport: 'streamable-http', url: 'https://docs.example/mcp' }, local: { transport: 'stdio' } } },
        user: { servers: { github } },
      })
    })
    expect(within(row('docs')).getByText(en.originComposition)).toBeTruthy()
    expect(within(row('docs')).getByText('https://docs.example/mcp')).toBeTruthy()
    expect(within(row('docs')).queryByRole('button', { name: 'Remove docs' })).toBeNull()
    // An entry that names nothing to run shows no target line.
    expect(row('local').querySelectorAll('p')).toHaveLength(0)
  })

  it('removes a server only after the removal is confirmed', () => {
    const { host } = mount()
    fireEvent.click(button(row('github'), 'Remove github'))
    fireEvent.click(button(screen.getByRole('dialog', { name: 'Remove “github”?' }), en.close))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(button(row('github'), 'Remove github'))
    fireEvent.click(button(screen.getByRole('dialog'), en.cancel))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(host.mutate).not.toHaveBeenCalled()
    fireEvent.click(button(row('github'), 'Remove github'))
    fireEvent.click(button(screen.getByRole('dialog'), en.remove))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(host.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'unset', path: ['servers', 'github'] }])
  })

  it('adds a server through the editor, marking the field a draft gets wrong', async () => {
    const { host } = mount()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    // One editor at a time: nothing else opens over the draft.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.add }).disabled).toBe(true)
    expect(button(row('github'), 'Edit github').disabled).toBe(true)
    const editor = editorIn(document)
    const name = editor.getByLabelText(en.fieldName)
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe(en.fieldNameHint)
    fireEvent.change(name, { target: { value: 'docs server' } })
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: en.save })) })
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(editor.getByRole('alert').textContent).toBe(en.problemName)
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe(en.problemName)
    expect(host.mutate).not.toHaveBeenCalled()

    fireEvent.change(name, { target: { value: 'docs' } })
    expect(name.getAttribute('aria-invalid')).toBeNull()
    const transport = editor.getByLabelText(en.fieldTransport)
    fireEvent.change(transport, { target: { value: 'streamable-http' } })
    // The fields follow the connection: an HTTP server has a URL and headers, not a command.
    expect(editor.queryByLabelText(en.fieldCommand)).toBeNull()
    fireEvent.change(transport, { target: { value: 'stdio' } })
    expect(editor.queryByLabelText(en.fieldUrl)).toBeNull()
    fireEvent.change(transport, { target: { value: 'streamable-http' } })
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

  it.each<[string, Record<string, string>, string, string]>([
    ['a taken name', { [en.fieldName]: 'github', [en.fieldCommand]: 'node' }, en.fieldName, en.problemNameTaken],
    ['a missing command', { [en.fieldName]: 'docs' }, en.fieldCommand, en.problemCommand],
    ['an environment line without =', { [en.fieldName]: 'docs', [en.fieldCommand]: 'node', [en.fieldEnv]: 'TOKEN' }, en.fieldEnv, 'This line is not NAME=value: TOKEN'],
    ['a missing URL', { [en.fieldName]: 'docs', [en.fieldTransport]: 'streamable-http' }, en.fieldUrl, en.problemUrl],
    ['a header line without a colon', { [en.fieldName]: 'docs', [en.fieldTransport]: 'streamable-http', [en.fieldUrl]: 'https://x', [en.fieldHeaders]: 'Bearer' },
      en.fieldHeaders, 'This line is not Name: value: Bearer'],
  ])('explains %s on the field at fault', async (_case, fields, field, message) => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const editor = editorIn(document)
    for (const [label, text] of Object.entries(fields)) fireEvent.change(editor.getByLabelText(label), { target: { value: text } })
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: en.save })) })
    expect(editor.getByLabelText(field).getAttribute('aria-invalid')).toBe('true')
    expect(editor.getByRole('alert').textContent).toBe(message)
  })

  it('edits a server in place with its name fixed, and reports a refusal in the editor and as a fading notice', async () => {
    vi.useFakeTimers()
    const { host } = mount()
    const edit = button(row('github'), 'Edit github')
    fireEvent.click(edit)
    expect(edit.getAttribute('aria-expanded')).toBe('true')
    const editor = editorIn(row('github'))
    expect(document.getElementById(edit.getAttribute('aria-controls')!)).toBe(row('github').querySelector('[data-mcp-editor]'))
    expect((editor.getByLabelText(en.fieldName) as HTMLInputElement).disabled).toBe(true)
    expect((editor.getByLabelText(en.fieldArgs) as HTMLTextAreaElement).value).toBe('-y\nserver-github')
    expect((editor.getByLabelText(en.fieldEnv) as HTMLTextAreaElement).value).toBe('TOKEN=${credential:GH}')
    host.mutate.mockResolvedValueOnce(false)
    fireEvent.change(editor.getByLabelText(en.fieldCommand), { target: { value: 'node' } })
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: en.save })) })
    expect(editor.getByText(en.refused).getAttribute('role')).toBe('alert')
    expect(screen.getByText(en.noticeRefused)).toBeTruthy()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.queryByText(en.noticeRefused)).toBeNull()

    fireEvent.click(editor.getByRole('button', { name: en.cancel }))
    expect(row('github').querySelector('[data-mcp-editor]')).toBeNull()
    expect(edit.getAttribute('aria-expanded')).toBe('false')
    // The row's Edit button opens and closes its editor.
    fireEvent.click(edit)
    fireEvent.click(edit)
    expect(row('github').querySelector('[data-mcp-editor]')).toBeNull()
  })

  it('keeps a failure that names what broke on screen longer', async () => {
    vi.useFakeTimers()
    const { manager } = mount()
    manager.restart.mockResolvedValueOnce({ failed: 'spawn npx ENOENT' })
    await act(async () => { fireEvent.click(button(row('github'), 'Restart github')) })
    expect(screen.getByText('The operation failed: spawn npx ENOENT')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.getByText('The operation failed: spawn npx ENOENT')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.queryByText('The operation failed: spawn npx ENOENT')).toBeNull()
  })

  it('disables every write on a read-only document and says so', () => {
    const { host } = mount()
    act(() => { host.publish({ writable: false }) })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect((screen.getByRole('button', { name: en.add }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(row('github')).getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    expect(button(row('github'), 'Edit github').disabled).toBe(true)
    expect(button(row('github'), 'Remove github').disabled).toBe(true)
    // Testing and restarting change no stored setting.
    expect(button(row('github'), 'Test github').disabled).toBe(false)
  })
})
