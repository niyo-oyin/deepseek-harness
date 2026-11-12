/** Renderer warnings and errors persist in a bounded log file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import {
  recordRendererConsole, RENDERER_LOG_FILE, RENDERER_LOG_MAX_BYTES, RENDERER_LOG_MAX_MESSAGE_CHARS,
} from '../src/renderer-log.ts'

function logsDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-renderer-log-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  return join(root, 'logs')
}

const time = new Date('2026-11-12T00:00:00.000Z')

it('creates the directory and appends one timestamped line per message', () => {
  const directory = logsDirectory()
  recordRendererConsole(directory, { level: 'warning', source: 'dsh-app://app/a.js', line: 3, message: 'first' }, time)
  recordRendererConsole(directory, { level: 'error', source: 'dsh-app://app/b.js', line: 7, message: 'second\nstack' }, time)
  expect(readFileSync(join(directory, RENDERER_LOG_FILE), 'utf8')).toBe([
    '2026-11-12T00:00:00.000Z warning dsh-app://app/a.js:3 first',
    '2026-11-12T00:00:00.000Z error dsh-app://app/b.js:7 second',
    '  stack',
    '',
  ].join('\n'))
})

it('cuts an oversized message and marks the cut', () => {
  const directory = logsDirectory()
  recordRendererConsole(directory, { level: 'error', source: 's', line: 1, message: 'x'.repeat(RENDERER_LOG_MAX_MESSAGE_CHARS + 5) }, time)
  const written = readFileSync(join(directory, RENDERER_LOG_FILE), 'utf8')
  expect(written).toContain(`${'x'.repeat(RENDERER_LOG_MAX_MESSAGE_CHARS)}… [truncated]`)
  expect(written).not.toContain('x'.repeat(RENDERER_LOG_MAX_MESSAGE_CHARS + 1))
})

it('keeps one predecessor once the current file reaches its size limit', () => {
  const directory = logsDirectory()
  recordRendererConsole(directory, { level: 'error', source: 's', line: 1, message: 'seed' }, time)
  const path = join(directory, RENDERER_LOG_FILE)
  writeFileSync(path, 'o'.repeat(RENDERER_LOG_MAX_BYTES))
  recordRendererConsole(directory, { level: 'error', source: 's', line: 2, message: 'after rotation' }, time)
  expect(readFileSync(`${path}.1`, 'utf8')).toBe('o'.repeat(RENDERER_LOG_MAX_BYTES))
  expect(readFileSync(path, 'utf8')).toBe('2026-11-12T00:00:00.000Z error s:2 after rotation\n')
})

it('drops the message when the logs directory cannot be created', () => {
  const directory = logsDirectory()
  // A regular file where the directory belongs makes every write fail.
  const blocked = join(directory, '..', 'blocked')
  writeFileSync(blocked, '')
  expect(() => { recordRendererConsole(blocked, { level: 'error', source: 's', line: 1, message: 'lost' }, time) }).not.toThrow()
  expect(readFileSync(blocked, 'utf8')).toBe('')
})
