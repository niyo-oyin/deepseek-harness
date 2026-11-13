// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { ManagedSkillView } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { SkillsCard } from '../src/client/SkillsCard.tsx'
import { SkillsController, type SkillManagerFace, type SkillSettings } from '../src/client/controller.ts'
import { en, type SkillSettingsLocaleKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = ((key: SkillSettingsLocaleKey, params?: Record<string, string | number>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])) as ComponentProps<typeof SkillsCard>['t']

const review: ManagedSkillView = {
  name: 'review', description: 'Review a change', source: 'user-dsh', path: '/home/me/.dsh/skills/review/SKILL.md',
  modelInvocable: true, userInvocable: true, editable: true,
}
const office: ManagedSkillView = {
  name: 'office', description: 'Work with Office files', source: 'bundled', modelInvocable: false, userInvocable: true, editable: false,
}

/** The page over a scripted settings form and manager, as the Plugins page renders it; `listed` delivers the first list. */
function mount(view: 'summary' | 'page' = 'page', listed = true) {
  const host = stubConfigForm<SkillSettings>()
  host.publish({ status: 'ready', writable: true, revision: 1, value: { disabled: ['office'] } })
  let onList: ((skills: readonly ManagedSkillView[]) => void) | undefined
  const unwatch = vi.fn()
  const manager = {
    watch: vi.fn<SkillManagerFace['watch']>((listener) => {
      onList = listener
      return unwatch
    }),
    read: vi.fn<SkillManagerFace['read']>(async name => ({ name, description: `${name} description`, whenToUse: 'Sometimes', content: 'Steps.' })),
    create: vi.fn<SkillManagerFace['create']>(async () => ({ ok: true })),
    update: vi.fn<SkillManagerFace['update']>(async () => ({ ok: true })),
    remove: vi.fn<SkillManagerFace['remove']>(async () => ({ ok: true })),
    importArchive: vi.fn<SkillManagerFace['importArchive']>(async () => ({
      ok: true, skills: [{ name: 'triage', outcome: 'imported' }, { name: 'review', outcome: 'exists' }],
    })),
    exportArchive: vi.fn<SkillManagerFace['exportArchive']>(async () => ({ status: 'saved', path: '/downloads/review.zip' })),
  }
  const { hooks, ...actions } = new SkillsController(host.scope, manager).inject()
  const props = { view, t, useSkills: bindSnapshotSelector(hooks.skills), ...actions } as ComponentProps<typeof SkillsCard>
  const rendered = render(<SkillsCard {...props} />)
  const list = (skills: ManagedSkillView[]): void => { act(() => { onList?.(skills) }) }
  if (view === 'page' && listed) list([office, review])
  return { host, manager, unwatch, rendered, list }
}

