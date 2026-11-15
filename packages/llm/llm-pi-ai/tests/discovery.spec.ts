import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { userAgent } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { discoverModels } from '../src/discovery.ts'

const servers: Server[] = []
/** Credential variables a test set, cleared so the next one starts unset. */
const touchedEnv: string[] = []

afterEach(async () => {
  // A no-op when the test never stubbed `fetch`; only 'probe key format'
  // below installs one.
  vi.unstubAllGlobals()
  for (const name of touchedEnv.splice(0)) Reflect.deleteProperty(process.env, name)
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

interface ListingServer {
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
}

/**
 * A stand-in provider that answers one scripted `GET /models`. `chunks` writes
 * without a declared length, which is how a real streamed reply arrives.
 */
async function listingServer(behavior: {
  status?: number
  body?: string
  chunks?: string[]
  holdOpenMs?: number
}): Promise<ListingServer> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    paths.push(request.url ?? '')
    headers.push(request.headers)
    if (behavior.chunks !== undefined) {
      // No declared length: the ceiling has to hold on what is read.
      response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json' })
      for (const chunk of behavior.chunks) response.write(chunk)
      if (behavior.holdOpenMs === undefined) { response.end(); return }
      // Left open so a caller's cancellation lands while the body is still
      // being read rather than after it completed.
      setTimeout(() => { response.end() }, behavior.holdOpenMs)
      return
    }
    const body = behavior.body ?? '{}'
    response.writeHead(behavior.status ?? 200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers }
}

/** The fields a test of the endpoint's own reply compares: the id and name, plus what the endpoint reported or the catalog holds. */
function reportedFields(model: LlmDiscoveredModel): LlmDiscoveredModel {
  if (model.inCatalog === true) {
    const { inCatalog: _inCatalog, ...catalog } = model
    return catalog
  }
  const fields = (['contextWindow', 'maxTokens'] as const).filter(field => model.sources?.[field] === 'endpoint')
  return {
    id: model.id,
    ...model.name === undefined ? {} : { name: model.name },
    ...Object.fromEntries(fields.map(field => [field, model[field]])),
  }
}

/**
 * Discover through the registry as the Models page's fetch action does —
 * asking the endpoint unless the request says otherwise — and keep the fields
 * {@link reportedFields} compares.
 */
async function discover(
  ctx: Context, settingsNs: string, request: LlmModelDiscoveryRequest, signal?: AbortSignal,
): Promise<LlmDiscoveredModel[]> {
  const answer = await ctx.llm.discoverModels(settingsNs, { listEndpoint: true, ...request }, signal)
  return answer.models.map(reportedFields)
}

/** A bare dormant mount: discovery is offered whether or not a route exists. */
async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {})
  return ctx
}

describe('catalog-route model discovery', () => {
  it('includes the installed model input types for vision models', async () => {
    const ctx = await harness()
    const models = await discover(ctx, 'llm-pi-ai', { provider: 'openai' })
    const installed = getBuiltinModels('openai').find(model => model.id === 'gpt-6-astra')
    expect(installed?.input).toContain('image')
    expect(models.find(model => model.id === 'gpt-6-astra')).toMatchObject({ inputModalities: installed?.input })
  })

  it('answers from the installed registry, with capacities and no network call', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'from-the-endpoint' }] }) })
    const ctx = await harness()

    const models = await discover(ctx, 'llm-pi-ai', { provider: 'deepseek', baseURL: server.url, listEndpoint: false })

    // pi-ai's own registry is the authority for its own providers, and it
    // carries what a listing endpoint would not disclose.
    expect(models.map(model => model.id).sort())
      .toEqual(getBuiltinModels('deepseek').map(model => model.id).sort())
    expect(models.every(model => (model.contextWindow ?? 0) > 0 && (model.maxTokens ?? 0) > 0)).toBe(true)
    expect(server.paths).toEqual([])
  })

  it('needs no endpoint for a route the catalog describes', async () => {
    const ctx = await harness()
    await expect(discover(ctx, 'llm-pi-ai', { provider: 'deepseek' })).resolves.not.toHaveLength(0)
  })

  it('says where a route the catalog does not describe must get its models', async () => {
    const ctx = await harness()
    await expect(discover(ctx, 'llm-pi-ai', { provider: 'acme-gateway' }))
      .rejects.toThrow(/ships no catalog for provider "acme-gateway".*set a baseURL/s)
    // A form that cleared the field says the same thing as one that never had it.
    await expect(discover(ctx, 'llm-pi-ai', { provider: 'acme-gateway', baseURL: '' }))
      .rejects.toThrow(/set a baseURL/)
    // The seam refuses a request naming neither, so the module's own guard for
    // that shape is only reachable by calling it directly.
    await expect(discoverModels({ listEndpoint: true })).rejects.toThrow(/set a baseURL/)
  })
})

