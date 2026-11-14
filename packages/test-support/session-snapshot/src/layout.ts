/**
 * Writing and checking a scenario's per-platform files.
 *
 * A file is split into `posix/` and `windows/` only between platforms the scenario's manifest runs on. A scenario
 * limited to one platform keeps every file at its root, because no other platform has an expectation to keep apart.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSnapshotManifest } from './manifest.ts'
import { filesIn, SNAPSHOT_PLATFORMS, snapshotPlatformOf, type SnapshotPlatform } from './platform.ts'

/**
 * The platforms a scenario directory runs on, from its manifest.
 * @param dir - the scenario directory.
 * @returns the declared platforms; every platform when the directory has no manifest or declares none.
 */
function scenarioPlatforms(dir: string): readonly SnapshotPlatform[] {
  const path = join(dir, 'snapshot.yml')
  if (!existsSync(path)) return SNAPSHOT_PLATFORMS
  return parseSnapshotManifest(readFileSync(path, 'utf8'), path).platforms ?? SNAPSHOT_PLATFORMS
}

function removeEmptyDirectory(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true })
}

/**
 * Write one scenario file from a run on `platform`, touching only that platform's expectation.
 * In a scenario that runs on no other platform the file is always shared. Otherwise identical content leaves a
 * shared file alone, and different content splits it: its unchanged bytes move to every other platform the scenario
 * runs on and the new content is written to this platform's directory. Writing a split side that becomes identical
 * to every other side merges them back into the shared root.
 * @param dir - the scenario directory.
 * @param name - the file's name within the scenario.
 * @param content - the content this platform produced.
 * @param platform - the running platform.
 * @throws {Error} when the scenario does not run on `platform`.
 */
export function writeScenarioFile(
  dir: string, name: string, content: string, platform: SnapshotPlatform = snapshotPlatformOf(),
): void {
  const runsOn = scenarioPlatforms(dir)
  if (!runsOn.includes(platform)) throw new Error(`${dir} does not run on ${platform}, so it cannot record ${name} there`)
  const shared = join(dir, name)
  const others = runsOn.filter(candidate => candidate !== platform).map(candidate => join(dir, candidate, name))
  if (others.length === 0) {
    writeFileSync(shared, content)
    return
  }
  const own = join(dir, platform, name)
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

/**
 * Layout violations of one scenario directory: a split must name the same file on every platform, never also keep a
 * shared copy, never hold identical sides, and only exist in a scenario that runs on every platform.
 * @param dir - the scenario directory.
 * @returns human-readable problems; empty when the layout holds.
 */
export function scenarioLayoutProblems(dir: string): string[] {
  const problems: string[] = []
  const split = new Set(SNAPSHOT_PLATFORMS.flatMap(platform => filesIn(join(dir, platform))))
  const runsOn = scenarioPlatforms(dir)
  for (const name of [...split].sort()) {
    if (runsOn.length < SNAPSHOT_PLATFORMS.length) {
      problems.push(`${name}: split, but the scenario runs on ${runsOn.join(', ')} only`)
      continue
    }
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
