/**
 * Refuse every outbound HTTP request that would leave this machine during a test run.
 *
 * A keyless suite that boots a real provider route, a replay whose composition silently falls back to
 * the live adapter, or a developer's exported key must not turn into traffic to a real API. This module
 * installs undici's `MockAgent` as the global dispatcher with network connections disabled except to
 * loopback and to this machine's own interface addresses, so a request elsewhere fails before any
 * socket opens (`UND_MOCK_ERR_MOCK_NOT_MATCHED`) while local fixture servers keep answering.
 *
 * It runs in two places: as a Vitest `setupFiles` entry inside each test worker, and as a Node
 * `--import` preload in every Node child process that inherits the worker's environment. The worker
 * appends `--import=<this file's URL>` to `NODE_OPTIONS`; a URL survives paths with spaces or 8.3 short
 * names. A spawner that builds its child environment from scratch drops it and must pass it on itself.
 * The module is plain JavaScript so a built child loads it without a TypeScript loader, and no product
 * code refers to it: it reaches a product process only through the test run's environment.
 *
 * Opt-in live runs are exempt through one switch, `DSH_TEST_LIVE_NETWORK=1`, which the real-API e2e
 * configuration and `DSH_SNAPSHOT=record` set before any worker starts. With the switch set this module
 * installs nothing and adds nothing to `NODE_OPTIONS`.
 *
 * Known limits — the guard covers what resolves undici's global dispatcher, which is Node's built-in
 * `fetch` and undici's own top-level helpers. It does not cover:
 * - `node:http`, `node:https`, `node:net`, `node:tls`, and `ws` clients, which never consult undici;
 * - a request given its own dispatcher, such as LiveShare's relay transport;
 * - code under test that replaces the global dispatcher (an installed proxy policy) until it restores it;
 * - non-Node children (browsers, Python, native tools) and Node children spawned with a rebuilt environment.
 * @module
 */

import { createRequire } from 'node:module'
import { networkInterfaces } from 'node:os'

/** Switch that exempts an opt-in live run; any other value, or absence, keeps the guard on. */
export const LIVE_NETWORK_ENV = 'DSH_TEST_LIVE_NETWORK'

/** `NODE_OPTIONS` entry that preloads this module in a Node child. */
export const NETWORK_GUARD_IMPORT = `--import=${import.meta.url}`

// The repository's own undici, resolved from this file so a child in any working directory loads the
// same copy. undici 8 also publishes its dispatcher under the symbol Node's built-in `fetch` reads.
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(
  new URL('../packages/util/http-proxy/package.json', import.meta.url),
)('undici')

/**
 * Whether a request authority stays on this machine.
 * @param {string} authority - `host:port` as undici reports it; IPv6 hosts are bracketed.
 * @returns {boolean} true for loopback names and addresses and for this machine's interface addresses.
 */
export function isLocalAuthority(authority) {
  const host = authority.replace(/:\d+$/u, '').replace(/^\[(.*)\]$/u, '$1').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (/^127\.\d+\.\d+\.\d+$/u.test(host) || host === '::1' || host === '::ffff:127.0.0.1') return true
  return Object.values(networkInterfaces()).some(entries =>
    (entries ?? []).some(entry => entry.address.toLowerCase() === host.replace(/%.*$/u, '')))
}

if (process.env[LIVE_NETWORK_ENV] !== '1' && !(getGlobalDispatcher() instanceof MockAgent)) {
  const agent = new MockAgent()
  agent.disableNetConnect()
  agent.enableNetConnect(isLocalAuthority)
  setGlobalDispatcher(agent)
  const options = process.env.NODE_OPTIONS ?? ''
  if (!options.includes(NETWORK_GUARD_IMPORT)) {
    process.env.NODE_OPTIONS = options === '' ? NETWORK_GUARD_IMPORT : `${options} ${NETWORK_GUARD_IMPORT}`
  }
}
