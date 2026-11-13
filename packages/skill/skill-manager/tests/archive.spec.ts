/** ZIP export and import of skill bundles over a real registry and filesystem provider in throwaway home folders. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import SkillManager, { type SkillExportResult } from '../src/index.ts'

const never = new AbortController().signal
/** The catalog follows a write through a filesystem watcher, which a loaded machine delays. */
const SETTLED = { timeout: 10_000 }

function skillFile(name: string, description = `${name} description`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${name} instructions.\n`
}

/** A ZIP of text files as bytes. */
function zipOf(files: Record<string, string>, level?: 0): Uint8Array {
  const entries = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)]))
  return zipSync(entries, level === undefined ? {} : { level })
}

/** A ZIP of text files as the base64 an import request carries. */
function archiveOf(files: Record<string, string>): string {
  return Buffer.from(zipOf(files)).toString('base64')
}

/** The text files of an exported archive by their path. */
function filesOf(result: SkillExportResult): Record<string, string> {
  if (!result.ok) throw new Error(`not exported: ${result.refused}`)
  return Object.fromEntries(Object.entries(unzipSync(Buffer.from(result.archive.data, 'base64'))).map(([path, data]) => [path, strFromU8(data)]))
}

/**
 * A manager over two user skill folders and one folder of built-in skills.
 * @param linked - whether the Harness home is reached through a link, as a home on another drive is.
 */
async function bench(linked = false) {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'skill-archive-')))
  /** Where the Harness home's files are; the tests read and write here. */
  const store = join(base, 'dsh')
  /** The Harness home as the manager and the provider are configured with it. */
  const dshHome = linked ? join(base, 'link') : store
  const agentsHome = join(base, 'agents')
  const builtIn = join(base, 'built-in')
  if (linked) {
    mkdirSync(store)
    // A junction needs no privilege on Windows; elsewhere the type is ignored and a symbolic link is made.
    symlinkSync(store, dshHome, 'junction')
  }
  const write = (path: string, text: string): string => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
    return path
  }
  write(join(store, 'skills', 'review', 'SKILL.md'), skillFile('review'))
  write(join(store, 'skills', 'review', 'scripts', 'check.py'), 'print("check")\n')
  write(join(agentsHome, 'skills', 'notes.md'), skillFile('notes'))
  write(join(builtIn, 'deploy', 'SKILL.md'), skillFile('deploy'))

  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFilesystem, { dshHome, agentsHome, customSkillDirs: [builtIn] })
  await ctx.plugin(SkillManager, { dshHome, agentsHome })
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    // Windows releases a closed watcher's handles a moment after the close returns.
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })
  const skills = join(store, 'skills')
  const names = async (): Promise<string[]> => (await ctx.skillManager.list()).map(skill => skill.name)
  return { manager: ctx.skillManager, base, dshHome, builtIn, skills, write, names }
}

describe('SkillManager archives', () => {
  it('exports a skill\'s whole folder under its name, and a flat skill as its SKILL.md', async () => {
    const { manager } = await bench()
    const review = await manager.exportArchive('review', never)
    expect(review).toMatchObject({ ok: true, archive: { fileName: 'review.zip' } })
    expect(filesOf(review)).toEqual({
      'review/SKILL.md': skillFile('review'),
      'review/scripts/check.py': 'print("check")\n',
    })
    expect(filesOf(await manager.exportArchive('notes', never))).toEqual({ 'notes/SKILL.md': skillFile('notes') })
    // A built-in skill is a folder too; an unknown name has nothing to export.
    expect(Object.keys(filesOf(await manager.exportArchive('deploy', never)))).toEqual(['deploy/SKILL.md'])
    expect(await manager.exportArchive('missing', never)).toEqual({ ok: false, refused: 'not-exportable' })
  })

  it('exports only the file of a skill written as SKILL.md directly in a folder of skills', async () => {
    const { manager, builtIn, write } = await bench()
    write(join(builtIn, 'SKILL.md'), skillFile('loose'))
    await vi.waitFor(async () => { expect(await manager.read('loose', never)).not.toBeNull() }, SETTLED)
    // Its folder is the whole skill root, which holds `deploy` as well.
    expect(filesOf(await manager.exportArchive('loose', never))).toEqual({ 'loose/SKILL.md': skillFile('loose') })
  })

  it('imports each skill of an archive with its resources, named by its frontmatter', async () => {
    const { manager, skills, names } = await bench()
    const result = await manager.importArchive({
      replace: false,
      data: archiveOf({
        // The archive folder's name is not the skill's.
        'downloads/Triage Skill/SKILL.md': skillFile('triage'),
        'downloads/Triage Skill/references/labels.md': 'bug, feature\n',
        'downloads/Triage Skill/nested/SKILL.md': 'A resource that happens to be named like a skill.\n',
        'downloads/release-notes/SKILL.md': skillFile('release-notes'),
        'downloads/readme.txt': 'Not part of any skill.\n',
        '__MACOSX/downloads/release-notes/._SKILL.md': 'resource fork',
      }),
    }, never)
    expect(result).toEqual({ ok: true, skills: [{ name: 'triage', outcome: 'imported' }, { name: 'release-notes', outcome: 'imported' }] })
    expect(readFileSync(join(skills, 'triage', 'SKILL.md'), 'utf8')).toBe(skillFile('triage'))
    expect(readFileSync(join(skills, 'triage', 'references', 'labels.md'), 'utf8')).toBe('bug, feature\n')
    expect(existsSync(join(skills, 'triage', 'nested', 'SKILL.md'))).toBe(true)
    expect(readdirSync(join(skills, 'release-notes'))).toEqual(['SKILL.md'])
    // Nothing of the staging is left beside the skill folder.
    expect(readdirSync(join(skills, '..'))).toEqual(['skills'])
    await vi.waitFor(async () => { expect(await names()).toEqual(expect.arrayContaining(['release-notes', 'triage'])) }, SETTLED)
  })

  it('imports an archive whose SKILL.md sits at its top', async () => {
    const { manager, skills } = await bench()
    const data = archiveOf({ 'SKILL.md': skillFile('triage'), 'assets/template.md': 'Template\n' })
    expect(await manager.importArchive({ data, replace: false }, never)).toEqual({ ok: true, skills: [{ name: 'triage', outcome: 'imported' }] })
    expect(readFileSync(join(skills, 'triage', 'assets', 'template.md'), 'utf8')).toBe('Template\n')
  })

  it('keeps a skill of the same name until the import is repeated with replace, then swaps the whole folder', async () => {
    const { manager, skills } = await bench()
    const data = archiveOf({ 'review/SKILL.md': skillFile('review', 'Review, second edition'), 'review/guide.md': 'Guide\n' })
    expect(await manager.importArchive({ data, replace: false }, never)).toEqual({ ok: true, skills: [{ name: 'review', outcome: 'exists' }] })
    expect(readFileSync(join(skills, 'review', 'SKILL.md'), 'utf8')).toBe(skillFile('review'))

    expect(await manager.importArchive({ data, replace: true }, never)).toEqual({ ok: true, skills: [{ name: 'review', outcome: 'replaced' }] })
    expect(readFileSync(join(skills, 'review', 'SKILL.md'), 'utf8')).toBe(skillFile('review', 'Review, second edition'))
    // The old bundle's files do not survive beside the new ones, and nothing of the swap is left behind.
    expect(readdirSync(join(skills, 'review')).sort()).toEqual(['SKILL.md', 'guide.md'])
    expect(readdirSync(join(skills, '..'))).toEqual(['skills'])
  })

  it('replaces the skill that carries the name, wherever its folder is, and never a folder that belongs to another skill', async () => {
    const { manager, skills, write } = await bench()
    // Discovery names a skill by its frontmatter: this folder is called `audit` and holds the skill `checks`.
    write(join(skills, 'audit', 'SKILL.md'), skillFile('checks'))
    await vi.waitFor(async () => { expect(await manager.read('checks', never)).not.toBeNull() }, SETTLED)

    const audit = archiveOf({ 'SKILL.md': skillFile('audit') })
    expect(await manager.importArchive({ data: audit, replace: true }, never)).toEqual({ ok: true, skills: [{ name: 'audit', outcome: 'name-taken' }] })
    expect(readFileSync(join(skills, 'audit', 'SKILL.md'), 'utf8')).toBe(skillFile('checks'))

    const checks = archiveOf({ 'SKILL.md': skillFile('checks', 'Checks, second edition') })
    expect(await manager.importArchive({ data: checks, replace: true }, never)).toEqual({ ok: true, skills: [{ name: 'checks', outcome: 'replaced' }] })
    expect(readFileSync(join(skills, 'checks', 'SKILL.md'), 'utf8')).toBe(skillFile('checks', 'Checks, second edition'))
    expect(existsSync(join(skills, 'audit'))).toBe(false)
  })

  it('does not write a skill whose name another source supplies, or whose SKILL.md names no skill it can store', async () => {
    const { manager, skills } = await bench()
    const result = await manager.importArchive({
      replace: true,
      data: archiveOf({
        'a/SKILL.md': skillFile('deploy'),
        'b/SKILL.md': skillFile('notes'),
        'c/SKILL.md': '# No frontmatter\n',
        'd/SKILL.md': skillFile('Not Kebab'),
        // A name Windows reads as a device.
        'e/SKILL.md': skillFile('nul'),
      }),
    }, never)
    expect(result).toEqual({
      ok: true,
      skills: [
        { name: 'deploy', outcome: 'name-taken' }, { name: 'notes', outcome: 'name-taken' },
        { name: 'c', outcome: 'invalid' }, { name: 'd', outcome: 'invalid' }, { name: 'e', outcome: 'invalid' },
      ],
    })
    expect(readdirSync(skills)).toEqual(['review'])
    expect(await manager.create({ name: 'nul', description: 'A device name', whenToUse: '', content: '' }, never))
      .toEqual({ ok: false, refused: 'invalid-name' })
  })

  it('writes one skill when the same archive is imported twice at once', async () => {
    const { manager, skills } = await bench()
    const data = archiveOf({ 'triage/SKILL.md': skillFile('triage'), 'triage/guide.md': 'Guide\n' })
    const results = await Promise.all([
      manager.importArchive({ data, replace: false }, never), manager.importArchive({ data, replace: false }, never),
    ])
    const outcomes = results.map(result => result.ok ? result.skills[0]?.outcome : result.refused)
    expect(outcomes[0]).toBe('imported')
    expect(outcomes[1]).not.toBe('imported')
    expect(readdirSync(join(skills, 'triage')).sort()).toEqual(['SKILL.md', 'guide.md'])
  })

  it('refuses an archive as a whole when it is not a ZIP, holds no skill, or carries a path it cannot store as written', async () => {
    const { manager, base, skills } = await bench()
    const refusal = async (data: string): Promise<unknown> => await manager.importArchive({ data, replace: true }, never)
    const withSkill = (files: Record<string, string>): string => archiveOf({ 'triage/SKILL.md': skillFile('triage'), ...files })
    expect(await refusal(Buffer.from('not a zip archive').toString('base64'))).toEqual({ ok: false, refused: 'not-zip' })
    expect(await refusal(archiveOf({ 'notes/readme.md': 'No skill here.\n' }))).toEqual({ ok: false, refused: 'no-skill' })
    for (const files of [
      { 'triage/../../escaped.md': 'out\n' },
      { 'C:\\escaped.md': 'out\n' },
      // One name as a file and as a folder, two names one file on Windows and macOS, a device, a name Windows trims.
      { 'triage/data': 'file\n', 'triage/data/item.md': 'inside\n' },
      { 'triage/Guide.md': 'one\n', 'triage/guide.md': 'two\n' },
      { 'triage/nul.txt': 'lost\n' },
      { 'triage/notes.': 'trimmed\n' },
    ]) {
      expect(await refusal(withSkill(files))).toEqual({ ok: false, refused: 'unsafe-path' })
    }
    // More files than any skill bundle holds.
    const crowded = Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`triage/file-${index}.txt`, '']))
    expect(await refusal(withSkill(crowded))).toEqual({ ok: false, refused: 'too-large' })
    expect(readdirSync(skills)).toEqual(['review'])
    expect(existsSync(join(base, 'escaped.md'))).toBe(false)
  })

  it('refuses an archive whose entries declare another size than they unpack to', async () => {
    const { manager, skills } = await bench()
    const archive = zipOf({ 'triage/SKILL.md': skillFile('triage') }, 0)
    // The central directory's record of the entry: signature, then the uncompressed size 24 bytes in.
    const record = Buffer.from(archive).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    new DataView(archive.buffer, archive.byteOffset).setUint32(record + 24, 0, true)
    expect(await manager.importArchive({ data: Buffer.from(archive).toString('base64'), replace: false }, never))
      .toEqual({ ok: false, refused: 'not-zip' })
    expect(readdirSync(skills)).toEqual(['review'])
  })

  it('restores a removed skill from its own export', async () => {
    const { manager, skills } = await bench()
    const exported = await manager.exportArchive('review', never)
    if (!exported.ok) throw new Error('review was not exported')
    expect(await manager.delete('review', never)).toEqual({ ok: true })
    await vi.waitFor(async () => { expect(await manager.read('review', never)).toBeNull() }, SETTLED)

    expect(await manager.importArchive({ data: exported.archive.data, replace: false }, never))
      .toEqual({ ok: true, skills: [{ name: 'review', outcome: 'imported' }] })
    expect(readFileSync(join(skills, 'review', 'scripts', 'check.py'), 'utf8')).toBe('print("check")\n')
  })

  it('edits, replaces, and removes skills of a home reached through a link', async () => {
    const { manager, skills } = await bench(true)
    expect(await manager.list()).toContainEqual(expect.objectContaining({ name: 'review', editable: true }))
    const edit = { name: 'review', description: 'Edited through the link', whenToUse: '', content: 'Steps.' }
    expect(await manager.update(edit, never)).toEqual({ ok: true })
    expect(readFileSync(join(skills, 'review', 'SKILL.md'), 'utf8')).toContain('Edited through the link')

    const data = archiveOf({ 'review/SKILL.md': skillFile('review', 'Review, second edition') })
    expect(await manager.importArchive({ data, replace: true }, never)).toEqual({ ok: true, skills: [{ name: 'review', outcome: 'replaced' }] })
    expect(readdirSync(join(skills, 'review'))).toEqual(['SKILL.md'])
    expect(await manager.delete('review', never)).toEqual({ ok: true })
    expect(existsSync(join(skills, 'review'))).toBe(false)
  })
})
