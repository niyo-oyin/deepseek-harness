// @vitest-environment jsdom
/**
 * Reasoning of pi-ai models outside the installed catalog: the three choices,
 * the folded level rows and API values, refusals, and settling rows from what
 * the adapter describes.
 */
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { LlmDiscoveredModel, LlmDiscoveredReasoning } from '@deepseek-ai/dsh-api-remotes/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeepSeekModelDraft } from '../src/client/DeepSeekModelsEditor.tsx'
import { validateDeepSeekModels } from '../src/client/DeepSeekModelsEditor.tsx'
import { ModelListEditor } from '../src/client/ModelListEditor.tsx'
import { ModelReasoningEfforts, validateReasoningEfforts } from '../src/client/ModelReasoningEfforts.tsx'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]
const DEFAULTS = { off: null, low: 'low', medium: 'medium', high: 'high' }
/** The levels llm-pi-ai's schema lists today. */
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** An Anthropic description: adaptive effort levels suggested, budget levels as the ordinary choice. */
const ANTHROPIC: LlmDiscoveredReasoning = {
  suggested: {
    efforts: ['low', 'medium', 'high', 'max'].map(level => ({ level, value: level })),
    compat: { forceAdaptiveThinking: true },
  },
  standard: {
    efforts: [{ level: 'off', value: null }, ...['low', 'medium', 'high'].map(level => ({ level, value: level }))],
    compat: { forceAdaptiveThinking: false },
  },
}
const ADAPTIVE = { low: 'low', medium: 'medium', high: 'high', max: 'max' }

/** Render the controlled group over local state, reporting every write. */
function renderGroup(initial: DeepSeekModelDraft, options: {
  disabled?: boolean
  levels?: readonly string[]
  levelsOnly?: boolean
  reasoning?: LlmDiscoveredReasoning
  suggestionLabel?: string
} = {}) {
  const writes: DeepSeekModelDraft[] = []
  function Harness() {
    const [model, setModel] = useState(initial)
    return (
      <ModelReasoningEfforts
        model={model} levels={options.levels ?? LEVELS} levelsOnly={options.levelsOnly ?? false}
        reasoning={options.reasoning} suggestionLabel={options.suggestionLabel}
        position={1} disabled={options.disabled ?? false} t={t}
        onChange={(next) => { writes.push(next); setModel(next) }}
      />
    )
  }
  render(<Harness />)
  return { writes, efforts: () => writes.at(-1)?.['reasoningEfforts'] }
}

const choice = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name })
const checked = () => screen.queryAllByRole<HTMLInputElement>('radio').filter(radio => radio.checked).map(radio => radio.labels?.[0]?.textContent)
const details = () => screen.getByRole<HTMLButtonElement>('button', { name: en.modelEffortDetails })
const levels = () => screen.queryAllByRole<HTMLSelectElement>('combobox').map(select => select.value)
const select = (row: number) => screen.getByRole<HTMLSelectElement>('combobox', { name: `${en.modelReasoningLevel} ${String(row)}` })
const value = (level: string) => screen.getByRole<HTMLInputElement>('textbox', { name: `${level} ${en.modelReasoningValue}` })
const remove = (level: string) => screen.getByRole<HTMLButtonElement>('button', { name: `${en.modelReasoningRemove} ${level}` })
const add = () => screen.getByRole<HTMLButtonElement>('button', { name: en.modelReasoningAdd })
const entriesOf = (efforts: unknown) => Object.entries(efforts as object)

