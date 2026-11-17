/**
 * Answering "which models can this provider serve?" for the configuration
 * surface: describing a route when its editor opens, and its "fetch available
 * models" action.
 *
 * Nothing reaches the network unless the request asks for the endpoint. A
 * route the installed pi-ai catalog ships is then answered from that catalog
 * plus its endpoint's listing, so a model newer than the installed catalog
 * shows up; without a stored key, or on a protocol with no readable listing,
 * or when the endpoint fails, the catalog alone answers with a notice saying
 * why. A route the catalog does not describe — a gateway, a self-hosted
 * server — is answered by its endpoint alone, and its failures are errors.
 * Every model outside the route's catalog is described by
 * {@link describeOutsideCatalog}: the endpoint's own facts first, the matched
 * catalog model's for the rest.
 *
 * Neither path is a catalog refresh. Nothing here is stored: the request
 * carries a draft the user is still editing, and the reply is candidate
 * metadata the surface offers for adoption. `cordis.patch.yml` remains the only
 * thing that decides what a route serves.
 *
 * OpenAI-compatible, Anthropic Messages, and Gemini protocols are interrogated
 * through their native model-listing endpoints. The OpenAI and Anthropic parser
 * accepts the standard `data` array and the enriched `models` map some
 * compatible gateways expose; Gemini replies with its own `models` array.
 * Every other protocol reports that it cannot be interrogated so the surface
 * falls back to hand-entry rather than guessing its response fields.
 *
 * @module dsh-llm-pi-ai/discovery
 */

import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type {
  LlmDiscoveredEffort, LlmDiscoveredModel, LlmModelDiscovery, LlmModelDiscoveryOperation, ModelModality,
} from '@deepseek-ai/dsh-llm'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { Api, Model } from '@earendil-works/pi-ai'
import { catalogModels, catalogProvider, sharedCatalogApi } from './catalog.ts'
import { describeOutsideCatalog } from './model-description.ts'
import type { ListedModel, ReportedReasoning } from './model-description.ts'

/**
 * Protocols whose model listing this module can read. OpenAI protocols use
 * bearer auth at `GET {baseURL}/models`; Anthropic Messages uses `x-api-key`
 * and `anthropic-version` at its native `GET /v1/models`; Gemini uses
 * `x-goog-api-key` at `GET {baseURL}/models`. Azure is absent
 * despite its OpenAI lineage — it authenticates with an `api-key` header and
 * requires an `api-version` query — and Codex authenticates through OAuth;
 * guessing at either would report an authentication failure as a provider
 * with no models. pi-ai's remaining protocols are absent for the same reason.
 * The route protocol table in `provider.ts` may name a protocol absent here;
 * discovery reports it as unsupported.
 */
const LISTABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  'anthropic-messages',
  'google-generative-ai',
  'openai-completions',
  'openai-responses',
])

/** Stable API version required by Anthropic's model-listing endpoint. */
const ANTHROPIC_VERSION = '2023-06-01'

/** Largest model-list page accepted by Anthropic's public endpoint; discovery reads one page and does not follow `has_more`. */
const ANTHROPIC_MODEL_LIMIT = 1000

/** Largest model-list page accepted by the Gemini API; discovery reads one page and does not follow `nextPageToken`. */
const GEMINI_MODEL_LIMIT = 1000

/**
 * Endpoint replies larger than this are refused. The endpoint is whatever URL
 * the user typed, so the ceiling holds on the bytes actually read rather than
 * on the length the server claims — the same two-stage shape `dsh-web-fetch`
 * uses for its own caller-supplied URLs, except that a truncated model listing
 * is not parseable, so overflow rejects instead of truncating.
 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** Capacity fields nested by enriched model-directory replies. */
interface ListingLimit {
  context?: unknown
  output?: unknown
}

/** Per-route capacities OpenRouter nests under each entry. */
interface ListingTopProvider {
  max_completion_tokens?: unknown
}

/** One `{ supported }` flag of Anthropic's `capabilities` object. */
interface CapabilitySupport {
  supported?: unknown
}

/**
 * The parts of Anthropic's `ModelInfo.capabilities` that describe input and
 * reasoning, per the List Models reference
 * (https://platform.claude.com/docs/en/api/models/list): `image_input`,
 * `thinking.supported` with `thinking.types.{adaptive,enabled,disabled}`, and
 * `effort.supported` with one flag per effort level.
 */
