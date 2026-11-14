/**
 * The writable-root derivation shared by every enforcement dialect that
 * expresses a mode as a canonical allow-list: `workspace-write` means "the
 * workspace root, explicit extra directories, and platform temp areas", and this module is that
 * meaning's one home. The Seatbelt profile
 * (`@deepseek-ai/dsh-sandbox-local`) and the in-process filesystem fence
 * (`@deepseek-ai/dsh-fs-sandbox`) both derive their allow-list here, so "the
 * write tool cannot write /tmp but bash can" asymmetries cannot arise between
 * them. The bwrap and Landlock dialects keep their own grant spellings (an
 * ephemeral `/tmp` mount, launcher-owned flags) — the honest per-runner
 * differences recorded in the sandbox RFC — with parity pinned by test.
 *
 * @module dsh-sandbox/roots
 */

import { lstatSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SandboxExecutionPolicy } from './index.ts'

/** A workspace root or explicit directory grant cannot be enforced without changing the caller's selected path. */
export class SandboxInvalidRootError extends HarnessError {
  /**
   * @param path - the rejected path, as the caller spelled it.
   * @param detail - why the path cannot be enforced.
   * @param subject - the role of the path in the policy, as the message names it.
   */
  constructor(path: string, detail: string, subject = 'additional writable directory') {
    super(`Invalid ${subject} ${JSON.stringify(path)}: ${detail}`, 'SANDBOX_INVALID_ROOT')
    this.name = 'SandboxInvalidRootError'
  }
}

/** One 8.3 short name, which Windows generates with a `~N` suffix. */
const SHORT_NAME = /^[^\\/.~]{1,6}~\d{1,6}(?:\.[^\\/.]{0,3})?$/u

/**
 * Whether a Windows path names `physical` itself and differs from it only by 8.3 short-name spelling. Every
 * component must either equal the physical component or be a short name in its place, and no component of the
 * path as given may be a symbolic link or junction (Node reports both as symbolic links), so an alias that
 * actually redirects is still rejected.
 * @param path - the directory as the caller spelled it.
 * @param physical - its native real path.
 * @returns true only on Windows for a short-name spelling of the same directory.
 */
function isShortNameSpelling(path: string, physical: string): boolean {
  if (process.platform !== 'win32') return false
  const given = resolve(path).split(/[\\/]+/u).filter(part => part !== '')
  const real = physical.split(/[\\/]+/u).filter(part => part !== '')
  if (given.length !== real.length) return false
  if (!given.every((part, index) => part.toLowerCase() === real[index]?.toLowerCase() || SHORT_NAME.test(part))) return false
  for (let current = resolve(path); current !== dirname(current); current = dirname(current)) {
    if (mayRedirect(current)) return false
  }
  return true
}

function mayRedirect(component: string): boolean {
  try {
    return lstatSync(component).isSymbolicLink()
  } catch (_unreadable) {
    return true // A component that cannot be inspected is never taken as proof that no link is present.
  }
}

/** Resolve existing directories, rejecting aliases that differ under the host's path comparison. */
function additionalRoot(path: string): string {
  let physical: string
  let directory: boolean
  try {
    physical = realpathSync.native(path)
    directory = statSync(physical).isDirectory()
  } catch (error) {
    throw new SandboxInvalidRootError(path, `cannot read the directory: ${String(error)}`)
  }
  if (!directory) throw new SandboxInvalidRootError(path, 'expected an existing directory')
  if (relative(path, physical) !== '' && !isShortNameSpelling(path, physical)) {
    throw new SandboxInvalidRootError(path, `use the physical directory path ${JSON.stringify(physical)}; symlinked grants are not supported`)
  }
  return physical
}

/**
 * Resolve a granted root to the path the enforcement layer actually compares:
 * canonical (symlinks resolved), because both Seatbelt filters and the fs
 * fence's containment check match resolved paths — `/tmp` IS `/private/tmp`
 * on darwin, and an as-spelled grant would match nothing.
 * @param path - the root as configured or platform-reported.
 * @returns the canonical path, or the spelling as-is when resolution fails
 *   (a missing root matches nothing until it exists — the conservative
 *   outcome; inventing a fallback would grant a path the caller never named).
 */
export function canonicalPath(path: string): string {
  try {
    // Node's JavaScript realpath implementation lexically collapses `..`
    // before resolving a preceding symlink on some platforms. The native
    // implementation follows the filesystem's component-by-component lookup,
    // matching chdir/spawn and the enforcement layers this identity feeds.
    return realpathSync.native(path)
  } catch {
    // realpathSync.native failed: the path (or a prefix) is missing or unreadable.
    return path
  }
}

/**
 * The workspace-owned writable roots — the policy's workspace root plus its
 * explicit extra directories, as a canonical, deduplicated allow-list. Both
 * the workspace and every extra root are included by the filesystem fence and
 * POSIX process backends; Windows process confinement ignores extra roots.
 * This derivation is separate from each backend's platform temp policy (Seatbelt and the fs
 * fence use {@link writableRoots}; bwrap and Landlock add their own temp
 * grants).
 * @param policy - the file-effect policy to derive the allow-list from.
 * @returns the canonical workspace-owned roots; empty under `read-only`.
 * @throws {SandboxInvalidRootError} An extra root cannot be inspected, is not a directory, or uses a symlink.
 */
export function workspaceWritableRoots(policy: SandboxExecutionPolicy): string[] {
  if (policy.mode !== 'workspace-write') return []
  const additional = (policy.additionalWritableRoots ?? []).map(additionalRoot)
  return [...new Set([canonicalPath(policy.workspaceRoot), ...additional])]
}

/**
 * The roots one confined execution may WRITE under — the mode's meaning as a
 * canonical, deduplicated allow-list. `read-only` allows nothing;
 * `workspace-write` allows the policy's workspace root, its explicit extra
 * directories, the host `/tmp`, and the per-user platform temp dir
 * (`os.tmpdir()` — the real temp area for mkstemp-family tools; omitting it
 * would deny what the mode promises).
 * @param policy - the file-effect policy to derive the allow-list from.
 * @returns the canonical writable roots; empty exactly under `read-only`.
 */
export function writableRoots(policy: SandboxExecutionPolicy): string[] {
  if (policy.mode !== 'workspace-write') return []
  return [...new Set([...workspaceWritableRoots(policy), canonicalPath('/tmp'), canonicalPath(tmpdir())])]
}
