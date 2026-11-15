/**
 * The three ways a model row outside the installed catalog states its
 * reasoning — none, as a matched catalog model (or as its endpoint reports),
 * or the protocol's ordinary levels — read from and written to the row's
 * `reasoningEfforts` and `compat` fields. The row stores values, never a
 * reference: a choice is recognized by comparing the stored levels with what
 * the adapter describes now.
 */

import type { LlmDiscoveredReasoning, LlmReasoningProposal } from '@deepseek-ai/dsh-api-remotes/client'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'

/** Which choice a row's stored reasoning matches; `unset` is a row that states none at all. */
export type ReasoningChoice = 'unset' | 'none' | 'suggested' | 'standard' | 'custom'

/** A row's `compat` object, or an empty one. */
function compatOf(model: DeepSeekModelDraft): Readonly<Record<string, unknown>> {
  const compat = model['compat']
  return compat !== null && typeof compat === 'object' && !Array.isArray(compat) ? compat as Record<string, unknown> : {}
}

/** Compat switches either proposal names, which a choice owns on the row. */
function namedSwitches(reasoning: LlmDiscoveredReasoning | undefined): string[] {
  const proposals = [reasoning?.standard, reasoning?.suggested === false ? undefined : reasoning?.suggested]
  return [...new Set(proposals.flatMap(proposal => Object.keys(proposal?.compat ?? {})))]
}

/**
 * Whether a row states exactly one proposal: the same levels in the same
 * order with the same values, and every switch the proposal names set the same
 * way (an absent switch reads as off).
 * @param model - the row.
 * @param proposal - the proposal to compare.
 * @returns whether the row holds it.
 */
export function holdsProposal(model: DeepSeekModelDraft, proposal: LlmReasoningProposal): boolean {
  const stored = model['reasoningEfforts']
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return false
  const entries = Object.entries(stored as Record<string, unknown>)
  if (entries.length !== proposal.efforts.length) return false
  const same = proposal.efforts.every((effort, at) => entries[at]?.[0] === effort.level && entries[at][1] === effort.value)
  if (!same) return false
  const compat = compatOf(model)
  return Object.entries(proposal.compat ?? {}).every(([key, on]) => (compat[key] === true) === on)
}

/**
 * The choice a row's stored reasoning matches.
 * @param model - the row.
 * @param reasoning - what the adapter describes for its id, when known.
 * @returns the matching choice.
 */
export function reasoningChoice(model: DeepSeekModelDraft, reasoning: LlmDiscoveredReasoning | undefined): ReasoningChoice {
  const stored = model['reasoningEfforts']
  if (stored === undefined) return 'unset'
  if (stored === false) return 'none'
  if (reasoning?.suggested !== undefined && reasoning.suggested !== false && holdsProposal(model, reasoning.suggested)) return 'suggested'
  if (reasoning !== undefined && holdsProposal(model, reasoning.standard)) return 'standard'
  return 'custom'
}

/**
 * Write one proposal into a row, preserving every field it does not own.
 * Switches the proposal turns off are removed rather than stored as `false`,
 * which is what an absent switch already means.
 * @param model - the row.
 * @param proposal - levels and switches to write.
 * @returns the replacement row.
 */
export function withProposal(model: DeepSeekModelDraft, proposal: LlmReasoningProposal): DeepSeekModelDraft {
  const compat = { ...compatOf(model) }
  for (const [key, on] of Object.entries(proposal.compat ?? {})) {
    if (on) compat[key] = true
    else Reflect.deleteProperty(compat, key)
  }
  const next: DeepSeekModelDraft = {
    ...model,
    reasoningEfforts: Object.fromEntries(proposal.efforts.map(effort => [effort.level, effort.value])),
  }
  if (Object.keys(compat).length > 0) next['compat'] = compat
  else Reflect.deleteProperty(next, 'compat')
  return next
}

/**
 * State that a row does not reason, removing the switches the reasoning
 * choices own.
 * @param model - the row.
 * @param reasoning - what the adapter describes for its id, naming those switches.
 * @returns the replacement row.
 */
export function withoutReasoning(model: DeepSeekModelDraft, reasoning: LlmDiscoveredReasoning | undefined): DeepSeekModelDraft {
  const compat = { ...compatOf(model) }
  for (const key of namedSwitches(reasoning)) Reflect.deleteProperty(compat, key)
  const next: DeepSeekModelDraft = { ...model, reasoningEfforts: false }
  if (Object.keys(compat).length > 0) next['compat'] = compat
  else Reflect.deleteProperty(next, 'compat')
  return next
}

/**
 * Apply what the adapter suggests to a row that states no reasoning yet.
 * @param model - the row.
 * @param reasoning - what the adapter describes for its id.
 * @returns the replacement row, or the row itself when it already states its
 * reasoning or nothing is suggested with confidence.
 */
export function withSuggestion(model: DeepSeekModelDraft, reasoning: LlmDiscoveredReasoning | undefined): DeepSeekModelDraft {
  if (model['reasoningEfforts'] !== undefined || reasoning?.suggested === undefined) return model
  return reasoning.suggested === false ? withoutReasoning(model, reasoning) : withProposal(model, reasoning.suggested)
}
