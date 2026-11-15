/**
 * Describing a model the installed catalog does not know: its capacities and
 * reasoning, from what the endpoint reported and, for everything it did not,
 * from the catalog model it most plausibly belongs with.
 *
 * Nothing here is stored. A configuration surface adopts the description into
 * the route's `models` entry, where `reasoningEfforts` and
 * `compat.forceAdaptiveThinking` carry the reasoning exactly as a hand-written
 * entry would; resolution never reads a template back.
 *
 * @module dsh-llm-pi-ai/model-description
 */

import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type { Api, Model } from '@earendil-works/pi-ai'
import type {
  LlmDiscoveredField, LlmDiscoveredModel, LlmDiscoveredSource, LlmReasoningProposal, ModelModality,
} from '@deepseek-ai/dsh-llm'
import { catalogModels, catalogProviderIds, THINKING_LEVELS } from './catalog.ts'

/** What an endpoint stated about a model's reasoning: does not reason, reasons with unstated levels, or its levels. */
export type ReportedReasoning = false | true | LlmReasoningProposal

/** One model as an endpoint listing reported it, before the catalog fills what it left out. */
export interface ListedModel {
  /** Model id the endpoint accepts. */
  id: string
  /** Display name the endpoint gave. */
  name?: string
  /** Context window the endpoint reported. */
  contextWindow?: number
  /** Output cap the endpoint reported. */
  maxTokens?: number
  /** Input types the endpoint reported. */
  inputModalities?: readonly ModelModality[]
  /** Reasoning the endpoint reported. */
  reasoning?: ReportedReasoning
}

const ANTHROPIC = 'anthropic-messages'
const GEMINI = 'google-generative-ai'

/**
 * The levels a protocol offers when nothing better is known, each sent under
 * its own name. pi-ai turns a level into the protocol's own parameter: an
 * OpenAI-style `reasoning_effort`, an Anthropic thinking budget, or a Gemini
 * thinking level or budget. Anthropic starts on budgets, which every
 * thinking Claude accepts; adaptive thinking is a switch beside the levels.
 * @param api - the route's wire protocol.
 * @returns the protocol's ordinary levels.
 */
export function standardProposal(api: string): LlmReasoningProposal {
  const levels = api === GEMINI ? ['minimal', 'low', 'medium', 'high'] : ['off', 'low', 'medium', 'high']
  return {
    efforts: levels.map(level => ({ level, value: level === 'off' ? null : level })),
    ...api === ANTHROPIC ? { compat: { forceAdaptiveThinking: false } } : {},
  }
}

/**
 * The reasoning a catalog model offers, spelled as a `reasoningEfforts` entry
 * would declare it. A level the model's map leaves unset goes out under its
 * own name, as pi-ai sends it; an Off the model cannot honor is left out.
 * @param model - the catalog model.
 * @returns `false` for a model that does not reason, its levels otherwise.
 */
export function catalogProposal(model: Model<Api>): false | LlmReasoningProposal {
  if (!model.reasoning) return false
  const map = model.thinkingLevelMap ?? {}
  const efforts = getSupportedThinkingLevels(model).map(level => ({
    level,
    value: map[level] ?? (level === 'off' ? null : level),
  }))
  if (!efforts.some(effort => effort.level !== 'off')) return false
  if (model.api !== ANTHROPIC) return { efforts }
  const adaptive = (model.compat as { forceAdaptiveThinking?: boolean } | undefined)?.forceAdaptiveThinking === true
  return { efforts, compat: { forceAdaptiveThinking: adaptive } }
}

/**
 * An id reduced to what names its model family: the routing prefix of an
 * aggregator (`anthropic/`), a variant suffix (`:batch`, `@001`), a release
 * date, and a `-latest` alias add nothing about what the model can do.
 * @param id - model id as a listing or a row spells it.
 * @returns the lowercase family tokens.
 */
function familyTokens(id: string): string[] {
  const reduced = id.toLowerCase()
    .replace(/^.*\//u, '')
    .replace(/[:@].*$/u, '')
    .replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/u, '')
    .replace(/-latest$/u, '')
  return reduced.split(/[-_.]/u).filter(token => token.length > 0)
}

/** The number of leading tokens two ids share. */
function sharedPrefix(left: readonly string[], right: readonly string[]): number {
  let shared = 0
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared++
  return shared
}

/** One catalog model a description may borrow from. */
interface Candidate {
  model: Model<Api>
  tokens: string[]
  /** Whether it ships on the route being described. */
  home: boolean
}

/**
 * Every installed catalog model speaking one protocol, the route's own first.
 * @param api - wire protocol the described model speaks.
 * @param provider - route being described, when it is a catalog route.
 */
function candidatesFor(api: string, provider: string | undefined): Candidate[] {
  const order = provider === undefined ? catalogProviderIds() : [provider, ...catalogProviderIds().filter(id => id !== provider)]
  const candidates: Candidate[] = []
  for (const id of order) {
    for (const model of catalogModels(id).values()) {
      if (model.api === api) candidates.push({ model, tokens: familyTokens(model.id), home: id === provider })
    }
  }
  return candidates
}

/**
 * The catalog model an id most plausibly belongs with, or nothing when no
 * match is confident.
 *
 * The same family spelled differently is a match. Otherwise the longest shared
 * run of leading tokens decides, and it must name more than a vendor: two
 * tokens at least (`claude-opus-5` for `claude-opus-5-7`, `gpt-5` for
 * `gpt-5-codex`). Among equally long matches the route's own models win; then,
 * where the ids next differ in a version number, the nearest release below the
 * described one and the one whose variant name agrees, or otherwise a template
 * whose whole id is the shared run. Matches that still disagree about
 * reasoning are no answer at all.
 * @param id - the described model id.
 * @param api - wire protocol it speaks.
 * @param provider - route being described, whose own models win a tie.
 * @returns the template, or `undefined`.
 */
