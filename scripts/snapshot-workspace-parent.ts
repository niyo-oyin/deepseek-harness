/** Workspace placement for snapshots that must not inherit temporary-directory write grants. */

import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, sep } from 'node:path'
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox'

function contains(root: string, path: string): boolean {
  const suffix = relative(root, path)
  return suffix === '' || suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix)
}

/**
 * Select a writable temp sibling parent, or home when that parent is unavailable for writes or redirects them.
 * The caller atomically allocates and owns cleanup of the generated workspace.
 * @param tempRoot - platform temporary directory.
 * @param home - fallback when temp siblings require a system directory or a non-writable parent.
 * @returns existing parent outside the automatic temporary write grants.
 */
export function outsideTempWorkspaceParent(tempRoot = tmpdir(), home = homedir()): string {
  const temporary = canonicalPath(tempRoot)
  const systemTemporary = canonicalPath('/tmp')
  const parent = dirname(temporary)
  if (temporary === systemTemporary || parent === parse(parent).root || contains(systemTemporary, parent)) return home
  try {
    accessSync(parent, constants.W_OK)
  } catch (error) {
    // A non-writable parent cannot host siblings; allocation failures still propagate from mkdtemp.
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return home
    throw error
  }
  return hostsOwnDirectories(parent) ? parent : home
}

/**
 * Whether a directory created in `parent` is physically where it is spelled. A process inside a packaged Windows
 * app has its new AppData entries redirected into the package's LocalCache, so a workspace there would have a
 * different physical path and the sandbox would rightly refuse grants spelled under it.
 * @param parent - candidate workspace parent.
 * @returns true when a probe directory's real path is its own.
 */
function hostsOwnDirectories(parent: string): boolean {
  const probe = mkdtempSync(join(parent, '.dsh-parent-probe-'))
  try {
    return canonicalPath(probe) === join(canonicalPath(parent), basename(probe))
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

/**
 * Reject a workspace whose write could succeed without the session's workspace grant.
 * @param cwd - allocated workspace to check, with symlinks resolved before comparison.
 * @returns nothing; throws when an automatic temporary write grant contains the workspace.
 */
export function assertWorkspaceOutsideTemp(cwd: string): void {
  const path = canonicalPath(cwd)
  for (const root of writableRoots({ mode: 'workspace-write', workspaceRoot: '/tmp' })) {
    if (contains(root, path)) throw new Error('snapshot workspace ' + cwd + ' must be outside temporary writable root ' + root)
  }
}
