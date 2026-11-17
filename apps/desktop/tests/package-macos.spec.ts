/** Exercise DMG promotion and artifact isolation without Apple credentials or network. */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  packageMacOSDiskImage,
  type DesktopPrepackagedArtifact,
  type MacOSDiskImageOperations,
} from '../scripts/package-macos.ts'
import { desktopElectronBuilderArguments, resolveDesktopPackageTarget } from '../scripts/package-target.ts'

const environment = {
  DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
  DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
}

async function fixture(arch: 'arm64' | 'x64' = 'arm64') {
  const root = await mkdtemp(join(tmpdir(), 'desktop-disk-image-'))
  const artifactsRoot = join(root, 'artifacts')
  const appPath = join(artifactsRoot, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Not DSH.app')
  await mkdir(appPath, { recursive: true })
  await writeFile(join(appPath, 'payload'), 'signed content')
  const version = '1.2.3-alpha.1'
  const dmg = `ndsh-${version}-mac-${arch}.dmg`
  const request = { arch, artifactsRoot, version, environment }
  const apple: MacOSDiskImageOperations = { verifySignature: vi.fn() }
  const build = async (artifact: DesktopPrepackagedArtifact) => {
    await mkdir(artifact.output, { recursive: true })
    await writeFile(join(artifact.output, dmg), await readFile(join(artifact.appPath, 'payload'), 'utf8'))
  }
  return { root, appPath, request, apple, build, dmg }
}

describe('macOS disk image', () => {
  it.each(['arm64', 'x64'] as const)('builds the %s DMG from the signed App in a private directory and promotes it', async (arch) => {
    const f = await fixture(arch)
    try {
      const outputs: string[] = []
      await packageMacOSDiskImage(f.request, async (artifact) => {
        expect(artifact.appPath).toBe(f.appPath)
        expect(dirname(artifact.output)).toBe(f.root)
        outputs.push(artifact.output)
        await f.build(artifact)
      }, f.apple)
      expect(outputs).toHaveLength(1)
      expect(await readFile(join(f.request.artifactsRoot, f.dmg), 'utf8')).toBe('signed content')
      expect(await readFile(join(f.appPath, 'payload'), 'utf8')).toBe('signed content')
      expect((await readdir(f.root)).sort()).toEqual(['artifacts'])
      expect(f.apple.verifySignature).toHaveBeenCalledTimes(2)
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it.each(['build', 'signature', 'post-signature', 'empty'] as const)('rejects incomplete %s qualification without promoting the DMG', async (failure) => {
    const f = await fixture()
    try {
      let signatureChecks = 0
      const apple: MacOSDiskImageOperations = {
        verifySignature: () => {
          signatureChecks += 1
          if ((failure === 'signature' && signatureChecks === 1) || (failure === 'post-signature' && signatureChecks === 2)) {
            throw new Error('signature failed')
          }
        },
      }
      await expect(packageMacOSDiskImage(f.request, async (artifact) => {
        if (failure === 'build') throw new Error('DMG rejected')
        await f.build(artifact)
        if (failure === 'empty') await writeFile(join(artifact.output, f.dmg), '')
      }, apple)).rejects.toThrow()
      expect(await readdir(f.root)).toEqual(['artifacts'])
      expect(await readdir(f.request.artifactsRoot)).toEqual(['mac-arm64'])
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it('passes the actual App and isolated output directory to the DMG builder', () => {
    const target = resolveDesktopPackageTarget('mac-arm64', 'darwin', 'arm64')
    const appPath = join('private build', 'Not DSH.app')
    const output = join(dirname(appPath), 'artifacts')
    expect(desktopElectronBuilderArguments(target, false, { appPath, output })).toEqual([
      'exec', 'electron-builder', '--config', 'electron-builder.config.mjs',
      '--mac', 'dmg', '--arm64', '--publish', 'never',
      '--config.mac.notarize=false',
      '--prepackaged', appPath, '--config.directories.output', output,
    ])
  })
})
