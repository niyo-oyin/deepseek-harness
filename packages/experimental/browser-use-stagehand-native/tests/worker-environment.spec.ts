/** A Stagehand Worker resolves a real temp directory without receiving ambient credentials. */

import { once } from 'node:events'
import { existsSync, rmSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { workerEnvironment } from '../src/worker-client.ts'

it('gives the Worker an absolute temp directory outside the working directory and no credentials', async () => {
  const worker = new Worker(`
    const { mkdtempSync } = require('node:fs')
    const { tmpdir } = require('node:os')
    const { join } = require('node:path')
    const { parentPort } = require('node:worker_threads')
    parentPort.postMessage({ tmp: tmpdir(), created: mkdtempSync(join(tmpdir(), 'dsh-stagehand-worker-')), keys: Object.keys(process.env) })
  `, { eval: true, env: workerEnvironment({ ...process.env, DEEPSEEK_API_KEY: 'secret', HTTPS_PROXY: 'http://proxy' }) })
  const [message] = await once(worker, 'message') as [{ tmp: string; created: string; keys: string[] }]
  await worker.terminate()
  try {
    expect(isAbsolute(message.tmp)).toBe(true)
    expect(relative(process.cwd(), message.created).startsWith('..') || isAbsolute(relative(process.cwd(), message.created)))
      .toBe(true)
    expect(existsSync(message.created)).toBe(true)
    expect(message.keys).not.toContain('DEEPSEEK_API_KEY')
    expect(message.keys).not.toContain('HTTPS_PROXY')
  } finally {
    rmSync(message.created, { recursive: true, force: true })
  }
})

it('passes only the system and temp locations on Windows, and nothing on other platforms', () => {
  const host = { SystemRoot: 'C:\\Windows', windir: 'C:\\Windows', TEMP: 'C:\\Temp', TMP: 'C:\\Temp', PATH: 'C:\\bin', DEEPSEEK_API_KEY: 'secret' }
  expect(workerEnvironment(host, 'win32')).toEqual({ SystemRoot: 'C:\\Windows', windir: 'C:\\Windows', TEMP: 'C:\\Temp', TMP: 'C:\\Temp' })
  expect(workerEnvironment(host, 'linux')).toEqual({})
  expect(workerEnvironment({ TSX_TSCONFIG_PATH: '/repo/tsconfig.json' }, 'linux')).toEqual({ TSX_TSCONFIG_PATH: '/repo/tsconfig.json' })
})
