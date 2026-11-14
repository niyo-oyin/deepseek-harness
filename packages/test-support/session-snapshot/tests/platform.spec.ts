import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scenarioLayoutProblems, writeScenarioFile } from '../src/layout.ts'
import { resolveScenarioFile, scenarioFileNames, snapshotPlatformOf, snapshotSkipReason } from '../src/platform.ts'

const dirs: string[] = []
function scenario(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-platform-'))
  dirs.push(dir)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('snapshot platforms', () => {
  it('maps Windows to its own family and every other host to posix', () => {
    expect(snapshotPlatformOf('win32')).toBe('windows')
    expect(snapshotPlatformOf('linux')).toBe('posix')
    expect(snapshotPlatformOf('darwin')).toBe('posix')
  })

  it('names why a scenario does not run on a host', () => {
    const windows = { platform: 'windows', capabilities: new Set<'pwsh'>() } as const
    expect(snapshotSkipReason({ platforms: ['posix'] }, windows)).toBe('runs on posix only')
    expect(snapshotSkipReason({ requires: ['pwsh'] }, windows)).toBe('requires pwsh')
    expect(snapshotSkipReason({ requires: ['pwsh'] }, { ...windows, capabilities: new Set(['pwsh'] as const) })).toBeUndefined()
    expect(snapshotSkipReason({}, windows)).toBeUndefined()
  })

  it('reads a split file from the platform side and a shared file from the root', () => {
    const dir = scenario({ 'shared.md': 'both', 'posix/prompt.md': 'bash', 'windows/prompt.md': 'pwsh' })
    expect(readFileSync(resolveScenarioFile(dir, 'prompt.md', 'windows'), 'utf8')).toBe('pwsh')
    expect(readFileSync(resolveScenarioFile(dir, 'prompt.md', 'posix'), 'utf8')).toBe('bash')
    expect(readFileSync(resolveScenarioFile(dir, 'shared.md', 'windows'), 'utf8')).toBe('both')
    expect(scenarioFileNames(dir, 'windows')).toEqual(['prompt.md', 'shared.md'])
  })

  it('leaves a shared file alone when a platform writes the same bytes', () => {
    const dir = scenario({ 'session.jsonl': 'same' })
    writeScenarioFile(dir, 'session.jsonl', 'same', 'windows')
    expect(existsSync(join(dir, 'windows'))).toBe(false)
    expect(readFileSync(join(dir, 'session.jsonl'), 'utf8')).toBe('same')
  })

  it('splits a shared file on a differing write without changing the other platform bytes', () => {
    const dir = scenario({ 'session.jsonl': 'recorded on posix' })
    writeScenarioFile(dir, 'session.jsonl', 'windows output', 'windows')
    expect(existsSync(join(dir, 'session.jsonl'))).toBe(false)
    expect(readFileSync(join(dir, 'posix', 'session.jsonl'), 'utf8')).toBe('recorded on posix')
    expect(readFileSync(join(dir, 'windows', 'session.jsonl'), 'utf8')).toBe('windows output')
    expect(scenarioLayoutProblems(dir)).toEqual([])
  })

  it('writes only the running side of a split and merges sides that become identical', () => {
    const dir = scenario({ 'posix/out.json': 'a', 'windows/out.json': 'b' })
    writeScenarioFile(dir, 'out.json', 'c', 'windows')
    expect(readFileSync(join(dir, 'posix', 'out.json'), 'utf8')).toBe('a')
    expect(readFileSync(join(dir, 'windows', 'out.json'), 'utf8')).toBe('c')
    writeScenarioFile(dir, 'out.json', 'a', 'windows')
    expect(readFileSync(join(dir, 'out.json'), 'utf8')).toBe('a')
    expect(existsSync(join(dir, 'posix'))).toBe(false)
    expect(existsSync(join(dir, 'windows'))).toBe(false)
  })

  it('keeps a single-platform scenario shared and refuses a platform it does not run on', () => {
    const dir = scenario({ 'snapshot.yml': 'version: 1\nprofile: headless\nplatforms: [windows]\n', 'session.jsonl': 'old' })
    writeScenarioFile(dir, 'session.jsonl', 'refreshed', 'windows')
    expect(readFileSync(join(dir, 'session.jsonl'), 'utf8')).toBe('refreshed')
    expect(existsSync(join(dir, 'posix'))).toBe(false)
    expect(existsSync(join(dir, 'windows'))).toBe(false)
    expect(() => { writeScenarioFile(dir, 'session.jsonl', 'posix output', 'posix') }).toThrow('does not run on posix')
    expect(scenarioLayoutProblems(scenario({ 'snapshot.yml': 'version: 1\nprofile: headless\nplatforms: [posix]\n', 'posix/a.md': 'x', 'windows/a.md': 'y' })))
      .toEqual(['a.md: split, but the scenario runs on posix only'])
  })

  it('reports half splits, a lingering shared copy, and identical sides', () => {
    expect(scenarioLayoutProblems(scenario({ 'windows/a.md': 'x' }))).toEqual(['a.md: split without a posix copy'])
    expect(scenarioLayoutProblems(scenario({ 'a.md': 'x', 'posix/a.md': 'y', 'windows/a.md': 'z' })))
      .toEqual(['a.md: split but still shared at the scenario root'])
    expect(scenarioLayoutProblems(scenario({ 'posix/a.md': 'x', 'windows/a.md': 'x' })))
      .toEqual(['a.md: identical on every platform, so it must be shared'])
  })
})
