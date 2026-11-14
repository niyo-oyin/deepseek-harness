/**
 * Per-platform snapshot expectations.
 *
 * A scenario's files sit in its directory and hold on every platform. Where the composed prompt, tool list, log, or
 * wire output legitimately differs by operating system, the file is split whole: the same filename lives once under
 * `posix/` (Linux and macOS) and once under `windows/`, and the scenario root no longer holds it. A session fixture
 * split this way is that platform's replay input as well as its expectation.
 *
 * Every reader resolves a scenario file through {@link resolveScenarioFile} or lists it through
 * {@link scenarioFileNames}; every writer goes through `writeScenarioFile` (layout.ts), which only ever writes the
 * running platform's side. Splitting a shared file moves its unchanged bytes to the other platform's directory: that file is
 * taken to be the other platform's truth at the moment of the split, and stays unverified there until a run on that
 * platform. A split whose two sides become identical is merged back into the shared root.
 *
 * @module
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
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

/**
 * The regular files directly inside one directory.
 * @param dir - the directory to list; a missing one has none.
 * @returns file names, unsorted.
 */
export function filesIn(dir: string): string[] {
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
