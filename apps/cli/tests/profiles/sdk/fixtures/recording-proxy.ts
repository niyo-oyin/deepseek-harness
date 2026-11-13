/** Loopback forwarding proxy that records the exact JSON bodies of DeepSeek Messages requests. */
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { once } from 'node:events'

/** Hop-by-hop and length headers the forwarding request and response must not copy. */
const UNFORWARDED_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'content-encoding', 'keep-alive'])

/** A started proxy; `baseURL` replaces the adapter's endpoint and `bodies` grows in request order. */
export interface RecordingProxy {
  readonly baseURL: string
  readonly bodies: readonly unknown[]
  close(): Promise<void>
}

function forwardedHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || UNFORWARDED_HEADERS.has(name)) continue
    result[name] = Array.isArray(value) ? value.join(', ') : value
  }
  return result
}

/**
 * Start a proxy whose `baseURL` keeps the upstream path, so the adapter's request paths map one to one.
 * @param upstream - real endpoint base, for example `https://api.deepseek.com/anthropic`.
 * @param record - selects which Messages requests to keep; compaction and auxiliary calls can be skipped.
 * @returns the proxy; the caller closes it after the scenario.
 */
export async function startRecordingProxy(
  upstream: string,
  record: (body: unknown, headers: IncomingHttpHeaders) => boolean,
): Promise<RecordingProxy> {
  const origin = new URL(upstream).origin
  const bodies: unknown[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const payload = Buffer.concat(chunks)
      if (request.method === 'POST' && request.url?.endsWith('/messages') === true) {
        const body: unknown = JSON.parse(payload.toString('utf8'))
        if (record(body, request.headers)) bodies.push(body)
      }
      const forwarded = await fetch(new URL(request.url ?? '/', origin), {
        method: request.method ?? 'GET',
        headers: forwardedHeaders(request.headers),
        ...payload.length === 0 ? {} : { body: payload },
      })
      const headers: Record<string, string> = {}
      forwarded.headers.forEach((value, name) => { if (!UNFORWARDED_HEADERS.has(name)) headers[name] = value })
      response.writeHead(forwarded.status, headers)
      if (forwarded.body === null) { response.end(); return }
      const reader = forwarded.body.getReader()
      for (let next = await reader.read(); !next.done; next = await reader.read()) response.write(next.value)
      response.end()
    })().catch((error: unknown) => { response.destroy(error instanceof Error ? error : new Error(String(error))) })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('recording proxy has no port')
  return {
    baseURL: `http://127.0.0.1:${address.port}${new URL(upstream).pathname.replace(/\/+$/u, '')}`,
    bodies,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}
