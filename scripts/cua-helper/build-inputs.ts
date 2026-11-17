/** Content and machine identity of a signed macOS helper build. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { resolveMacOSSigningEnvironment } from '../../apps/desktop/scripts/desktop-release-environment.mjs'

const sourceDirectories = [
  'packages/experimental/cua-macos/native', 'scripts/cua-helper', 'apps/desktop/scripts', 'patches',
]
const sourceFiles = new Set([
  'package.json', 'scripts/package.json', 'apps/package.json', 'apps/desktop/package.json', 'scripts/release/process.ts',
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs', '.pnpmfile.mjs',
])

function isSourceFile(path: string): boolean {
  return sourceFiles.has(path) || path === '.gitattributes' || path.endsWith('/.gitattributes') || /^(?:(?:apps|apps\/desktop|scripts)\/)?tsconfig[^/]*\.json$/u.test(path)
    || path.split('/').includes('node_modules')
    || sourceDirectories.some(directory => path.startsWith(`${directory}/`))
}

function trackedSources(root: string): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\0').filter(isSourceFile).sort()
  for (const required of ['packages/experimental/cua-macos/native/Package.swift', 'scripts/cua-helper/package.ts',
    'package.json', 'pnpm-lock.yaml']) {
    if (!files.includes(required)) throw new Error(`CUA source: missing tracked build input ${required}`)
  }
  return files
}

function manifestConfiguration(bytes: Buffer, root: boolean): Buffer {
  const manifest: unknown = JSON.parse(bytes.toString('utf8'))
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'CUA source: invalid package manifest')
  assert(!root || ('packageManager' in manifest && typeof manifest.packageManager === 'string'),
    'CUA source: package.json must declare packageManager')
  return Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(manifest).filter(([name]) => name !== 'version'))))
}

function sourceFile(root: string, file: string): { bytes: Buffer; executable: boolean } {
  const path = join(root, file)
  const stat = lstatSync(path)
  if (!stat.isFile()) throw new Error(`CUA source: build input must be a regular file: ${file}`)
  return { bytes: readFileSync(path), executable: (stat.mode & 0o111) !== 0 }
}

/**
 * Hash tracked build inputs by path, bytes and executable mode; only package manifest version fields is excluded.
 * Missing tracked files and links fail; build outputs and untracked files never enter the digest.
 * @param root - Clean repository root containing all helper build inputs.
 * @returns SHA-256 of sources, resources, package configuration, patches and locked dependencies.
 */
export function cuaHelperSourceDigest(root: string): string {
  const hash = createHash('sha256')
  for (const file of trackedSources(root)) {
    const { bytes, executable } = sourceFile(root, file)
    const input = file === 'package.json' || file.endsWith('/package.json') ? manifestConfiguration(bytes, file === 'package.json') : bytes
    hash.update(`${file}\0`).update(createHash('sha256').update(input).digest()).update(Buffer.from([Number(executable)]))
  }
  return hash.digest('hex')
}

/**
 * Bind source bytes to the active toolchain, preset and signing certificate container.
 * @param source - Current source digest.
 * @param environment - File-owned signing settings including CSC_LINK and the selected preset.
 * @param run - Synchronous query returning the active compiler, SDK and Python version strings.
 * @returns SHA-256 build key; credential values and certificate bytes are not recorded.
 */
export function cuaHelperBuildKey(source: string, environment: NodeJS.ProcessEnv,
  run: (command: string, args: string[]) => string = (command, args) =>
    execFileSync(command, args, { encoding: 'utf8', timeout: 60_000, stdio: 'pipe' }).trim()): string {
  const signing = resolveMacOSSigningEnvironment(environment)
  const certificate = environment.CSC_LINK
  if (!certificate || !isAbsolute(certificate)) throw new Error('CUA reuse: CSC_LINK must identify the signing certificate file')
  const configuration = {
    source, preset: environment.DSH_PACKAGING_PRESET ?? 'local', ...signing,
    certificate: createHash('sha256').update(readFileSync(certificate)).digest('hex'),
    node: process.version,
    swift: run('/usr/bin/xcrun', ['swift', '--version']),
    clang: run('/usr/bin/xcrun', ['clang', '--version']),
    sdk: run('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-build-version']),
    python: run('/usr/bin/xcrun', ['python3', '--version']),
  }
  return createHash('sha256').update(JSON.stringify(configuration)).digest('hex')
}
