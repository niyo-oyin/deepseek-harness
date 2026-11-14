/**
 * Structural secret redaction for settings values. `role('secret')` fields are
 * removed from a value before it crosses a wire boundary; a sidecar records
 * each schema-declared secret position and whether it currently holds a value,
 * so a configuration surface can render a write-only input without ever
 * receiving the secret itself.
 * @module @deepseek-ai/dsh-settings/redact
 */

import type z from '@deepseek-ai/schemastery'

/**
 * Minimal structural view of a live schemastery node. Only the relations the
 * redactor walks are named; everything else on the instance is ignored.
 */
interface SchemaNode {
  type?: string
  meta?: { role?: unknown }
  /** `object` properties, keyed by property name. */
  dict?: Record<string, SchemaNode>
  /** `dict`/`array` element schema. */
  inner?: SchemaNode
  list?: SchemaNode[]
}

/** One schema-declared secret position inside a redacted value. */
export interface RedactedSecret {
  /** Path from the section root to the removed field (concrete dict keys and array indexes included). */
  path: string[]
  /** Whether the field held a value before redaction. */
  set: boolean
}

/** A value with every `role('secret')` field removed, plus the removal record. */
export interface RedactedValue {
  /** Detached copy of the input with secret fields absent. */
  value: unknown
  /**
   * Every reachable secret position: object properties always (even unset, so
   * a form knows the slot exists), dict entries and array items only where the
   * value has them.
   */
  secrets: RedactedSecret[]
}

/** Whether a value is a plain data object the walker may recurse into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function walk(node: SchemaNode | undefined, value: unknown, path: string[], secrets: RedactedSecret[]): unknown {
  if (node === undefined) return value
  if (node.meta?.role === 'secret') {
    secrets.push({ path, set: value !== undefined })
    return undefined
  }
  switch (node.type) {
    case 'object': {
      const properties = node.dict ?? {}
      const source = isRecord(value) ? value : undefined
      const rebuilt: Record<string, unknown> = {}
      if (source !== undefined) {
        for (const [key, entry] of Object.entries(source)) {
          if (key in properties) continue
          rebuilt[key] = entry
        }
      }
      for (const [key, child] of Object.entries(properties)) {
        const stripped = walk(child, source?.[key], [...path, key], secrets)
        if (stripped !== undefined) rebuilt[key] = stripped
      }
      return source === undefined && Object.keys(rebuilt).length === 0 ? value : rebuilt
    }
    case 'dict': {
      if (!isRecord(value)) return value
      const rebuilt: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value)) {
        const stripped = walk(node.inner, entry, [...path, key], secrets)
        if (stripped !== undefined) rebuilt[key] = stripped
      }
      return rebuilt
    }
    case 'array': {
      if (!Array.isArray(value)) return value
      return value.map((entry, index) => walk(node.inner, entry, [...path, String(index)], secrets))
    }
    case 'union':
    case 'intersect':
      return (node.list ?? []).reduce((current, child) => walk(child, current, path, secrets), value)
    case 'transform':
      return walk(node.inner, value, path, secrets)
    default:
      return value
  }
}

/** One member of an inherited container, or `undefined` when the inherited layer has none. */
function inheritedMember(inherited: unknown, key: string | number): unknown {
  if (Array.isArray(inherited)) return typeof key === 'number' ? inherited[key] : undefined
  return isRecord(inherited) && Object.hasOwn(inherited, key) ? inherited[key] : undefined
}

function protectWalk(
  node: SchemaNode | undefined, value: unknown, inherited: unknown, protect: (secret: string) => unknown,
): unknown {
  if (node === undefined || value === undefined) return value
  if (node.meta?.role === 'secret') {
    return typeof value === 'string' && value.length > 0 && value !== inherited ? protect(value) : value
  }
  switch (node.type) {
    case 'object': {
      if (!isRecord(value)) return value
      const properties = node.dict ?? {}
      return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
        [key, protectWalk(properties[key], entry, inheritedMember(inherited, key), protect)]))
    }
    case 'dict':
      if (!isRecord(value)) return value
      return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
        [key, protectWalk(node.inner, entry, inheritedMember(inherited, key), protect)]))
    case 'array':
      return Array.isArray(value)
        ? value.map((entry, index) => protectWalk(node.inner, entry, inheritedMember(inherited, index), protect))
        : value
    case 'union':
    case 'intersect':
      return (node.list ?? []).reduce<unknown>((current, child) => protectWalk(child, current, inherited, protect), value)
    case 'transform':
      return protectWalk(node.inner, value, inherited, protect)
    default:
      return value
  }
}

/**
 * Replace the text of every `role('secret')` field a schema declares with its
 * protected spelling. A field is left as it is when it is unset or empty, when
 * it is already something other than text — an expression or an earlier
 * protected value — and when it repeats the inherited layer's value, so a
 * value that only restates its default stays equal to it. The input is never
 * mutated.
 * @param schema - live schemastery schema describing the value.
 * @param value - raw configuration to store.
 * @param inherited - raw configuration of the layers beneath the stored one.
 * @param protect - builds the stored spelling of one secret.
 * @returns the value with secret text protected.
 */
export function protectSecrets(
  schema: z<never>, value: unknown, inherited: unknown, protect: (secret: string) => unknown,
): unknown {
  return protectWalk(schema, value, inherited, protect)
}

/**
 * Whether a raw configuration stores secret text that {@link protectSecrets} would protect.
 * @param schema - live schemastery schema describing the value.
 * @param value - raw configuration as stored.
 * @param inherited - raw configuration of the layers beneath the stored one.
 * @returns whether any `role('secret')` field holds text of its own.
 */
export function storesSecretText(schema: z<never>, value: unknown, inherited: unknown): boolean {
  let found = false
  protectWalk(schema, value, inherited, (secret) => { found = true; return secret })
  return found
}

/**
 * Remove every `role('secret')` field a schema declares from a value. The
 * walker visits every union branch, conservatively removing any field declared
 * secret by a branch. The input is never mutated.
 * @param schema - live schemastery schema describing the value.
 * @param value - the value to strip; `undefined` yields an empty record with
 *   object-property secret slots still enumerated.
 * @returns the stripped detached value and the ordered secret positions.
 */
export function redactSecrets(schema: z<never>, value: unknown): RedactedValue {
  const secrets: RedactedSecret[] = []
  const stripped = walk(schema, value, [], secrets)
  const positions = new Map<string, RedactedSecret>()
  for (const secret of secrets) {
    const key = JSON.stringify(secret.path)
    const previous = positions.get(key)
    positions.set(key, { ...secret, set: secret.set || previous?.set === true })
  }
  return { value: stripped, secrets: [...positions.values()] }
}
