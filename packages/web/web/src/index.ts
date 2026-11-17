/**
 * Service Definition for the web access capability seam (`ctx.web`): registries and provider-selecting execution for search and
 * fetch. Duplicate ids are rejected. At execution time, a configured provider must exist and
 * be usable; without one, exactly one usable provider is required, so selection never depends
 * on registration order.
 * @module @deepseek-ai/dsh-web
 */

import { Context, type Volatile } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebProviderInfo,
  WebProviderList,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from './types.ts'
import { WebError } from './types.ts'

export {
  WebError,
} from './types.ts'
export type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebProviderInfo,
  WebProviderList,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    web: WebRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection<P> {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  readonly providers: ReadonlyMap<string, P>
}

/**
 * Config for the web seam. `searchProvider` / `fetchProvider` pin which provider
 * wins for each capability; both are optional (a single registered usable
 * provider auto-selects). Each operation reads the current value, so a settings
 * change applies to the next search or fetch without remounting the service.
 * Operational overrides such as environment variables must feed these same
 * fields rather than introduce a hidden priority chain.
 */
export interface WebRuntimeConfig {
  /** Explicit search provider id. Omitted = auto-select when exactly one is usable and ready. */
  readonly searchProvider: Volatile<string | undefined>
  /** Explicit fetch provider id. Omitted = auto-select when exactly one usable. */
  readonly fetchProvider: Volatile<string | undefined>
}

/**
 * The web access service. Registered as `ctx.web` (one instance per context)
 * and exposed to Clients as the `web` Remote namespace (`listProviders`).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `WEB_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.
 *
 * Search counts only usable providers that are also ready when no id is
 * configured, so automatic selection never picks a provider without a
 * credential; with none or several ready, search has no selection and
 * `searchReady()` answers false. A configured provider is never replaced.
 */
export class WebRuntime extends TypertRemoteService {
  /**
   * Provider selection config. Operational env overrides feed the SAME fields:
   * `$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER` are equivalent to
   * `searchProvider` / `fetchProvider` and are NOT a hidden priority chain.
   */
  static Config = z.object({
    searchProvider: z.string().volatile(),
    fetchProvider: z.string().volatile(),
  })

  private searchProviders = new Map<string, WebSearchProvider>()
  private fetchProviders = new Map<string, WebFetchProvider>()
  private readonly searchProviderEnv: string | undefined
  private readonly fetchProviderEnv: string | undefined

  constructor(ctx: Context, private readonly config: WebRuntimeConfig) {
    super(ctx, 'web')
    this.searchProviderEnv = process.env.DSH_WEB_SEARCH_PROVIDER
    this.fetchProviderEnv = process.env.DSH_WEB_FETCH_PROVIDER
  }

  /**
   * Register a search provider. `listProviders()` lists it until the
   * registration is disposed, which happens with the calling fiber or through
   * the returned disposer; registration and disposal each emit
   * `web/providers-changed`. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for search.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerSearchProvider(provider: WebSearchProvider): () => void {
    return this.registerProvider(this.searchProviders, provider)
  }

  /**
   * Register a fetch provider, with the listing, disposal, and event behavior
   * of {@link WebRuntime.registerSearchProvider}. Throws {@link WebError}
   * `WEB_DUPLICATE_PROVIDER` if its id is already registered for fetch.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerFetchProvider(provider: WebFetchProvider): () => void {
    return this.registerProvider(this.fetchProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) {
      throw new WebError(`a web provider with id "${provider.id}" is already registered`, 'WEB_DUPLICATE_PROVIDER')
    }
    const emitChanged = (): void => { this.emitProvidersChanged() }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      emitChanged()
      yield () => {
        store.delete(provider.id)
        emitChanged()
      }
    }, 'web.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * List every registered search and fetch provider for provider pickers.
   * Availability does not filter the lists.
   * @returns detached `{ id, title, description }` entries per capability, in registration order.
   */
  @Remote
  listProviders(): WebProviderList {
    return {
      search: [...this.searchProviders.values()].map(providerInfo),
      fetch: [...this.fetchProviders.values()].map(providerInfo),
    }
  }

  /** Emit `web/providers-changed`, containing each listener's failure so none vetoes the mutation. */
  private emitProvidersChanged(): void {
    for (const listener of this.ctx.events.dispatch('emit', ['web/providers-changed'])) {
      try {
        const returned: unknown = listener()
        void Promise.resolve(returned).catch((error: unknown) => { this.warnListenerFailure(error) })
      } catch (error: unknown) {
        this.warnListenerFailure(error)
      }
    }
  }

  private warnListenerFailure(error: unknown): void {
    this.ctx.logger.warn('web: a web/providers-changed listener failed')
    this.ctx.logger.warn(error)
  }

