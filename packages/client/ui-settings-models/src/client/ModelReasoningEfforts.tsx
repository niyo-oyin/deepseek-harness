/**
 * Reasoning for a pi-ai model row the installed catalog does not describe:
 * none, as a matched catalog model (or as the endpoint reports), or the
 * protocol's ordinary levels, with the stored levels and their API values
 * folded beneath whichever is chosen.
 */

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredReasoning, LlmReasoningProposal } from '@deepseek-ai/dsh-api-remotes/client'
import { IconPlusOutlineRegular, IconTrashOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import { modelDrafts } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import { reasoningChoice, withoutReasoning, withProposal } from './reasoning-choice.ts'
import styles from './ModelsSection.module.css'

/** Declared levels in stored order, each with the value stored for it, whatever a hand edit left there. */
type Entries = readonly (readonly [string, unknown])[]

/** Levels offered as the ordinary choice while the adapter has not described the row, where the schema lists them. */
const INITIAL_LEVELS: readonly string[] = ['off', 'low', 'medium', 'high']

/** The wire value a level sends unless its row says otherwise; `null` is the Off entry that sends nothing. */
function defaultValue(level: string): string | null {
  return level === 'off' ? null : level
}

/**
 * The ordinary choice while the adapter has not described a row: the schema's
 * common levels, each sent under its own name.
 * @param levels - levels the schema accepts.
 * @returns choices with nothing suggested.
 */
export function undescribedReasoning(levels: readonly string[]): LlmDiscoveredReasoning {
  return {
    standard: { efforts: INITIAL_LEVELS.filter(level => levels.includes(level)).map(level => ({ level, value: defaultValue(level) })) },
  }
}

/**
 * Whether pi-ai accepts a stored value: a non-empty string, or nothing for Off.
 * @param level - the declared level.
 * @param wire - the value stored for it.
 * @returns whether the adapter would resolve the entry.
 */
function acceptedValue(level: string, wire: unknown): boolean {
  return typeof wire === 'string' ? wire.length > 0 : wire === null && level === 'off'
}

/**
 * Read the declared levels from a row in their stored order, including a key
 * the offered levels do not name, so an edit never drops it.
 * @param model - model row as drafted.
 * @returns the entries; empty for a valueless field, which pi-ai refuses, and
 * `undefined` when the field is absent or `false`.
 */
function readEfforts(model: DeepSeekModelDraft): Entries | undefined {
  const value = model['reasoningEfforts']
  if (value === null) return []
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.entries(value)
}

/**
 * Replace a row's declared levels, preserving every other field.
 * @param model - model row as drafted.
 * @param entries - the levels to write in row order.
 * @returns the replacement row.
 */
function withEfforts(model: DeepSeekModelDraft, entries: Entries): DeepSeekModelDraft {
  return { ...model, reasoningEfforts: Object.fromEntries(entries) }
}

/** A reasoning-level failure the Models cards name by row. */
export interface ReasoningEffortsFailure {
  /** Zero-based model position. */
  index: number
  /** Message key owned by the Models settings section. */
  key: 'modelReasoningValueRequired' | 'modelReasoningNeedsLevel' | 'modelReasoningLevelsOnly'
}

/**
 * Whether an entry breaks a protocol that accepts only its offered levels,
 * each sent under its own name.
 * @param only - the accepted levels.
 * @param level - the declared level.
 * @param wire - the value stored for it.
 * @returns whether the entry is outside the accepted levels.
 */
function outsideLevels(only: readonly string[], level: string, wire: unknown): boolean {
  return !only.includes(level) || wire !== level
}

/**
 * Mirror the pi-ai refusals of a hand-declared `reasoningEfforts`, so a card
 * names the row instead of failing at the write.
 * @param value - drafted `models` value, or `undefined` while inherited.
 * @param only - the levels the route's protocol accepts, each sent under its
 * own name, or `undefined` when the protocol accepts any declared value.
 * @returns the first refused row, or `undefined` when the adapter will accept every row.
 */
export function validateReasoningEfforts(value: unknown, only?: readonly string[]): ReasoningEffortsFailure | undefined {
  for (const [index, model] of modelDrafts(value).entries()) {
    const entries = readEfforts(model)
    if (entries === undefined) continue
    if (only !== undefined && entries.some(([level, wire]) => outsideLevels(only, level, wire))) {
      return { index, key: 'modelReasoningLevelsOnly' }
    }
    if (entries.some(([level, wire]) => !acceptedValue(level, wire))) return { index, key: 'modelReasoningValueRequired' }
    if (!entries.some(([level]) => level !== 'off')) return { index, key: 'modelReasoningNeedsLevel' }
  }
  return undefined
}

/** Props of {@link ModelReasoningEfforts}. */
interface ModelReasoningEffortsProps {
  /** Effective model row, including fields outside the curated editor. */
  model: DeepSeekModelDraft
  /** Levels the adapter's schema accepts as `reasoningEfforts` keys, in escalation order. */
  levels: readonly string[]
  /** Whether the route's protocol accepts only {@link levels}, each sent under its own name. */
  levelsOnly: boolean
  /** Choices the adapter describes for this row's id; absent until it answers. */
  reasoning?: LlmDiscoveredReasoning | undefined
  /** How the suggested choice reads, such as "As claude-opus-5-5"; absent when nothing is suggested. */
  suggestionLabel?: string | undefined
  /** One-based row position for accessible names. */
  position: number
  /** Prevent changes while read-only or saving. */
  disabled: boolean
  /** Section copy. */
  t: (key: ModelsKey) => string
  /** Replace this row, preserving unrelated configuration. */
  onChange: (model: DeepSeekModelDraft) => void
}

/**
 * Choose a row's reasoning — none, the suggestion, or the protocol's ordinary
 * levels — and, folded beneath the choice, see or adjust the levels and API
 * values it stored. Every control reads the row, so a reused instance shows
 * its new model.
 * @param props - model row, described choices, and row replacement action.
 * @returns the reasoning group.
 */
export function ModelReasoningEfforts(props: ModelReasoningEffortsProps): ReactNode {
  const { model, levels, levelsOnly, reasoning, position, disabled, t, onChange } = props
  const name = useId()
  const [open, setOpen] = useState(false)
  // Until the adapter answers, the ordinary choice is the schema's common levels.
  const choices = reasoning ?? undescribedReasoning(levels)
  const choice = reasoningChoice(model, choices)
  const suggested = choices.suggested === undefined || choices.suggested === false ? undefined : choices.suggested
  const standard: LlmReasoningProposal = choices.standard
  const label = `${t('modelReasoning')} ${String(position)}`
  const options: { key: 'none' | 'suggested' | 'standard'; text: string; pick: () => void }[] = [
    { key: 'none', text: t('modelEffortNone'), pick: () => { onChange(withoutReasoning(model, reasoning)) } },
    ...suggested === undefined || props.suggestionLabel === undefined
      ? []
      : [{ key: 'suggested' as const, text: props.suggestionLabel, pick: () => { onChange(withProposal(model, suggested)) } }],
    { key: 'standard', text: t('modelEffortStandard'), pick: () => { onChange(withProposal(model, standard)) } },
  ]
  const note = choice === 'unset'
    ? t(reasoning === undefined || reasoning.suggested !== undefined ? 'modelEffortUnset' : 'modelEffortUnknown')
    : choice === 'custom' ? t('modelEffortCustom') : undefined
  const switches = [...new Set([...Object.keys(standard.compat ?? {}), ...Object.keys(suggested?.compat ?? {})])]
  const holdsLevels = choice !== 'unset' && choice !== 'none'

  return (
    <div className={styles['modelReasoning']} role="group" aria-label={label}>
      <span className={`${styles['modelFieldLabel']} ${styles['modelReasoningLabel']}`}>
        {t('modelReasoning')}
        <Tooltip label={t('modelReasoningHelpText')} side="right" delayMs={0} focusDelayMs={0} portal openOnClick>
          <button type="button" className={styles['helpButton']} aria-label={t('modelReasoningHelp')}>?</button>
        </Tooltip>
      </span>
      <div className={styles['modelEffortChoices']} role="radiogroup" aria-label={label}>
        {options.map(option => (
          <label key={option.key} className={styles['modelEffortChoice']}>
            <input
              type="radio"
              name={name}
              checked={choice === option.key}
              disabled={disabled}
              onChange={option.pick}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
      {note === undefined ? null : <p className={styles['modelEffortNote']}>{note}</p>}
      {holdsLevels
        ? (
          <>
            <button
              type="button"
              className={styles['linkButton']}
              aria-expanded={open || choice === 'custom'}
              onClick={() => { setOpen(!open) }}
            >
              {t('modelEffortDetails')}
            </button>
            {open || choice === 'custom'
              ? (
                <>
                  <LevelTable model={model} levels={levels} levelsOnly={levelsOnly} disabled={disabled} t={t} onChange={onChange} />
                  {switches.map(key => (
                    <label key={key} className={styles['modelEffortChoice']}>
                      <input
                        type="checkbox"
                        checked={(model['compat'] as Record<string, unknown> | undefined)?.[key] === true}
                        disabled={disabled}
                        onChange={(event) => {
                          const compat = { ...model['compat'] as Record<string, unknown> | undefined }
                          if (event.target.checked) compat[key] = true
                          else Reflect.deleteProperty(compat, key)
                          const next = { ...model, compat }
                          if (Object.keys(compat).length === 0) Reflect.deleteProperty(next, 'compat')
                          onChange(next)
                        }}
                      />
                      <span>{key === 'forceAdaptiveThinking' ? t('modelEffortAdaptive') : key}</span>
                    </label>
                  ))}
                </>
              )
              : null}
          </>
        )
        : null}
    </div>
  )
}

/** Props of {@link LevelTable}. */
interface LevelTableProps {
  model: DeepSeekModelDraft
  levels: readonly string[]
  levelsOnly: boolean
  disabled: boolean
  t: (key: ModelsKey) => string
  onChange: (model: DeepSeekModelDraft) => void
}

/**
 * The stored levels, one row per level pairing it with the value sent for it.
 * @param props - model row and replacement action.
 * @returns the level table.
 */
function LevelTable(props: LevelTableProps): ReactNode {
  const { model, levels, levelsOnly, disabled, t, onChange } = props
  const entries = readEfforts(model) ?? []
  // Only the focused field keeps its own text, so a field cleared while typing
  // stays empty although its level's name is stored. Leaving the field drops
  // it, and deleting a model, resetting the list, or folding these options all
  // move focus first, so no text outlives the field it was typed into.
  const [typing, setTyping] = useState<{ level: string; text: string } | undefined>(undefined)
  const used = entries.map(([level]) => level)

  const write = (next: Entries): void => { onChange(withEfforts(model, next)) }
  const replaceAt = (current: Entries, index: number, entry: readonly [string, unknown]): Entries =>
    current.map((existing, at) => at === index ? entry : existing)

  const changeLevel = (index: number, from: string, wire: unknown, to: string): void => {
    // Only a custom spelling between two thinking levels carries over; a value
    // still spelled as its old level, or one crossing to or from Off, resets.
    // A protocol accepting only its offered levels sends each under its own name, so nothing carries.
    const carried = !levelsOnly && typeof wire === 'string' && wire.length > 0 && wire !== from && from !== 'off' && to !== 'off'
    write(replaceAt(entries, index, [to, carried ? wire : defaultValue(to)]))
  }

  const addLevel = (): void => {
    const highest = Math.max(-1, ...used.map(level => levels.indexOf(level)))
    const level = levels.find((candidate, index) => index > highest && !used.includes(candidate))
      ?? levels.find(candidate => !used.includes(candidate))
    /* v8 ignore next -- the add button is disabled once every level has a row */
    if (level === undefined) return
    write([...entries, [level, defaultValue(level)]])
  }

  const editValue = (index: number, level: string, text: string): void => {
    setTyping({ level, text })
    const trimmed = text.trim()
    write(replaceAt(entries, index, [level, trimmed.length === 0 ? defaultValue(level) : trimmed]))
  }

  const leaveValue = (index: number, level: string, wire: unknown): void => {
    setTyping(undefined)
    // Leaving a field whose stored value the adapter refuses repairs it with the level name.
    if (!acceptedValue(level, wire)) write(replaceAt(entries, index, [level, defaultValue(level)]))
  }

  // A stored key the offered levels do not name stays selectable in its own row.
  const choicesFor = (level: string): readonly string[] => [
    ...levels.includes(level) ? [] : [level],
    ...levels.filter(choice => choice === level || !used.includes(choice)),
  ]

  const refused = entries.some(([level, wire]) => !acceptedValue(level, wire))
  const missingLevel = !used.some(level => level !== 'off')
  const outside = levelsOnly && entries.some(([level, wire]) => outsideLevels(levels, level, wire))

  return (
    <>
      {entries.length > 0
        ? (
          <div className={styles['modelReasoningRow']} aria-hidden="true">
            <span className={styles['modelFieldLabel']}>{t('modelReasoningLevel')}</span>
            <span className={styles['modelFieldLabel']}>{t('modelReasoningValue')}</span>
          </div>
        )
        : null}
      {entries.map(([level, wire], index) => (
        // A row is the entry at this position of the stored dict: changing its
        // level edits that entry in place and rows keep no state of their own,
        // so the position is the row's identity. Keying by level would remount
        // the select on every change and drop keyboard focus.
        <div key={index} className={styles['modelReasoningRow']}>
          <select
            className={`${styles['input']} ${styles['selectInput']}`}
            value={level}
            aria-label={`${t('modelReasoningLevel')} ${String(index + 1)}`}
            disabled={disabled}
            onChange={(event) => { changeLevel(index, level, wire, event.target.value) }}
          >
            {choicesFor(level).map(choice => (
              <option key={choice} value={choice}>{choice}</option>
            ))}
          </select>
          <input
            className={`${styles['input']} ${styles['modelReasoningValueInput']}`}
            type="text"
            value={typing?.level === level ? typing.text : typeof wire === 'string' ? wire : ''}
            placeholder={level === 'off' ? t('modelReasoningOffValuePlaceholder') : level}
            aria-label={`${level} ${t('modelReasoningValue')}`}
            aria-invalid={!acceptedValue(level, wire)}
            // Off only turns reasoning off; a value stored in cordis.patch.yml is shown and kept.
            // A protocol accepting only its offered levels sends each under its own name.
            disabled={disabled || level === 'off' || levelsOnly}
            onChange={(event) => { editValue(index, level, event.target.value) }}
            onBlur={() => { leaveValue(index, level, wire) }}
          />
          <button
            type="button"
            className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
            aria-label={`${t('modelReasoningRemove')} ${level}`}
            title={t('modelReasoningRemove')}
            disabled={disabled}
            onClick={() => { write(entries.filter((_entry, at) => at !== index)) }}
          >
            <IconTrashOutlineRegular size={14} />
          </button>
        </div>
      ))}
      {outside
        ? <p className={styles['error']}>{t('modelReasoningLevelsOnly')}</p>
        : refused
          ? <p className={styles['error']}>{t('modelReasoningValueRequired')}</p>
          : missingLevel ? <p className={styles['error']}>{t('modelReasoningNeedsLevel')}</p> : null}
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={disabled || levels.every(level => used.includes(level))}
        onClick={addLevel}
      >
        <IconPlusOutlineRegular size={14} />
        {t('modelReasoningAdd')}
      </button>
    </>
  )
}
