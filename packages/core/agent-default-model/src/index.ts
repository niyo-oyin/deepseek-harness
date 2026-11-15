/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-config-editor'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Default model selection supplied by plugin configuration; provider and model are set together or not at all. */
export interface Config {
  /** Registered provider route; absent until a default is chosen. */
  provider: Volatile<string | undefined>
  /** Provider-owned model id; absent until a default is chosen. */
  model: Volatile<string | undefined>
  /** Adapter-owned reasoning effort; omission follows the provider default. */
  reasoningEffort: Volatile<string | undefined>
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: { provider: string; model: string; reasoningEffort?: string }): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: brandString<ReasoningEffortId>(settings.reasoningEffort) },
  }
}

/**
 * The one failure every entry point raises when it needs the default and none
 * is set. Its text says both ways to set one, since a non-interactive caller
 * sees only the text.
 */
export class NoDefaultModelError extends Error {
  /** Stable code for callers that report the failure through a protocol. */
  readonly code = 'NO_DEFAULT_MODEL'

  constructor() {
    super('No default model is set. Choose a model in the app (the first model you pick becomes the default),'
      + ' or set provider and model under agent-default-model in the profile.')
    this.name = 'NoDefaultModelError'
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * Each operation reads the owning Config references.
 */
export class AgentDefaultModelConfig extends Service {
  private saves: Promise<void> = Promise.resolve()

  static Config = z.object({
    provider: z.string().volatile(),
    model: z.string().volatile(),
    reasoningEffort: z.string().volatile(),
  })

  constructor(private readonly ownerContext: Context, private config: Config) {
    super(ownerContext, 'agentDefaultModel')

    ownerContext.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ownerContext.fiber)) })
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection, or
   *   `undefined` while no default is set.
   * @throws Error when the configuration names a provider without a model or a model without a provider.
   */
  currentSelection(): ModelSelection | undefined {
    const provider = this.config.provider.get()
    const model = this.config.model.get()
    if (provider === undefined && model === undefined) return undefined
    if (provider === undefined || model === undefined) {
      throw new Error('agent-default-model: provider and model are set together;'
        + ` the profile sets only ${provider === undefined ? 'model' : 'provider'}`)
    }
    const reasoningEffort = this.config.reasoningEffort.get()
    return selection({ provider, model, ...reasoningEffort === undefined ? {} : { reasoningEffort } })
  }

  /**
   * Read the default for an entry point that cannot proceed without one.
   * @returns the current default selection.
   * @throws NoDefaultModelError while no default is set.
   */
  requireSelection(): ModelSelection {
    const current = this.currentSelection()
    if (current === undefined) throw new NoDefaultModelError()
    return current
  }

  /**
   * Save the complete default model selection. A deployment without a configuration
   * editor keeps its composition entry. Saves commit in submission order; a failed
   * save rejects its caller without blocking later saves.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional profile write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    const entry = this.ownerContext.fiber.entry
    if (entry === undefined) return
    const editor = this.ctx.get('configEditor')
    if (editor === undefined) return
    const config = {
      provider: next.provider, model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    }
    const saved = this.saves.then(() => editor.edit(entry, () => config))
    this.saves = saved.catch(() => {})
    await saved
  }
}

export default AgentDefaultModelConfig