  /**
   * Run one search through the selected provider. Resolves the provider at call
   * time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. The seam enforces `request.maxResults` on the result:
   * if the provider over-returns, `sources[]` is truncated and `truncated` set.
   * @param request - the query and optional result limit.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's results, capped to `request.maxResults`.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const configuredId = this.searchProviderId()
    const selected = configuredId === undefined
      ? onlyReady(await readyProviders(this.searchProviders))
      : resolveProvider({ providers: this.searchProviders, configuredId })
    return capSources(await selected.search(request, signal), request.maxResults)
  }

  /**
   * Whether search has a provider that can authenticate the next search. With a
   * configured id, asks only that provider's `ready()`, and a selection failure
   * answers true because `search()` reports it as a structured `WebError`. Without
   * one, answers whether exactly one usable provider is ready. A provider without
   * `ready()` counts as ready. Makes no network calls.
   * @returns false when the configured provider cannot authenticate, or when no id is configured and zero or several providers are ready.
   */
  async searchReady(): Promise<boolean> {
    const configuredId = this.searchProviderId()
    if (configuredId === undefined) return (await readyProviders(this.searchProviders)).size === 1
    return await selectedProviderReady(() => resolveProvider({ providers: this.searchProviders, configuredId }))
  }

  /** The explicitly configured search provider id, from config or `$DSH_WEB_SEARCH_PROVIDER`. */
  private searchProviderId(): string | undefined {
    return this.config.searchProvider.get() ?? this.searchProviderEnv
  }

  /**
   * Retrieve one URL through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. A non-2xx response is a result, not a throw.
   * @param request - the URL plus retrieval options.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the retrieval outcome; non-2xx responses resolve descriptively.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    return await this.selectFetchProvider().fetch(request, signal)
  }

  /**
   * Whether the provider `fetch()` would select can authenticate the next fetch. Asks
   * only that provider's `ready()`; one without `ready()` counts as ready. Makes no
   * network calls. A selection failure answers true, because `fetch()` reports that
   * failure as a structured `WebError`.
   * @returns false only when the selected provider reports that it cannot authenticate.
   */
  async fetchReady(): Promise<boolean> {
    return await selectedProviderReady(() => this.selectFetchProvider())
  }

  /** Select the fetch provider with the rules above, throwing the matching {@link WebError}. */
  private selectFetchProvider(): WebFetchProvider {
    const configuredId = this.config.fetchProvider.get() ?? this.fetchProviderEnv
    return resolveProvider({
      providers: this.fetchProviders,
      ...configuredId !== undefined ? { configuredId } : {},
    })
  }
}

/** Project one provider to its picker entry, omitting an absent title or description. */
function providerInfo(provider: WebSearchProvider | WebFetchProvider): WebProviderInfo {
  return {
    id: provider.id,
    ...provider.title === undefined ? {} : { title: provider.title },
    ...provider.description === undefined ? {} : { description: provider.description },
  }
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
  ready?(): Promise<boolean>
}

/**
 * Ask the provider an operation selects whether it can authenticate.
 * @param select - the operation's selection; throws its {@link WebError} when no provider qualifies.
 * @returns the provider's answer; true when it has no `ready()` or selection fails, because the
 *   operation reports that failure itself.
 */
async function selectedProviderReady(select: () => ResolvableProvider): Promise<boolean> {
  let provider: ResolvableProvider
  try { provider = select() }
  catch (_selectionFailure) { return true /* The operation surfaces the same failure when called. */ }
  return await provider.ready?.() ?? true
}

/**
 * The providers automatic selection may choose: usable ones that can authenticate.
 * @param providers - every provider registered for the capability.
 * @returns the available and ready providers, keyed by id.
 */
async function readyProviders<P extends ResolvableProvider>(providers: ReadonlyMap<string, P>): Promise<Map<string, P>> {
  const ready = new Map<string, P>()
  for (const [id, provider] of providers) {
    if (provider.available() && (await provider.ready?.() ?? true)) ready.set(id, provider)
  }
  return ready
}

/**
 * Take the one ready search provider that automatic selection uses.
 * @param ready - the usable and ready search providers.
 * @returns that provider.
 * @throws {WebError} `WEB_PROVIDER_UNAVAILABLE` when none is ready, `WEB_PROVIDER_AMBIGUOUS` when several are.
 */
function onlyReady<P extends ResolvableProvider>(ready: ReadonlyMap<string, P>): P {
  const [single] = ready.values()
  if (single === undefined) {
    throw new WebError('no web search provider is set up; give one search provider the credential it needs', 'WEB_PROVIDER_UNAVAILABLE')
  }
  if (ready.size > 1) {
    throw new WebError(`several web search providers are set up (${[...ready.keys()].join(', ')}); choose one in web.searchProvider`, 'WEB_PROVIDER_AMBIGUOUS')
  }
  return single
}

/** Resolve the selected provider or throw the matching {@link WebError}. */
function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new WebError(`configured web provider "${configuredId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new WebError(`configured web provider "${configuredId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new WebError('no usable web provider is registered', 'WEB_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new WebError(`multiple usable web providers are registered (${ids}); configure one explicitly`, 'WEB_PROVIDER_AMBIGUOUS')
  }
  return single
}

/** Enforce `maxResults` on a search result: truncate `sources[]` and flag it. */
function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

export default WebRuntime
