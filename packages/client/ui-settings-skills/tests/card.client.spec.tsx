// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { ManagedSkillView } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { SkillsCard } from '../src/client/SkillsCard.tsx'
import { SkillsController, type SkillManagerFace, type SkillSettings } from '../src/client/controller.ts'
import { en, type SkillSettingsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: SkillSettingsLocaleKey, params?: Record<string, string | number>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])) as ComponentProps<typeof SkillsCard>['t']

const review: ManagedSkillView = {
  name: 'review', description: 'Review a change', source: 'user-dsh', path: '/home/me/.dsh/skills/review/SKILL.md',
  modelInvocable: true, userInvocable: true, editable: true,
}
const office: ManagedSkillView = {
  name: 'office', description: 'Work with Office files', source: 'bundled', modelInvocable: false, userInvocable: true, editable: false,
}

/** The page over a scripted settings form and manager, as the Plugins page renders it. */
function mount(view: 'summary' | 'page' = 'page') {
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
  const props = { view, t, useSkills: bindSnapshotSelector(hooks.skills), ...actions } as unknown as ComponentProps<typeof SkillsCard>
  const rendered = render(<SkillsCard {...props} />)
  const list = (skills: ManagedSkillView[]): void => { act(() => { onList?.(skills) }) }
  if (view === 'page') list([office, review])
  return { host, manager, unwatch, rendered, list }
}

