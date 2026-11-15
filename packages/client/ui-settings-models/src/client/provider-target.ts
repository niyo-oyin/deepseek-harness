/** What a provider editor addresses, derived from one joined directory row. */
import type { LlmNativeAuth } from '@deepseek-ai/dsh-api-remotes/client'
import { deriveKeyRef, wholeSection } from './store.ts'
import type { ProviderRow } from './store.ts'

/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
}

/** One existing row or dormant directory entry addressed by an editor action. */
export interface EditorTarget extends ProviderIdentity {
  settingsNs: string
  settingsPath: readonly string[]
  /** Writable credential the page stored under this provider's reference; removal clears it. */
  credentialRef?: string
  /** The adapter reports this route as one it does not ship. */
  declared?: boolean
  /** The route's catalog endpoint. */
  defaultBaseURL?: string
  /** Environment used to construct an endpoint. */
  baseURLEnv?: readonly string[]
  /** The route's native authentication. */
  nativeAuth?: LlmNativeAuth
  /** Service tiers the route offers. */
  serviceTiers?: readonly string[]
}

/**
 * The provider-card seat's credential fact: the reference this page would use
 * for the row — the profile's `apiKeyEnv`, or the page's derived
 * `<ROUTE>_API_KEY` while the profile names none — confirmed configured.
 * @param row - one joined row.
 * @returns whether that reference resolves.
 */
export function keyConfiguredOf(row: ProviderRow): boolean {
  return row.apiKeyEnv !== undefined
    ? row.credential?.configured === true
    : row.derivedCredential?.configured === true
}

/**
 * Address one row for an editor or a removal. A provider's key is cleared on
 * removal only when the page stored it: a whole-section provider's key is the
 * one its section names, another provider's is the page's derived reference.
 * @param row - one joined row.
 * @returns the editor target.
 */
export function targetOf(row: ProviderRow): EditorTarget {
  const managedRef = wholeSection(row) ? row.apiKeyEnv : deriveKeyRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    && row.credential.source !== 'env'
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    // Only declared routes may expose route-owned fields.
    ...row.entry.declared === true ? { declared: true } : {},
    ...row.entry.defaultBaseURL === undefined ? {} : { defaultBaseURL: row.entry.defaultBaseURL },
    ...row.entry.baseURLEnv === undefined ? {} : { baseURLEnv: row.entry.baseURLEnv },
    ...row.entry.nativeAuth === undefined ? {} : { nativeAuth: row.entry.nativeAuth },
    ...row.entry.serviceTiers === undefined ? {} : { serviceTiers: row.entry.serviceTiers },
  }
}