describe('ModelReasoningEfforts', () => {
  it('shows a model stating no reasoning as unset, and one stating false as None, without writing', () => {
    const { writes } = renderGroup({ id: 'chat' })
    expect(checked()).toEqual([])
    expect(screen.getByText(en.modelEffortUnset)).toBeTruthy()
    cleanup()
    renderGroup({ id: 'chat', reasoningEfforts: false })
    expect(checked()).toEqual([en.modelEffortNone])
    expect(levels()).toEqual([])
    expect(screen.queryByRole('button', { name: en.modelEffortDetails })).toBeNull()
    expect(writes).toEqual([])
  })

  it('says when nothing describes the model, and offers no suggestion', () => {
    renderGroup({ id: 'house' }, { reasoning: { standard: ANTHROPIC.standard } })
    expect(screen.getByText(en.modelEffortUnknown)).toBeTruthy()
    expect(screen.getAllByRole('radio').map(radio => (radio as HTMLInputElement).labels?.[0]?.textContent))
      .toEqual([en.modelEffortNone, en.modelEffortStandard])
  })

  it('echoes stored levels in their stored order with their API values, unfolded as custom levels', () => {
    renderGroup({ id: 'gateway', reasoningEfforts: { off: null, max: 'ultra', high: 'high' } })
    expect(checked()).toEqual([])
    expect(screen.getByText(en.modelEffortCustom)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.modelReasoningHelp })).toBeTruthy()
    expect(levels()).toEqual(['off', 'max', 'high'])
    expect(value('off').value).toBe('')
    expect(value('off').placeholder).toBe(en.modelReasoningOffValuePlaceholder)
    expect(value('off').disabled).toBe(true)
    expect(value('max').value).toBe('ultra')
    expect(value('high').value).toBe('high')
    // Each select offers its own level and the levels no other row uses.
    expect([...select(3).options].map(option => option.value)).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
    expect(screen.queryByText(en.modelReasoningValueRequired)).toBeNull()
  })

  it('chooses the standard levels while keeping other fields, folding the levels away', () => {
    const { writes } = renderGroup({ id: 'chat', contextWindow: 131072, compat: { supportsDeveloperRole: false } })
    fireEvent.click(choice(en.modelEffortStandard))
    expect(writes.at(-1)).toEqual({
      id: 'chat', contextWindow: 131072, compat: { supportsDeveloperRole: false }, reasoningEfforts: DEFAULTS,
    })
    expect(checked()).toEqual([en.modelEffortStandard])
    expect(levels()).toEqual([])
    fireEvent.click(details())
    expect(levels()).toEqual(['off', 'low', 'medium', 'high'])
  })

  it('states no reasoning with None and starts from the defaults on Standard', () => {
    const { writes } = renderGroup({ id: 'chat', reasoningEfforts: { off: 'none', high: 'deep' } })
    fireEvent.click(choice(en.modelEffortNone))
    expect(writes[0]).toEqual({ id: 'chat', reasoningEfforts: false })
    fireEvent.click(choice(en.modelEffortStandard))
    expect(writes[1]).toEqual({ id: 'chat', reasoningEfforts: DEFAULTS })
  })

  it('writes the suggestion with the switch it depends on, and None takes the switch away again', () => {
    const { writes } = renderGroup(
      { id: 'claude-opus-5-7', compat: { supportsTemperature: false } },
      { reasoning: ANTHROPIC, suggestionLabel: 'As claude-opus-5-5' },
    )
    fireEvent.click(choice('As claude-opus-5-5'))
    expect(writes.at(-1)).toEqual({
      id: 'claude-opus-5-7', reasoningEfforts: ADAPTIVE, compat: { supportsTemperature: false, forceAdaptiveThinking: true },
    })
    expect(checked()).toEqual(['As claude-opus-5-5'])
    fireEvent.click(choice(en.modelEffortStandard))
    expect(writes.at(-1)).toEqual({
      id: 'claude-opus-5-7', reasoningEfforts: DEFAULTS, compat: { supportsTemperature: false },
    })
    fireEvent.click(choice(en.modelEffortNone))
    expect(writes.at(-1)).toEqual({ id: 'claude-opus-5-7', reasoningEfforts: false, compat: { supportsTemperature: false } })
  })

  it('folds the adaptive switch beside the levels, and turning it on leaves the standard choice', () => {
    const { writes } = renderGroup({ id: 'claude-x' }, { reasoning: { standard: ANTHROPIC.standard } })
    fireEvent.click(choice(en.modelEffortStandard))
    fireEvent.click(details())
    fireEvent.click(screen.getByRole('checkbox', { name: en.modelEffortAdaptive }))
    expect(writes.at(-1)).toEqual({ id: 'claude-x', reasoningEfforts: DEFAULTS, compat: { forceAdaptiveThinking: true } })
    expect(checked()).toEqual([])
    expect(screen.getByText(en.modelEffortCustom)).toBeTruthy()
  })

  it('appends the next unused level above the highest row, then the lowest unused one', () => {
    const { efforts } = renderGroup({ id: 'chat', reasoningEfforts: { low: 'low', max: 'max' } })
    fireEvent.click(add())
    expect(levels()).toEqual(['low', 'max', 'off'])
    expect(entriesOf(efforts())).toEqual([['low', 'low'], ['max', 'max'], ['off', null]])
    fireEvent.click(add())
    expect(levels()).toEqual(['low', 'max', 'off', 'minimal'])
    expect(entriesOf(efforts())).toEqual([['low', 'low'], ['max', 'max'], ['off', null], ['minimal', 'minimal']])
  })

  it('stops adding once every level has a row', () => {
    renderGroup({ id: 'chat', reasoningEfforts: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' } })
    fireEvent.click(add())
    expect(levels()).toHaveLength(7)
    expect(add().disabled).toBe(true)
  })

  it('changes a level in place, carrying a custom value only between thinking levels', () => {
    const { efforts } = renderGroup({ id: 'chat', reasoningEfforts: { low: 'low', high: 'deep', max: 'max' } })
    fireEvent.change(select(1), { target: { value: 'xhigh' } })
    expect(levels()).toEqual(['xhigh', 'high', 'max'])
    expect(entriesOf(efforts())).toEqual([['xhigh', 'xhigh'], ['high', 'deep'], ['max', 'max']])
    fireEvent.change(select(2), { target: { value: 'medium' } })
    expect(entriesOf(efforts())).toEqual([['xhigh', 'xhigh'], ['medium', 'deep'], ['max', 'max']])
    fireEvent.change(select(2), { target: { value: 'off' } })
    expect(entriesOf(efforts())).toEqual([['xhigh', 'xhigh'], ['off', null], ['max', 'max']])
    fireEvent.change(select(2), { target: { value: 'low' } })
    expect(entriesOf(efforts())).toEqual([['xhigh', 'xhigh'], ['low', 'low'], ['max', 'max']])
  })

  it('edits API values, storing the level name for a cleared field and showing it once the field is left', () => {
    const { efforts } = renderGroup({ id: 'gateway', reasoningEfforts: { off: 'none', high: 'high' } })
    expect(value('off').value).toBe('none')
    fireEvent.change(value('high'), { target: { value: ' deep ' } })
    expect(efforts()).toEqual({ off: 'none', high: 'deep' })
    fireEvent.change(value('high'), { target: { value: '' } })
    expect(value('high').value).toBe('')
    expect(efforts()).toEqual({ off: 'none', high: 'high' })
    fireEvent.blur(value('high'))
    expect(value('high').value).toBe('high')
  })

  it.each([
    ['a level besides off without a value', { off: null, high: null }, 'high'],
    ['an empty value', { off: null, high: '' }, 'high'],
    ['an empty off value', { off: '', high: 'high' }, 'off'],
  ])('flags %s that the adapter refuses', (_label, stored, level) => {
    renderGroup({ id: 'chat', reasoningEfforts: stored })
    expect(value(level).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(en.modelReasoningValueRequired)).toBeTruthy()
  })

  it('repairs a refused value with the level name once its field is left', () => {
    const { efforts } = renderGroup({ id: 'chat', reasoningEfforts: { off: null, high: null } })
    expect(value('high').value).toBe('')
    fireEvent.focus(value('high'))
    fireEvent.blur(value('high'))
    expect(efforts()).toEqual({ off: null, high: 'high' })
    expect(value('high').getAttribute('aria-invalid')).toBe('false')
    expect(screen.queryByText(en.modelReasoningValueRequired)).toBeNull()
  })

  it('leaves an accepted value alone when its field is left', () => {
    const { writes } = renderGroup({ id: 'chat', reasoningEfforts: { high: 'deep' } })
    fireEvent.blur(value('high'))
    expect(writes).toEqual([])
  })

  it('shows a valueless field as custom with no levels, which the adapter refuses', () => {
    const { writes } = renderGroup({ id: 'chat', reasoningEfforts: null })
    expect(checked()).toEqual([])
    expect(levels()).toEqual([])
    expect(screen.getByText(en.modelReasoningNeedsLevel)).toBeTruthy()
    fireEvent.click(add())
    expect(writes.at(-1)).toEqual({ id: 'chat', reasoningEfforts: { off: null } })
  })

  it('deletes a row and requires a level besides off', () => {
    const { efforts } = renderGroup({ id: 'chat', reasoningEfforts: { off: null, high: 'high' } })
    expect(screen.queryByText(en.modelReasoningNeedsLevel)).toBeNull()
    fireEvent.click(remove('high'))
    expect(levels()).toEqual(['off'])
    expect(efforts()).toEqual({ off: null })
    expect(screen.getByText(en.modelReasoningNeedsLevel)).toBeTruthy()
    fireEvent.click(remove('off'))
    expect(levels()).toEqual([])
    expect(efforts()).toEqual({})
  })

  it('offers the levels it is given, seeding only the defaults the list names', () => {
    const { efforts } = renderGroup({ id: 'gateway' }, { levels: ['off', 'low', 'high', 'ultra'] })
    fireEvent.click(choice(en.modelEffortStandard))
    fireEvent.click(details())
    expect(entriesOf(efforts())).toEqual([['off', null], ['low', 'low'], ['high', 'high']])
    expect([...select(3).options].map(option => option.value)).toEqual(['high', 'ultra'])
    fireEvent.click(add())
    expect(levels()).toEqual(['off', 'low', 'high', 'ultra'])
    expect(add().disabled).toBe(true)
  })

  it('keeps a stored key the offered levels do not name', () => {
    const { efforts } = renderGroup({ id: 'gateway', reasoningEfforts: { turbo: 'turbo-x', high: 'high' } })
    expect(levels()).toEqual(['turbo', 'high'])
    expect([...select(1).options].map(option => option.value)).toEqual(['turbo', 'off', 'minimal', 'low', 'medium', 'xhigh', 'max'])
    fireEvent.change(value('high'), { target: { value: 'deep' } })
    expect(entriesOf(efforts())).toEqual([['turbo', 'turbo-x'], ['high', 'deep']])
  })

  it('disables every control while read-only or saving', () => {
    const { writes } = renderGroup({ id: 'chat', reasoningEfforts: { high: 'deep' } }, { disabled: true })
    expect(screen.getAllByRole<HTMLInputElement>('radio').every(radio => radio.disabled)).toBe(true)
    expect(select(1).disabled).toBe(true)
    expect(value('high').disabled).toBe(true)
    expect(remove('high').disabled).toBe(true)
    expect(add().disabled).toBe(true)
    choice(en.modelEffortNone).click()
    remove('high').click()
    add().click()
    expect(writes).toEqual([])
  })
})

