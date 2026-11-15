// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { StrictMode } from 'react'
import { autoBooleanField, autoChoiceField, autoConfig, autoRoleField } from '../src/client/auto-config.ts'
import type { PluginConfigFieldProps } from '../src/client/slot-contract.ts'
import { AutoConfigForm } from '../src/client/AutoConfigForm.tsx'
import { en, type PluginManagerLocaleKey } from '../src/client/locales.ts'
import type { Translate } from '../src/client/presentation.ts'

afterEach(cleanup)

const t = ((key: PluginManagerLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key])) as Translate

/** A serialized schema as the Host serves it: nodes by uid, nested nodes named by uid. */
const SCHEMA = {
  uid: 1,
  refs: {
    1: { type: 'object', meta: {}, dict: { name: 2, apiKey: 3, count: 4, strict: 5, mode: 6, tags: 9, internal: 10, mixed: 11, locked: 12 } },
    2: { type: 'string', meta: { description: 'Provider id.', default: 'exa' } },
    3: { type: 'string', meta: { role: 'secret', default: 'never shown' } },
    4: { type: 'number', meta: { default: 3 } },
    5: { type: 'boolean', meta: { default: true } },
    6: { type: 'union', meta: { default: 'auto', description: { ja: '検索方式', en: 'Search type.' } }, list: [7, 8] },
    7: { type: 'const', value: 'auto', meta: {} },
    8: { type: 'const', value: 'neural', meta: {} },
    9: { type: 'array', meta: {}, inner: 2 },
    10: { type: 'string', meta: { hidden: true } },
    11: { type: 'union', meta: {}, list: [7, 4] },
    12: { type: 'string', meta: { disabled: true } },
  },
}

describe('autoConfig', () => {
  it('reads scalar, choice, and secret fields and reports the rest', () => {
    expect(autoConfig(SCHEMA, 'en')).toEqual({
      fields: [
        { name: 'name', kind: 'text', description: 'Provider id.', defaultText: 'exa' },
        { name: 'apiKey', kind: 'secret' },
        { name: 'count', kind: 'number', defaultText: '3' },
        { name: 'strict', kind: 'boolean', defaultText: 'true' },
        { name: 'mode', kind: 'choice', description: 'Search type.', defaultText: 'auto', choices: ['auto', 'neural'] },
      ],
      unsupported: ['tags', 'mixed'],
    })
  })

  it('selects a localized description by the active language, then its primary subtag', () => {
    const mode = (language: string) => autoConfig(SCHEMA, language).fields.find(field => field.name === 'mode')?.description
    expect(mode('ja')).toBe('検索方式')
    expect(mode('ja-JP')).toBe('検索方式')
    expect(mode('fr')).toBe('Search type.')
  })

  it.each([undefined, null, {}, { uid: 1 }, { uid: 1, refs: {} }, { uid: 1, refs: { 1: { type: 'string', meta: {} } } },
    { uid: 1, refs: { 1: { type: 'object', meta: {} } } }])('reads no field from %j', (schema) => {
    expect(autoConfig(schema, 'en')).toEqual({ fields: [], unsupported: [] })
  })

  it('skips a field whose node is missing and a description that is empty or of another type', () => {
    const schema = { uid: 'a', refs: { a: { type: 'object', dict: { gone: 'x', plain: 'b', odd: 'c', none: 'd' } },
      b: { type: 'string', meta: { description: '' } }, c: { type: 'string', meta: { description: 7, default: '' } },
      d: { type: 'string', meta: { description: { de: '' } } } } }
    expect(autoConfig(schema, 'en')).toEqual({
      fields: [{ name: 'plain', kind: 'text' }, { name: 'odd', kind: 'text' }, { name: 'none', kind: 'text' }], unsupported: [],
    })
  })
})

describe('generated field specs', () => {
  it('stages a boolean as true or false text', () => {
    const spec = autoBooleanField('strict')
    expect([spec.format(true), spec.format(false), spec.format('yes')]).toEqual(['true', 'false', ''])
    expect([spec.parse('true'), spec.parse('false'), spec.parse(''), spec.parse('maybe')])
      .toEqual([{ kind: 'set', value: true }, { kind: 'set', value: false }, { kind: 'clear' }, undefined])
  })

  it('accepts only declared choices', () => {
    const spec = autoChoiceField('mode', ['auto', 'neural'])
    expect([spec.format('auto'), spec.format(3)]).toEqual(['auto', ''])
    expect([spec.parse(' neural '), spec.parse(''), spec.parse('fast')]).toEqual([{ kind: 'set', value: 'neural' }, { kind: 'clear' }, undefined])
  })
})

