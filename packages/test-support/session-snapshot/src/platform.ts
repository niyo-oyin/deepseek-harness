/**
 * Per-platform snapshot expectations.
 *
 * A scenario's files sit in its directory and hold on every platform. Where the composed prompt, tool list, log, or
 * wire output legitimately differs by operating system, the file is split whole: the same filename lives once under
 * `posix/` (Linux and macOS) and once under `windows/`, and the scenario root no longer holds it. A session fixture
 * split this way is that platform's replay input as well as its expectation.
 *
 * Every reader resolves a scenario file through {@link resolveScenarioFile} or lists it through
 * {@link scenarioFileNames}; every writer goes through {@link writeScenarioFile}, which only ever writes the running
 * platform's side. Splitting a shared file moves its unchanged bytes to the other platform's directory: that file is
 * taken to be the other platform's truth at the moment of the split, and stays unverified there until a run on that
 * platform. A split whose two sides become identical is merged back into the shared root.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** Operating-system family whose expectations may differ. */
export type SnapshotPlatform = 'posix' | 'windows'

/** Host capability a scenario may require beyond its platform. */
export type SnapshotCapability = 'pwsh'

/** Every platform directory name, in a stable order. */
export const SNAPSHOT_PLATFORMS: readonly SnapshotPlatform[] = ['posix', 'windows']

/** Every capability a manifest may require. */
export const SNAPSHOT_CAPABILITIES: readonly SnapshotCapability[] = ['pwsh']

/**
 * The platform family of a Node platform id.
 * @param nodePlatform - `process.platform` of the host.
 * @returns `windows` for win32, otherwise `posix`.
 */
export function snapshotPlatformOf(nodePlatform: NodeJS.Platform = process.platform): SnapshotPlatform {
  return nodePlatform === 'win32' ? 'windows' : 'posix'
}

/** Host facts that decide whether a scenario runs. */
export interface SnapshotHost {
  readonly platform: SnapshotPlatform
  readonly capabilities: ReadonlySet<SnapshotCapability>
}

/**
 * Why a scenario does not run on this host, for the skipped test's name.
 * @param manifest - the scenario's declared platforms and requirements.
 * @param manifest.platforms - platforms the scenario runs on; absent means every platform.
 * @param manifest.requires - capabilities the host must provide.
 * @param host - the running host.
 * @returns the reason, or undefined when the scenario runs.
 */
export function snapshotSkipReason(
  manifest: { readonly platforms?: readonly SnapshotPlatform[]; readonly requires?: readonly SnapshotCapability[] },
  host: SnapshotHost,
): string | undefined {
  if (manifest.platforms !== undefined && !manifest.platforms.includes(host.platform)) {
    return `runs on ${manifest.platforms.join(', ')} only`
  }
  const missing = (manifest.requires ?? []).filter(capability => !host.capabilities.has(capability))
  return missing.length === 0 ? undefined : `requires ${missing.join(', ')}`
}

function filesIn(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter(name => statSync(join(dir, name)).isFile()) : []
}

/**
 * Resolve one scenario file for a platform: its platform copy when the file is split, otherwise the shared copy.
 * @param dir - the scenario directory.
 * @param name - the file's name within the scenario.
 * @param platform - the platform whose expectation is wanted.
 * @returns the path to read; it may not exist when the scenario has no such file.
 */
export function resolveScenarioFile(dir: string, name: string, platform: SnapshotPlatform = snapshotPlatformOf()): string {
  const own = join(dir, platform, name)
  return existsSync(own) ? own : join(dir, name)
}

/**
 * The scenario directory of a resolved scenario file, whether it is shared or one platform's copy.
 * @param path - a path returned by {@link resolveScenarioFile} or a shared file's path.
 * @returns the scenario directory that owns the file.
 */
export function scenarioDirectoryOf(path: string): string {
  const parent = dirname(path)
  return (SNAPSHOT_PLATFORMS as readonly string[]).includes(basename(parent)) ? dirname(parent) : parent
}

/**
 * The file names a platform sees in one scenario: shared files plus that platform's split files.
 * @param dir - the scenario directory.
 * @param platform - the platform whose view is listed.
 * @returns sorted file names, each resolvable with {@link resolveScenarioFile}.
 */
export function scenarioFileNames(dir: string, platform: SnapshotPlatform = snapshotPlatformOf()): string[] {
  return [...new Set([...filesIn(dir), ...filesIn(join(dir, platform))])].sort()
}

/**
 * Write one scenario file from a run on `platform`, touching only that platform's expectation.
 * Identical content leaves a shared file alone. Different content splits the shared file: its unchanged bytes move
 * to every other platform's directory and the new content is written to this platform's. Writing a split side that
 * becomes identical to every other side merges them back into the shared root.
 * @param dir - the scenario directory.
 * @param name - the file's name within the scenario.
 * @param content - the content this platform produced.
 * @param platform - the running platform.
 */
export function writeScenarioFile(
  dir: string, name: string, content: string, platform: SnapshotPlatform = snapshotPlatformOf(),
): void {
  const shared = join(dir, name)
  const own = join(dir, platform, name)
  const others = SNAPSHOT_PLATFORMS.filter(candidate => candidate !== platform).map(candidate => join(dir, candidate, name))
  if (!existsSync(own)) {
    if (!existsSync(shared)) {
      writeFileSync(shared, content)
      return
    }
    if (readFileSync(shared, 'utf8') === content) return
    for (const other of others) {
      mkdirSync(join(other, '..'), { recursive: true })
      writeFileSync(other, readFileSync(shared))
    }
    rmSync(shared)
    mkdirSync(join(dir, platform), { recursive: true })
    writeFileSync(own, content)
    return
  }
  if (others.every(other => existsSync(other) && readFileSync(other, 'utf8') === content)) {
    for (const path of [own, ...others]) rmSync(path)
    for (const candidate of SNAPSHOT_PLATFORMS) removeEmptyDirectory(join(dir, candidate))
    writeFileSync(shared, content)
    return
  }
  writeFileSync(own, content)
}

function removeEmptyDirectory(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true })
}

/**
 * Layout violations of one scenario directory: a split must name the same file on every platform, never also keep a
 * shared copy, and never hold identical sides.
 * @param dir - the scenario directory.
 * @returns human-readable problems; empty when the layout holds.
 */
export function scenarioLayoutProblems(dir: string): string[] {
  const problems: string[] = []
  const split = new Set(SNAPSHOT_PLATFORMS.flatMap(platform => filesIn(join(dir, platform))))
  for (const name of [...split].sort()) {
    const sides = SNAPSHOT_PLATFORMS.map(platform => join(dir, platform, name))
    const missing = SNAPSHOT_PLATFORMS.filter((_, index) => !existsSync(sides[index] as string))
    if (missing.length > 0) problems.push(`${name}: split without a ${missing.join(' and ')} copy`)
    if (existsSync(join(dir, name))) problems.push(`${name}: split but still shared at the scenario root`)
    if (missing.length === 0 && new Set(sides.map(side => readFileSync(side, 'utf8'))).size === 1) {
      problems.push(`${name}: identical on every platform, so it must be shared`)
    }
  }
  for (const platform of SNAPSHOT_PLATFORMS) {
    const sub = join(dir, platform)
    if (!existsSync(sub)) continue
    for (const entry of readdirSync(sub)) {
      if (!statSync(join(sub, entry)).isFile()) problems.push(`${platform}/${entry}: only files may be split`)
    }
  }
  return problems
}