/** A catalog route whose stored key and endpoint point at a local listing. */
async function storedCatalogRoute(provider: string, baseURL: string, apiKeyEnv?: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  if (apiKeyEnv !== undefined) {
    process.env[apiKeyEnv] = 'stored-key'
    touchedEnv.push(apiKeyEnv)
  }
  await ctx.plugin(LlmPiAi, { providers: { [provider]: { baseURL, ...apiKeyEnv === undefined ? {} : { apiKeyEnv } } } })
  return ctx
}

/** Anthropic's documented capability flags for a model, with the given support. */
function anthropicEntry(id: string, flags: { adaptive: boolean; enabled: boolean; disabled: boolean; efforts: string[]; image: boolean }) {
  const flag = (supported: boolean) => ({ supported })
  return {
    id,
    display_name: id,
    max_input_tokens: 1_000_000,
    max_tokens: 128_000,
    capabilities: {
      image_input: flag(flags.image),
      thinking: {
        supported: true,
        types: { adaptive: flag(flags.adaptive), enabled: flag(flags.enabled), disabled: flag(flags.disabled) },
      },
      effort: {
        supported: flags.efforts.length > 0,
        ...Object.fromEntries(['low', 'medium', 'high', 'xhigh', 'max'].map(level => [level, flag(flags.efforts.includes(level))])),
      },
    },
  }
}

