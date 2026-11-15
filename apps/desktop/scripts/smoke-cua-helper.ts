/**
 * Check the Windows Computer Use helper in an assembled application: every
 * file its publish produced sits unpacked beside the exe with the same size,
 * and the exe starts. Started without the provider's arguments, the helper
 * loads its bundled runtime, rejects the launch with `INVALID_ARGUMENT`, and
 * exits; it touches no window and starts no server.
 */
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const HELPER = join('node_modules', '@deepseek-ai', 'dsh-cua-windows', 'native', 'bin')

async function filesUnder(root: string): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    sizes.set(relative(root, path), (await stat(path)).size)
  }
  return sizes
}

/**
 * Compare the publish output with the helper directory the application carries.
 * @param published - The publish output, `native/bin/win-<arch>` of the provider package.
 * @param packaged - The same directory under `resources/app.asar.unpacked/dsh`.
 * @returns One line per missing or resized file, empty when they match.
 */
export async function cuaHelperFileProblems(published: string, packaged: string): Promise<string[]> {
  const expected = await filesUnder(published)
  if (expected.size === 0) return [`the publish output ${published} is empty`]
  const actual = await filesUnder(packaged).catch(() => new Map<string, number>())
  const problems: string[] = []
  for (const [file, size] of expected) {
    const found = actual.get(file)
    if (found === undefined) problems.push(`missing unpacked ${file}`)
    else if (found !== size) problems.push(`${file} is ${String(found)} bytes, published ${String(size)}`)
  }
  return problems
}

/**
 * Check the helper of one assembled Windows application.
 * @param published - The publish output, `native/bin/win-<arch>` of the provider package.
 * @param resources - The application's `resources` directory.
 * @param architecture - Target architecture of the application.
 * @returns Resolves when every file arrived and the exe rejected an unmanaged launch.
 */
export async function smokeCuaWindowsHelper(published: string, resources: string, architecture: 'arm64' | 'x64'): Promise<void> {
  const packaged = join(resources, 'app.asar.unpacked', 'dsh', HELPER, `win-${architecture}`)
  const problems = await cuaHelperFileProblems(published, packaged)
  if (problems.length > 0) {
    throw new Error(`Windows Computer Use helper: the application does not carry the published helper:\n  ${problems.join('\n  ')}`)
  }
  const executable = join(packaged, 'dsh-cua-windows.exe')
  const outcome = await new Promise<{ code: number | null; stderr: string }>((resolvePromise) => {
    execFile(executable, [], { timeout: 30_000, windowsHide: true }, (error, _stdout, stderr) => {
      resolvePromise({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : null, stderr })
    })
  })
  if (outcome.code === 0 || !outcome.stderr.includes('INVALID_ARGUMENT')) {
    throw new Error(`Windows Computer Use helper: ${executable} did not reject an unmanaged launch`
      + ` (exit ${String(outcome.code)}): ${outcome.stderr.trim()}`)
  }
  console.log(`Windows Computer Use helper: ${String((await filesUnder(packaged)).size)} files unpacked; the exe starts`)
}
