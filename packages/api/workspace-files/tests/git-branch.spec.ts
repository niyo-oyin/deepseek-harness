/** The checked-out branch of a Session's workspace directory, read from a real repository. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mountSearchSubprocess } from './search-harness.ts'
import { openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness
let home: string
beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-git-branch-')
})
afterEach(async () => {
  await harness.ctx.fiber.dispose()
  await harness.dispose()
})

/** Run Git in the workspace with a private home, so the developer's own configuration plays no part. */
function git(...argv: string[]): string {
  return execFileSync('git', argv, {
    cwd: harness.workspace, encoding: 'utf8',
    env: {
      ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim()
}

const branch = (abort = signal()) => harness.endpoint().gitBranch(harness.scope, abort)

describe('workspace Git branch', () => {
  it('reports nothing without a subprocess provider', async () => {
    await expect(branch()).resolves.toEqual({ kind: 'none' })
  })

  describe('with a subprocess provider', () => {
    beforeEach(async () => { home = await mountSearchSubprocess(harness) })

    it('reports nothing for a directory outside a repository', async () => {
      await expect(branch()).resolves.toEqual({ kind: 'none' })
    })

    it('names the branch from its first commit on, and before it', async () => {
      git('init', '-q', '-b', 'main')
      // An unborn branch has no commit yet, and is still what the next commit lands on.
      await expect(branch()).resolves.toEqual({ kind: 'branch', name: 'main' })
      await writeFile(join(harness.workspace, 'file.txt'), 'x')
      git('add', '.')
      git('commit', '-q', '-m', 'first')
      await expect(branch()).resolves.toEqual({ kind: 'branch', name: 'main' })
      git('switch', '-q', '-c', 'feature/branch-chip')
      await expect(branch()).resolves.toEqual({ kind: 'branch', name: 'feature/branch-chip' })
    })

    it('reports a detached HEAD by its short commit id', async () => {
      git('init', '-q', '-b', 'main')
      await writeFile(join(harness.workspace, 'file.txt'), 'x')
      git('add', '.')
      git('commit', '-q', '-m', 'first')
      git('switch', '-q', '--detach')
      await expect(branch()).resolves.toEqual({ kind: 'detached', head: git('rev-parse', '--short', 'HEAD') })
    })

    it('reads the repository a workspace subdirectory belongs to', async () => {
      git('init', '-q', '-b', 'trunk')
      const nested = join(harness.workspace, 'packages', 'app')
      await mkdir(nested, { recursive: true })
      await expect(harness.endpoint().gitBranch({ ...harness.scope, workspaceRoot: nested }, signal()))
        .resolves.toEqual({ kind: 'branch', name: 'trunk' })
    })

    it('reports nothing for a workspace directory that no longer exists', async () => {
      git('init', '-q', '-b', 'main')
      await rm(harness.workspace, { recursive: true, force: true })
      await expect(branch()).resolves.toEqual({ kind: 'none' })
    })
  })
})
