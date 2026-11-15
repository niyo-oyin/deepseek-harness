/**
 * The model list of one pi-ai provider profile, plus the action that asks the
 * provider what it serves.
 *
 * The list is the profile's `models` array as the card holds it: an empty list
 * means "serve this route's built-in catalog", and any entry replaces that
 * catalog, so a row is only ever added deliberately. Fetching asks the endpoint
 * **the form currently shows** — including a key typed but not yet saved — so
 * adding a provider is one pass instead of save-then-return; the reply is
 * candidates the user picks from, never configuration written behind them. The
 * picker opens with the configured models checked, so confirming it adds the
 * newly checked candidates and removes the unchecked configured ones in the
 * draft; configured rows the reply does not list are kept, and a confirmation
 * that would empty the list is refused.
 *
 * A provider that cannot be interrogated (an unreachable endpoint, a protocol
 * with no readable listing) is not a dead end: the failure is shown next to the
 * rows the user can still fill in by hand. A catalog route keeps its installed
 * catalog then, with the reason shown as a notice.
 *
 * Rows the route's installed catalog does not describe carry their own
 * reasoning. The adapter describes each such id — saved rows when the card
 * opens, a typed id when its field is left, listed models when fetched — and a
 * row it describes with confidence is settled at once when it is adopted or
 * typed. A saved row that states no reasoning is never rewritten behind the
 * user: it shows the suggestion with one action, and the list offers to apply
 * every such suggestion at once.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-api-remotes/client'
import { AnimatedRows, Button, IconPlusOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { TextSearchIndex } from '@deepseek-ai/dsh-util-text-search'
import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'
import type { ModelsOperations } from './operations.ts'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { en } from './locales.ts'
import { ModelRow } from './ModelRow.tsx'
import type { EffortSummary } from './ModelRow.tsx'
import { undescribedReasoning } from './ModelReasoningEfforts.tsx'
import { reasoningChoice, withProposal, withSuggestion } from './reasoning-choice.ts'
import { useModelRows } from './useModelRows.ts'
import type { CapacityField } from './useModelRows.ts'
import styles from './ModelsSection.module.css'

/**
 * One configured model row. Fields this card does not edit must survive an
 * edit rather than being dropped by a rebuild.
 */