describe('models outside the installed catalog', () => {
  it('adds the endpoint listing of a catalog route to its catalog when the route has a stored key', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [
      anthropicEntry('claude-opus-5-7', { adaptive: true, enabled: false, disabled: false, efforts: ['low', 'medium', 'high', 'max'], image: true }),
      { id: 'claude-opus-5-5', display_name: 'Listed name' },
    ] }) })
    const ctx = await storedCatalogRoute('anthropic', server.url, 'ANTHROPIC_DISCOVERY_KEY')

    const { models, notice } = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'anthropic', listEndpoint: true })

    expect(notice).toBeUndefined()
    expect(server.headers[0]?.['x-api-key']).toBe('stored-key')
    // The endpoint's order first; a model the catalog knows keeps the catalog's description.
    expect(models.slice(0, 2).map(model => [model.id, model.inCatalog])).toEqual([['claude-opus-5-7', false], ['claude-opus-5-5', true]])
    expect(models.find(model => model.id === 'claude-opus-5-5')?.name).not.toBe('Listed name')
    expect(models.filter(model => model.inCatalog === true).map(model => model.id).sort())
      .toEqual(getBuiltinModels('anthropic').map(model => model.id).sort())
    expect(models[0]).toMatchObject({
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      inputModalities: ['text', 'image'],
      sources: { contextWindow: 'endpoint', maxTokens: 'endpoint', inputModalities: 'endpoint', reasoning: 'endpoint' },
      reasoning: {
        suggested: {
          efforts: ['low', 'medium', 'high', 'max'].map(level => ({ level, value: level })),
          compat: { forceAdaptiveThinking: true },
        },
        standard: { compat: { forceAdaptiveThinking: false } },
      },
    })
  })

  it('reads budget thinking and a disabled Off from Anthropic capabilities', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [
      anthropicEntry('acme-claude', { adaptive: false, enabled: true, disabled: true, efforts: [], image: false }),
      { id: 'acme-plain', capabilities: { thinking: { supported: false } } },
    ] }) })
    const ctx = await harness()

    const { models } = await ctx.llm.discoverModels('llm-pi-ai', {
      baseURL: server.url, api: 'anthropic-messages', apiKey: 'key', listEndpoint: true,
    })

    expect(models[0]).toMatchObject({
      inputModalities: ['text'],
      reasoning: { suggested: {
        efforts: [{ level: 'off', value: null }, ...['low', 'medium', 'high'].map(level => ({ level, value: level }))],
        compat: { forceAdaptiveThinking: false },
      } },
    })
    expect(models[1]?.reasoning?.suggested).toBe(false)
  })

  it.each([
    { name: 'without a stored key', provider: 'anthropic', key: undefined, notice: /signs in without an API key/ },
    { name: 'on a protocol with no readable listing', provider: 'openai-codex', key: 'CODEX_DISCOVERY_KEY', notice: /no model listing/ },
  ])('answers a catalog route $name from its catalog, saying why', async ({ provider, key, notice }) => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'unseen' }] }) })
    const ctx = await storedCatalogRoute(provider, server.url, key)

    const answer = await ctx.llm.discoverModels('llm-pi-ai', { provider, listEndpoint: true })

    expect(answer.notice).toMatch(notice)
    expect(answer.notice).toMatch(/installed catalog only$/)
    expect(answer.models.length).toBeGreaterThan(0)
    expect(answer.models.every(model => model.inCatalog === true)).toBe(true)
    expect(server.paths).toEqual([])
  })

  it('keeps the catalog when the endpoint fails', async () => {
    const server = await listingServer({ status: 500, body: '{}' })
    const ctx = await storedCatalogRoute('anthropic', server.url, 'ANTHROPIC_DISCOVERY_KEY')

    const answer = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'anthropic', listEndpoint: true })

    expect(answer.notice).toMatch(/answered 500; the list shows the installed catalog only/)
    expect(answer.models.length).toBe(getBuiltinModels('anthropic').length)
  })

  it('describes held ids without contacting anyone', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [] }) })
    const ctx = await storedCatalogRoute('anthropic', server.url, 'ANTHROPIC_DISCOVERY_KEY')
    const template = getBuiltinModels('anthropic').find(model => model.id === 'claude-opus-5-5')

    const { models } = await ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'anthropic', describe: ['claude-opus-5-5-20261201', 'acme-house-model', 'claude-opus-5-5', 'claude-opus-5-7'],
    })
    // A later point release belongs with the nearest earlier one, not with the family's first release.
    expect(models.find(model => model.id === 'claude-opus-5-7')?.template).toBe('claude-opus-5-5')

    expect(server.paths).toEqual([])
    const dated = models.find(model => model.id === 'claude-opus-5-5-20261201')
    expect(dated).toMatchObject({
      inCatalog: false,
      template: 'claude-opus-5-5',
      contextWindow: template?.contextWindow,
      maxTokens: template?.maxTokens,
      sources: { contextWindow: 'template', maxTokens: 'template', inputModalities: 'template', reasoning: 'template' },
      reasoning: { suggested: { compat: { forceAdaptiveThinking: true } } },
    })
    // Nothing names the house model's family, so only the protocol's ordinary levels are offered.
    expect(models.find(model => model.id === 'acme-house-model')).toEqual({
      id: 'acme-house-model',
      inCatalog: false,
      reasoning: { standard: {
        efforts: [{ level: 'off', value: null }, ...['low', 'medium', 'high'].map(level => ({ level, value: level }))],
        compat: { forceAdaptiveThinking: false },
      } },
    })
    expect(models.filter(model => model.id === 'claude-opus-5-5')).toEqual([expect.objectContaining({ inCatalog: true })])
  })

  it('describes the held ids of a hand-declared route by the protocol it names', async () => {
    const ctx = await harness()

    const { models } = await ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'acme-gateway', api: 'google-generative-ai', describe: ['gemini-3.9-flash'],
    })

    expect(models).toEqual([expect.objectContaining({
      id: 'gemini-3.9-flash',
      inCatalog: false,
      template: 'gemini-3.8-flash',
      reasoning: {
        suggested: { efforts: ['low', 'medium', 'high'].map(level => ({ level, value: level })) },
        standard: { efforts: ['minimal', 'low', 'medium', 'high'].map(level => ({ level, value: level })) },
      },
    })])
  })

  it('takes a Gemini thinking flag from the endpoint and the levels from the matched model', async () => {
    const server = await listingServer({ body: JSON.stringify({ models: [
      { name: 'models/gemini-3.9-flash', inputTokenLimit: 2_000_000, thinking: true, supportedGenerationMethods: ['generateContent'] },
      { name: 'models/house-thinker', thinking: true },
      { name: 'models/gemini-3.9-flash-tts', thinking: false },
    ] }) })
    const ctx = await harness()

    const { models } = await ctx.llm.discoverModels('llm-pi-ai', {
      baseURL: server.url, api: 'google-generative-ai', apiKey: 'key', listEndpoint: true,
    })

    const template = getBuiltinModels('google').find(model => model.id === 'gemini-3.8-flash')
    expect(models[0]).toMatchObject({
      contextWindow: 2_000_000,
      maxTokens: template?.maxTokens,
      template: 'gemini-3.8-flash',
      sources: { contextWindow: 'endpoint', maxTokens: 'template', reasoning: 'endpoint' },
      reasoning: { suggested: { efforts: ['low', 'medium', 'high'].map(level => ({ level, value: level })) } },
    })
    // A thinking model nothing else describes gets the protocol's ordinary levels.
    expect(models[1]?.reasoning?.suggested).toEqual(models[1]?.reasoning?.standard)
    expect(models[2]?.reasoning?.suggested).toBe(false)
  })

  it('reads reasoning efforts and input modalities in the OpenRouter shape', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [
      {
        id: 'acme/thinker',
        architecture: { input_modalities: ['text', 'image'] },
        supported_parameters: ['reasoning', 'max_tokens'],
        reasoning: { supported_efforts: ['low', 'high', 'turbo'], mandatory: false },
      },
      { id: 'acme/always-thinks', supported_parameters: ['reasoning'], reasoning: { supported_efforts: ['medium'], mandatory: true } },
      { id: 'acme/plain', architecture: { input_modalities: ['text'] }, supported_parameters: ['max_tokens'] },
    ] }) })
    const ctx = await harness()

    const { models } = await ctx.llm.discoverModels('llm-pi-ai', { baseURL: server.url, listEndpoint: true })

    expect(models[0]).toMatchObject({
      inputModalities: ['text', 'image'],
      sources: { inputModalities: 'endpoint', reasoning: 'endpoint' },
      // An effort pi-ai does not send is left out.
      reasoning: { suggested: { efforts: [{ level: 'off', value: null }, { level: 'low', value: 'low' }, { level: 'high', value: 'high' }] } },
    })
    expect(models[1]?.reasoning?.suggested).toEqual({ efforts: [{ level: 'medium', value: 'medium' }] })
    expect(models[2]).toMatchObject({ inputModalities: ['text'], reasoning: { suggested: false } })
  })
})

