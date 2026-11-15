/** Startup appearance and language read from the owned Desktop Host's settings over standard RPC. */

import { randomUUID } from 'node:crypto'

/** The shared preferences the main process applies before the workspace becomes visible. */
export interface DesktopStartupPreferences {
  readonly localePreference: string | null
  /** Effective Host theme preference; absent or invalid optional theme settings use system appearance. */
  readonly themePreference: 'light' | 'dark' | 'system'
}

/** Narrow preference reads against the owned Host. */
export interface DesktopPreferences {
  /** @returns The shared language and theme preferences. */
  read(): Promise<DesktopStartupPreferences>
  /** @returns The saved UI language. */
  readLocalePreference(): Promise<string | null>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Connect the native HTTP client to the Desktop Host; every request sends `cookie` explicitly and uses no cookie jar.
 * @param hostUrl - URL of the running Desktop Host; only its origin is used.
 * @param cookie - Desktop-private authentication header for this owned Host.
 * @param send - HTTP client for Host requests.
 * @returns the preference reads.
 */
export function connectDesktopPreferences(
  hostUrl: string,
  cookie: string,
  send: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): DesktopPreferences {
  const origin = new URL(hostUrl).origin
  const describeSettings = async (): Promise<unknown[]> => {
    const rpcId = randomUUID()
    const method = 'settings/describe'
    const response = await send(new URL(`/api/${method}`, origin).href, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: {} } }),
    })
    if (!response.ok) throw new Error('desktop preferences: Web request failed')
    const envelope: unknown = await response.json()
    if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !record(envelope.result) || envelope.result.ok !== true) {
      throw new Error('desktop preferences: Web RPC failed')
    }
    const settings = envelope.result.value
    const namespaces: unknown = record(settings) ? settings.namespaces : undefined
    if (!Array.isArray(namespaces)) throw new Error('desktop preferences: missing settings namespaces')
    return namespaces as unknown[]
  }
  const localePreference = (namespaces: unknown[]): string | null => {
    const locale: unknown = namespaces.find((item: unknown) => record(item) && item.ns === 'locale')
    if (!record(locale) || !record(locale.value)
      || (locale.value.preference !== undefined && typeof locale.value.preference !== 'string')) {
      throw new Error('desktop preferences: invalid locale preference')
    }
    return locale.value.preference ?? null
  }
  const themePreference = (namespaces: unknown[]): DesktopStartupPreferences['themePreference'] => {
    const theme = namespaces.find(item => record(item) && item.ns === 'ui-theme')
    if (theme === undefined) return 'system'
    const preference = record(theme) && record(theme.value) ? theme.value.preference : undefined
    if (preference === 'light' || preference === 'dark' || preference === 'system') return preference
    console.warn('desktop appearance: invalid Host theme preference; using system appearance')
    return 'system'
  }
  return {
    async read() {
      const namespaces = await describeSettings()
      return { localePreference: localePreference(namespaces), themePreference: themePreference(namespaces) }
    },
    async readLocalePreference() {
      return localePreference(await describeSettings())
    },
  }
}
