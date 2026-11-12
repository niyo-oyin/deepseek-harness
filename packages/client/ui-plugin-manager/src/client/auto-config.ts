/**
 * The fields of a served configuration schema that a generated form can edit.
 *
 * The Host serves every active entry's live Config fields as a serialized
 * schema and marks whether a page may be generated for an entry that registers
 * none. This module reads that serialized form directly: `{ uid, refs }`, where
 * each ref is one schema node and nested nodes are named by uid. Reading the
 * JSON keeps the Plugins page independent of a schema runtime.
 */

import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'

/** How a generated form edits one field. */
export type AutoFieldKind = 'text' | 'number' | 'boolean' | 'choice' | 'secret'

/** One field a generated form renders. */
export interface AutoField {
  /** Field name inside the entry's Config. */
  readonly name: string
  readonly kind: AutoFieldKind
  /** The schema's own description, when it declares one as text or in the requested language. */
  readonly description?: string
  /** Accepted values of a `choice` field, in declaration order. */
  readonly choices?: readonly string[]
  /** The schema default rendered as text, when it is a scalar. */
  readonly defaultText?: string
}

/** What a generated form can and cannot edit of one entry. */
export interface AutoConfig {
  readonly fields: readonly AutoField[]
  /** Names of declared fields whose type a generated form does not edit. */
  readonly unsupported: readonly string[]
}

interface SchemaNode {
  readonly type?: unknown
  readonly meta?: unknown
  readonly dict?: unknown
  readonly list?: unknown
  readonly value?: unknown
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function describe(description: unknown, language: string): string | undefined {
  if (typeof description === 'string') return description === '' ? undefined : description
  const localized = record(description)
  if (localized === undefined) return undefined
  const primary = language.split('-')[0] ?? language
  for (const key of [language, primary, 'en', '']) {
    const text = localized[key]
    if (typeof text === 'string' && text !== '') return text
  }
  return undefined
}

function scalarText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value
    : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined
}

/**
 * Read the editable fields of one serialized schema.
 * @param schema - the `schema` of a settings namespace view.
 * @param language - active locale id, selecting a localized description.
 * @returns the fields a generated form edits and the declared fields it leaves to the profile document;
 *   both empty when the schema is not a serialized object schema.
 */
export function autoConfig(schema: unknown, language: string): AutoConfig {
  const envelope = record(schema)
  const refs = record(envelope?.refs)
  const node = (uid: unknown): SchemaNode | undefined =>
    typeof uid === 'number' || typeof uid === 'string' ? record(refs?.[String(uid)]) : undefined
  const root = node(envelope?.uid)
  const dict = record(root?.dict)
  if (root?.type !== 'object' || dict === undefined) return { fields: [], unsupported: [] }
  const fields: AutoField[] = []
  const unsupported: string[] = []
  for (const [name, uid] of Object.entries(dict)) {
    const child = node(uid)
    const meta = record(child?.meta) ?? {}
    if (child === undefined || meta.hidden === true || meta.disabled === true) continue
    const description = describe(meta.description, language)
    const defaultText = scalarText(meta.default)
    const shared = { name, ...description === undefined ? {} : { description }, ...defaultText === undefined ? {} : { defaultText } }
    if (child.type === 'string') {
      // A secret never rides a response, so its default is not rendered either.
      fields.push(meta.role === 'secret' ? { name, kind: 'secret', ...description === undefined ? {} : { description } } : { ...shared, kind: 'text' })
    } else if (child.type === 'number') {
      fields.push({ ...shared, kind: 'number' })
    } else if (child.type === 'boolean') {
      fields.push({ ...shared, kind: 'boolean' })
    } else if (child.type === 'union' && Array.isArray(child.list)) {
      const choices = child.list.map((item) => {
        const option = node(item)
        return option?.type === 'const' && typeof option.value === 'string' ? option.value : undefined
      })
      if (choices.length > 0 && choices.every(choice => choice !== undefined)) {
        fields.push({ ...shared, kind: 'choice', choices: choices as string[] })
      } else {
        unsupported.push(name)
      }
    } else {
      unsupported.push(name)
    }
  }
  return { fields, unsupported }
}

/**
 * A true/false field staged as the text `true` or `false`. An empty draft clears the field.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function autoBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'boolean' ? String(value) : '',
    parse: text => text === '' ? { kind: 'clear' } : text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined,
  }
}

/**
 * A field accepting one of the schema's declared values. An empty draft clears the field;
 * any other draft outside the declared values blocks the save.
 * @param field - field name inside the namespace section.
 * @param choices - the accepted values.
 * @returns the field's conversion spec.
 */
export function autoChoiceField(field: string, choices: readonly string[]): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : choices.includes(trimmed) ? { kind: 'set', value: trimmed } : undefined
    },
  }
}
