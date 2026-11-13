/** The skill manager over a real registry and filesystem provider in throwaway home folders. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import SkillManager from '../src/index.ts'

const never = new AbortController().signal
/** The catalog follows a write through a filesystem watcher, which a loaded machine delays. */
const SETTLED = { timeout: 10_000 }

function skillFile(name: string, description: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${name} instructions.\n`
}

/**
 * A manager over two user skill folders and one folder of built-in skills.
 * @param disabled - skill names the registry switches off.
 */
async function bench(disabled: string[] = []) {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'skill-manager-')))
  const dshHome = join(base, 'dsh')
  const agentsHome = join(base, 'agents')
  const builtIn = join(base, 'built-in')
  const write = (path: string, text: string): string => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
    return path
  }
  write(join(dshHome, 'skills', 'review', 'SKILL.md'), skillFile('review', 'Review a change'))
  write(join(agentsHome, 'skills', 'notes.md'), skillFile('notes', 'Take notes'))
  write(join(builtIn, 'deploy', 'SKILL.md'), skillFile('deploy', 'Deploy the app'))

  const ctx = new Context()
  await ctx.plugin(SkillRegistry, { disabled })
  await ctx.plugin(SkillFilesystem, { dshHome, agentsHome, customSkillDirs: [builtIn] })
  await ctx.plugin(SkillManager, { dshHome, agentsHome })
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    // Windows releases a closed watcher's handles a moment after the close returns.
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })
  const names = async (): Promise<string[]> => (await ctx.skillManager.list()).map(skill => skill.name)
  return { ctx, manager: ctx.skillManager, dshHome, agentsHome, builtIn, write, names }
}

describe('SkillManager', () => {
  it('lists every skill, switched off or not, and marks the ones in the user skill folders as editable', async () => {
    const { manager, dshHome } = await bench(['review'])
    expect(await manager.list()).toEqual([
      expect.objectContaining({ name: 'deploy', source: 'custom', editable: false, modelInvocable: true, userInvocable: true }),
      expect.objectContaining({ name: 'notes', source: 'user-agents', editable: true }),
      {
        name: 'review', description: 'Review a change', source: 'user-dsh', path: join(dshHome, 'skills', 'review', 'SKILL.md'),
        modelInvocable: true, userInvocable: true, editable: true,
      },
    ])
    expect(await manager.read('review', never)).toEqual({
      name: 'review', description: 'Review a change', whenToUse: '', content: 'review instructions.',
    })
    expect(await manager.read('missing', never)).toBeNull()
  })

  it('creates a skill the catalog then lists, and refuses a draft it cannot write', async () => {
    const { manager, dshHome, names } = await bench()
    const draft = { name: 'triage', description: ' Sort new issues ', whenToUse: 'When an issue arrives', content: 'Label it.\n\n' }
    expect(await manager.create(draft, never)).toEqual({ ok: true })
    const file = join(dshHome, 'skills', 'triage', 'SKILL.md')
    expect(readFileSync(file, 'utf8')).toBe(
      '---\nname: triage\ndescription: Sort new issues\nwhenToUse: When an issue arrives\n---\n\nLabel it.\n',
    )
    await vi.waitFor(async () => { expect(await names()).toContain('triage') }, SETTLED)

    expect(await manager.create({ ...draft, name: 'Not Kebab' }, never)).toEqual({ ok: false, refused: 'invalid-name' })
    expect(await manager.create({ ...draft, name: 'empty', description: '  ' }, never)).toEqual({ ok: false, refused: 'no-description' })
    // A name any source already supplies, and a folder that holds no readable skill.
    expect(await manager.create({ ...draft, name: 'deploy' }, never)).toEqual({ ok: false, refused: 'name-taken' })
    mkdirSync(join(dshHome, 'skills', 'draft'))
    expect(await manager.create({ ...draft, name: 'draft' }, never)).toEqual({ ok: false, refused: 'name-taken' })
    expect(existsSync(join(dshHome, 'skills', 'draft', 'SKILL.md'))).toBe(false)
  })

  it('rewrites the edited fields of a user skill and keeps the rest of its frontmatter', async () => {
    const { manager, dshHome, write } = await bench()
    const file = write(
      join(dshHome, 'skills', 'audit', 'SKILL.md'),
      skillFile('audit', 'Old', '# keep me\ndisable-model-invocation: true\nwhenToUse: Sometimes\nmetadata:\n  owner: me\n'),
    )
    await vi.waitFor(async () => { expect(await manager.read('audit', never)).not.toBeNull() }, SETTLED)

    const edit = { name: 'audit', description: 'Audit the dependencies: licenses, advisories', whenToUse: '', content: 'New steps.' }
    expect(await manager.update(edit, never)).toEqual({ ok: true })
    expect(readFileSync(file, 'utf8')).toBe(
      '---\nname: audit\ndescription: "Audit the dependencies: licenses, advisories"\n# keep me\ndisable-model-invocation: true\n'
      + 'metadata:\n  owner: me\n---\n\nNew steps.\n',
    )
    await vi.waitFor(async () => {
      expect(await manager.list()).toContainEqual(expect.objectContaining({
        name: 'audit', description: 'Audit the dependencies: licenses, advisories', modelInvocable: false,
      }))
    }, SETTLED)

    expect(await manager.update({ ...edit, description: '' }, never)).toEqual({ ok: false, refused: 'no-description' })
    expect(await manager.update({ ...edit, name: 'deploy' }, never)).toEqual({ ok: false, refused: 'not-editable' })
    expect(await manager.update({ ...edit, name: 'missing' }, never)).toEqual({ ok: false, refused: 'not-found' })
  })

  it('removes a user skill — its folder, or the single file of a flat skill — and nothing outside the user skill folders', async () => {
    const { manager, dshHome, agentsHome, builtIn, write, names } = await bench()
    write(join(dshHome, 'skills', 'review', 'reference.md'), 'A resource of the skill.')

    expect(await manager.delete('review', never)).toEqual({ ok: true })
    expect(existsSync(join(dshHome, 'skills', 'review'))).toBe(false)
    expect(await manager.delete('notes', never)).toEqual({ ok: true })
    expect(existsSync(join(agentsHome, 'skills', 'notes.md'))).toBe(false)
    expect(existsSync(join(agentsHome, 'skills'))).toBe(true)
    await vi.waitFor(async () => { expect(await names()).toEqual(['deploy']) }, SETTLED)

    expect(await manager.delete('deploy', never)).toEqual({ ok: false, refused: 'not-editable' })
    expect(existsSync(join(builtIn, 'deploy', 'SKILL.md'))).toBe(true)
    expect(await manager.delete('missing', never)).toEqual({ ok: false, refused: 'not-found' })
  })

  it('streams the list on subscription and again when it changes, until the subscriber leaves', async () => {
    const { manager, dshHome, write } = await bench()
    const subscriber = new AbortController()
    const lists: string[][] = []
    const done = (async () => {
      for await (const skills of manager.watch(subscriber.signal)) lists.push(skills.map(skill => skill.name))
    })()
    await vi.waitFor(() => { expect(lists).toEqual([['deploy', 'notes', 'review']]) }, SETTLED)

    write(join(dshHome, 'skills', 'triage', 'SKILL.md'), skillFile('triage', 'Sort new issues'))
    await vi.waitFor(() => { expect(lists.at(-1)).toEqual(['deploy', 'notes', 'review', 'triage']) }, SETTLED)
    // One list per change: discovery reporting a change of its own is not sent again.
    expect(new Set(lists.map(list => list.join())).size).toBe(lists.length)

    subscriber.abort()
    await expect(done).resolves.toBeUndefined()
  })
})
