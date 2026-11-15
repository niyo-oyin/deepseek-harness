/**
 * Search API endpoint for the API-key search snapshot. The endpoint answers only a request that carries the snapshot's
 * DeepSeek API key as `Authorization: Bearer`.
 */
import { applyLoopbackServerEffect } from '../loopback-fixture-server.mjs'

/** Search endpoint under the official origin, routed to the current loopback listener. */
const RECORDED_ENDPOINT = 'https://api.deepseek.com/v1/tools/search'

/** API key the snapshot environment supplies as `DEEPSEEK_API_KEY`. */
const API_KEY = 'snapshot-search-key'

/** Cordis plugin name. */
export const name = 'web-search-api-key-fixture'

function requestUrl(input) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  return undefined
}

function transportInput(input, transportEndpoint) {
  const url = requestUrl(input)
  if (url === RECORDED_ENDPOINT) {
    return input instanceof Request ? new Request(transportEndpoint, input) : transportEndpoint
  }
  if (url !== undefined && url.startsWith('https://api.deepseek.com/')) {
    throw new Error(`web-search-api-key-fixture: unexpected DeepSeek request: ${url}`)
  }
  return input
}

/** Start the Search endpoint; it ends with the plugin fiber. */
export async function apply(ctx) {
  let restoreFetch = () => {}
  await applyLoopbackServerEffect(ctx, {
    label: 'web-search-api-key-fixture',
    requestListener: (request, response) => {
      if (request.method === 'POST' && request.url === '/v1/tools/search') {
        if (request.headers.authorization !== `Bearer ${API_KEY}`) {
          response.writeHead(401, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: { message: 'expected the snapshot API key' } }))
          return
        }
        request.resume()
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          results: [{
            url: 'https://search.example.test/guide', title: 'Search guide', snippet: 'Web search with an API key.',
            summary: 'Web search sends the DeepSeek API key.', date: null,
          }],
        }))
        return
      }
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
    },
    onListening: (address) => {
      const transportEndpoint = `http://127.0.0.1:${String(address.port)}/v1/tools/search`
      const originalFetch = globalThis.fetch
      const fixtureFetch = async (input, init) => originalFetch(transportInput(input, transportEndpoint), init)
      globalThis.fetch = fixtureFetch
      restoreFetch = () => {
        if (globalThis.fetch !== fixtureFetch) {
          throw new Error('web-search-api-key-fixture: global fetch owner changed before cleanup')
        }
        globalThis.fetch = originalFetch
      }
    },
    onCleanup: () => restoreFetch(),
  })
}
