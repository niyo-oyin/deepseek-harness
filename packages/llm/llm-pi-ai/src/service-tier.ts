/**
 * Gemini API service tiers a route may select. pi-ai's Gemini protocol has no
 * option for the tier, so the adapter writes it into the request the protocol
 * built, just before dispatch.
 */

import type { Api, Model } from '@earendil-works/pi-ai'

/** Service tiers a profile may name; omission keeps the provider's standard tier. */
export const SERVICE_TIERS = ['flex', 'priority'] as const

/** One selectable Gemini API service tier. */
export type PiAiServiceTier = typeof SERVICE_TIERS[number]

/** The only wire protocol whose requests take a service tier. */
const SERVICE_TIER_API = 'google-generative-ai'

/**
 * How long a Flex request may wait for its first bytes. The provider targets
 * one to fifteen minutes for a Flex response and sends nothing meanwhile.
 */
export const FLEX_STREAM_IDLE_TIMEOUT_MS = 900_000

/**
 * Whether a model's requests can carry a service tier.
 * @param model - the resolved pi-ai model.
 * @returns whether the model speaks the Gemini API protocol.
 */
export function takesServiceTier(model: Model<Api>): boolean {
  return model.api === SERVICE_TIER_API
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Add a service tier to the request pi-ai's Gemini protocol built.
 * @param payload - the `generateContentStream` parameters pi-ai is about to send.
 * @param tier - the tier the route selected.
 * @returns the parameters with `config.serviceTier` set, or `undefined` to keep a payload of another shape unchanged.
 */
export function withServiceTier(payload: unknown, tier: PiAiServiceTier): unknown {
  if (!isRecord(payload)) return undefined
  return { ...payload, config: { ...isRecord(payload['config']) ? payload['config'] : {}, serviceTier: tier } }
}
