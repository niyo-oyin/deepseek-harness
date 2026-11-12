/** ZIP export and import of skill bundles over a real registry and filesystem provider in throwaway home folders. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import SkillManager from '../src/index.ts'

const never = new AbortController().signal

function skillFile(name: string, description = `${name} description`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${name} instructions.\n`
}

/** A ZIP of text files as the base64 an import request carries. */
function archiveOf(files: Record<string, string>): string {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])))).toString('base64')
}

/** The text files of an exported archive by their path. */
function filesOf(archive: { data: string } | null): Record<string, string> {
  if (archive === null) throw new Error('no archive')
  return Object.fromEntries(Object.entries(unzipSync(Buffer.from(archive.data, 'base64'))).map(([path, data]) => [path, strFromU8(data)]))
}

/** A manager over two user skill folders and one folder of built-in skills. */
async function bench() {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'skill-archive-')))
  const dshHome = join(base, 'dsh')
  const agentsHome = join(base, 'agents')
  const builtIn = join(base, 'built-in')
  const write = (path: string, text: string): string => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
    return path
  }
  write(join(dshHome, 'skills', 'review', 'SKILL.md'), skillFile('review'))
  write(join(dshHome, 'skills', 'review', 'scripts', 'check.py'), 'print("check")\n')
  write(join(agentsHome, 'skills', 'notes.md'), skillFile('notes'))
  write(join(builtIn, 'deploy', 'SKILL.md'), skillFile('deploy'))

  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFilesystem, { dshHome, agentsHome, customSkillDirs: [builtIn] })
  await ctx.plugin(SkillManager, { dshHome, agentsHome })
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    rmSync(base, { recursive: true, force: true })
  })
  const skills = join(dshHome, 'skills')
  const names = async (): Promise<string[]> => (await ctx.skillManager.list()).map(skill => skill.name)
  return { manager: ctx.skillManager, base, dshHome, skills, write, names }
}

describe('SkillManager archives', () => {
  it('exports a skill\'s whole folder under its name, and a flat skill as its SKILL.md', async () => {
    const { manager } = await bench()
    const review = await manager.exportArchive('review', never)
    expect(review?.fileName).toBe('review.zip')
    expect(filesOf(review)).toEqual({
      'review/SKILL.md': skillFile('review'),
      'review/scripts/check.py': 'print("check")\n',
    })
    expect(filesOf(await manager.exportArchive('notes', never))).toEqual({ 'notes/SKILL.md': skillFile('notes') })
    // A built-in skill is a folder too; an unknown name has nothing to export.
    expect(Object.keys(filesOf(await manager.exportArchive('deploy', never)))).toEqual(['deploy/SKILL.md'])
    expect(await manager.exportArchive('missing', never)).toBeNull()
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
    await vi.waitFor(async () => { expect(await names()).toEqual(expect.arrayContaining(['release-notes', 'triage'])) })
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
    // The old bundle's files do not survive beside the new ones.
    expect(readdirSync(join(skills, 'review')).sort()).toEqual(['SKILL.md', 'guide.md'])
  })

  it('does not write a skill whose name another source supplies, or whose SKILL.md names no skill', async () => {
    const { manager, skills } = await bench()
    const result = await manager.importArchive({
      replace: true,
      data: archiveOf({
        'a/SKILL.md': skillFile('deploy'),
        'b/SKILL.md': skillFile('notes'),
        'c/SKILL.md': '# No frontmatter\n',
        'd/SKILL.md': skillFile('Not Kebab'),
      }),
    }, never)
    expect(result).toEqual({
      ok: true,
      skills: [
        { name: 'deploy', outcome: 'name-taken' }, { name: 'notes', outcome: 'name-taken' },
        { name: 'c', outcome: 'invalid' }, { name: 'd', outcome: 'invalid' },
      ],
    })
    expect(readdirSync(skills)).toEqual(['review'])
  })

  it('refuses an archive as a whole when it is not a ZIP, holds no skill, or carries a path that leaves its folder', async () => {
    const { manager, base, skills } = await bench()
    const refusal = async (data: string): Promise<unknown> => await manager.importArchive({ data, replace: true }, never)
    expect(await refusal(Buffer.from('not a zip archive').toString('base64'))).toEqual({ ok: false, refused: 'not-zip' })
    expect(await refusal(archiveOf({ 'notes/readme.md': 'No skill here.\n' }))).toEqual({ ok: false, refused: 'no-skill' })
    expect(await refusal(archiveOf({ 'triage/SKILL.md': skillFile('triage'), 'triage/../../escaped.md': 'out\n' })))
      .toEqual({ ok: false, refused: 'unsafe-path' })
    expect(await refusal(archiveOf({ 'triage/SKILL.md': skillFile('triage'), 'C:\\escaped.md': 'out\n' })))
      .toEqual({ ok: false, refused: 'unsafe-path' })
    // More files than any skill bundle holds.
    const crowded = Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`triage/file-${index}.txt`, '']))
    expect(await refusal(archiveOf({ 'triage/SKILL.md': skillFile('triage'), ...crowded }))).toEqual({ ok: false, refused: 'too-large' })
    expect(readdirSync(skills)).toEqual(['review'])
    expect(existsSync(join(base, 'escaped.md'))).toBe(false)
  })

  it('restores a removed skill from its own export', async () => {
    const { manager, skills } = await bench()
    const exported = await manager.exportArchive('review', never)
    expect(await manager.delete('review', never)).toEqual({ ok: true })
    await vi.waitFor(async () => { expect(await manager.read('review', never)).toBeNull() })

    expect(await manager.importArchive({ data: exported!.data, replace: false }, never))
      .toEqual({ ok: true, skills: [{ name: 'review', outcome: 'imported' }] })
    expect(readFileSync(join(skills, 'review', 'scripts', 'check.py'), 'utf8')).toBe('print("check")\n')
  })
})