describe('draft-provider model discovery', () => {
  it('reads an OpenAI-compatible listing and keeps the capacities it discloses', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          { id: 'acme-large', display_name: 'Acme Large', context_length: 65_536, max_output_tokens: 4096 },
          { id: 'acme-camel', displayName: 'Acme Camel', contextWindow: 131_072, maxOutputTokens: 8192 },
          { id: 'acme-mixed', name: 'Acme Mixed', context_window: 32_768, maxTokens: 2048 },
          { id: 'acme-legacy', max_tokens: 1024 },
          { id: 'acme-small' },
        ],
      }),
    })
    const ctx = await harness()

    const models = await discover(ctx, 'llm-pi-ai', { baseURL: `${server.url}/v1`, apiKey: 'probe-key' })

    expect(models).toEqual([
      { id: 'acme-large', name: 'Acme Large', contextWindow: 65_536, maxTokens: 4096 },
      { id: 'acme-camel', name: 'Acme Camel', contextWindow: 131_072, maxTokens: 8192 },
      { id: 'acme-mixed', name: 'Acme Mixed', contextWindow: 32_768, maxTokens: 2048 },
      { id: 'acme-legacy', name: 'acme-legacy', maxTokens: 1024 },
      { id: 'acme-small', name: 'acme-small' },
    ])
    expect(server.paths).toEqual(['/v1/models'])
    expect(server.headers[0]?.authorization).toBe('Bearer probe-key')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('reads an enriched models map using route ids and nested capacities', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        models: {
          'lobechat-deepseek-chat': {
            id: 'deepseek/deepseek-v4-flash',
            name: 'DeepSeek V4 Flash',
            limit: { context: 1_048_576, output: 384_000 },
          },
          'bare-route': {},
          '': { id: 'nested-id', display_name: 'Nested fallback' },
          'malformed-route': null,
          'primitive-route': 'not a model record',
        },
      }),
    })
    const ctx = await harness()

    expect(await discover(ctx, 'llm-pi-ai', { baseURL: server.url })).toEqual([
      {
        id: 'lobechat-deepseek-chat',
        name: 'DeepSeek V4 Flash',
        contextWindow: 1_048_576,
        maxTokens: 384_000,
      },
      { id: 'bare-route', name: 'bare-route' },
      { id: 'nested-id', name: 'Nested fallback' },
    ])
  })

  it('uses Anthropic model-listing paths, headers, and capacity fields', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          {
            id: 'claude-sonnet',
            display_name: 'Claude Sonnet',
            max_input_tokens: 200_000,
            max_tokens: 64_000,
          },
        ],
      }),
    })
    const ctx = await harness()

    const rootModels = await discover(ctx, 'llm-pi-ai', {
      baseURL: server.url,
      api: 'anthropic-messages',
      apiKey: 'anthropic-key',
    })
    const versionedModels = await discover(ctx, 'llm-pi-ai', {
      baseURL: `${server.url}/v1`,
      api: 'anthropic-messages',
      apiKey: 'anthropic-key',
    })
    await discover(ctx, 'llm-pi-ai', {
      baseURL: server.url,
      api: 'anthropic-messages',
    })

    expect(rootModels).toEqual([
      { id: 'claude-sonnet', name: 'Claude Sonnet', contextWindow: 200_000, maxTokens: 64_000 },
    ])
    expect(versionedModels).toEqual(rootModels)
    expect(server.paths).toEqual([
      '/v1/models?limit=1000',
      '/v1/models?limit=1000',
      '/v1/models?limit=1000',
    ])
    expect(server.headers.map(headers => headers['x-api-key']))
      .toEqual(['anthropic-key', 'anthropic-key', undefined])
    expect(server.headers.map(headers => headers['anthropic-version']))
      .toEqual(['2023-06-01', '2023-06-01', '2023-06-01'])
    expect(server.headers.map(headers => headers.authorization)).toEqual([undefined, undefined, undefined])
    expect(server.headers.map(headers => headers['user-agent'])).toEqual([userAgent(), userAgent(), userAgent()])
  })

  it('uses the Gemini model-listing path, header, and fields', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        models: [
          {
            name: 'models/gemini-pro',
            displayName: 'Gemini Pro',
            inputTokenLimit: 1_048_576,
            outputTokenLimit: 65_536,
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          { name: 'models/text-embedding', supportedGenerationMethods: ['embedContent'] },
          { name: 'gateway-alias' },
          { name: 'models/' },
          { displayName: 'nameless' },
        ],
        nextPageToken: 'ignored',
      }),
    })
    const ctx = await harness()

    const models = await discover(ctx, 'llm-pi-ai', {
      baseURL: `${server.url}/v1beta/`,
      api: 'google-generative-ai',
      apiKey: 'gemini-key',
    })

    expect(models).toEqual([
      { id: 'gemini-pro', name: 'Gemini Pro', contextWindow: 1_048_576, maxTokens: 65_536 },
      { id: 'gateway-alias', name: 'gateway-alias' },
    ])
    expect(server.paths).toEqual(['/v1beta/models?pageSize=1000'])
    expect(server.headers[0]?.['x-goog-api-key']).toBe('gemini-key')
    expect(server.headers[0]?.authorization).toBeUndefined()
  })

  it('leaves a Gemini probe with no key unauthenticated, and rejects a reply with no models array', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = await harness()

    const failure = discover(ctx, 'llm-pi-ai', { baseURL: server.url, api: 'google-generative-ai' })
    await expect(failure).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
    await expect(failure).rejects.toThrow(/no "models" array/)
    expect(server.headers[0]?.['x-goog-api-key']).toBeUndefined()
  })

  it('prefers the standard data array when both supported formats are present', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [{ id: 'standard' }],
        models: { enriched: { name: 'Enriched' } },
      }),
    })
    const ctx = await harness()

    await expect(discover(ctx, 'llm-pi-ai', { baseURL: server.url }))
      .resolves.toEqual([{ id: 'standard', name: 'standard' }])
  })

  it('keeps a deployment path instead of resolving it away', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = await harness()

    await discover(ctx, 'llm-pi-ai', { baseURL: `${server.url}/openai/v1/` })

    expect(server.paths).toEqual(['/openai/v1/models'])
  })

  it('offers no credential when the draft names none', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = await harness()

    await discover(ctx, 'llm-pi-ai', { baseURL: server.url })

    expect(server.headers[0]?.authorization).toBeUndefined()
  })

  it('authenticates configured routes the draft cannot supply a key for', async () => {
    // What the Models page actually sends after a key is saved: the form holds
    // the redacted descriptor, so the draft names the route and the endpoint
    // and no credential at all. Interrogating unauthenticated would answer 401
    // and read as a wrong key.
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    process.env['ACME_GATEWAY_KEY'] = 'stored-key'
    touchedEnv.push('ACME_GATEWAY_KEY')
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'ACME_GATEWAY_KEY',
          api: 'openai-completions',
          baseURL: server.url,
          headers: { 'X-Company-Code': 'private-tenant' },
          models: [{ id: 'acme-large' }],
        },
        'plain-gateway': {
          apiKeyEnv: 'ACME_GATEWAY_KEY',
          api: 'openai-completions',
          baseURL: server.url,
          models: [{ id: 'plain-large' }],
        },
      },
    })

    await discover(ctx, 'llm-pi-ai', { provider: 'acme-gateway', baseURL: server.url })
    // A key typed into the form is the one being tested — possibly the
    // replacement for the stored one — so it wins without resolving the
    // missing stored credential, while the route's headers still apply.
    Reflect.deleteProperty(process.env, 'ACME_GATEWAY_KEY')
    await discover(ctx, 'llm-pi-ai', { provider: 'acme-gateway', baseURL: server.url, apiKey: 'typed' })
    // A route no profile declares yet is the create case: nothing is stored.
    await discover(ctx, 'llm-pi-ai', { provider: 'not-declared-yet', baseURL: server.url })
    // A configured route without deployment headers still contributes its
    // stored credential without inventing a header map.
    await discover(ctx, 'llm-pi-ai', { provider: 'plain-gateway', baseURL: server.url, apiKey: 'plain-typed' })

    expect(server.headers.map(headers => headers.authorization))
      .toEqual(['Bearer stored-key', 'Bearer typed', undefined, 'Bearer plain-typed'])
    expect(server.headers.map(headers => headers['x-company-code']))
      .toEqual(['private-tenant', 'private-tenant', undefined, undefined])
  })

  it('leaves a catalog route\'s credential unresolved, having never reached the network', async () => {
    // The catalog answers before any endpoint is asked, so a route whose
    // profile names a credential that is not set must still answer rather than
    // failing over a key the interrogation never needed.
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    Reflect.deleteProperty(process.env, 'ABSENT_FOR_DISCOVERY')
    await ctx.plugin(LlmPiAi, { providers: { deepseek: { apiKeyEnv: 'ABSENT_FOR_DISCOVERY' } } })

    await expect(discover(ctx, 'llm-pi-ai', { provider: 'deepseek' })).resolves.not.toHaveLength(0)
  })

  it('drops unusable rows rather than failing the whole listing', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          { id: 'good' },
          { id: '' },
          { name: 'no id at all' },
          null,
          { id: 'good' },
          { id: 'zero-capacity', context_length: 0, max_tokens: -1 },
        ],
      }),
    })
    const ctx = await harness()

    expect(await discover(ctx, 'llm-pi-ai', { baseURL: server.url }))
      .toEqual([{ id: 'good', name: 'good' }, { id: 'zero-capacity', name: 'zero-capacity' }])
  })

  it('points at the credential for a rejected one, and only then', async () => {
    const ctx = await harness()

    for (const status of [401, 403]) {
      const refused = await listingServer({ status, body: '{"error":"nope"}' })
      await expect(discover(ctx, 'llm-pi-ai', { baseURL: refused.url, apiKey: 'wrong' }))
        .rejects.toThrow(new RegExp(`answered ${status}; check the API key`))
    }

    // A server fault is not a credential problem, so it must not send the user
    // off to re-check a key that is fine.
    const broken = await listingServer({ status: 500, body: '{"error":"boom"}' })
    await expect(discover(ctx, 'llm-pi-ai', { baseURL: broken.url, apiKey: 'fine' }))
      .rejects.toThrow(/answered 500$/)
  })

  it('reports a reply that is not a model listing', async () => {
    const server = await listingServer({ body: '{"models":[]}' })
    const ctx = await harness()

    await expect(discover(ctx, 'llm-pi-ai', { baseURL: server.url }))
      .rejects.toThrow(/neither a "data" array nor a "models" object/)

    const broken = await listingServer({ body: 'not json at all' })
    await expect(discover(ctx, 'llm-pi-ai', { baseURL: broken.url }))
      .rejects.toThrow(/did not answer with JSON/)
  })

  it('refuses an oversized reply, whether its length is declared or streamed', async () => {
    const ctx = await harness()
    // Just over the four-megabyte ceiling, as one padded model row.
    const oversized = `{"data":[{"id":"m","pad":"${'x'.repeat(4 * 1024 * 1024)}"}]}`

    const declared = await listingServer({ body: oversized })
    await expect(discover(ctx, 'llm-pi-ai', { baseURL: declared.url }))
      .rejects.toThrow(/answered with more than 4194304 bytes/)

    // A streamed reply declares no length, so the ceiling has to hold on the
    // body the harness actually read.
    const streamed = await listingServer({ chunks: ['{"data":[{"id":"m","pad":"', 'x'.repeat(4 * 1024 * 1024), '"}]}'] })
    await expect(discover(ctx, 'llm-pi-ai', { baseURL: streamed.url }))
      .rejects.toThrow(/answered with more than 4194304 bytes/)
  })

  it('reports an unreachable endpoint instead of an empty catalog', async () => {
    const ctx = await harness()
    // Port 9 is the discard service: nothing accepts a connection there.
    await expect(discover(ctx, 'llm-pi-ai', { baseURL: 'http://127.0.0.1:9/v1' }))
      .rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
  })

  it.each(['azure-openai-responses', 'openai-codex-responses'])(
    'says it cannot interrogate %s rather than guessing a shape',
    async (api) => {
      // Azure authenticates with an `api-key` header and an `api-version`
      // query despite its OpenAI lineage, and Codex uses OAuth; guessing at
      // either would report an auth failure as a provider with no models.
      const ctx = await harness()
      await expect(discover(ctx, 'llm-pi-ai', { baseURL: 'https://gateway.example/v1', api }))
        .rejects.toMatchObject({ code: 'DISCOVERY_UNSUPPORTED' })
    },
  )

  it('reports cancellation during the body read as an abort, not a raw reason', async () => {
    const ctx = await harness()
    const controller = new AbortController()
    const bodyRead = Promise.withResolvers<undefined>()
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('expected a discovery signal')
      return new Response(new ReadableStream<Uint8Array>({
        pull(stream) {
          bodyRead.resolve(undefined)
          return new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              stream.error(signal.reason)
              resolve()
            }, { once: true })
          })
        },
      }))
    })
    const probe = discover(ctx, 'llm-pi-ai', {
      baseURL: 'https://slow.example/v1',
    }, controller.signal)
    await bodyRead.promise
    controller.abort('test cancellation')

    await expect(probe).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('honors caller cancellation', async () => {
    const ctx = await harness()
    const aborted = AbortSignal.abort('test cancellation')
    await expect(discover(ctx, 'llm-pi-ai', {
      baseURL: 'http://127.0.0.1:9/v1',
    }, aborted)).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('is offered for the namespace, and refuses one it does not serve', async () => {
    const ctx = await harness()

    await expect(discover(ctx, 'llm-pi-ai', { provider: 'openai' })).resolves.not.toHaveLength(0)
    await expect(discover(ctx, 'llm-deepseek', { baseURL: 'https://api.deepseek.com' }))
      .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
    await expect(discover(ctx, 'llm-pi-ai', { baseURL: '' }))
      .rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })
  })

  it('withdraws the offer when the plugin unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(LlmPiAi, {})
    await expect(discover(ctx, 'llm-pi-ai', { provider: 'openai' })).resolves.not.toHaveLength(0)

    await fiber.dispose()

    await expect(discover(ctx, 'llm-pi-ai', { provider: 'openai' }))
      .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
  })
})