interface AnthropicCapabilities {
  image_input?: CapabilitySupport | null
  thinking?: (CapabilitySupport & { types?: Record<string, CapabilitySupport | null | undefined> | null }) | null
  effort?: (CapabilitySupport & Record<string, unknown>) | null
}

/**
 * OpenRouter's model fields that describe input and reasoning, per its Models
 * API reference (https://openrouter.ai/docs/api/api-reference/models/get-models):
 * `architecture.input_modalities`, `supported_parameters`, and a `reasoning`
 * object carrying `supported_efforts`, omitted for a model that does not reason.
 */
interface OpenRouterFields {
  architecture?: { input_modalities?: unknown } | null
  supported_parameters?: unknown
  reasoning?: { supported_efforts?: unknown; mandatory?: unknown } | null
}

/** One entry of a supported `GET /models` reply. */
interface ListingEntry {
  id?: unknown
  /** Common gateway extensions; absent from the official listings. */
  name?: unknown
  display_name?: unknown
  displayName?: unknown
  contextWindow?: unknown
  context_window?: unknown
  context_length?: unknown
  max_input_tokens?: unknown
  maxOutputTokens?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
  maxTokens?: unknown
  limit?: ListingLimit | null
  top_provider?: ListingTopProvider | null
  capabilities?: AnthropicCapabilities | null
  architecture?: OpenRouterFields['architecture']
  supported_parameters?: OpenRouterFields['supported_parameters']
  reasoning?: OpenRouterFields['reasoning']
}

/** A positive integer field of a listing entry, or `undefined` when absent or unusable. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** A non-empty string field of a listing entry, or `undefined`. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Join the endpoint base with the protocol's listing path. The base is
 * treated as a prefix rather than a URL to resolve against, so a deployment
 * path such as `https://gateway.example/openai/v1` keeps its segments instead
 * of losing them to `URL` resolution. OpenAI protocols list at
 * `{baseURL}/models`, and Gemini at `{baseURL}/models` with a page size,
 * because its `baseURL` already carries the API version. Anthropic lists at
 * `{root}/v1/models`, where the root is the base without trailing slashes and
 * without one trailing `/v1` segment: gateway documentation publishes both
 * spellings of the same root. Only this listing URL normalizes that segment;
 * model requests receive the configured `baseURL` unchanged.
 */
