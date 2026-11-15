// @vitest-environment jsdom
/** The settings route field over the shared model catalog: default entry, grouping, effort, and unavailable routes. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import { ModelRouteField } from '../src/client/ModelRouteField.tsx'
import type { ModelCatalogState } from '../src/client/catalog.ts'
import { en, type ModelKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: ModelKey): string => en[key]

const CATALOG: ModelCatalog = {
  default: { provider: 'anthropic', model: 'claude-opus-5-5' },
  routableProviders: ['anthropic', 'gateway'],
  groups: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: [
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
        { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
      ],
    },
    { id: 'gateway', name: 'Gateway', models: [{ id: 'small', name: 'Small' }] },
  ],
  failures: [],
}

function renderField(value: unknown, catalog: ModelCatalogState = { value: CATALOG, status: 'ready', error: null }) {
  const store = createSnapshotStore<ModelCatalogState>(catalog)
  const onChange = vi.fn()
  const load = vi.fn()
  render(<ModelRouteField id="reviewer" value={value} disabled={false} onChange={onChange} catalog={store} load={load} t={t} />)
  return { onChange, load, store }
}

const modelSelect = () => screen.getAllByRole<HTMLSelectElement>('combobox')[0]!
const effortSelect = () => screen.queryByRole<HTMLSelectElement>('combobox', { name: en['menu.effort'] })

it('starts on the session model, grouped by provider, and loads the shared catalog', () => {
  const { load } = renderField(undefined)
  expect(load).toHaveBeenCalledOnce()
  expect(modelSelect().value).toBe('')
  expect(modelSelect().options[0]?.text).toBe(en['route.session'])
  const groups = [...modelSelect().querySelectorAll('optgroup')].map(group => [group.label, [...group.querySelectorAll('option')].map(option => option.text)])
  expect(groups).toEqual([['Anthropic', ['Claude Opus 5.5', 'Claude Haiku 5.5']], ['Gateway', ['Small']]])
  expect(effortSelect()).toBeNull()
})

it('writes the chosen route, then the effort the model offers, and unsets on the session entry', () => {
  const { onChange } = renderField(undefined)
  fireEvent.change(modelSelect(), { target: { value: 'gateway\0small' } })
  expect(onChange).toHaveBeenLastCalledWith({ provider: 'gateway', model: 'small' })
  cleanup()

  const second = renderField({ provider: 'anthropic', model: 'claude-opus-5-5' })
  expect([...effortSelect()!.options].map(option => [option.value, option.text])).toEqual([['', en['effort.providerDefault']], ['low', 'Low'], ['high', 'High']])
  fireEvent.change(effortSelect()!, { target: { value: 'high' } })
  expect(second.onChange).toHaveBeenLastCalledWith({ provider: 'anthropic', model: 'claude-opus-5-5', reasoningEffort: 'high' })
  fireEvent.change(modelSelect(), { target: { value: '' } })
  expect(second.onChange).toHaveBeenLastCalledWith(undefined)
})

it('offers no effort select for a model without levels', () => {
  renderField({ provider: 'anthropic', model: 'claude-haiku-5-5' })
  expect(modelSelect().value).toBe('anthropic\0claude-haiku-5-5')
  expect(effortSelect()).toBeNull()
})

it('keeps a configured route the catalog no longer offers, marked unavailable', () => {
  const { store } = renderField({ provider: 'gone', model: 'old', reasoningEffort: 'high' }, { value: null, status: 'loading', error: null })
  // Until the catalog answers, the stored route is shown as stored, not yet judged.
  expect(modelSelect().selectedOptions[0]?.text).toBe('gone · old')
  act(() => { store.set({ value: CATALOG, status: 'ready', error: null }) })
  expect(modelSelect().value).toBe('gone\0old')
  expect(modelSelect().selectedOptions[0]?.text).toBe(en['route.unavailable'].replace('{model}', 'gone · old'))
  expect(screen.getByText(en['route.unavailableHint'])).toBeTruthy()
  expect(effortSelect()).toBeNull()
})