describe('AutoConfigForm', () => {
  function renderForm(stored: readonly string[] = [], config = autoConfig(SCHEMA, 'en'), mode = 'auto') {
    const stub = stubConfigForm<Record<string, unknown>>()
    stub.publish({ status: 'ready', writable: true, revision: 4, value: { name: 'exa', count: 3, strict: true, mode }, base: { strict: true }, user: { strict: true } })
    const view = render(
      <StrictMode>
        <AutoConfigForm scope={stub.scope} config={config} storedSecrets={new Set(stored)} t={t} renderField={() => null} />
      </StrictMode>,
    )
    return { stub, view }
  }

  it('renders one control per field with its description and default, and a choice as a dropdown', () => {
    renderForm()
    expect((screen.getByLabelText('name') as HTMLInputElement).value).toBe('exa')
    expect((screen.getByLabelText('count') as HTMLInputElement).value).toBe('3')
    expect(screen.getByRole('switch', { name: 'strict' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Provider id. Default: exa.')).toBeTruthy()
    expect(screen.getByText('Search type. Default: auto.')).toBeTruthy()
    const mode = screen.getByLabelText('mode') as HTMLSelectElement
    expect(mode.value).toBe('auto')
    expect([...mode.options].map(option => [option.value, option.text])).toEqual([['', en.autoConfigChoiceDefault], ['auto', 'auto'], ['neural', 'neural']])
    expect(screen.getByText('Edit these fields in the profile configuration file: tags, mixed')).toBeTruthy()
    expect((screen.getByLabelText('apiKey') as HTMLInputElement).type).toBe('password')
    expect(screen.getByText(en.autoConfigSecretUnset)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear the stored apiKey' })).toBeNull()
    expect((screen.getByRole('button', { name: en.autoConfigSave }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('writes staged edits in one mutation and the secret separately on save', async () => {
    const { stub } = renderForm()
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'exa-anon' } })
    fireEvent.change(screen.getByLabelText('count'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('mode'), { target: { value: 'neural' } })
    fireEvent.click(screen.getByRole('switch', { name: 'strict' }))
    fireEvent.change(screen.getByLabelText('apiKey'), { target: { value: ' secret-value ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.autoConfigSave })) })
    expect(stub.mutate.mock.calls).toEqual([
      [[
        { op: 'set', path: ['name'], value: 'exa-anon' },
        { op: 'unset', path: ['count'] },
        { op: 'set', path: ['mode'], value: 'neural' },
        { op: 'set', path: ['strict'], value: false },
      ], 4],
      [[{ op: 'set', path: ['apiKey'], value: 'secret-value' }]],
    ])
  })

  it('blocks the save while a number draft is not accepted', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('count'), { target: { value: 'many' } })
    expect(screen.getByText(en.autoConfigInvalidNumber)).toBeTruthy()
    expect((screen.getByRole('button', { name: en.autoConfigSave }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a stored choice outside the declared values until another one replaces it', async () => {
    const { stub } = renderForm([], autoConfig(SCHEMA, 'en'), 'fast')
    const mode = screen.getByLabelText('mode') as HTMLSelectElement
    expect(mode.value).toBe('fast')
    expect([...mode.options].map(option => option.value)).toEqual(['', 'fast', 'auto', 'neural'])
    fireEvent.change(mode, { target: { value: '' } })
    expect([...mode.options].map(option => option.value)).toEqual(['', 'auto', 'neural'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.autoConfigSave })) })
    expect(stub.mutate.mock.calls).toEqual([[[{ op: 'unset', path: ['mode'] }], 4]])
  })

  it('stages a reset of an overridden switch back to the composition value', async () => {
    const { stub } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: en.autoConfigReset }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.autoConfigSave })) })
    expect(stub.mutate.mock.calls).toEqual([[[{ op: 'unset', path: ['strict'] }], 4]])
  })

  it('reports a stored secret and clears it at once', () => {
    const { stub } = renderForm(['apiKey'])
    expect(screen.getByText(en.autoConfigSecretSet)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear the stored apiKey' }))
    expect(stub.mutate.mock.calls).toEqual([[[{ op: 'unset', path: ['apiKey'] }]]])
  })

  it('disables every control on a read-only document and releases its subscription on unmount', () => {
    const { stub, view } = renderForm(['apiKey'], { fields: autoConfig(SCHEMA, 'en').fields, unsupported: [] })
    act(() => { stub.publish({ writable: false }) })
    expect(screen.getByText(en.autoConfigReadOnly)).toBeTruthy()
    expect((screen.getByLabelText('name') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('switch', { name: 'strict' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Clear the stored apiKey' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/Edit these fields/u)).toBeNull()
    view.unmount()
    expect(stub.listenerCount()).toBe(0)
  })

  it('renders a switch without a hint when the schema declares no description or default', () => {
    const stub = stubConfigForm<Record<string, unknown>>()
    stub.publish({ status: 'ready', writable: true, revision: 0, value: {}, base: {}, user: {} })
    render(<AutoConfigForm scope={stub.scope} config={{ fields: [{ name: 'flag', kind: 'boolean' }], unsupported: [] }} storedSecrets={new Set()} t={t} renderField={() => null} />)
    expect(screen.getByRole('switch', { name: 'flag' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByText(/Default/u)).toBeNull()
  })
})

describe('role fields', () => {
  /** A schema with one `model-route` object field, as auto-review declares it. */
  const ROUTE_SCHEMA = {
    uid: 1,
    refs: {
      1: { type: 'object', meta: {}, dict: { reviewer: 2 } },
      2: { type: 'object', meta: { role: 'model-route', default: {}, description: { en: 'Reviews cost one request each.', ja: '審査ごとに 1 回' } }, dict: { provider: 3, model: 3 } },
      3: { type: 'string', meta: {} },
    },
  }

  it('edits a field through the editor registered for its role, and lists it as unsupported without one', () => {
    expect(autoConfig(ROUTE_SCHEMA, 'ja', new Set(['model-route']))).toEqual({
      fields: [{ name: 'reviewer', kind: 'role', role: 'model-route', description: '審査ごとに 1 回' }], unsupported: [],
    })
    expect(autoConfig(ROUTE_SCHEMA, 'en')).toEqual({ fields: [], unsupported: ['reviewer'] })
  })

  it('stages a role value as JSON text and clears an empty one', () => {
    const spec = autoRoleField('reviewer')
    expect([spec.format({ provider: 'p', model: 'm' }), spec.format({}), spec.format(undefined)]).toEqual(['{"provider":"p","model":"m"}', '', ''])
    expect([spec.parse('{"provider":"p","model":"m"}'), spec.parse(''), spec.parse('{}'), spec.parse('{')])
      .toEqual([{ kind: 'set', value: { provider: 'p', model: 'm' } }, { kind: 'clear' }, { kind: 'clear' }, undefined])
  })

  it('hands the staged value to the role editor and writes what it stages on save', async () => {
    const stub = stubConfigForm<Record<string, unknown>>()
    stub.publish({ status: 'ready', writable: true, revision: 2, value: { reviewer: {} }, base: { reviewer: {} }, user: {} })
    const seen: PluginConfigFieldProps[] = []
    render(<AutoConfigForm
      scope={stub.scope} config={autoConfig(ROUTE_SCHEMA, 'en', new Set(['model-route']))} storedSecrets={new Set()} t={t}
      renderField={(role, field) => {
        seen.push(field)
        return (
          <button type="button" id={field.id} onClick={() => { field.onChange({ provider: 'cheap', model: 'small' }) }}>
            {`${role}:${JSON.stringify(field.value) ?? 'unset'}`}
          </button>
        )
      }}
    />)
    expect(screen.getByText('model-route:unset')).toBeTruthy()
    // The editor owns the heading: the form prints no raw field name for it.
    expect(screen.queryByText('reviewer')).toBeNull()
    expect(screen.getByText('Reviews cost one request each.')).toBeTruthy()
    fireEvent.click(screen.getByText('model-route:unset'))
    expect(screen.getByText('model-route:{"provider":"cheap","model":"small"}')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.autoConfigSave })) })
    expect(stub.mutate.mock.calls).toEqual([[[{ op: 'set', path: ['reviewer'], value: { provider: 'cheap', model: 'small' } }], 2]])
    expect(seen.at(-1)?.disabled).toBe(false)
  })
})
