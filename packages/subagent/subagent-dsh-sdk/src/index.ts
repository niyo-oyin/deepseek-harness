/**
 * Out-of-process SDK subagent backend. Each child is a complete DeepSeek
 * Harness runtime in its own process — own named profile and patch composition,
 * session, model route, and tools — driven over stdio JSON-RPC through the
 * TypeScript SDK client, so it shares no Cordis context. It accepts the
 * provider/model/reasoning/maxTokens subset of `agentOptions`; other start
 * features remain unsupported. The child retains its parent's origin directory
 * while starting in the directory selected by the subagent service. This plugin uses named
 * exports only; a default would hide its loader metadata (see
 * `docs/postmortem/0001-acp-default-export-drops-inject.md`).
 * @module @deepseek-ai/dsh-subagent-dsh-sdk
 */

import type { Context } from '@deepseek-ai/cordis'
import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SubagentCapabilities, SubagentProvider, ResolvedSubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import {
  assertPositiveFinite,
  NO_START_CAPABILITIES,
  assertUsableCwd,
  parentAgentOptionsForDelegation,
  SubagentError,
} from '@deepseek-ai/dsh-subagent'
import {
  DEFAULT_DISPOSE_EOF_GRACE_MS,
  DEFAULT_DISPOSE_GRACE_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  sdkConfigurationFailure,
  startSdkRun,
  type SdkRunSpec,
} from './run.ts'

export const name = 'subagent-dsh-sdk'
export const inject = ['subagents']

