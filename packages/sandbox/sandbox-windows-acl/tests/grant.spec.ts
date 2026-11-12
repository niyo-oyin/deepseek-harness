/**
 * AclWriteGrant tests: the server-side grant materialization — SID parsing
 * fail-closed, ACE add/dispose round-trip against the REAL directory DACL
 * (observed through icacls, the operator's own tool), the recorded path
 * order, and the standing/revocable lifecycle split (workspace ACEs outlive
 * dispose as the reuse cache; temp ACEs revoke), and releaseStandingGrant
 * returning a granted tree to its earlier state. Win32-only, like the other
 * real-FFI suites.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { AclWriteGrant, releaseStandingGrant } from '../src/index.ts'

const isWin32 = process.platform === 'win32'

/** The directory DACL as icacls renders it (the operator-visible form). */
function icaclsText(path: string): string {
  const result = spawnSync('icacls', [path], { encoding: 'utf8' })
  expect(result.status, `icacls failed: ${result.stderr}`).toBe(0)
  return result.stdout
}

describe.skipIf(!isWin32)('AclWriteGrant (server-side materialization)', () => {
  const scratchDirs: string[] = []
  afterEach(() => {
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-acl-grant-'))
    scratchDirs.push(dir)
    return dir
  }

  it('create parses the SID fail-closed: a malformed SID throws before anything is granted', () => {
    expect(() => AclWriteGrant.create('S-1-4-abc-1')).toThrow(/ConvertStringSidToSidW/u)
  })

  it('add materializes the ACE (idempotently) and reports grant order; dispose revokes revocable paths and keeps standing paths standing', () => {
    const dir = scratch()
    const standingDir = scratch()
    const grant = AclWriteGrant.create('S-1-4-9000-77')
    grant.add(dir) // revocable: the session-temp lifecycle
    grant.add(standingDir, true) // standing: the workspace reuse cache
    expect(grant.paths).toEqual([standingDir, dir])
    expect(icaclsText(dir)).toContain('S-1-4-9000-77')
    expect(icaclsText(standingDir)).toContain('S-1-4-9000-77')
    // A second add over the standing exact ACE is a DACL-read no-op: the
    // grant stays exactly one ACE (the reuse across sessions/restarts).
    grant.add(dir)
    grant.add(standingDir, true)
    expect(icaclsText(dir)).toContain('S-1-4-9000-77')
    expect(icaclsText(standingDir)).toContain('S-1-4-9000-77')
    grant.dispose()
    expect(icaclsText(dir)).not.toContain('S-1-4-9000-77')
    expect(icaclsText(standingDir)).toContain('S-1-4-9000-77')
  })

  it('two grants with different SIDs coexist and revoke independently', () => {
    const dir = scratch()
    const grantA = AclWriteGrant.create('S-1-4-9000-78')
    const grantB = AclWriteGrant.create('S-1-4-9000-79')
    grantA.add(dir)
    grantB.add(dir)
    expect(icaclsText(dir)).toContain('S-1-4-9000-78')
    expect(icaclsText(dir)).toContain('S-1-4-9000-79')
    grantA.dispose()
    expect(icaclsText(dir)).not.toContain('S-1-4-9000-78')
    expect(icaclsText(dir)).toContain('S-1-4-9000-79')
    grantB.dispose()
    expect(icaclsText(dir)).not.toContain('S-1-4-9000-79')
  })
})

describe.skipIf(!isWin32)('releaseStandingGrant (undoing a workspace grant)', () => {
  const scratchDirs: string[] = []
  const grants: AclWriteGrant[] = []
  afterEach(() => {
    for (const grant of grants.splice(0)) grant.dispose()
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A directory tree `root/sub/file.txt`, the shape a grant propagates through. */
  function tree(): { root: string; sub: string; file: string } {
    const root = mkdtempSync(join(tmpdir(), 'dsh-acl-release-'))
    scratchDirs.push(root)
    const sub = join(root, 'sub')
    mkdirSync(sub)
    const file = join(sub, 'file.txt')
    writeFileSync(file, 'x')
    return { root, sub, file }
  }

  function standing(sid: string, path: string): void {
    const grant = AclWriteGrant.create(sid)
    grants.push(grant)
    grant.add(path, true)
  }

  /** Every entry icacls shows for the paths, with each path removed from its own listing so trees compare. */
  function entries(...paths: string[]): string[] {
    return paths.map(path => icaclsText(path).replaceAll(path, '<path>'))
  }

  it('returns the whole tree to its state before the grant, keeping entries the owner added', () => {
    const { root, sub, file } = tree()
    // An explicit entry naming the same Everyone SID as the deny this package adds.
    expect(spawnSync('icacls', [root, '/grant', '*S-1-1-0:(OI)(CI)(RX)']).status).toBe(0)
    const before = entries(root, sub, file)

    standing('S-1-4-9100-1', root)
    const granted = icaclsText(root)
    expect(granted).toContain('S-1-4-9100-1')
    expect(granted).toContain('(DENY)')
    expect(granted).toContain('Mandatory Label')
    expect(icaclsText(file)).toContain('S-1-4-9100-1')

    expect(releaseStandingGrant(root)).toBe(true)
    expect(entries(root, sub, file)).toEqual(before)
    // Nothing is left to undo, and a directory that carries no grant is not touched.
    expect(releaseStandingGrant(root)).toBe(false)
    expect(entries(root, sub, file)).toEqual(before)
  })

  it('removes the grant of a SID derived from an earlier path together with the current one', () => {
    const { root, sub, file } = tree()
    const before = entries(root, sub, file)
    standing('S-1-4-9100-2', root)
    standing('S-1-4-9100-3', root) // what a rename leaves: the SID of the old path still names the directory
    expect(releaseStandingGrant(root)).toBe(true)
    expect(entries(root, sub, file)).toEqual(before)
  })

  it('keeps a nested directory writable for the enclosing grant, which later takes its label with it', () => {
    const { root, sub, file } = tree()
    const before = entries(root, sub, file)
    standing('S-1-4-9100-4', root)
    standing('S-1-4-9100-5', sub)

    expect(releaseStandingGrant(sub)).toBe(true)
    const nested = icaclsText(sub)
    expect(nested).not.toContain('S-1-4-9100-5')
    // The enclosing grant still reaches the directory, and its confined processes still find the Low label there.
    expect(nested).toContain('S-1-4-9100-4')
    expect(nested).toContain('Mandatory Label')

    expect(releaseStandingGrant(root)).toBe(true)
    expect(entries(root, sub, file)).toEqual(before)
  })

  it('names the failing call for a directory that does not exist', () => {
    expect(() => releaseStandingGrant(join(tmpdir(), 'dsh-acl-release-missing-directory'))).toThrow(/GetNamedSecurityInfoW/u)
  })
})
