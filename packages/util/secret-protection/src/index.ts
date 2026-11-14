/**
 * Operating-system protection for secrets stored on disk, and the spelling a
 * protected value takes inside plugin configuration.
 * @module @deepseek-ai/dsh-secret-protection
 */

import type { SecretProtection } from './dpapi.ts'

export { loadDpapi, loadPlatformProtection } from './dpapi.ts'
export type { SecretProtection } from './dpapi.ts'

/** The single member of the mapping that carries a protected configuration value. */
const PROTECTED_VALUE_KEY = '__dpapi'

/** A configuration value stored protected: a mapping whose only member is the ciphertext. */
export interface ProtectedValue {
  /** Base64 ciphertext only the Windows account that stored it can decrypt. */
  __dpapi: string
}

/** Whether a value is a plain data object the walkers may recurse into. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Whether a configuration value is in its protected spelling.
 * @param value - any configuration value.
 * @returns whether it is a mapping holding only a ciphertext.
 */
export function isProtectedValue(value: unknown): value is ProtectedValue {
  return isPlainObject(value) && Object.keys(value).length === 1 && typeof value[PROTECTED_VALUE_KEY] === 'string'
}

/**
 * Protect one configuration secret for storage.
 * @param secret - the secret text.
 * @param protection - the platform's protection.
 * @returns the mapping to store in place of the secret.
 */
export function protectValue(secret: string, protection: SecretProtection): ProtectedValue {
  return { [PROTECTED_VALUE_KEY]: protection.protect(secret) }
}

/**
 * Replace every protected value inside a configuration with its secret. Plain
 * objects and arrays are walked; anything else passes through untouched, and a
 * configuration holding no protected value is returned as the same object.
 * @param config - a plugin's raw configuration.
 * @param protection - the platform's protection; `undefined` refuses a protected value.
 * @param subject - what the configuration belongs to, for a diagnostic.
 * @returns the configuration with protected values opened.
 * @throws naming the subject and the field path, never a value, when a protected value cannot be opened.
 */
export function openProtectedValues(config: unknown, protection: SecretProtection | undefined, subject: string): unknown {
  const open = (value: unknown, path: readonly string[]): unknown => {
    if (isProtectedValue(value)) {
      const where = `${subject} field "${path.join('.')}"`
      if (protection === undefined) {
        throw new Error(
          `secret-protection: ${where} is protected by a Windows account and cannot be read on this platform; set the value again`,
        )
      }
      try {
        return protection.unprotect(value[PROTECTED_VALUE_KEY])
      } catch {
        throw new Error(
          `secret-protection: ${where} cannot be decrypted by this Windows account;`
          + ' it was stored by another account or on another machine; set the value again',
        )
      }
    }
    if (Array.isArray(value)) {
      const items = value.map((item, index) => open(item, [...path, String(index)]))
      return items.some((item, index) => item !== value[index]) ? items : value
    }
    if (!isPlainObject(value)) return value
    let changed = false
    const result: Record<string, unknown> = {}
    for (const [key, member] of Object.entries(value)) {
      const opened = open(member, [...path, key])
      changed ||= opened !== member
      Object.defineProperty(result, key, { value: opened, enumerable: true, writable: true, configurable: true })
    }
    return changed ? result : value
  }
  return open(config, [])
}
