/** Packaging the Windows Computer Use helper: the publish stage, the packaged-file check, and the SDK requirement. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { dotnetSdkFailure, probeDesktopToolchain } from '../scripts/desktop-toolchain-preflight.ts'
import { prepareCuaWindowsHelper, type CuaHelperCommand } from '../scripts/prepare-cua-helper.ts'
import { cuaHelperFileProblems } from '../scripts/smoke-cua-helper.ts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-cua-helper-'))
  directories.push(directory)
  return directory
}

async function put(root: string, file: string, content = 'x'): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true })
  await writeFile(join(root, file), content)
}

describe('helper publish stage', () => {
  it('empties native/bin, restores locked, and publishes self-contained for the target architecture', async () => {
    const root = await scratch()
    await put(root, 'native/bin/win-x64/stale.dll')
    await put(root, 'native/bin/local/dsh-cua-windows.exe')
    const ran: CuaHelperCommand[] = []
    const executable = await prepareCuaWindowsHelper({
      packageRoot: root,
      architecture: 'arm64',
      run: async (command) => {
        ran.push(command)
        if (command.args[0] === 'publish') await put(root, 'native/bin/win-arm64/dsh-cua-windows.exe')
      },
    })
    expect(executable).toBe(join(root, 'native/bin/win-arm64/dsh-cua-windows.exe'))
    expect(existsSync(join(root, 'native/bin/win-x64'))).toBe(false)
    expect(existsSync(join(root, 'native/bin/local'))).toBe(false)
    expect(ran.map(command => [command.command, ...command.args])).toEqual([
      ['dotnet', 'restore', join(root, 'native/cua-windows.slnx'), '--locked-mode'],
      ['dotnet', 'publish', join(root, 'native/entry/CuaWindows.csproj'), '--configuration', 'Release', '--runtime', 'win-arm64',
        '--self-contained', 'true', '--no-restore', '--output', join(root, 'native/bin/win-arm64')],
    ])
  })

  it('fails when the publish leaves no executable', async () => {
    const root = await scratch()
    await expect(prepareCuaWindowsHelper({ packageRoot: root, architecture: 'x64', run: async () => {} }))
      .rejects.toThrow('publish produced no')
  })
})

describe('packaged helper files', () => {
  it('accepts a packaged copy of every published file and names each missing or resized one', async () => {
    const root = await scratch()
    const published = join(root, 'published')
    const packaged = join(root, 'packaged')
    for (const file of ['dsh-cua-windows.exe', 'dsh-cua-windows.runtimeconfig.json', 'ja/System.CommandLine.resources.dll']) {
      await put(published, file, 'published')
      await put(packaged, file, 'published')
    }
    expect(await cuaHelperFileProblems(published, packaged)).toEqual([])

    await rm(join(packaged, 'dsh-cua-windows.runtimeconfig.json'))
    await put(packaged, 'dsh-cua-windows.exe', 'other size')
    expect(await cuaHelperFileProblems(published, packaged)).toEqual([
      'dsh-cua-windows.exe is 10 bytes, published 9',
      'missing unpacked dsh-cua-windows.runtimeconfig.json',
    ])
  })

  it('refuses an empty publish output', async () => {
    const root = await scratch()
    await mkdir(join(root, 'published'))
    expect(await cuaHelperFileProblems(join(root, 'published'), join(root, 'packaged'))).toEqual([
      `the publish output ${join(root, 'published')} is empty`,
    ])
  })
})

describe('.NET SDK requirement', () => {
  it('accepts a host with a .NET 10 or later SDK and names what to install otherwise', () => {
    expect(dotnetSdkFailure('9.0.321 [C:\\Program Files\\dotnet\\sdk]\r\n10.0.404 [C:\\Program Files\\dotnet\\sdk]\r\n')).toBeUndefined()
    expect(dotnetSdkFailure('11.0.100 [/usr/share/dotnet/sdk]\n')).toBeUndefined()
    expect(dotnetSdkFailure('8.0.428 [C:\\sdk]\n9.0.321 [C:\\sdk]\n')).toBe('the Windows Computer Use helper needs the .NET 10 SDK'
      + ' (installed: 8.0.428, 9.0.321); install it from https://dotnet.microsoft.com/download/dotnet/10.0')
    expect(dotnetSdkFailure('')).toContain('(installed: none)')
  })

  it('reports dotnet for a Windows target when it is not on PATH', async () => {
    const empty = await scratch()
    // Windows matches environment names case-insensitively, so this also covers Path.
    vi.stubEnv('PATH', empty)
    onTestFinished(() => { vi.unstubAllEnvs() })
    const failures = await probeDesktopToolchain('win32', {})
    expect(failures.find(failure => failure.tool === 'dotnet')?.detail).toBe('dotnet is not on PATH; the Windows Computer Use'
      + ' helper needs the .NET 10 SDK from https://dotnet.microsoft.com/download/dotnet/10.0')
  })
})