const row = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-skill="${name}"]`)!
const button = (scope: HTMLElement, name: string): HTMLButtonElement => within(scope).getByRole('button', { name })
const editorIn = (scope: ParentNode): ReturnType<typeof within> => within(scope.querySelector<HTMLElement>('[data-skill-editor]')!)
const value = (field: HTMLElement): string => (field as HTMLInputElement).value
const pick = async (archive: File): Promise<void> => {
  await act(async () => { fireEvent.change(document.querySelector<HTMLInputElement>('[data-skill-import]')!, { target: { files: [archive] } }) })
}

describe('SkillsCard', () => {
  it('renders the one-liner for the summary view without following the skill list', () => {
    const { manager, rendered } = mount('summary')
    expect(rendered.container.textContent).toBe(en.description)
    expect(manager.watch).not.toHaveBeenCalled()
  })

  it('shows placeholders until the first list arrives, and says when there is nothing to list', () => {
    const { list } = mount('page', false)
    expect(screen.getByRole('status', { name: en.loading })).toBeTruthy()
    list([])
    expect(screen.queryByRole('status', { name: en.loading })).toBeNull()
    expect(screen.getByText(en.empty)).toBeTruthy()
    cleanup()
    const unavailable = mount('page', false)
    act(() => { unavailable.host.publish({ status: 'unavailable' }) })
    // A registry that is not loaded is said once, without a placeholder that would never resolve.
    expect(screen.getByText(en.unavailable)).toBeTruthy()
    expect(screen.queryByRole('status', { name: en.loading })).toBeNull()
  })

  it('lists each skill with where it comes from and how it is invoked, and stops following on unmount', () => {
    const { unwatch, rendered } = mount()
    expect(within(row('review')).getByText(en.originUser)).toBeTruthy()
    expect(within(row('review')).getByText('Review a change')).toBeTruthy()
    expect(within(row('review')).getByText('/home/me/.dsh/skills/review/SKILL.md')).toBeTruthy()
    expect(within(row('office')).getByText(en.originBuiltIn)).toBeTruthy()
    expect(within(row('office')).getByText(en.manualOnly)).toBeTruthy()
    // A skill outside the user's folders can be read and switched, not edited or removed.
    expect(within(row('office')).getAllByRole('button').map(control => control.getAttribute('aria-label'))).toEqual(['View office'])
    // Only a skill that is a file has a bundle to export.
    expect(within(row('review')).getAllByRole('button').map(control => control.getAttribute('aria-label')))
      .toEqual(['Edit review', 'Export review', 'Remove review'])
    expect(within(row('office')).getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(within(row('review')).getByRole('switch').getAttribute('aria-checked')).toBe('true')
    rendered.unmount()
    expect(unwatch).toHaveBeenCalledOnce()
  })

  it('marks a skill only the model can load', () => {
    const { list } = mount()
    list([{ ...office, name: 'auto', modelInvocable: true, userInvocable: false }])
    expect(within(row('auto')).getByText(en.modelOnly)).toBeTruthy()
    expect(within(row('auto')).queryByText(en.manualOnly)).toBeNull()
  })

  it('switches a skill off and on from its row, holding each switch until its write returns', async () => {
    const { host } = mount()
    let accept: (accepted: boolean) => void = () => undefined
    host.mutate.mockReturnValueOnce(new Promise((resolve) => { accept = resolve }))
    const toggle = within(row('review')).getByRole<HTMLButtonElement>('switch', { name: 'Enable review' })
    fireEvent.click(toggle)
    expect(host.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['disabled'], value: ['office', 'review'] }])
    expect(toggle.disabled).toBe(true)
    // A second switch made before the first is written keeps the first.
    fireEvent.click(within(row('office')).getByRole('switch'))
    expect(host.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['disabled'], value: ['review'] }])
    await act(async () => { accept(true) })
    expect(toggle.disabled).toBe(false)
  })

  it('adds a skill through the editor, marking the field a draft gets wrong', async () => {
    const { manager } = mount()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    // One editor at a time: nothing else opens over the draft.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.add }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.importZip }).disabled).toBe(true)
    expect(button(row('review'), 'Edit review').disabled).toBe(true)
    const editor = editorIn(document)
    const name = editor.getByLabelText(en.fieldName)
    fireEvent.change(name, { target: { value: 'Release Notes' } })
    fireEvent.change(editor.getByLabelText(en.fieldDescription), { target: { value: 'Write release notes' } })
    fireEvent.change(editor.getByLabelText(en.fieldContent), { target: { value: 'Collect the merged changes.' } })
    let refuse: () => void = () => undefined
    manager.create.mockImplementationOnce(() => new Promise((resolve) => { refuse = () => { resolve({ ok: false, refused: 'invalid-name' }) } }))
    fireEvent.click(editor.getByRole('button', { name: en.save }))
    expect((editor.getByRole('button', { name: en.saving }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { refuse() })
    expect(editor.getByRole('alert').textContent).toBe(en.problemInvalidName)
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe(en.problemInvalidName)

    fireEvent.change(name, { target: { value: 'release-notes' } })
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe(en.fieldNameHint)
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: en.save })) })
    expect(manager.create).toHaveBeenLastCalledWith({
      name: 'release-notes', description: 'Write release notes', whenToUse: '', content: 'Collect the merged changes.',
    })
    // A written skill closes the editor.
    expect(document.querySelector('[data-skill-editor]')).toBeNull()
  })

  it.each<[string, Awaited<ReturnType<SkillManagerFace['create']>>, string | undefined, string]>([
    ['a taken name', { ok: false, refused: 'name-taken' }, en.fieldName, en.problemNameTaken],
    ['a missing description', { ok: false, refused: 'no-description' }, en.fieldDescription, en.problemNoDescription],
    ['a skill that is gone', { ok: false, refused: 'not-found' }, undefined, en.problemGone],
    ['a failed call', { failed: 'EACCES' }, undefined, 'Could not save: EACCES'],
  ])('explains %s where it belongs', async (_case, result, field, message) => {
    const { manager } = mount()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const editor = editorIn(document)
    manager.create.mockResolvedValueOnce(result)
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: en.save })) })
    expect(editor.getByRole('alert').textContent).toBe(message)
    if (field !== undefined) expect(editor.getByLabelText(field).getAttribute('aria-invalid')).toBe('true')
    else expect(document.querySelector('[aria-invalid]')).toBeNull()
  })

  it('edits one of the user\'s skills in place with its name fixed, keeping what is typed when the list changes behind it', async () => {
    const { manager, list } = mount()
    let deliver: () => void = () => undefined
    manager.read.mockImplementationOnce(name => new Promise((resolve) => {
      deliver = () => { resolve({ name, description: `${name} description`, whenToUse: 'Sometimes', content: 'Steps.' }) }
    }))
    const edit = button(row('review'), 'Edit review')
    fireEvent.click(edit)
    expect(edit.getAttribute('aria-expanded')).toBe('true')
    // The editor waits for the skill's text, and says so.
    expect(document.getElementById(edit.getAttribute('aria-controls')!)!.getAttribute('aria-label')).toBe(en.loading)
    await act(async () => { deliver() })
    const editor = editorIn(row('review'))
    expect((editor.getByLabelText(en.fieldName) as HTMLInputElement).disabled).toBe(true)
    expect(value(editor.getByLabelText(en.fieldWhenToUse))).toBe('Sometimes')
    fireEvent.change(editor.getByLabelText(en.fieldContent), { target: { value: 'New steps.' } })
    list([office, { ...review, description: 'Changed elsewhere' }])
    expect(manager.read).toHaveBeenCalledOnce()
    expect(value(editorIn(row('review')).getByLabelText(en.fieldContent))).toBe('New steps.')

    await act(async () => { fireEvent.click(editorIn(row('review')).getByRole('button', { name: en.save })) })
    expect(manager.update).toHaveBeenCalledExactlyOnceWith({
      name: 'review', description: 'review description', whenToUse: 'Sometimes', content: 'New steps.',
    })
    expect(row('review').querySelector('[data-skill-editor]')).toBeNull()
    expect(edit.getAttribute('aria-expanded')).toBe('false')
  })

  it('drops a skill read for an editor that was closed before it arrived', async () => {
    const { manager } = mount()
    let deliver: () => void = () => undefined
    manager.read.mockImplementationOnce(name => new Promise((resolve) => {
      deliver = () => { resolve({ name, description: 'late', whenToUse: '', content: '' }) }
    }))
    const edit = button(row('review'), 'Edit review')
    fireEvent.click(edit)
    fireEvent.click(edit)
    await act(async () => { deliver() })
    expect(row('review').querySelector('[data-skill-editor]')).toBeNull()
    expect(edit.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows a skill that cannot be changed here read-only', async () => {
    const { manager } = mount()
    await act(async () => { fireEvent.click(button(row('office'), 'View office')) })
    const editor = editorIn(row('office'))
    expect(editor.getByText(en.viewOnly)).toBeTruthy()
    expect((editor.getByLabelText(en.fieldContent) as HTMLTextAreaElement).disabled).toBe(true)
    expect(editor.queryByRole('button', { name: en.save })).toBeNull()
    // Enter in a read-only form saves nothing.
    await act(async () => { fireEvent.submit(row('office').querySelector('form')!) })
    fireEvent.click(editor.getByRole('button', { name: en.close }))
    expect(row('office').querySelector('[data-skill-editor]')).toBeNull()
    expect(manager.update).not.toHaveBeenCalled()
  })

  it('closes the editor of a skill that could not be read and says why in a fading notice', async () => {
    vi.useFakeTimers()
    const { manager } = mount()
    manager.read.mockResolvedValueOnce(null)
    await act(async () => { fireEvent.click(button(row('review'), 'Edit review')) })
    expect(row('review').querySelector('[data-skill-editor]')).toBeNull()
    expect(screen.getByText('“review” is no longer listed, or it cannot be changed here.')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.queryByText('“review” is no longer listed, or it cannot be changed here.')).toBeNull()
  })

  it('removes a skill only after the removal is confirmed', async () => {
    const { manager } = mount()
    fireEvent.click(button(row('review'), 'Remove review'))
    fireEvent.click(button(screen.getByRole('dialog'), en.close))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(button(row('review'), 'Remove review'))
    const dialog = screen.getByRole('dialog', { name: 'Remove “review”?' })
    expect(within(dialog).getByText(en.removeDescription)).toBeTruthy()
    fireEvent.click(button(dialog, en.cancel))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(manager.remove).not.toHaveBeenCalled()
    fireEvent.click(button(row('review'), 'Remove review'))
    await act(async () => { fireEvent.click(button(screen.getByRole('dialog'), en.remove)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(manager.remove).toHaveBeenCalledExactlyOnceWith('review')
  })

  it('keeps a failure that names what broke on screen longer', async () => {
    vi.useFakeTimers()
    const { manager, host } = mount()
    manager.remove.mockResolvedValueOnce({ failed: 'EBUSY' })
    fireEvent.click(button(row('review'), 'Remove review'))
    await act(async () => { fireEvent.click(button(screen.getByRole('dialog'), en.remove)) })
    expect(screen.getByText('The operation failed: EBUSY')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.getByText('The operation failed: EBUSY')).toBeTruthy()
    // A later notice takes its place.
    host.mutate.mockResolvedValueOnce(false)
    await act(async () => { fireEvent.click(within(row('review')).getByRole('switch')) })
    expect(screen.queryByText('The operation failed: EBUSY')).toBeNull()
    expect(screen.getByText(en.noticeRefused)).toBeTruthy()
  })

  it('imports a chosen ZIP while saying so, lists what became of each skill, and replaces the ones it left on request', async () => {
    const { manager } = mount()
    const archive = new File(['zip bytes'], 'skills.zip', { type: 'application/zip' })
    let finish: () => void = () => undefined
    manager.importArchive.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => { resolve({ ok: true, skills: [{ name: 'triage', outcome: 'imported' }, { name: 'review', outcome: 'exists' }, { name: 'big', outcome: 'failed' }] }) }
    }))
    await pick(archive)
    expect(manager.importArchive).toHaveBeenCalledExactlyOnceWith(archive, false)
    expect(screen.getByRole('status').textContent).toBe(en.importing)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.importZip }).disabled).toBe(true)
    await act(async () => { finish() })
    const result = within(document.querySelector<HTMLElement>('[data-skill-transfer="imported"]')!)
    expect(result.getByText('triage: added')).toBeTruthy()
    expect(result.getByText('review: not added, because you already have a skill with this name')).toBeTruthy()
    expect(result.getByText('big: not added, because its files could not be stored; a skill it was to replace is kept')).toBeTruthy()

    manager.importArchive.mockResolvedValueOnce({ ok: true, skills: [{ name: 'triage', outcome: 'replaced' }, { name: 'review', outcome: 'replaced' }] })
    await act(async () => { fireEvent.click(result.getByRole('button', { name: en.replaceImported })) })
    expect(manager.importArchive).toHaveBeenLastCalledWith(archive, true)
    expect(screen.getByText('review: replaced')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.replaceImported })).toBeNull()
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-skill-transfer]')!).getByRole('button', { name: en.dismiss }))
    expect(document.querySelector('[data-skill-transfer]')).toBeNull()
  })

  it('opens the file picker from Import ZIP and imports nothing when no file is chosen', async () => {
    const { manager } = mount()
    const picker = document.querySelector<HTMLInputElement>('[data-skill-import]')!
    const opened = vi.fn()
    picker.addEventListener('click', opened)
    fireEvent.click(screen.getByRole('button', { name: en.importZip }))
    expect(opened).toHaveBeenCalledOnce()
    await act(async () => { fireEvent.change(picker, { target: { files: [] } }) })
    expect(manager.importArchive).not.toHaveBeenCalled()
  })

  it('says why a chosen archive was refused', async () => {
    const { manager } = mount()
    manager.importArchive.mockResolvedValueOnce({ ok: false, refused: 'no-skill' })
    await pick(new File(['x'], 'notes.zip'))
    expect(screen.getByText(en.refusedNoSkill)).toBeTruthy()
  })

  it('exports a skill from its row and says where it was saved in a fading banner', async () => {
    vi.useFakeTimers()
    const { manager } = mount()
    await act(async () => { fireEvent.click(button(row('review'), 'Export review')) })
    expect(manager.exportArchive).toHaveBeenCalledExactlyOnceWith('review')
    expect(screen.getByText('Exported “review” to /downloads/review.zip')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.queryByText('Exported “review” to /downloads/review.zip')).toBeNull()

    manager.exportArchive.mockResolvedValueOnce({ status: 'requested' })
    await act(async () => { fireEvent.click(button(row('review'), 'Export review')) })
    expect(screen.getByText('Exported “review”.')).toBeTruthy()
  })

  it('says a skill is too large to export, with the limits, for longer', async () => {
    vi.useFakeTimers()
    const { manager } = mount()
    manager.exportArchive.mockResolvedValueOnce({ status: 'refused', reason: 'too-large' })
    await act(async () => { fireEvent.click(button(row('review'), 'Export review')) })
    const text = '“review” is too large to export: the limit is 10,000 files, 256 MiB, and a 64 MiB archive.'
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('locks the switches on a read-only document and says so, while the user\'s own skill files stay editable', () => {
    const { host } = mount()
    act(() => { host.publish({ writable: false }) })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect((within(row('review')).getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: en.add }) as HTMLButtonElement).disabled).toBe(false)
    expect(button(row('review'), 'Edit review').disabled).toBe(false)
  })
})