describe('stored credentials and their endpoint', () => {
  /** A hand-declared route whose saved key and headers belong to `baseURL`. */
  async function storedGateway(baseURL: string, apiKeyEnv: string | null = 'GATEWAY_LISTING_KEY'): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    if (apiKeyEnv !== null) {
      process.env[apiKeyEnv] = 'stored-key'
      touchedEnv.push(apiKeyEnv)
    }
    await ctx.plugin(LlmPiAi, { providers: { 'acme-gateway': {
      ...apiKeyEnv === null ? {} : { apiKeyEnv },
      api: 'openai-completions', baseURL, headers: { 'X-Tenant': 'private' }, models: [{ id: 'm' }],
    } } })
    return ctx
  }

  const ask = (ctx: Context, baseURL: string, apiKey?: string) => ctx.llm.discoverModels('llm-pi-ai', {
    provider: 'acme-gateway', baseURL, api: 'openai-completions', listEndpoint: true, ...apiKey === undefined ? {} : { apiKey },
  })

  it('sends the saved key and headers to the endpoint they were saved for, however it is spelled', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = await storedGateway(`${server.url}/v1`)

    await ask(ctx, `${server.url.replace('127.0.0.1', '127.0.0.1')}/v1/`)

    expect(server.headers[0]?.authorization).toBe('Bearer stored-key')
    expect(server.headers[0]?.['x-tenant']).toBe('private')
  })

  it.each([
    { name: 'another host', draft: (url: string) => url.replace('127.0.0.1', 'localhost') },
    { name: 'another port', draft: (url: string) => url.replace(/:(\d+)$/u, (_match, port: string) => `:${String(Number(port) + 1)}`) },
    { name: 'another scheme', draft: (url: string) => url.replace('http:', 'https:') },
    { name: 'another path', draft: (url: string) => `${url}/other` },
  ])('refuses to send the saved key to $name until a key is typed', async ({ draft }) => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = await storedGateway(server.url)

    await expect(ask(ctx, draft(server.url))).rejects.toThrow(/saved API key is sent only to .*type the API key into the form/u)
    expect(server.paths).toEqual([])
  })

  it('uses a typed key as typed at any endpoint, without the saved headers elsewhere', async () => {
    const saved = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const other = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = await storedGateway(saved.url)

    await ask(ctx, other.url, 'typed-key')
    await ask(ctx, saved.url, 'typed-key')

    expect(other.headers[0]?.authorization).toBe('Bearer typed-key')
    expect(other.headers[0]?.['x-tenant']).toBeUndefined()
    expect(saved.headers[0]?.authorization).toBe('Bearer typed-key')
    expect(saved.headers[0]?.['x-tenant']).toBe('private')
  })

  it('asks another endpoint of a keyless route without its saved headers', async () => {
    const other = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = await storedGateway('https://gateway.invalid/v1', null)

    await ask(ctx, other.url)

    expect(other.headers[0]?.authorization).toBeUndefined()
    expect(other.headers[0]?.['x-tenant']).toBeUndefined()
  })

  it('keeps a catalog route without a saved endpoint to its own endpoint', async () => {
    const other = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    process.env['ANTHROPIC_LISTING_KEY'] = 'stored-key'
    touchedEnv.push('ANTHROPIC_LISTING_KEY')
    await ctx.plugin(LlmPiAi, { providers: { anthropic: { apiKeyEnv: 'ANTHROPIC_LISTING_KEY' } } })

    const answer = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'anthropic', baseURL: other.url, listEndpoint: true })

    expect(answer.notice).toMatch(/saved API key is sent only to https:\/\/api\.anthropic\.com/u)
    expect(other.paths).toEqual([])
  })
})