function listingUrl(baseURL: string, api: string): string {
  const base = baseURL.replace(/\/+$/, '')
  if (api === 'google-generative-ai') return `${base}/models?pageSize=${String(GEMINI_MODEL_LIMIT)}`
  if (api !== 'anthropic-messages') return `${base}/models`
  const root = base.endsWith('/v1') ? base.slice(0, -3) : base
  return `${root}/v1/models?limit=${String(ANTHROPIC_MODEL_LIMIT)}`
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares (or streams) tells us nothing up front.
 */
async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): LlmError =>
    new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    /* v8 ignore next 4 -- cancel() after a completed or abandoned read settles without rejecting; unobserved best-effort cleanup. */
    await reader.cancel().catch(() => {
      // Cancel after a drained read, or after this function walked away from
      // an oversized one, is cleanup; the reply is already decided either way.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/** A capability flag's value, or `undefined` when the listing does not state it. */
function supported(flag: CapabilitySupport | null | undefined): boolean | undefined {
  return typeof flag?.supported === 'boolean' ? flag.supported : undefined
}

/** One proposal level per name, each sent under its own name. */
function namedLevels(levels: readonly string[]): LlmDiscoveredEffort[] {
  return levels.map(level => ({ level, value: level }))
}

/** Anthropic's effort levels, in pi-ai's escalation order. */
const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * What Anthropic's capabilities say about reasoning. A model that accepts
 * adaptive thinking with effort is offered the effort levels it supports, as
 * pi-ai's adaptive path sends them; one that takes only budgets is offered the
 * budget levels. Off is offered only where thinking can be disabled.
 * @param capabilities - the entry's `capabilities` object.
 * @returns the reported reasoning, or `undefined` when the entry states none.
 */
function anthropicReasoning(capabilities: AnthropicCapabilities | null | undefined): ReportedReasoning | undefined {
  const thinking = capabilities?.thinking
  const thinks = supported(thinking)
  if (thinks === undefined) return undefined
  if (!thinks) return false
  const types = thinking?.types ?? undefined
  const off: LlmDiscoveredEffort[] = supported(types?.['disabled']) === true ? [{ level: 'off', value: null }] : []
  const effort = capabilities?.effort
  if (supported(types?.['adaptive']) === true && supported(effort) === true) {
    const levels = ANTHROPIC_EFFORTS.filter(level => supported(effort?.[level] as CapabilitySupport | undefined) === true)
    if (levels.length > 0) return { efforts: [...off, ...namedLevels(levels)], compat: { forceAdaptiveThinking: true } }
  }
  if (supported(types?.['enabled']) === true) {
    return { efforts: [...off, ...namedLevels(['low', 'medium', 'high'])], compat: { forceAdaptiveThinking: false } }
  }
  return true
}

/**
 * What OpenRouter's fields say about reasoning: the `reasoning` object's
 * `supported_efforts` when it lists them, with Off unless reasoning is
 * mandatory. A model without that object does not reason; an entry carrying
 * `supported_parameters` is in OpenRouter's shape, so its absence is a statement.
 * @param entry - one listing entry.
 * @returns the reported reasoning, or `undefined` when the entry is not in OpenRouter's shape.
 */
function openRouterReasoning(entry: ListingEntry | null): ReportedReasoning | undefined {
  const reasoning = entry?.reasoning
  if (reasoning !== null && typeof reasoning === 'object') {
    const efforts = Array.isArray(reasoning.supported_efforts)
      ? (reasoning.supported_efforts as readonly unknown[]).filter((level): level is string => typeof level === 'string')
      : []
    if (efforts.length === 0) return true
    const off: LlmDiscoveredEffort[] = reasoning.mandatory === true ? [] : [{ level: 'off', value: null }]
    return { efforts: [...off, ...namedLevels(efforts)] }
  }
  return Array.isArray(entry?.supported_parameters) ? false : undefined
}

/**
 * The input types a listing entry reports: Anthropic's `image_input` flag, or
 * OpenRouter's `architecture.input_modalities`. OpenAI's own listing reports
 * neither, nor any capacity or reasoning field: `id`, `object`, `created`, and
 * `owned_by` are all it carries (https://platform.openai.com/docs/api-reference/models/list).
 * @param entry - one listing entry.
 * @returns the reported input types, or `undefined`.
 */
function listedInput(entry: ListingEntry | null): ModelModality[] | undefined {
  const image = supported(entry?.capabilities?.image_input)
  if (image !== undefined) return image ? ['text', 'image'] : ['text']
  const modalities = entry?.architecture?.input_modalities
  if (!Array.isArray(modalities) || !modalities.includes('text')) return undefined
  return modalities.includes('image') ? ['text', 'image'] : ['text']
}

/**
 * Read one supported model-listing reply. The standard `data` array takes
 * precedence when both supported formats are present. An enriched `models`
 * map uses each property key as the endpoint-facing id; its nested `id` is
 * only a fallback for an empty key because gateways may put a canonical model
 * identity there instead of the alias they accept on requests. Only
 * object-valued map entries are models; primitive properties are ignored
 * because they may be directory metadata rather than model records.
 *
 * Entries without a usable id are skipped rather than failing the whole
 * interrogation: a single malformed row should not deny the user the rest of
 * a working endpoint's catalog. Missing names fall back to the adopted id so
 * the Web form receives a complete human-readable row.
 */
function readListing(body: unknown): ListedModel[] {
  const listing = body as { data?: unknown; models?: unknown } | null
  const data = listing?.data
  let listed: { readonly key?: string; readonly raw: unknown }[]
  if (Array.isArray(data)) {
    const rows = data as readonly unknown[]
    listed = rows.map(raw => ({ raw }))
  } else {
    const models = listing?.models
    if (models === null || typeof models !== 'object' || Array.isArray(models)) {
      throw new LlmError(
        'the endpoint\'s model listing has neither a "data" array nor a "models" object; '
        + 'enter this provider\'s models by hand',
        'DISCOVERY_FAILED',
      )
    }
    listed = Object.entries(models as Record<string, unknown>)
      .filter(([, raw]) => raw !== null && typeof raw === 'object' && !Array.isArray(raw))
      .map(([key, raw]) => ({ key, raw }))
  }
  const models: ListedModel[] = []
  for (const { key, raw } of listed) {
    const entry = raw as ListingEntry | null
    const id = label(key, entry?.id)
    if (id === undefined) continue
    const name = label(entry?.name, entry?.display_name, entry?.displayName) ?? id
    const contextWindow = capacity(
      entry?.contextWindow,
      entry?.context_window,
      entry?.context_length,
      entry?.max_input_tokens,
      entry?.limit?.context,
    )
    const maxTokens = capacity(
      entry?.maxOutputTokens,
      entry?.max_output_tokens,
      entry?.maxTokens,
      entry?.max_tokens,
      entry?.limit?.output,
      entry?.top_provider?.max_completion_tokens,
    )
    const inputModalities = listedInput(entry)
    const reasoning = anthropicReasoning(entry?.capabilities) ?? openRouterReasoning(entry)
    models.push({
      id,
      name,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      ...inputModalities === undefined ? {} : { inputModalities },
      ...reasoning === undefined ? {} : { reasoning },
    })
  }
  return models
}

/** One entry of a Gemini `GET /models` reply. */
interface GeminiListingEntry {
  name?: unknown
  displayName?: unknown
  inputTokenLimit?: unknown
  outputTokenLimit?: unknown
  supportedGenerationMethods?: unknown
  thinking?: unknown
}

/**
 * Read a Gemini model-listing reply. Each entry's `name` is a resource name
 * such as `models/gemini-2.5-pro`; the request id is that name without the
 * `models/` prefix, because pi-ai's Gemini protocol sends the bare id. Entries
 * that declare generation methods without `generateContent`, such as embedding
 * models, cannot serve a conversation and are skipped. The Model resource
 * (https://ai.google.dev/api/models#Model) states whether a model thinks in
 * its `thinking` flag, but not at which levels, and names no input types.
 */
function readGeminiListing(body: unknown): ListedModel[] {
  const listed = (body as { models?: unknown } | null)?.models
  if (!Array.isArray(listed)) {
    throw new LlmError(
      'the endpoint\'s model listing has no "models" array; enter this provider\'s models by hand',
      'DISCOVERY_FAILED',
    )
  }
  const models: ListedModel[] = []
  for (const raw of listed as readonly unknown[]) {
    const entry = raw as GeminiListingEntry | null
    const methods = entry?.supportedGenerationMethods
    if (Array.isArray(methods) && !methods.includes('generateContent')) continue
    const id = label(entry?.name)?.replace(/^models\//, '')
    if (id === undefined || id.length === 0) continue
    const contextWindow = capacity(entry?.inputTokenLimit)
    const maxTokens = capacity(entry?.outputTokenLimit)
    models.push({
      id,
      name: label(entry?.displayName) ?? id,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      ...typeof entry?.thinking === 'boolean' ? { reasoning: entry.thinking } : {},
    })
  }
  return models
}

/**
 * Accept one probe key, or refuse it before the header is built. Without this
 * the `fetch` below would throw a ByteString `TypeError` that this function's
 * catch reports as `could not reach <url>` — blaming the network for a local,
 * deterministic fault.
 * @param raw - the key typed into the form or read from storage.
 * @returns the trimmed, usable key.
 */
function usableProbeKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'this provider\'s API key is blank; enter it on the Models page, or clear it to probe unauthenticated'
      : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

/** Host-owned profile inputs that a configuration draft deliberately omits. */
export interface StoredModelDiscoveryProfile {
  /** Deployment headers configured on the named route. */
  readonly headers: Readonly<Record<string, string>> | undefined
  /** Endpoint the stored route names, when it names one. */
  readonly baseURL: string | undefined
  /** Resolve the named route's credential only when the draft carries none. */
  readonly resolveApiKey: () => Promise<string | undefined>
}

/** Where and how to ask one endpoint for its listing. */
interface ListingTarget {
  baseURL: string
  api: string
  /** Whether a request without a key is pointless rather than possibly authorized by a header. */
  requiresKey: boolean
  /**
   * The endpoint the stored route's credential and headers belong to: its
   * stored baseURL, or a catalog route's own endpoint when it stores none.
   */
  home: string | undefined
}

/**
 * One endpoint's identity for deciding whether stored credentials may go to
 * it: scheme, host, and port, plus the path without trailing slashes. A query,
 * a fragment, and the letter case of the host do not change where a key goes.
 * @param url - an endpoint as configured or typed.
 * @returns the comparable identity, or `undefined` for text that is not a URL.
 */
function endpointIdentity(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/u, '')}`
  } catch {
    return undefined
  }
}

/**
 * Whether a listing may carry the stored route's credential and headers: only
 * to the endpoint they were stored for, so a URL edited in a draft never
 * receives them before it is saved.
 * @param target - the listing destination and the stored route's endpoint.
 * @returns whether the destination is the stored endpoint.
 */
function storedEndpoint(target: ListingTarget): boolean {
  if (target.home === undefined) return false
  const home = endpointIdentity(target.home)
  return home !== undefined && home === endpointIdentity(target.baseURL)
}

/**
 * Ask one endpoint for its model listing.
 * @param request - the draft, for its typed key and cancellation.
 * @param target - endpoint, protocol, and whether a key is required.
 * @param stored - Host-owned headers and lazy credential resolution, when the route is stored.
 * @returns the listed models in endpoint order.
 * @throws LlmError when the protocol has no readable listing, no key is
 *   available where one is required, the endpoint refuses or fails the
 *   request, or the reply is not a model listing.
 */
async function listEndpoint(
  request: LlmModelDiscoveryOperation,
  target: ListingTarget,
  stored: StoredModelDiscoveryProfile | undefined,
): Promise<ListedModel[]> {
  const { api } = target
  if (!LISTABLE_PROTOCOLS.has(api)) {
    throw new LlmError(
      `pi-ai protocol "${api}" has no model listing this build can read; enter this provider's models by hand`,
      'DISCOVERY_UNSUPPORTED',
    )
  }
  const url = listingUrl(target.baseURL, api)
  // A key typed into the form wins: it may replace the stored key that is
  // failing. The stored profile is asked past the protocol check, and its
  // credential resolver remains lazy so a typed key cannot fail over a stored
  // credential it supersedes. A gateway may still authenticate through a
  // deployment-owned Authorization header when neither key exists. The stored
  // key and headers go only to the endpoint they were stored for.
  const trusted = stored !== undefined && storedEndpoint(target)
  // Elsewhere, a route that has a saved key refuses rather than asking unauthenticated, which would read as a bad key.
  const savedKey = async (): Promise<boolean> => stored !== undefined
    && await stored.resolveApiKey().then(key => key !== undefined, () => false)
  if (request.apiKey === undefined && !trusted && await savedKey()) {
    throw new LlmError(
      `the saved API key is sent only to ${target.home ?? 'the saved endpoint'}; to list models at ${target.baseURL}, `
      + 'type the API key into the form',
      INVALID_CREDENTIAL_CODE,
    )
  }
  const supplied = request.apiKey ?? (trusted ? await stored.resolveApiKey() : undefined)
  if (supplied === undefined && target.requiresKey) {
    throw new LlmError(
      'this provider signs in without an API key stored on the Models page, and its model listing needs one',
      'DISCOVERY_UNSUPPORTED',
    )
  }
  const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied)
  let response: Response
  try {
    const headers = new Headers(!trusted || stored.headers === undefined ? undefined : Object.entries(stored.headers))
    headers.set('accept', 'application/json')
    if (api === 'anthropic-messages') {
      headers.set('anthropic-version', ANTHROPIC_VERSION)
      if (apiKey !== undefined) headers.set('x-api-key', apiKey)
    } else if (api === 'google-generative-ai') {
      if (apiKey !== undefined) headers.set('x-goog-api-key', apiKey)
    } else if (apiKey !== undefined) {
      headers.set('authorization', `Bearer ${apiKey}`)
    }
    for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
    response = await fetch(url, {
      method: 'GET',
      headers,
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error: unknown) {
    // Cancellation during the body read rejects with the abort reason, which
    // may be any value; the caller gets the same coded failure it would have
    // for a cancellation before the request went out.
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  return api === 'google-generative-ai' ? readGeminiListing(body) : readListing(body)
}

/**
 * The protocol a catalog route's models outside the catalog speak: the one its
 * shipped models agree on, or the one most of them speak.
 * @param installed - the route's installed catalog.
 * @returns the route's protocol.
 */
function catalogRouteApi(installed: ReadonlyMap<string, Model<Api>>): string {
  const shared = sharedCatalogApi(installed)
  if (shared !== undefined) return shared
  const counts = new Map<string, number>()
  for (const model of installed.values()) counts.set(model.api, (counts.get(model.api) ?? 0) + 1)
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'openai-completions'
}

/** One installed catalog model, as discovery reports it. */
function fromCatalog(model: Model<Api>): LlmDiscoveredModel {
  return {
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    inputModalities: [...model.input],
    inCatalog: true,
  }
}

/**
 * Describe the models one draft provider serves.
 *
 * Without `listEndpoint` nothing reaches the network: a catalog route answers
 * from its installed catalog, and every route describes the ids the request
 * holds. With it, a catalog route adds its endpoint's listing when the route
 * has a key and a readable listing, and otherwise answers from the catalog
 * with a notice saying why; a route the catalog does not describe answers
 * from its endpoint, whose failures are errors because nothing else can answer.
 * @param request - the endpoint, protocol, one-shot credential, and held ids.
 * @param storedProfile - Host-owned headers, endpoint, and lazy credential
 *   resolution for the named route. It is read only on the path that reaches
 *   the network; the credential is resolved only when the draft carries none.
 * @returns the described models and, when the endpoint was skipped or failed, why.
 * @throws LlmError when a route the catalog does not describe cannot be listed.
 */
export async function discoverModels(
  request: LlmModelDiscoveryOperation,
  storedProfile?: () => StoredModelDiscoveryProfile | undefined,
): Promise<LlmModelDiscovery> {
  const provider = request.provider
  const installed = provider === undefined ? new Map<string, Model<Api>>() : catalogModels(provider)
  const catalogRoute = provider !== undefined && installed.size > 0
  // A draft that has not chosen a protocol yet is asked as OpenAI Chat
  // Completions: it is the shape a gateway is overwhelmingly likely to speak,
  // and the alternative — refusing until the field is filled — would withhold
  // the action from the case it exists for. The cost is a misdirected message
  // when the endpoint speaks something else (an Anthropic gateway answers 401,
  // which reads as a credential problem), and hand-entry remains the way out.
  const api = request.api ?? (catalogRoute ? catalogRouteApi(installed) : 'openai-completions')
  let listed: readonly ListedModel[] = []
  let notice: string | undefined
  if (request.listEndpoint === true) {
    const stored = storedProfile?.()
    if (catalogRoute) {
      const baseURL = request.baseURL ?? stored?.baseURL ?? catalogProvider(provider)?.baseUrl
      try {
        if (baseURL === undefined) {
          throw new LlmError('this provider has no single endpoint to ask', 'DISCOVERY_UNSUPPORTED')
        }
        const home = stored?.baseURL ?? catalogProvider(provider)?.baseUrl
        listed = await listEndpoint(request, { baseURL, api, requiresKey: true, home }, stored)
      } catch (error: unknown) {
        if (error instanceof LlmError && error.code === 'ABORTED') throw error
        notice = `${error instanceof Error ? error.message : String(error)}; the list shows the installed catalog only`
      }
    } else {
      if (request.baseURL === undefined || request.baseURL.length === 0) {
        throw new LlmError(
          `pi-ai ships no catalog for provider "${provider ?? ''}", so its models can only come from its`
          + " endpoint; set a baseURL, or enter this provider's models by hand",
          'DISCOVERY_FAILED',
        )
      }
      listed = await listEndpoint(request, { baseURL: request.baseURL, api, requiresKey: false, home: stored?.baseURL }, stored)
    }
  }
  const home = catalogRoute ? provider : undefined
  const describe = (entry: ListedModel): LlmDiscoveredModel => {
    const known = installed.get(entry.id)
    return known === undefined ? describeOutsideCatalog(entry, api, home) : fromCatalog(known)
  }
  const models = new Map<string, LlmDiscoveredModel>()
  for (const entry of listed) if (!models.has(entry.id)) models.set(entry.id, describe(entry))
  for (const model of installed.values()) if (!models.has(model.id)) models.set(model.id, fromCatalog(model))
  for (const id of request.describe ?? []) {
    if (id.length > 0 && !models.has(id)) models.set(id, describe({ id }))
  }
  return { models: [...models.values()], ...notice === undefined ? {} : { notice } }
}