describe('levels a protocol fixes', () => {
  const GEMINI = ['minimal', 'low', 'medium', 'high']

  it('starts without off, offers only its levels, and fixes each value to the level name', () => {
    const { efforts } = renderGroup({ id: 'gemini' }, { levels: GEMINI, levelsOnly: true })
    fireEvent.click(choice(en.modelEffortStandard))
    fireEvent.click(details())
    expect(efforts()).toEqual({ low: 'low', medium: 'medium', high: 'high' })
    expect([...select(1).options].map(option => option.value)).toEqual(['minimal', 'low'])
    expect(value('low').disabled).toBe(true)
    expect(screen.queryByText(en.modelReasoningLevelsOnly)).toBeNull()
  })

  it('resets a custom value to the new level name when a row changes level', () => {
    const { efforts } = renderGroup({ id: 'gemini', reasoningEfforts: { high: 'ultra' } }, { levels: GEMINI, levelsOnly: true })
    fireEvent.change(select(1), { target: { value: 'medium' } })
    expect(efforts()).toEqual({ medium: 'medium' })
  })

  it('names a stored level or value outside the fixed levels', () => {
    renderGroup({ id: 'gemini', reasoningEfforts: { off: null, high: 'ultra' } }, { levels: GEMINI, levelsOnly: true })
    expect(screen.getByText(en.modelReasoningLevelsOnly)).toBeTruthy()
  })

  it.each([
    [{ off: null, high: 'high' }],
    [{ high: 'ultra' }],
    [{ xhigh: 'xhigh' }],
  ])('refuses %j on a protocol accepting only its own level names', (stored) => {
    expect(validateReasoningEfforts([{ id: 'ok' }, { id: 'gemini', reasoningEfforts: stored }], GEMINI))
      .toEqual({ index: 1, key: 'modelReasoningLevelsOnly' })
  })

  it('accepts its own level names', () => {
    expect(validateReasoningEfforts([{ id: 'gemini', reasoningEfforts: { minimal: 'minimal', high: 'high' } }], GEMINI))
      .toBeUndefined()
  })
})