/** Config: how to spawn and drive the child SDK runtime process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `dsh-sdk`). */
  providerName: string
  /** Explicit dsh CLI module, resolved and checked at plugin load; omission uses the SDK dependency. */
  dshBin?: string
  /** Named child profile (default `sdk`). */
  profile: string
  /** Ordered per-launch profile patch files, resolved and checked at plugin load. */
  patches: string[]
  /** Absolute isolated Harness home for every nested child process. */
  dshHome: string
  /** Provider route the child runtime initializes with; set together with `model`. Omitted: the delegating parent's route. */
  provider?: string
  /** Model the child runtime initializes with; set together with `provider`. Omitted: the delegating parent's route. */
  model?: string
  /** Optional per-request output-token cap for the child runtime. */
  maxTokens?: number
  /**
   * Extra environment variables for the child process — e.g. the child
   * runtime's own `DEEPSEEK_API_KEY`. Forwarded on top of a credential-scrubbed copy of the parent
   * env, so an explicit key here reaches the child while ambient secrets do
   * not leak implicitly.
   */
  env: Record<string, string>
  /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
  shutdownTimeoutMs?: number
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal.
   */
  disposeEofGraceMs?: number
  /** Termination confirmation window (ms), including forced exit on every platform. */
  disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('dsh-sdk'),
  dshBin: z.string(),
  profile: z.string().default('sdk'),
  patches: z.array(z.string()).default([]),
  dshHome: z.string().required(),
  provider: z.string(),
  model: z.string(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  env: z.dict(z.string()).default({}),
  shutdownTimeoutMs: z.number().default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
  disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

/** The shape after schemastery applied the defaults (`dshBin`, `provider`, `model`, and `maxTokens` have none). */
type ResolvedConfig = Required<Omit<Config, 'maxTokens' | 'dshBin' | 'provider' | 'model'>>
  & Pick<Config, 'maxTokens' | 'dshBin' | 'provider' | 'model'>

/** Resolve one configured runtime file against the harness launch directory and require a regular file. */
function resolveConfiguredFile(field: string, value: string): string {
  const path = resolve(value)
  try {
    if (statSync(path).isFile()) return path
  } catch {
    // The diagnostic below owns missing, inaccessible, and non-file paths uniformly.
  }
  throw new TypeError(`subagent-dsh-sdk ${field} must name an existing file: ${path}`)
}

/** DSH SDK can apply Agent route options while the other start features remain child-owned. */
const SDK_START_CAPABILITIES: SubagentCapabilities = Object.freeze({
  ...NO_START_CAPABILITIES,
  agentOptions: true,
})

/**
 * Merge the request's supported route fields over this provider instance's
 * configured route, or over the delegating parent's route when none is configured.
 * A child that keeps the parent's provider and model also keeps the parent's
 * reasoning effort unless the request names one, as an in-process child does.
 * @param config - provider instance configuration.
 * @param requested - the start request's Agent options.
 * @param parent - delegating parent whose current route applies when none is configured.
 * @returns the child runtime's handshake route.
 * @throws SubagentError `NO_MODEL_ROUTE` when neither the request, the configuration, nor the parent supplies a provider and model.
 */
function resolveSdkRoute(config: ResolvedConfig, requested: AgentOptions | undefined, parent: Agent): Pick<
  SdkRunSpec,
  'provider' | 'model' | 'reasoningEffort' | 'maxTokens'
> {
  const configured = configuredRoute(config)
  const base: AgentOptions = configured ?? parentAgentOptionsForDelegation(parent)
  const provider = requested?.provider ?? base.provider
  const model = requested?.model ?? base.model
  if (provider === undefined || model === undefined) {
    throw new SubagentError(
      'subagent-dsh-sdk: the child has no model route; set provider and model on this provider, or select a model for the parent',
      'NO_MODEL_ROUTE',
    )
  }
  const reasoningEffort = requested?.reasoningEffort
    ?? (configured === undefined && provider === base.provider && model === base.model ? base.reasoningEffort : undefined)
  const maxTokens = requested?.maxTokens ?? config.maxTokens
  return {
    provider,
    model,
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
    ...maxTokens === undefined ? {} : { maxTokens },
  }
}

/** The configured provider/model pair, or `undefined` when the configuration leaves the route to the parent. */
function configuredRoute(config: ResolvedConfig): Readonly<{ provider: string; model: string }> | undefined {
  return config.provider === undefined || config.model === undefined
    ? undefined
    : Object.freeze({ provider: config.provider, model: config.model })
}

/**
 * The SDK provider. It resolves Agent route options into the child runtime's
 * process-wide handshake; output schema, depth, and independent preset selection stay
 * unsupported because their ownership does not cross this process boundary.
 */
class SdkSubagentProvider implements SubagentProvider {
  readonly capabilities = SDK_START_CAPABILITIES
  readonly agentRouteDefaults?: Readonly<{ provider: string; model: string }>
  // Context contract: an out-of-process SDK child starts fresh — no parent conversation crosses the process boundary.
  readonly inheritsParentContext = false

  constructor(readonly name: string, private readonly ctx: Context, private readonly config: ResolvedConfig) {
    const route = configuredRoute(config)
    if (route !== undefined) this.agentRouteDefaults = route
  }

  start(request: ResolvedSubagentStartRequest) {
    if (request.signal.aborted) {
      throw new Error('subagent request was aborted before the SDK child started')
    }
    let cwd: string
    try {
      cwd = assertUsableCwd('subagent-dsh-sdk', 'child cwd', request.cwd)
    } catch (error: unknown) {
      const failure = sdkConfigurationFailure(error)
      this.ctx.logger.warn(`subagent-dsh-sdk "${this.name}": child start failed: %o`, error)
      throw failure
    }
    // The route failure names only settings, so it reaches the caller as is.
    const route = resolveSdkRoute(this.config, request.agentOptions, request.parent)
    const spec: SdkRunSpec = {
      ...this.config.dshBin === undefined ? {} : { dshBin: this.config.dshBin },
      profile: this.config.profile,
      patches: this.config.patches,
      dshHome: this.config.dshHome,
      cwd,
      originCwd: request.parent.session.header.cwd,
      ...route,
      env: this.config.env,
      shutdownTimeoutMs: this.config.shutdownTimeoutMs,
      disposeEofGraceMs: this.config.disposeEofGraceMs,
      disposeGraceMs: this.config.disposeGraceMs,
      onError: (error, stopReason) => {
        // The seam forbids `result` rejecting, so a child-level failure is
        // flattened to a stop reason — preserve it here rather than losing it.
        this.ctx.logger.warn(`subagent-dsh-sdk "${this.name}": child run failed (${stopReason}): ${error.message}`)
      },
    }
    return startSdkRun(request, spec)
  }
}

export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveFinite('subagent-dsh-sdk', 'shutdownTimeoutMs', resolved.shutdownTimeoutMs)
  assertPositiveFinite('subagent-dsh-sdk', 'disposeEofGraceMs', resolved.disposeEofGraceMs)
  assertPositiveFinite('subagent-dsh-sdk', 'disposeGraceMs', resolved.disposeGraceMs)
  if (resolved.maxTokens !== undefined && (!Number.isSafeInteger(resolved.maxTokens) || resolved.maxTokens <= 0)) {
    throw new TypeError('subagent-dsh-sdk maxTokens must be a positive safe integer')
  }
  if ((resolved.provider === undefined) !== (resolved.model === undefined)) {
    throw new TypeError('subagent-dsh-sdk provider and model are set together, or both omitted to use the parent route')
  }
  if (!isAbsolute(resolved.dshHome)) throw new TypeError('subagent-dsh-sdk dshHome must be an absolute path')
  const launchPaths: ResolvedConfig = {
    ...resolved,
    patches: resolved.patches.map((path, index) => resolveConfiguredFile(`patches[${String(index)}]`, path)),
    ...resolved.dshBin === undefined ? {} : { dshBin: resolveConfiguredFile('dshBin', resolved.dshBin) },
  }
  ctx.subagents.registerProvider(new SdkSubagentProvider(launchPaths.providerName, ctx, launchPaths))
}
