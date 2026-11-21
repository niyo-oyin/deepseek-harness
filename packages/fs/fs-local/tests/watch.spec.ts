/** Polled target watches: what they report, when, and what they leave open. */
import { Context } from '@deepseek-ai/cordis'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as realDelay } from 'node:timers/promises'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocalFileSystem } from '../src/index.ts'

afterEach(() => { vi.useRealTimers() })

type Changed = (error?: Error) => void

async function setup(): Promise<{ fs: FileSystem; root: string; changed: ReturnType<typeof vi.fn<Changed>>; signal: AbortSignal }> {
  const root = await mkdtemp(join(tmpdir(), 'fs-local-watch-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LocalFileSystem)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  return { fs: ctx.fs, root, changed: vi.fn<Changed>(), signal: new AbortController().signal }
}

/** Start a watch, registering its closure with the test. */
async function watching(fs: FileSystem, target: FsTarget, changed: Changed, signal: AbortSignal): Promise<() => Promise<void>> {
  const close = await fs.watch(target, changed, signal)
  onTestFinished(close)
  return close
}

/** Run every open watch's next poll to completion; each schedules its successor after its filesystem read. */
async function nextPoll(watches = 1): Promise<void> {
  vi.advanceTimersByTime(1000)
  while (vi.getTimerCount() !== watches) await realDelay(1)
}

describe('local filesystem watch', () => {
  it('reports a file being written, removed, and created again', async () => {
    const h = await setup()
    const path = join(h.root, 'file.txt')
    await writeFile(path, 'one')
    await watching(h.fs, await h.fs.resolve(path), h.changed, h.signal)

    await nextPoll()
    expect(h.changed).not.toHaveBeenCalled()

    await writeFile(path, 'two, longer')
    await nextPoll()
    expect(h.changed).toHaveBeenCalledTimes(1)

    await rm(path)
    await nextPoll()
    expect(h.changed).toHaveBeenCalledTimes(2)

    await writeFile(path, 'three')
    await nextPoll()
    expect(h.changed.mock.calls).toEqual([[], [], []])
  })

  it('reports a missing file appearing, even after its parent directory is recreated', async () => {
    const h = await setup()
    const parent = join(h.root, 'parent')
    const path = join(parent, 'file.txt')
    await watching(h.fs, await h.fs.resolve(path), h.changed, h.signal)

    await mkdir(parent)
    await nextPoll()
    expect(h.changed).not.toHaveBeenCalled()

    await writeFile(path, 'one')
    await nextPoll()
    expect(h.changed).toHaveBeenCalledTimes(1)

    await rm(parent, { recursive: true })
    await nextPoll()
    await mkdir(parent)
    await writeFile(path, 'two')
    await nextPoll()
    expect(h.changed).toHaveBeenCalledTimes(3)
  })

  it('reports a directory gaining, renaming, and losing a direct entry', async () => {
    const h = await setup()
    const directory = join(h.root, 'directory')
    await mkdir(directory)
    await watching(h.fs, await h.fs.resolve(directory), h.changed, h.signal)

    await writeFile(join(directory, 'a.txt'), 'a')
    await nextPoll()
    expect(h.changed).toHaveBeenCalledTimes(1)

    await rename(join(directory, 'a.txt'), join(directory, 'b.txt'))
    await nextPoll()
    expect(h.changed).toHaveBeenCalledTimes(2)

    await rm(join(directory, 'b.txt'))
    await nextPoll()
    expect(h.changed).toHaveBeenCalledTimes(3)
  })

  it('leaves a watched directory and its ancestors free to be renamed', async () => {
    const h = await setup()
    const ancestor = join(h.root, 'ancestor')
    const directory = join(ancestor, 'directory')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'file.txt'), 'one')
    await watching(h.fs, await h.fs.resolve(directory), h.changed, h.signal)
    await watching(h.fs, await h.fs.resolve(join(directory, 'file.txt')), h.changed, h.signal)
    await nextPoll(2)

    await rename(ancestor, join(h.root, 'renamed'))
    await nextPoll(2)
    expect(h.changed.mock.calls).toEqual([[], []])
  })

  it('reports nothing after it is closed, including a poll already reading', async () => {
    const h = await setup()
    const path = join(h.root, 'file.txt')
    await writeFile(path, 'one')
    const close = await watching(h.fs, await h.fs.resolve(path), h.changed, h.signal)

    await writeFile(path, 'two, longer')
    vi.advanceTimersByTime(1000)
    await close()
    await realDelay(50)
    vi.advanceTimersByTime(5000)
    await realDelay(50)
    expect(h.changed).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a cancelled initialization without starting to poll', async () => {
    const h = await setup()
    const controller = new AbortController()
    controller.abort()
    await expect(h.fs.watch(await h.fs.resolve(join(h.root, 'file.txt')), h.changed, controller.signal)).rejects.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a failed read and keeps watching', async () => {
    const h = await setup()
    const path = join(h.root, 'file.txt')
    await writeFile(path, 'one')
    const target = await h.fs.resolve(path)
    await watching(h.fs, target, h.changed, h.signal)

    const error = new Error('read failed')
    const stat = vi.spyOn(h.fs, 'stat').mockRejectedValueOnce(error)
    await nextPoll()
    expect(h.changed).toHaveBeenCalledExactlyOnceWith(error)

    stat.mockRestore()
    await writeFile(path, 'two, longer')
    await nextPoll()
    expect(h.changed).toHaveBeenLastCalledWith()
  })
})