describe('reasoning-level validation', () => {
  it.each([
    [{}],
    [null],
    [{ off: null }],
    [{ off: 'none' }],
  ])('refuses %j, which offers nothing beyond off', (stored) => {
    expect(validateReasoningEfforts([{ id: 'ok' }, { id: 'chat', reasoningEfforts: stored }]))
      .toEqual({ index: 1, key: 'modelReasoningNeedsLevel' })
  })

  it.each([
    [{ high: null }],
    [{ off: null, high: '' }],
    [{ off: '', high: 'high' }],
  ])('refuses %j, which holds a value the adapter rejects', (stored) => {
    expect(validateReasoningEfforts([{ id: 'chat', reasoningEfforts: stored }]))
      .toEqual({ index: 0, key: 'modelReasoningValueRequired' })
  })

  it.each([[undefined], [false], [{ high: 'high' }], [{ off: null, max: 'ultra' }]])('accepts %j', (stored) => {
    expect(validateReasoningEfforts([{ id: 'chat', reasoningEfforts: stored }])).toBeUndefined()
  })

  it('accepts an inherited model list', () => {
    expect(validateReasoningEfforts(undefined)).toBeUndefined()
  })

  it('stays out of the shared model checker that DeepSeek and catalog rows use', () => {
    expect(validateDeepSeekModels([{ id: 'chat', reasoningEfforts: { off: null } }])).toBeUndefined()
  })
})