export type ModelDraft = DeepSeekModelDraft

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** A row's numeric field, or `undefined` when unset or not a number. */
function numberOf(model: ModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

/** What an interrogation needs, taken from the live form. */
export interface ProbeTarget {
  /** Settings namespace whose adapter family answers. */
  settingsNs: string
  /**
   * Route being edited, when the card edits one. An adapter that already
   * describes it answers from its own registry, so such a card can ask without
   * an endpoint at all.
   */
  provider?: string
  /** Endpoint as the form currently shows it. */
  baseURL?: string
  /** Wire protocol the form names, when it names one. */
  api?: string
  /** Key typed into the form and not yet stored, when there is one. */
  apiKey?: string
}

/** Props of {@link ModelListEditor}. */
export interface ModelListEditorProps {
  /** The rows as currently drafted. */
  models: readonly ModelDraft[]
  /** Installed provider whose catalog supplies defaults without endpoint I/O. */
  catalogProvider?: string | undefined
  /**
   * Reasoning levels a row outside the installed catalog may declare in
   * `reasoningEfforts`, in escalation order; absent or empty shows no
   * reasoning control. A catalog model's levels stay the catalog's.
   */
  reasoningLevels?: readonly string[] | undefined
  /** Whether the route's protocol accepts only {@link reasoningLevels}, each sent under its own name. */
  reasoningLevelsOnly?: boolean | undefined
  /** Route input types for models absent from the installed catalog. */
  defaultInput?: readonly string[] | undefined
  /** Whether the user layer currently owns the whole array; absent on a create. */
  overridden?: boolean
  /** Replace the drafted rows. */
  onChange: (models: ModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance; absent on a create. */
  onReset?: () => void
  /** Endpoint facts for the fetch action. */
  probe: ProbeTarget
  /**
   * Copy key naming why the fetch action is unavailable, or `undefined` when
   * it is. The card owns this because the key it would send is judged there:
   * asking with a key the form has already refused spends a round trip to be
   * told what the field already says.
   */
  probeBlocked?: keyof typeof en | undefined
  /** The Host operations whose interrogation answers the fetch action. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control (read-only deployment or a pending write). */
  disabled: boolean
  /**
   * Called once per change with whether an endpoint interrogation is in
   * flight. The owning card folds it into its own busy state so the surface
   * around the card — a mode switch, say — can refuse to move while the
   * answer, and the picker it opens, is still bound for this list.
   */
  onBusyChange: (busy: boolean) => void
}

/**
 * What an empty capacity field is worth, shown as its placeholder so a row left
 * blank does not read as a model with no capacity at all.
 *
 * These hints match llm-pi-ai's built-in `defaultContextWindow` and
 * `defaultMaxTokens` in decimal K/M notation. Provider overrides are not
 * available to this component and are not reflected in the hints.
 */
const CAPACITY_HINT: Readonly<Record<CapacityField, string>> = {
  contextWindow: '1M',
  maxTokens: '128K',
}

/**
 * Spell a stored count for a field that may be unset. The spelling itself is
 * {@link formatCapacity}, shared with the DeepSeek catalog editor so both
 * surfaces read and write one K/M vocabulary.
 * @param value - stored capacity, or `undefined` for an unset field.
 * @returns the field text, empty when unset.
 */
function capacitySpelling(value: number | undefined): string {
  return value === undefined ? '' : formatCapacity(value)
}

/**
 * Adopt a candidate, preserving disclosed capacities and input types. A model
 * outside the installed catalog also takes the reasoning described for it with
 * confidence, so it offers its effort levels without another step.
 */
function adopt(candidate: LlmDiscoveredModel): ModelDraft {
  const row: ModelDraft = {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
    ...candidate.inputModalities === undefined ? {} : { input: [...candidate.inputModalities] },
  }
  return candidate.inCatalog === false ? withSuggestion(row, candidate.reasoning) : row
}

/** The row fields a description's sources speak for, with the label each is named by. */
const DESCRIBED_FIELDS = [
  { field: 'contextWindow', row: 'contextWindow', label: 'contextWindow' },
  { field: 'maxTokens', row: 'maxTokens', label: 'maxTokens' },
  { field: 'inputModalities', row: 'input', label: 'modelInputTypes' },
] as const

/**
 * Say where a row's described values came from, naming only the fields whose
 * stored value is still the described one.
 * @param model - the row.
 * @param description - what the adapter described for its id.
 * @param t - section copy.
 * @returns the caption, or `undefined` when no stored value came from the description.
 */
function sourceNoteOf(
  model: ModelDraft, description: LlmDiscoveredModel | undefined, t: (key: keyof typeof en) => string,
): string | undefined {
  if (description?.sources === undefined) return undefined
  const named = (source: 'endpoint' | 'template'): string[] => DESCRIBED_FIELDS
    .filter(({ field, row }) => description.sources?.[field] === source
      && JSON.stringify(model[row]) === JSON.stringify(description[field]))
    .map(({ label }) => t(label))
  const parts = [
    ...named('endpoint').length > 0 ? [t('modelFromEndpoint').replace('{fields}', () => named('endpoint').join(', '))] : [],
    ...named('template').length > 0 && description.template !== undefined
      ? [t('modelFromTemplate').replace('{model}', () => description.template ?? '').replace('{fields}', () => named('template').join(', '))]
      : [],
  ]
  return parts.length === 0 ? undefined : parts.join(' ')
}

/**
 * Render the model list with its fetch action.
 * @param props - the drafted rows, probe target, wire face, and copy.
 * @returns the model-list editor.
 */
export function ModelListEditor(props: ModelListEditorProps): ReactNode {
  const { models, onChange, probe, operations, t, disabled, onBusyChange } = props
  const { catalogProvider } = props
  const [busy, setBusy] = useState(false)
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  // What the adapter has described so far, by id, for the route this card edits.
  const [described, setDescribed] = useState<{
    route: string | undefined
    models: ReadonlyMap<string, LlmDiscoveredModel>
  }>({ route: undefined, models: new Map() })
  const route = catalogProvider ?? probe.provider
  const descriptions = described.route === route ? described.models : new Map<string, LlmDiscoveredModel>()
  const learn = (found: readonly LlmDiscoveredModel[]): void => {
    setDescribed(current => ({
      route,
      models: new Map([...current.route === route ? current.models : [], ...found.map(model => [model.id, model] as const)]),
    }))
  }
  // The rows as last drafted, for an answer that arrives after further edits.
  const latest = useRef(models)
  latest.current = models
  const idsOf = (rows: readonly ModelDraft[]): string[] => [...new Set(rows.map(model => textOf(model, 'id')).filter(id => id.length > 0))]
  // A route the adapter knows, or a draft endpoint, identifies what to describe.
  const describable = probe.provider !== undefined || (probe.baseURL !== undefined && probe.baseURL.length > 0)
  const describeRequest = (ids: readonly string[]): LlmModelDiscoveryRequest => ({
    ...probe.provider === undefined ? {} : { provider: probe.provider },
    ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
    ...probe.api === undefined ? {} : { api: probe.api },
    describe: ids,
  })
  const [catalogLoaded, setCatalogLoaded] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (route === undefined || probe.provider === undefined) return
    let current = true
    // Opening the card describes the installed catalog and the saved ids; nothing reaches the endpoint.
    void operations.discoverModels(probe.settingsNs, describeRequest(idsOf(latest.current))).then((answer) => {
      if (!current) return
      if (answer.kind === 'found') learn(answer.models)
      setCatalogLoaded(route)
      setFailure(answer.kind === 'refused' ? answer.message : undefined)
    })
    return () => { current = false }
    // Described once per route: later rows are described as they are typed or fetched.
  }, [route, operations, probe.settingsNs])
  const inputDefaults = useMemo(() => new Map([...descriptions.values()]
    .filter(model => model.inCatalog !== false)
    .map(model => [model.id, model.inputModalities])), [descriptions])

  /**
   * Describe an id just typed and, for a row that states no reasoning yet,
   * apply what is suggested with confidence.
   * @param id - the id the row's field was left with.
   */
  const describeTyped = (id: string): void => {
    if (id.length === 0 || !describable) return
    const settle = (description: LlmDiscoveredModel | undefined): void => {
      if (description?.inCatalog !== false || !showsReasoning(description)) return
      const rows = latest.current
      const next = rows.map(row => textOf(row, 'id') === id ? withSuggestion(row, description.reasoning) : row)
      if (next.some((row, at) => row !== rows[at])) onChange(next)
    }
    const known = descriptions.get(id)
    if (known !== undefined) { settle(known); return }
    void operations.discoverModels(probe.settingsNs, describeRequest([id])).then((answer) => {
      if (answer.kind !== 'found') return
      learn(answer.models)
      settle(answer.models.find(model => model.id === id))
    })
  }
  const [candidates, setCandidates] = useState<readonly LlmDiscoveredModel[] | undefined>(undefined)
  // Candidates whose checkbox the user flipped from its default. The default
  // is read from the list at render, so a row drafted while the fetch was in
  // flight opens checked rather than being removed by a stale selection.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set())
  const [candidateQuery, setCandidateQuery] = useState('')
  const rowState = useModelRows(models, onChange, disabled)

  const editCapacity = (index: number, field: CapacityField, text: string): void => {
    rowState.edit(index, field, text)
    patch(index, { [field]: parseCapacity(text) })
  }

  const capacityText = (model: ModelDraft, index: number, field: CapacityField): string =>
    rowState.rows[index]?.editing.get(field) ?? capacitySpelling(numberOf(model, field))

  const patch = (index: number, next: Record<string, string | number | undefined>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      // Rebuilt rather than spread over: an emptied optional field has to leave
      // the profile, not be stored as a value its schema would reject.
      // Spread first so a field this card does not edit survives; an emptied
      // optional field is then dropped rather than stored as a value its
      // schema would reject.
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
      )
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
      )
    }))
  }

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    setNotice(undefined)
    try {
      const answer = await operations.discoverModels(probe.settingsNs, {
        ...describeRequest(idsOf(models)),
        ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
        listEndpoint: true,
      })
      if (answer.kind === 'refused') {
        setFailure(answer.message)
        return
      }
      const found = answer.models
      learn(found)
      setNotice(answer.notice)
      if (found.length === 0) {
        setFailure(t('fetchEmpty'))
        return
      }
      setCandidateQuery('')
      setFlipped(new Set())
      // A listing may repeat an id; the picker and the list hold each model once.
      setCandidates([...new Map(found.map(model => [model.id, model])).values()])
    } finally {
      setBusy(false)
    }
  }

  const closePicker = (): void => {
    setCandidates(undefined)
    setFlipped(new Set())
    setCandidateQuery('')
  }

  // The picker opens on the current list so a few models can be added or
  // removed in one place. A list with no identified model serves the whole
  // catalog or nothing yet, so every candidate starts checked.
  const configuredIds = new Set(models.map(model => textOf(model, 'id')).filter(id => id.length > 0))
  const pickedByDefault = (id: string): boolean => configuredIds.size === 0 || configuredIds.has(id)
  const isPicked = (id: string): boolean => pickedByDefault(id) !== flipped.has(id)

  const activeCandidates = candidates ?? []
  const candidateIndex = useMemo(
    () => new TextSearchIndex(candidates ?? [], candidate => ({ fuzzy: [candidate.id, candidate.name] })),
    [candidates],
  )
  const listed = new Set(activeCandidates.map(candidate => candidate.id))
  // An unchecked candidate leaves the list. A row the listing does not name,
  // including a half-typed row without an id, is outside the picker and stays.
  const removedRows = new Set<number>()
  models.forEach((model, at) => {
    const id = textOf(model, 'id')
    if (listed.has(id) && !isPicked(id)) removedRows.add(at)
  })
  // A kept row the user already tuned wins over the provider's own numbers.
  const keptRows = models.filter((_model, at) => !removedRows.has(at))
  const keptIds = new Set(keptRows.map(model => textOf(model, 'id')))
  const addedRows = activeCandidates
    .filter(candidate => isPicked(candidate.id) && !keptIds.has(candidate.id))
    .map(adopt)
  // An empty list serves the whole catalog, so emptying a non-empty list
  // would restore every model instead of removing the unchecked ones.
  const emptiesList = models.length > 0 && keptRows.length === 0 && addedRows.length === 0

  const adoptPicked = (): void => {
    onChange([...keptRows, ...addedRows])
    rowState.forget(removedRows)
    closePicker()
  }

  const toggle = (id: string): void => {
    setFlipped((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const visibleCandidates = candidateIndex.search(candidateQuery)
  const allVisibleCandidatesPicked = visibleCandidates.length > 0
    && visibleCandidates.every(candidate => isPicked(candidate.id))

  const toggleVisibleCandidates = (): void => {
    // Only visible candidates change: a hidden checked one may be a configured
    // model, and clearing it would remove that model unseen.
    const target = !allVisibleCandidatesPicked
    setFlipped((current) => {
      const next = new Set(current)
      for (const candidate of visibleCandidates) {
        if (pickedByDefault(candidate.id) === target) next.delete(candidate.id)
        else next.add(candidate.id)
      }
      return next
    })
  }

  // A route the adapter already describes answers without an endpoint; only a
  // draft with neither has nothing to ask about.
  const askable = describable
  const levels = props.reasoningLevels ?? []

  /** Whether a row outside the catalog edits its reasoning here. */
  function showsReasoning(description: LlmDiscoveredModel | undefined): boolean {
    return levels.length > 0 && (catalogProvider === undefined || description?.inCatalog === false)
  }

  /** How a description's suggestion reads, when it has one. */
  const suggestionLabel = (description: LlmDiscoveredModel | undefined): string | undefined => {
    const suggested = description?.reasoning?.suggested
    if (suggested === undefined) return undefined
    if (suggested === false) return t('modelEffortNone')
    const template = description.template
    return template === undefined ? t('modelEffortAsEndpoint') : t('modelEffortAs').replace('{model}', () => template)
  }

  /** The folded row's account of its reasoning and the one action that settles it. */
  const summaryOf = (model: ModelDraft, index: number, description: LlmDiscoveredModel | undefined): EffortSummary | undefined => {
    const reasoning = description?.reasoning
    const choice = reasoningChoice(model, reasoning ?? undescribedReasoning(levels))
    const label = suggestionLabel(description)
    const replace = (next: ModelDraft): void => { onChange(models.map((row, at) => at === index ? next : row)) }
    if (choice === 'unset') {
      if (reasoning === undefined) return { text: t('modelEffortSummaryUnset'), pending: true }
      if (label === undefined) {
        return {
          text: t('modelEffortSummaryUnknown'),
          pending: true,
          action: { label: t('modelEffortUseStandard'), run: () => { replace(withProposal(model, reasoning.standard)) } },
        }
      }
      return {
        text: t('modelEffortSummarySuggested').replace('{choice}', () => label),
        pending: true,
        action: { label: t('modelEffortApply'), run: () => { replace(withSuggestion(model, reasoning)) } },
      }
    }
    const text = choice === 'none'
      ? t('modelEffortNone')
      : choice === 'suggested' && label !== undefined
        ? label
        : choice === 'standard' ? t('modelEffortStandard') : t('modelEffortCustom')
    return { text: t('modelEffortSummary').replace('{choice}', () => text), pending: false }
  }

  // Saved rows that state no reasoning while a confident suggestion exists, settled together on request.
  const settleable = models.filter((model) => {
    const description = descriptions.get(textOf(model, 'id'))
    return showsReasoning(description) && reasoningChoice(model, description?.reasoning) === 'unset'
      && description?.reasoning?.suggested !== undefined
  }).length
  const settleAll = (): void => {
    onChange(models.map((model) => {
      const description = descriptions.get(textOf(model, 'id'))
      return showsReasoning(description) ? withSuggestion(model, description?.reasoning) : model
    }))
  }
  return (
    <section className={styles['modelCatalog']} aria-label={t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('models')}</span>
          {props.overridden === undefined
            ? null
            : (
              <span className={styles['modelCatalogMeta']}>
                {props.overridden ? t('modelsCustomized') : t('modelsInherited')}
              </span>
            )}
        </div>
        {props.overridden === true && props.onReset !== undefined
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={disabled}
              onClick={() => { rowState.reset(); props.onReset?.() }}
            >
              {t('resetModels')}
            </button>
          )
          : null}
        <button
          type="button"
          className={styles['linkButton']}
          disabled={disabled || busy || !askable || props.probeBlocked !== undefined}
          title={props.probeBlocked !== undefined
            ? t(props.probeBlocked)
            : askable ? undefined : t('fetchNeedsBaseUrl')}
          onClick={() => { void fetchModels() }}
        >
          {busy ? t('fetching') : t('fetchModels')}
        </button>
      </div>
      {settleable > 0
        ? (
          <p className={styles['modelEffortPending']}>
            <span>{t('modelEffortPendingRows').replace('{count}', () => String(settleable))}</span>
            <button type="button" className={styles['linkButton']} disabled={disabled} onClick={settleAll}>
              {t('modelEffortApplyAll')}
            </button>
          </p>
        )
        : null}
      {models.length === 0 ? <p className={styles['modelEmpty']}>{t('modelsEmpty')}</p> : null}
      <AnimatedRows className={styles['modelList'] as string} rowKeys={rowState.rows.map(row => String(row.key))} ready resetKey="">
        {rowState.rows.map(({ model, key, expanded, order }, index) => {
          const description = descriptions.get(textOf(model, 'id'))
          // A row stating its own levels keeps them editable, wherever its id sits.
          const reasoningShown = showsReasoning(description) || (levels.length > 0 && model['reasoningEfforts'] !== undefined)
          const outside = description?.inCatalog === false
          return (
            <ModelRow
              key={key}
              rowKey={key}
              order={order}
              model={model}
              position={index + 1}
              inputField="input"
              inputFallback={inputDefaults.get(textOf(model, 'id')) ?? props.defaultInput}
              inputLoading={catalogProvider !== undefined && catalogLoaded !== route}
              reasoningLevels={reasoningShown ? levels : undefined}
              reasoningLevelsOnly={props.reasoningLevelsOnly}
              reasoning={outside ? description.reasoning : undefined}
              suggestionLabel={outside ? suggestionLabel(description) : undefined}
              effortSummary={reasoningShown && textOf(model, 'id').length > 0 ? summaryOf(model, index, outside ? description : undefined) : undefined}
              sourceNote={outside ? sourceNoteOf(model, description, t) : undefined}
              expanded={expanded}
              disabled={disabled}
              t={t}
              contextWindow={{
                value: capacityText(model, index, 'contextWindow'),
                placeholder: CAPACITY_HINT.contextWindow,
                onChange: (text) => { editCapacity(index, 'contextWindow', text) },
              }}
              maxTokens={{
                value: capacityText(model, index, 'maxTokens'),
                placeholder: CAPACITY_HINT.maxTokens,
                onChange: (text) => { editCapacity(index, 'maxTokens', text) },
              }}
              onFieldChange={(field, value) => { patch(index, { [field]: value }) }}
              onIdBlur={(id) => { describeTyped(id.trim()) }}
              onChange={(next) => { onChange(models.map((row, at) => at === index ? next : row)) }}
              onToggle={() => { rowState.toggle(index) }}
              onRemove={() => {
                onChange(models.filter((_model, at) => at !== index))
                rowState.forget(new Set([index]))
              }}
            />
          )
        })}
      </AnimatedRows>
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '' }]) }}
      >
        <IconPlusOutlineRegular size={14} />
        {t('addModel')}
      </button>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {notice !== undefined ? <p className={styles['modelEffortNote']} role="status">{notice}</p> : null}
      <Modal
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('fetchTitle')}
        closeLabel={t('close')}
        description={t('fetchDescription')}
        className={styles['fetchDialog'] as string}
        footer={(
          <>
            <Button variant="outline" onClick={closePicker}>{t('cancel')}</Button>
            <Button
              variant="outline"
              disabled={emptiesList}
              title={emptiesList ? t('fetchKeepOne') : undefined}
              onClick={adoptPicked}
            >
              {t('fetchAdopt')}
            </Button>
          </>
        )}
      >
        <div className={styles['candidateToolbar']}>
          <input
            className={`${styles['input']} ${styles['candidateSearch']}`}
            type="search"
            value={candidateQuery}
            placeholder={t('fetchSearch')}
            aria-label={t('fetchSearch')}
            onChange={(event) => { setCandidateQuery(event.target.value) }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={visibleCandidates.length === 0}
            onClick={toggleVisibleCandidates}
          >
            {t(allVisibleCandidatesPicked ? 'fetchDeselectAll' : 'fetchSelectAll')}
          </Button>
        </div>
        {visibleCandidates.length === 0
          ? <p className={styles['candidateEmpty']} role="status">{t('fetchNoMatches')}</p>
          : (
            <ul className={styles['candidateList']}>
              {visibleCandidates.map(candidate => (
                <li key={candidate.id} className={styles['candidate']}>
                  <label className={styles['candidateLabel']}>
                    <input
                      type="checkbox"
                      checked={isPicked(candidate.id)}
                      onChange={() => { toggle(candidate.id) }}
                    />
                    <span className={styles['candidateId']} title={candidate.name ?? candidate.id}>
                      {candidate.id}
                    </span>
                    {catalogProvider !== undefined && candidate.inCatalog === false
                      ? <span className={styles['candidateBadge']}>{t('fetchNotInCatalog')}</span>
                      : null}
                  </label>
                </li>
              ))}
            </ul>
          )}
      </Modal>
    </section>
  )
}
