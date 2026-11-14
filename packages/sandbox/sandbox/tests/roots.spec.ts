/**
 * Tests for the writable-root derivation: the mode's meaning as a canonical
 * allow-list. Pinned here so the fs fence and the Seatbelt profile — both
 * deriving from `writableRoots` — cannot drift, and so the workspace-plus-
 * additional set stays one shared derivation across backend dialects.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalPath, workspaceWritableRoots, writableRoots } from '@deepseek-ai/dsh-sandbox'

/** Every temp root created by this file, removed after each test. */
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('canonicalPath', () => {
  it('resolves symlinks (an existing path realpaths)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-roots-'))
    roots.push(dir)
    expect(canonicalPath(dir)).toBe(realpathSync.native(dir))
  })

  it('returns the spelling as-is when the path cannot be resolved (conservative — matches nothing until it exists)', () => {
    expect(canonicalPath('/does/not/exist/anywhere-xyz')).toBe('/does/not/exist/anywhere-xyz')
  })
})

describe('workspaceWritableRoots', () => {
  it('workspace-write grants only the workspace when no extra root is configured', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-ws-'))
    roots.push(ws)
    expect(workspaceWritableRoots({ mode: 'workspace-write', workspaceRoot: ws })).toEqual([realpathSync.native(ws)])
  })

  it('workspace-write deduplicates physical extra directories and rejects symlink aliases', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-ws-'))
    const extra = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-extra-')))
    const alias = join(ws, 'alias')
    symlinkSync(extra, alias, 'dir')
    roots.push(ws, extra)
    const grants = workspaceWritableRoots({
      mode: 'workspace-write',
      workspaceRoot: ws,
      additionalWritableRoots: [extra, extra],
    })
    expect(grants).toEqual([realpathSync.native(ws), realpathSync.native(extra)])
    expect(() => workspaceWritableRoots({ mode: 'workspace-write', workspaceRoot: ws, additionalWritableRoots: [alias] }))
      .toThrow('use the physical directory path')
  })

  it.skipIf(process.platform !== 'win32')('accepts Windows casing and separator differences and retains the canonical directory identity', () => {
    const ws = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-roots-')))
    roots.push(ws)
    const extra = join(ws, 'Memory')
    mkdirSync(extra)
    const alias = join(ws, 'memory').replaceAll('\\', '/')
    const physical = realpathSync.native(extra)
    expect(alias).not.toBe(physical)
    const grants = workspaceWritableRoots({
      mode: 'workspace-write', workspaceRoot: ws, additionalWritableRoots: [alias, extra],
    })
    expect(grants).toEqual([ws, physical])
  })

  describe.skipIf(process.platform !== 'win32')('8.3 short-name spellings on Windows', () => {
    /** The volume's 8.3 spelling of an existing path, or undefined where the volume generates none. */
    function shortSpelling(path: string): string | undefined {
      const result = spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${path}") do @echo %~sI`], {
        encoding: 'utf8', windowsVerbatimArguments: true,
      })
      const short = result.stdout.trim()
      return result.status === 0 && short !== '' && short.toLowerCase() !== path.toLowerCase() ? short : undefined
    }
    function directoryWithShortName(ws: string, name: string): { long: string; short: string } | undefined {
      const long = join(ws, name)
      mkdirSync(long)
      const short = shortSpelling(long)
      return short === undefined ? undefined : { long, short }
    }

    it('accepts a short-name spelling of a real directory and stores its long path', (context) => {
      const ws = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-roots-')))
      roots.push(ws)
      const extra = directoryWithShortName(ws, 'Writable Long Directory Name')
      if (extra === undefined) return context.skip('this volume generates no 8.3 names')
      expect(workspaceWritableRoots({ mode: 'workspace-write', workspaceRoot: ws, additionalWritableRoots: [extra.short] }))
        .toEqual([ws, extra.long])
    })

    it.each(['junction', 'dir'] as const)('still rejects a short-name spelling through a %s', (kind, context) => {
      const ws = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-roots-')))
      roots.push(ws)
      const target = join(ws, 'Redirect Target Directory')
      mkdirSync(target)
      const link = join(ws, 'Redirecting Alias Directory')
      symlinkSync(target, link, kind)
      const short = shortSpelling(link)
      if (short === undefined) return context.skip('this volume generates no 8.3 names')
      for (const spelling of [link, short]) {
        expect(() => workspaceWritableRoots({ mode: 'workspace-write', workspaceRoot: ws, additionalWritableRoots: [spelling] }))
          .toThrow('symlinked grants are not supported')
      }
    })

    it('keeps the POSIX comparison: a short-name spelling is rejected where the host is not Windows', (context) => {
      const ws = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-roots-')))
      roots.push(ws)
      const extra = directoryWithShortName(ws, 'Posix Comparison Directory')
      if (extra === undefined) return context.skip('this volume generates no 8.3 names')
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
      Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
      try {
        expect(() => workspaceWritableRoots({ mode: 'workspace-write', workspaceRoot: ws, additionalWritableRoots: [extra.short] }))
          .toThrow('use the physical directory path')
      } finally { Object.defineProperty(process, 'platform', platform) }
    })
  })

  it('rejects invalid extra roots and checks them again on each call', () => {
    const ws = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-roots-')))
    roots.push(ws)
    const file = join(ws, 'file.txt')
    const extra = join(ws, 'extra')
    writeFileSync(file, 'file')
    for (const path of [file, join(file, 'child'), extra]) {
      expect(() => workspaceWritableRoots({ mode: 'workspace-write', workspaceRoot: ws, additionalWritableRoots: [path] }))
        .toThrow('Invalid additional writable directory')
    }
    const policy = { mode: 'workspace-write' as const, workspaceRoot: ws, additionalWritableRoots: [extra] }
    mkdirSync(extra)
    expect(workspaceWritableRoots(policy)).toEqual([ws, extra])
    rmSync(extra, { recursive: true })
    expect(() => workspaceWritableRoots(policy)).toThrow('cannot read the directory')
  })

  it('reports inspection failures that do not establish a missing or non-directory path', () => {
    const inspect = vi.spyOn(realpathSync, 'native').mockImplementationOnce(() => {
      throw Object.assign(new Error('access denied'), { code: 'EACCES' })
    })
    try {
      expect(() => workspaceWritableRoots({ mode: 'workspace-write', workspaceRoot: '/workspace', additionalWritableRoots: ['/private'] }))
        .toThrow('cannot read the directory')
    } finally { inspect.mockRestore() }
  })

  it('read-only grants nothing even when extra roots are carried on the policy', () => {
    expect(workspaceWritableRoots({ mode: 'read-only', workspaceRoot: '/ws', additionalWritableRoots: ['/extra'] })).toEqual([])
    expect(writableRoots({ mode: 'read-only', workspaceRoot: '/ws', additionalWritableRoots: ['/extra'] })).toEqual([])
  })
})

describe('writableRoots', () => {
  it('read-only grants nothing', () => {
    expect(writableRoots({ mode: 'read-only', workspaceRoot: process.cwd() })).toEqual([])
  })

  it('workspace-write grants the workspace root plus the platform temp areas, canonical and deduplicated', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-ws-'))
    roots.push(ws)
    const writable = writableRoots({ mode: 'workspace-write', workspaceRoot: ws })
    expect(writable).toContain(realpathSync.native(ws))
    expect(writable).toContain(canonicalPath('/tmp'))
    expect(writable).toContain(realpathSync.native(tmpdir()))
    // Deduplicated after canonicalization (/tmp and os.tmpdir() may coincide).
    expect(new Set(writable).size).toBe(writable.length)
  })

  it('workspace-write includes an explicit extra directory beside the temp areas', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-ws-'))
    const extra = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-extra-')))
    roots.push(ws, extra)
    expect(writableRoots({
      mode: 'workspace-write',
      workspaceRoot: ws,
      additionalWritableRoots: [extra],
    })).toContain(realpathSync.native(extra))
  })
})