export function matchTemplate(id: string, api: string, provider?: string): Model<Api> | undefined {
  const tokens = familyTokens(id)
  if (tokens.length === 0) return undefined
  const candidates = candidatesFor(api, provider)
  const exact = candidates.filter(candidate => candidate.tokens.join('-') === tokens.join('-'))
  if (exact.length > 0) return (exact.find(candidate => candidate.home) ?? exact[0])?.model
  let best = 0
  for (const candidate of candidates) best = Math.max(best, sharedPrefix(tokens, candidate.tokens))
  if (best < 2) return undefined
  let tied = candidates.filter(candidate => sharedPrefix(tokens, candidate.tokens) === best)
  if (tied.some(candidate => candidate.home)) tied = tied.filter(candidate => candidate.home)
  const version = Number(tokens[best])
  const versioned = /^\d+$/u.test(tokens[best] ?? '')
    ? tied.filter(candidate => /^\d+$/u.test(candidate.tokens[best] ?? '') && Number(candidate.tokens[best]) <= version)
    : []
  const whole = tied.filter(candidate => candidate.tokens.length === best)
  if (versioned.length > 0) {
    // A later point release belongs with the nearest earlier one: `claude-opus-5-7` with `claude-opus-5-5`.
    const nearest = Math.max(...versioned.map(candidate => Number(candidate.tokens[best])))
    tied = versioned.filter(candidate => Number(candidate.tokens[best]) === nearest)
    // Past the differing version, the variant name decides: `gpt-6.2-sol` belongs with `gpt-6.1-sol`.
    const variant = (candidate: Candidate): number =>
      tokens.slice(best + 1).filter((token, at) => candidate.tokens[best + 1 + at] === token).length
    const closest = Math.max(...tied.map(variant))
    tied = tied.filter(candidate => variant(candidate) === closest)
  } else if (whole.length > 0) {
    tied = whole
  }
  const proposals = new Set(tied.map(candidate => JSON.stringify(catalogProposal(candidate.model))))
  if (proposals.size !== 1) return undefined
  return tied[0]?.model
}

/**
 * Keep the levels this adapter can declare, in escalation order; anything else
 * an endpoint reports is not a level pi-ai sends.
 * @param proposal - levels as an endpoint reported them.
 * @returns the declarable levels, or `true` when none remains beyond Off.
 */
function declarable(proposal: LlmReasoningProposal): true | LlmReasoningProposal {
  const efforts = THINKING_LEVELS.flatMap((level) => {
    const effort = proposal.efforts.find(candidate => candidate.level === level)
    return effort === undefined ? [] : [effort]
  })
  return efforts.some(effort => effort.level !== 'off') ? { ...proposal, efforts } : true
}

/**
 * Describe one model the route's installed catalog does not know.
 * @param listed - what the endpoint reported, or only the id for a held row.
 * @param api - wire protocol the route speaks.
 * @param provider - route being described, when it is a catalog route.
 * @returns the description a surface may adopt.
 */
export function describeOutsideCatalog(listed: ListedModel, api: string, provider?: string): LlmDiscoveredModel {
  const template = matchTemplate(listed.id, api, provider)
  const sources: Partial<Record<LlmDiscoveredField, LlmDiscoveredSource>> = {}
  const pick = <T>(field: LlmDiscoveredField, reported: T | undefined, borrowed: T | undefined): T | undefined => {
    if (reported !== undefined) sources[field] = 'endpoint'
    else if (borrowed !== undefined) sources[field] = 'template'
    return reported ?? borrowed
  }
  const contextWindow = pick('contextWindow', listed.contextWindow, template?.contextWindow)
  const maxTokens = pick('maxTokens', listed.maxTokens, template?.maxTokens)
  const inputModalities = pick<readonly ModelModality[]>('inputModalities', listed.inputModalities, template?.input)
  const reported = listed.reasoning === undefined || typeof listed.reasoning === 'boolean'
    ? listed.reasoning
    : declarable(listed.reasoning)
  let suggested: false | LlmReasoningProposal | undefined
  if (reported === false || (reported !== undefined && reported !== true)) {
    suggested = reported
    sources.reasoning = 'endpoint'
  } else if (reported === true) {
    // The endpoint says the model thinks but not at which levels: the
    // template's levels when it thinks too, the protocol's ordinary ones otherwise.
    const borrowed = template === undefined ? false : catalogProposal(template)
    suggested = borrowed === false ? standardProposal(api) : borrowed
    sources.reasoning = 'endpoint'
  } else if (template !== undefined) {
    suggested = catalogProposal(template)
    sources.reasoning = 'template'
  }
  const borrowsTemplate = template !== undefined
    && (Object.values(sources).includes('template') || (reported === true && template.reasoning))
  return {
    id: listed.id,
    ...listed.name === undefined ? {} : { name: listed.name },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...inputModalities === undefined ? {} : { inputModalities: [...inputModalities] },
    inCatalog: false,
    ...borrowsTemplate ? { template: template.id } : {},
    ...Object.keys(sources).length === 0 ? {} : { sources },
    reasoning: { ...suggested === undefined ? {} : { suggested }, standard: standardProposal(api) },
  }
}
