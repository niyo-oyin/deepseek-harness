/** Test runs cannot reach a real host, in the worker or in a Node child that inherits its environment. */
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { vitestConfigFiles } from './test-proxy-environment.ts'

const run = promisify(execFile)

/** A host that never resolves, so a regression costs one failed lookup rather than a real request. */
const EXTERNAL = 'https://network-guard-probe.invalid/v1/messages'

/** The refusal undici reports when the guard answers a request without opening a socket. */
const REFUSED = 'UND_MOCK_ERR_MOCK_NOT_MATCHED'

let server: Server
let local: string
beforeAll(async () => {
  server = createServer((_request, response) => { response.end('local') })
  const address = await new Promise<AddressInfo>((resolve) => {
    server.listen(0, '127.0.0.1', () => { resolve(server.address() as AddressInfo) })
  })
  local = `http://127.0.0.1:${String(address.port)}/`
})
afterAll(async () => { await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) })

/** Child script printing the outcome of one `fetch` per URL argument. */
const PROBE = `
for (const url of process.argv.slice(1)) {
  try { const response = await fetch(url); console.log(String(response.status)) }
  catch (error) { console.log(error.cause?.code ?? error.message) }
}`

async function probeChild(env: NodeJS.ProcessEnv, ...urls: string[]): Promise<string[]> {
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', PROBE, ...urls], { env })
  return stdout.trim().split(/\r?\n/u)
}

describe('test network guard', () => {
  it('refuses an external request in the worker before any connection', async () => {
    await expect(fetch(EXTERNAL)).rejects.toMatchObject({ cause: { code: REFUSED } })
  })

  it('lets loopback requests through in the worker', async () => {
    await expect((await fetch(local)).text()).resolves.toBe('local')
  })

  it('refuses an external request in a Node child that inherits the environment, and keeps its loopback', async () => {
    expect(await probeChild(process.env, EXTERNAL, local)).toEqual([REFUSED, '200'])
  })

  it('stands aside in a child of an opt-in live run', async () => {
    const outcomes = await probeChild({ ...process.env, DSH_TEST_LIVE_NETWORK: '1' }, local)
    expect(outcomes).toEqual(['200'])
    const { stdout } = await run(process.execPath, [
      '--input-type=module', '-e', 'console.log(globalThis[Symbol.for("undici.globalDispatcher.2")]?.constructor.name ?? "none")',
    ], { env: { ...process.env, DSH_TEST_LIVE_NETWORK: '1' } })
    expect(stdout.trim()).not.toBe('MockAgent')
  })

  // What can regress is the wiring: a new Vitest project or configuration that omits the guard.
  const declared = vitestConfigFiles()
    .map(config => ({ config, slots: readFileSync(config, 'utf8').match(/setupFiles: \[[^\]]*\]/g) ?? [] }))
    .filter(entry => entry.slots.length > 0)

  it.each(declared)('$config loads the guard in every setupFiles it declares', ({ slots }) => {
    for (const slot of slots) expect(slot).toContain('./scripts/test-network-guard.mjs')
  })
})
