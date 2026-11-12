/** What Git has checked out in a workspace directory, read through the composed subprocess provider. */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { WorkspaceGitBranch } from './types.ts'

/** A branch name or a short commit id fits well inside this; anything longer is not an answer. */
const OUTPUT_CAP_BYTES = 4096

/** Both reads are local ref lookups, so a slow answer means a stuck process. */
const TIMEOUT_MS = 5000

/**
 * Read the branch checked out in a directory, or the commit of a detached HEAD.
 * `git branch --show-current` separates the three cases in one read: it names
 * the branch (also an unborn one before its first commit), prints nothing on a
 * detached HEAD, and fails outside a repository.
 * @param subprocess - the composed process spawner, co-located with the filesystem.
 * @param cwd - the directory in the subprocess execution world.
 * @param signal - caller cancellation.
 * @returns the branch, the detached commit, or `none` for a directory outside a repository, a host
 *   without Git, and a read that failed or timed out.
 */
export async function readGitBranch(
  subprocess: Pick<SubprocessRuntime, 'spawn' | 'resolveExecutable'>,
  cwd: string,
  signal: AbortSignal,
): Promise<WorkspaceGitBranch> {
  let git: string
  try {
    git = await subprocess.resolveExecutable('git')
  } catch {
    // A host without Git has no checkout to report.
    return { kind: 'none' }
  }
  const run = async (argv: readonly string[]): Promise<string | undefined> => {
    const handle = subprocess.spawn({
      argv: [git, '-C', cwd, ...argv],
      cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: OUTPUT_CAP_BYTES }, stderr: { maxBytes: OUTPUT_CAP_BYTES } },
      graceMs: TIMEOUT_MS,
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
    try {
      const outcome = await handle.done
      if (outcome.exitCode !== 0) return undefined
    } catch {
      // A spawn failure or the deadline leaves no exit facts, so there is no answer.
      return undefined
    }
    return handle.collected.stdout?.readFrom(0).text.trim()
  }
  const name = await run(['branch', '--show-current'])
  if (name === undefined) return { kind: 'none' }
  if (name !== '') return { kind: 'branch', name }
  const head = await run(['rev-parse', '--short', 'HEAD'])
  return head === undefined || head === '' ? { kind: 'none' } : { kind: 'detached', head }
}
