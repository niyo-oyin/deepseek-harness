/** Desktop client identity sent with each mandatory-update policy check. */

/** Identity of the requesting Desktop UI for one policy check. */
export interface DesktopClientMetadata {
  readonly version: string
  /** Active UI language; only its primary subtag selects the wire locale. */
  readonly locale: string
  /** Offset from UTC in seconds, positive east of Greenwich. */
  readonly timezoneOffsetSeconds: number
}

/**
 * Read the client build version inlined by the Desktop build.
 * @returns the version embedded in this application build.
 * @throws Error when the build carries no client version, instead of reporting a guessed one.
 */
export function desktopClientVersion(): string {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined || version === '') {
    throw new Error('desktop client: this application build carries no DSH_CLIENT_VERSION')
  }
  return version
}

/**
 * Sample the Desktop client identity for one policy check.
 * @param locale - current resolved Desktop language.
 * @returns this call's build version, the raw active language, and the UTC offset in whole seconds east.
 */
export function desktopClientMetadata(locale: string): DesktopClientMetadata {
  return {
    version: desktopClientVersion(),
    locale,
    // Date.getTimezoneOffset reports minutes west of UTC; the policy service wants seconds east.
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/**
 * Build the client identity headers of one policy check.
 * @param platform - Operating system of the installed Desktop.
 * @param client - identity of the requesting UI for this check.
 * @returns the five client headers; the bundle ID is intentionally empty.
 */
export function desktopClientHeaders(platform: 'darwin' | 'win32', client: DesktopClientMetadata): Record<string, string> {
  return {
    'x-client-bundle-id': '',
    'x-client-platform': platform === 'win32' ? 'desktop-win' : 'desktop-mac',
    'x-client-version': client.version,
    // The service accepts only these two region-tagged locales.
    'x-client-locale': client.locale.toLowerCase().split(/[-_]/)[0] === 'zh' ? 'zh_CN' : 'en_US',
    'x-client-timezone-offset': String(client.timezoneOffsetSeconds),
  }
}
