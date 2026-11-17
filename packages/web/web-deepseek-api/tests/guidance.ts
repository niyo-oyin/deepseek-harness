/** Endpoint guidance and credential values for provider tests that construct a provider or a request directly. */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { DeepSeekWebAuth, DeepSeekWebGuidance } from '../src/transport.ts'

/**
 * Guidance of an operation whose capability uses its own base URL and key.
 * @param capability - the capability whose endpoint the guidance names.
 * @returns the guidance fields.
 */
export function customGuidance(capability: 'search' | 'fetch'): DeepSeekWebGuidance {
  return {
    subject: capability === 'search' ? 'Search' : 'Fetch', plugin: 'web-deepseek-api', custom: true,
    baseURLField: `${capability}BaseURL`, apiKeyEnvField: `${capability}ApiKeyEnv`,
  }
}

/**
 * Credential of an operation whose referenced key reads as `key`.
 * @param key - the value the reference resolves to; undefined means no key is stored.
 * @param baseURL - the API base the key is sent to.
 * @returns the operation's credential.
 */
export function referencedKeyAuth(key: string | undefined, baseURL: string): DeepSeekWebAuth {
  return {
    source: { kind: 'api-key', baseURL, key: {
      ref: credentialRef('DEEPSEEK_API_KEY'), configured: async () => key !== undefined, resolve: async () => key,
    } },
    missingCredentialMessage: 'no key is configured for "DEEPSEEK_API_KEY"',
  }
}