describe('reasoning levels in the model list', () => {
  const operations: ModelsOperations = {
    discoverModels: () => Promise.resolve({ kind: 'found', models: [] }),
    storeCredential: vi.fn(),
    removeCredential: vi.fn(),
    writeSettings: vi.fn(),
  }

  /** Render the list over local state, reporting every write. */
  function renderList(initial: DeepSeekModelDraft[]) {
    const writes: DeepSeekModelDraft[][] = []
    function Harness() {
      const [models, setModels] = useState(initial)
      return (
        <ModelListEditor
          models={models} onChange={(next) => { writes.push(next); setModels(next) }} reasoningLevels={LEVELS}
          probe={{ settingsNs: 'llm-pi-ai' }} operations={operations} disabled={false} t={t} onBusyChange={() => {}}
        />
      )
    }
    render(<Harness />)
    return { writes }
  }

  it('edits a hand-declared route row', () => {
    const { writes } = renderList([{ id: 'my-reasoner' }])
    fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
    fireEvent.click(choice(en.modelEffortStandard))
    expect(writes.at(-1)).toEqual([{ id: 'my-reasoner', reasoningEfforts: DEFAULTS }])
  })

  it('writes only the surviving model\'s own levels after the row above it is deleted', () => {
    // Rows are keyed by position, so the survivor reuses the deleted model's editor instance.
    const { writes } = renderList([{ id: 'a' }, { id: 'b' }])
    fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
    fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 2` }))
    const first = within(screen.getByRole('group', { name: `${en.modelReasoning} 1` }))
    fireEvent.click(first.getByRole('radio', { name: en.modelEffortStandard }))
    fireEvent.click(first.getByRole('button', { name: en.modelEffortDetails }))
    fireEvent.click(first.getByRole('button', { name: `${en.modelReasoningRemove} medium` }))
    fireEvent.change(first.getByRole('textbox', { name: `high ${en.modelReasoningValue}` }), { target: { value: 'deep' } })
    fireEvent.click(first.getByRole('radio', { name: en.modelEffortNone }))
    fireEvent.click(screen.getByRole('button', { name: `${en.removeModel} 1` }))
    expect(writes.at(-1)).toEqual([{ id: 'b' }])

    fireEvent.click(within(screen.getByRole('group', { name: `${en.modelReasoning} 1` })).getByRole('radio', { name: en.modelEffortStandard }))
    expect(writes.at(-1)).toEqual([{ id: 'b', reasoningEfforts: DEFAULTS }])
  })

  it.each([
    ['without a level list', undefined],
    ['with an empty level list', []],
  ])('shows no reasoning control %s, leaving catalog rows to the installed catalog', (_label, reasoningLevels) => {
    render(<ModelListEditor
      models={[{ id: 'gpt-5' }]} onChange={vi.fn()} catalogProvider="openai" reasoningLevels={reasoningLevels}
      probe={{ settingsNs: 'llm-pi-ai', provider: 'openai' }}
      operations={operations} disabled={false} t={t} onBusyChange={() => {}}
    />)
    fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
    expect(screen.getByRole('group', { name: `${en.modelInputTypes} 1` })).toBeTruthy()
    expect(screen.queryByRole('group', { name: `${en.modelReasoning} 1` })).toBeNull()
  })
})

describe('settling models outside the catalog', () => {
  /** A catalog route's description: one catalog model, one newer id matched to it, one nothing matches. */
  const DESCRIBED: LlmDiscoveredModel[] = [
    { id: 'claude-opus-5-5', inCatalog: true, inputModalities: ['text', 'image'] },
    {
      id: 'claude-opus-5-7', inCatalog: false, template: 'claude-opus-5-5', contextWindow: 1_000_000, inputModalities: ['text', 'image'],
      sources: { contextWindow: 'endpoint', inputModalities: 'template', reasoning: 'template' }, reasoning: ANTHROPIC,
    },
    { id: 'house-model', inCatalog: false, reasoning: { standard: ANTHROPIC.standard } },
  ]

  /** Render a catalog route's list over local state, answering discovery from {@link DESCRIBED}. */
  function renderCatalogList(initial: DeepSeekModelDraft[], answer: (request: Parameters<ModelsOperations['discoverModels']>[1]) => readonly LlmDiscoveredModel[] = () => DESCRIBED) {
    const writes: DeepSeekModelDraft[][] = []
    const discoverModels = vi.fn<ModelsOperations['discoverModels']>((_ns, request) => Promise.resolve({ kind: 'found', models: answer(request) }))
    const operations: ModelsOperations = { discoverModels, storeCredential: vi.fn(), removeCredential: vi.fn(), writeSettings: vi.fn() }
    function Harness() {
      const [models, setModels] = useState(initial)
      return (
        <ModelListEditor
          models={models} onChange={(next) => { writes.push(next); setModels(next) }} reasoningLevels={LEVELS}
          catalogProvider="anthropic" probe={{ settingsNs: 'llm-pi-ai', provider: 'anthropic' }}
          operations={operations} disabled={false} t={t} onBusyChange={() => {}}
        />
      )
    }
    render(<Harness />)
    return { writes, discoverModels }
  }

  const summary = (text: string) => screen.findByText(text)

  it('describes the saved ids on open without asking the endpoint, and rewrites nothing', async () => {
    const { writes, discoverModels } = renderCatalogList([{ id: 'claude-opus-5-5' }, { id: 'claude-opus-5-7' }, { id: 'house-model' }])

    await summary(en.modelEffortSummarySuggested.replace('{choice}', 'As claude-opus-5-5'))
    expect(discoverModels).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', {
      provider: 'anthropic', describe: ['claude-opus-5-5', 'claude-opus-5-7', 'house-model'],
    })
    expect(screen.getByText(en.modelEffortSummaryUnknown)).toBeTruthy()
    // The catalog model keeps the catalog's levels and shows no reasoning line.
    expect(screen.getAllByText(/^Reasoning:/u)).toHaveLength(2)
    expect(screen.getByText(en.modelEffortPendingRows.replace('{count}', '1'))).toBeTruthy()
    expect(writes).toEqual([])
  })

  it('applies one suggestion, or every suggestion at once, only when asked', async () => {
    const saved = [{ id: 'claude-opus-5-7' }, { id: 'house-model' }, { id: 'claude-opus-5-7-fast' }]
    const { writes } = renderCatalogList(saved, () => [...DESCRIBED, { ...DESCRIBED[1]!, id: 'claude-opus-5-7-fast' }])
    await summary(en.modelEffortPendingRows.replace('{count}', '2'))

    fireEvent.click(screen.getAllByRole('button', { name: en.modelEffortApply })[0]!)
    expect(writes.at(-1)).toEqual([
      { id: 'claude-opus-5-7', reasoningEfforts: ADAPTIVE, compat: { forceAdaptiveThinking: true } },
      { id: 'house-model' },
      { id: 'claude-opus-5-7-fast' },
    ])
    expect(screen.getByText(en.modelEffortSummary.replace('{choice}', 'As claude-opus-5-5'))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.modelEffortApplyAll }))
    // A row nothing describes with confidence is left for the user.
    expect(writes.at(-1)).toEqual([
      { id: 'claude-opus-5-7', reasoningEfforts: ADAPTIVE, compat: { forceAdaptiveThinking: true } },
      { id: 'house-model' },
      { id: 'claude-opus-5-7-fast', reasoningEfforts: ADAPTIVE, compat: { forceAdaptiveThinking: true } },
    ])
    expect(screen.queryByText(/^Models without a reasoning setting/u)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.modelEffortUseStandard }))
    expect(writes.at(-1)?.[1]).toEqual({ id: 'house-model', reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } })
  })

  it('settles an adopted model at once, marking it as outside the catalog in the picker', async () => {
    const { writes, discoverModels } = renderCatalogList([{ id: 'claude-opus-5-5' }])
    await waitFor(() => { expect(discoverModels).toHaveBeenCalledTimes(1) })

    await act(async () => { fireEvent.click(screen.getByText(en.fetchModels)) })
    expect(discoverModels).toHaveBeenLastCalledWith('llm-pi-ai', { provider: 'anthropic', describe: ['claude-opus-5-5'], listEndpoint: true })
    const picker = within(screen.getByRole('dialog'))
    expect(picker.getAllByText(en.fetchNotInCatalog)).toHaveLength(2)
    fireEvent.click(picker.getByRole('checkbox', { name: /claude-opus-5-7/u }))
    fireEvent.click(picker.getByRole('button', { name: en.fetchAdopt }))

    expect(writes.at(-1)).toEqual([
      { id: 'claude-opus-5-5' },
      {
        id: 'claude-opus-5-7', contextWindow: 1_000_000, input: ['text', 'image'],
        reasoningEfforts: ADAPTIVE, compat: { forceAdaptiveThinking: true },
      },
    ])
    expect(screen.getByText(en.modelEffortSummary.replace('{choice}', 'As claude-opus-5-5'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 2` }))
    expect(screen.getByText(`${en.modelFromEndpoint.replace('{fields}', en.contextWindow)} ${en.modelFromTemplate.replace('{model}', 'claude-opus-5-5').replace('{fields}', en.modelInputTypes)}`)).toBeTruthy()
  })

  it('settles a typed id once its field is left', async () => {
    const { writes, discoverModels } = renderCatalogList([])
    await waitFor(() => { expect(discoverModels).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: en.addModel }))
    const id = screen.getByRole('textbox', { name: `${en.modelId} 1` })
    fireEvent.change(id, { target: { value: 'claude-opus-5-7' } })
    expect(discoverModels).toHaveBeenCalledTimes(1)
    await act(async () => { fireEvent.blur(id) })

    expect(writes.at(-1)).toEqual([{ id: 'claude-opus-5-7', reasoningEfforts: ADAPTIVE, compat: { forceAdaptiveThinking: true } }])
  })
})