const row = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-skill="${name}"]`)!
const editorIn = (scope: ParentNode): ReturnType<typeof within> => within(scope.querySelector<HTMLElement>('[data-skill-editor]')!)
const value = (field: HTMLElement): string => (field as HTMLInputElement).value

describe('SkillsCard', () => {
  it('renders the one-liner for the summary view without following the skill list', () => {
    const { manager, rendered } = mount('summary')
    expect(rendered.container.textContent).toBe(en.description)
    expect(manager.watch).not.toHaveBeenCalled()
  })

  it('lists each skill with where it comes from and how it is invoked, and stops following on unmount', () => {
    const { unwatch, rendered } = mount()
    expect(within(row('review')).getByText(en.originUser)).toBeTruthy()
    expect(within(row('review')).getByText('Review a change')).toBeTruthy()
    expect(within(row('review')).getByText('/home/me/.dsh/skills/review/SKILL.md')).toBeTruthy()
    expect(within(row('office')).getByText(en.originBuiltIn)).toBeTruthy()
    expect(within(row('office')).getByText(en.manualOnly)).toBeTruthy()
    // A skill outside the user's folders can be read and switched, not edited or removed.
    expect(within(row('office')).getAllByRole('button').map(button => button.textContent)).toEqual([en.view])
    // Only a skill that is a file has a bundle to export.
    expect(within(row('review')).getAllByRole('button').map(button => button.textContent)).toEqual([en.edit, en.export, en.remove])
    expect(within(row('office')).getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(within(row('review')).getByRole('switch').getAttribute('aria-checked')).toBe('true')
    rendered.unmount()
    expect(unwatch).toHaveBeenCalledOnce()
  })

  it('switches a skill off and on from its row', () => {
    const { host } = mount()
    fireEvent.click(within(row('review')).getByRole('switch', { name: 'Use review' }))
    expect(host.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['disabled'], value: ['office', 'review'] }])
    fireEvent.click(within(row('office')).getByRole('switch'))
    expect(host.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['disabled'], value: [] }])
  })

  it('adds a skill through the editor, explaining a draft the manager refuses', async () => {
    const { manager } = mount()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const editor = editorIn(document)
    fireEvent.change(editor.getByLabelText(en.fieldName), { target: { value: 'Release Notes' } })
    fireEvent.change(editor.getByLabelText(en.fieldDescription), { target: { value: 'Write release notes' } })
    fireEvent.change(editor.getByLabelText(en.fieldContent), { target: { value: 'Collect the merged changes.' } })
    manager.create.mockResolvedValueOnce({ ok: false, refused: 'invalid-name' })
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: en.save })) })
    expect(editor.getByRole('alert').textContent).toBe(en.problemInvalidName)

    fireEvent.change(editor.getByLabelText(en.fieldName), { target: { value: 'release-notes' } })
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: en.save })) })
    expect(manager.create).toHaveBeenLastCalledWith({
      name: 'release-notes', description: 'Write release notes', whenToUse: '', content: 'Collect the merged changes.',
    })
    // A written skill closes the editor.
    expect(document.querySelector('[data-skill-editor]')).toBeNull()
  })

  it('edits one of the user\'s skills in place with its name fixed, keeping what is typed when the list changes behind it', async () => {
    const { manager, list } = mount()
    await act(async () => { fireEvent.click(within(row('review')).getByRole('button', { name: en.edit })) })
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
  })

  it('shows a skill that cannot be changed here read-only', async () => {
    const { manager } = mount()
    await act(async () => { fireEvent.click(within(row('office')).getByRole('button', { name: en.view })) })
    const editor = editorIn(row('office'))
    expect(editor.getByText(en.viewOnly)).toBeTruthy()
    expect((editor.getByLabelText(en.fieldContent) as HTMLTextAreaElement).disabled).toBe(true)
    expect(editor.queryByRole('button', { name: en.save })).toBeNull()
    fireEvent.click(editor.getByRole('button', { name: en.close }))
    expect(row('office').querySelector('[data-skill-editor]')).toBeNull()
    expect(manager.update).not.toHaveBeenCalled()
  })

  it('removes a skill only after the removal is confirmed', () => {
    const { manager } = mount()
    fireEvent.click(within(row('review')).getByRole('button', { name: en.remove }))
    expect(within(row('review')).getByText('Delete “review” and every file in its folder?')).toBeTruthy()
    fireEvent.click(within(row('review')).getByRole('button', { name: en.cancel }))
    expect(manager.remove).not.toHaveBeenCalled()
    fireEvent.click(within(row('review')).getByRole('button', { name: en.remove }))
    fireEvent.click(within(row('review')).getByRole('button', { name: en.remove }))
    expect(manager.remove).toHaveBeenCalledExactlyOnceWith('review')
  })

  it('imports a chosen ZIP, lists what became of each skill, and replaces the ones it left on request', async () => {
    const { manager } = mount()
    const archive = new File(['zip bytes'], 'skills.zip', { type: 'application/zip' })
    const picker = document.querySelector<HTMLInputElement>('[data-skill-import]')!
    await act(async () => { fireEvent.change(picker, { target: { files: [archive] } }) })
    expect(manager.importArchive).toHaveBeenCalledExactlyOnceWith(archive, false)
    const result = within(document.querySelector<HTMLElement>('[data-skill-transfer="imported"]')!)
    expect(result.getByText('triage: added')).toBeTruthy()
    expect(result.getByText('review: not added, because you already have a skill with this name')).toBeTruthy()

    manager.importArchive.mockResolvedValueOnce({ ok: true, skills: [{ name: 'triage', outcome: 'replaced' }, { name: 'review', outcome: 'replaced' }] })
    await act(async () => { fireEvent.click(result.getByRole('button', { name: en.replaceImported })) })
    expect(manager.importArchive).toHaveBeenLastCalledWith(archive, true)
    expect(screen.getByText('review: replaced')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.replaceImported })).toBeNull()
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-skill-transfer]')!).getByRole('button', { name: en.dismiss }))
    expect(document.querySelector('[data-skill-transfer]')).toBeNull()
  })

  it('says why a chosen archive was refused', async () => {
    const { manager } = mount()
    manager.importArchive.mockResolvedValueOnce({ ok: false, refused: 'no-skill' })
    const picker = document.querySelector<HTMLInputElement>('[data-skill-import]')!
    await act(async () => { fireEvent.change(picker, { target: { files: [new File(['x'], 'notes.zip')] } }) })
    expect(screen.getByText(en.refusedNoSkill)).toBeTruthy()
  })

  it('exports a skill from its row and says where it was saved', async () => {
    const { manager } = mount()
    await act(async () => { fireEvent.click(within(row('review')).getByRole('button', { name: en.export })) })
    expect(manager.exportArchive).toHaveBeenCalledExactlyOnceWith('review')
    expect(screen.getByText('Exported “review” to /downloads/review.zip')).toBeTruthy()
  })

  it('locks the switches on a read-only document and says so, while the user\'s own skill files stay editable', () => {
    const { host } = mount()
    act(() => { host.publish({ writable: false }) })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect((within(row('review')).getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: en.add }) as HTMLButtonElement).disabled).toBe(false)
    expect((within(row('review')).getByRole('button', { name: en.edit }) as HTMLButtonElement).disabled).toBe(false)
  })
})
