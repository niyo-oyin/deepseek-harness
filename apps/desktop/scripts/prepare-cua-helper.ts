/**
 * Publish the Windows Computer Use helper into its package before the
 * package set is packed.
 *
 * `@deepseek-ai/dsh-cua-windows` lists `native/bin` in its package files, and
 * the installed provider runs `native/bin/win-<arch>/dsh-cua-windows.exe`
 * from the unpacked ASAR tree. The directory is git-ignored, so a Windows
 * package is complete only when this stage has filled it. It empties
 * `native/bin` first, so files of an older or other-architecture build never
 * reach the package, then restores in locked mode and publishes a
 * self-contained helper for the target architecture.
 */
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The Windows provider package whose `native/bin` the installer carries. */
export const CUA_WINDOWS_PACKAGE_ROOT = resolve(import.meta.dirname, '../../../packages/experimental/cua-windows')

/** One process the stage runs. */
export interface CuaHelperCommand {
  readonly command: string
  readonly args: readonly string[]
}

/**
 * The restore and publish commands for one architecture. They match the
 * `Restore locked Windows helper` and `Publish Windows CUA helper` steps of
 * `.github/workflows/cua-helper-package-windows.yml`, except for the output
 * directory; change both together.
 * @param nativeRoot - The package's `native` directory.
 * @param architecture - Target architecture of the desktop package.
 * @returns The locked restore, then the self-contained publish.
 */
export function cuaHelperCommands(nativeRoot: string, architecture: 'arm64' | 'x64'): readonly CuaHelperCommand[] {
  return [
    { command: 'dotnet', args: ['restore', join(nativeRoot, 'cua-windows.slnx'), '--locked-mode'] },
    {
      command: 'dotnet',
      args: ['publish', join(nativeRoot, 'entry', 'CuaWindows.csproj'), '--configuration', 'Release',
        '--runtime', `win-${architecture}`, '--self-contained', 'true', '--no-restore',
        '--output', join(nativeRoot, 'bin', `win-${architecture}`)],
    },
  ]
}

function runCommand({ command, args }: CuaHelperCommand): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Windows Computer Use helper: ${command} ${args[0] ?? ''} exited with ${String(code ?? signal)}`))
    })
  })
}

/**
 * Empty `native/bin`, then restore and publish the helper for one architecture.
 * @param options - The package root, the target architecture, and the process runner.
 * @returns The published executable.
 */
export async function prepareCuaWindowsHelper(options: {
  readonly packageRoot: string
  readonly architecture: 'arm64' | 'x64'
  readonly run?: (command: CuaHelperCommand) => Promise<void>
}): Promise<string> {
  const nativeRoot = join(options.packageRoot, 'native')
  const bin = join(nativeRoot, 'bin')
  try {
    rmSync(bin, { recursive: true, force: true, maxRetries: 3 })
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown error'
    throw new Error(`Windows Computer Use helper: cannot empty ${bin} (${code}); a running dsh Host may hold the`
      + ' helper open. Stop the Hosts started from this checkout and package again', { cause: error })
  }
  for (const command of cuaHelperCommands(nativeRoot, options.architecture)) await (options.run ?? runCommand)(command)
  const executable = join(bin, `win-${options.architecture}`, 'dsh-cua-windows.exe')
  if (!existsSync(executable)) throw new Error(`Windows Computer Use helper: publish produced no ${executable}`)
  return executable
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const architecture = process.env.DSH_DESKTOP_TARGET_ARCH
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error('Windows Computer Use helper: DSH_DESKTOP_TARGET_ARCH must name arm64 or x64')
  }
  const executable = await prepareCuaWindowsHelper({ packageRoot: CUA_WINDOWS_PACKAGE_ROOT, architecture })
  console.log(`Windows Computer Use helper: published ${executable}`)
}