describe('probe key format', () => {
  it('reports an illegal probe key as a credential fault, not an unreachable endpoint', async () => {
    await expect(discoverModels({
      listEndpoint: true,
      baseURL: 'https://acme.test',
      api: 'openai-completions',
      apiKey: 'sk-\u{1F600}',
    })).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it('reports a blank probe key as a credential fault too', async () => {
    // The Models page omits `apiKey` entirely for a cleared field rather than
    // sending '', so this pins the contract for every other caller: a supplied
    // key is judged, and only an absent one probes unauthenticated. '' means
    // "I have a key" and is answered as the empty key it is.
    await expect(discoverModels({
      listEndpoint: true,
      baseURL: 'https://acme.test',
      api: 'openai-completions',
      apiKey: '',
    })).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it('leaves a probe with no key unauthenticated', async () => {
    // The file's other cases capture headers through a real local HTTP server
    // (`listingServer`); this one has no route or stored key to resolve, so
    // the smallest real double is a `fetch` stub, scoped to this test and
    // unstubbed by the shared `afterEach` above.
    const requests: RequestInit[] = []
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      requests.push(init ?? {})
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    await discoverModels({ listEndpoint: true, baseURL: 'https://acme.test', api: 'openai-completions' })

    const headers = new Headers(requests[0]?.headers)
    expect(headers.has('authorization')).toBe(false)
  })
})

/**
 * Replies recorded from live endpoints on 2026-09-02, plus the reply
 * Anthropic's List Models reference documents. Each file keeps the reply's
 * top-level fields and entry objects verbatim; only a recorded entry list is
 * cut down to the named entries so the archive stays small.
 */
const RECORDED_LISTINGS = [
  {
    name: 'OpenRouter GET /api/v1/models',
    file: 'openrouter-2026-09-02.json',
    api: 'openai-completions',
    models: [
      { id: 'anthropic/claude-fable-5.1', name: 'Anthropic: Claude Fable 5.1', contextWindow: 1_000_000, maxTokens: 128_000 },
      // The router's own aggregate route reports no completion cap.
      { id: 'openrouter/auto-beta', name: 'Auto Router (Beta)', contextWindow: 2_000_000 },
      { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek: DeepSeek V4 Flash 0423', contextWindow: 1_048_576, maxTokens: 384_000 },
    ],
  },
  {
    name: 'the models.dev anthropic provider object',
    file: 'models-dev-anthropic-2026-09-02.json',
    api: 'openai-completions',
    models: [
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', contextWindow: 1_000_000, maxTokens: 128_000 },
      { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', contextWindow: 1_000_000, maxTokens: 128_000 },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (latest)', contextWindow: 200_000, maxTokens: 64_000 },
    ],
  },
  {
    name: 'DeepSeek GET /models',
    file: 'deepseek-2026-09-02.json',
    api: 'openai-completions',
    models: [
      { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
      { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
      { id: 'deepseek-v4-flash-vision-exp', name: 'deepseek-v4-flash-vision-exp' },
    ],
  },
  {
    name: "Anthropic's documented GET /v1/models example",
    file: 'anthropic-reference-example.json',
    api: 'anthropic-messages',
    // The reference example fills both capacities with 0, which is not a
    // usable capacity, so the row carries the name alone.
    models: [{ id: 'claude-opus-5', name: 'Claude Opus 5' }],
  },
]

describe('recorded provider listings', () => {
  it.each(RECORDED_LISTINGS)('reads $name as recorded', async ({ file, api, models }) => {
    const body = await readFile(new URL(`./fixtures/model-listings/${file}`, import.meta.url), 'utf8')
    const server = await listingServer({ body })
    const ctx = await harness()

    await expect(discover(ctx, 'llm-pi-ai', { baseURL: server.url, api })).resolves.toEqual(models)
  })
})
