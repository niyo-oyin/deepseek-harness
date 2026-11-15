/**
 * The one way to gain a provider, shared by the Models page and the first-run
 * dialog: a mode switch chooses between adopting a directory provider that has
 * no profile or key yet (the catalog select over the provider editor) and
 * declaring a custom model API (the create form). A panel mounts the first time
 * its mode is shown and stays mounted, hidden, while the panel is open, so
 * switching modes discards neither draft; the switch holds still while either
 * panel has a write or an endpoint interrogation in flight.
 */

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from './slot-contract.ts'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import { protocolChoices, reasoningLevelChoices } from './store.ts'
import type { ModelsSettingsState, ProviderRow } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import { keyConfiguredOf, targetOf, type EditorTarget, type ProviderIdentity } from './provider-target.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The two ways to gain a provider. */
export type AddMode = 'catalog' | 'custom'

/** A directory row the catalog mode can adopt, with its registered namespace. */
interface AddableRow {
  row: ProviderRow
  namespace: SettingsNamespaceView
}

/** What the current snapshot lets the panel offer. */
export interface AddOffers {
  /** Directory rows without a profile or key, in directory order. */
  addable: readonly AddableRow[]
  /** Whether a configurable namespace is mounted at all. */
  catalogOffered: boolean
  /** Whether a directory row is left to adopt. */
  catalogEnabled: boolean
  /** Whether the pi-ai namespace that takes declared routes is mounted. */
  customOffered: boolean
  /** Whether that namespace names a protocol to declare a route with. */
  customEnabled: boolean
}

/**
 * Read what one snapshot lets the panel offer.
 * @param state - the Models page snapshot.
 * @param schema - settings schema operations.
 * @returns the addable rows and which modes are offered and enabled.
 */
export function addOffers(state: ModelsSettingsState, schema: SettingsSchemaOperations): AddOffers {
  const addable = state.rows.flatMap((row) => {
    const namespace = state.namespaces.get(row.entry.settingsNs)
    return namespace === undefined || row.configured ? [] : [{ row, namespace }]
  })
  const piAi = state.namespaces.get('llm-pi-ai')
  return {
    addable,
    catalogOffered: state.rows.some(row => state.namespaces.has(row.entry.settingsNs)),
    catalogEnabled: addable.length > 0,
    customOffered: piAi !== undefined,
    customEnabled: protocolChoices(piAi, schema).length > 0,
  }
}

/** Props of {@link AddProviderPanel}. */
export interface AddProviderPanelProps {
  /** The Models page snapshot. */
  state: ModelsSettingsState
  schema: SettingsSchemaOperations
  operations: ModelsOperations
  t: (key: keyof typeof en) => string
  /** The provider-card seat, rendered under the catalog draft. */
  renderSlot: PropsRenderSlots<'settings.models.provider-card'>['renderSlot']
  /**
   * Close the panel.
   * @param changed - whether a write landed.
   * @param saved - the catalog provider that was saved; absent for a declared route.
   */
  onClose: (changed: boolean, saved?: ProviderIdentity) => void
}

/**
 * Render the add-provider panel.
 * @param props - the snapshot, the write operations, and the close callback.
 * @returns the panel.
 */
export function AddProviderPanel({ state, schema, operations, t, renderSlot, onClose }: AddProviderPanelProps): ReactNode {
  const offers = addOffers(state, schema)
  const { addable, catalogOffered, catalogEnabled, customOffered, customEnabled } = offers
  const [addMode, setAddMode] = useState<AddMode>(catalogEnabled ? 'catalog' : 'custom')
  const [visited, setVisited] = useState<ReadonlySet<AddMode>>(() => new Set([addMode]))
  const [target, setTarget] = useState<EditorTarget | undefined>(() => {
    const first = addable[0]
    return first === undefined ? undefined : targetOf(first.row)
  })
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [customBusy, setCustomBusy] = useState(false)
  const addId = useId()
  const piAi = state.namespaces.get('llm-pi-ai')
  const protocols = protocolChoices(piAi, schema)
  const reasoningLevels = reasoningLevelChoices(piAi, schema)
  const bothOffered = catalogOffered && customOffered
  const mode: AddMode = bothOffered ? addMode : customOffered ? 'custom' : 'catalog'
  const mounted = (candidate: AddMode): boolean => mode === candidate || visited.has(candidate)
  const switchLocked = catalogBusy || customBusy
  // The chosen row survives a refresh that adopts or withdraws it elsewhere, so a typed key is never discarded,
  // for as long as its namespace can still take the write; else the first row still addable.
  const draft = ((): { target: EditorTarget; namespace: SettingsNamespaceView } | undefined => {
    if (!catalogOffered) return undefined
    const kept = target === undefined ? undefined : state.namespaces.get(target.settingsNs)
    if (target !== undefined && kept !== undefined) return { target, namespace: kept }
    const first = addable[0]
    return first === undefined ? undefined : { target: targetOf(first.row), namespace: first.namespace }
  })()
  const addRow = draft === undefined ? undefined : state.rows.find(row => row.entry.provider === draft.target.provider)

  return (
    <div className={styles['addCard']}>
      <div className={styles['addModes']}>
        {bothOffered
          ? (
            <SegmentedControl
              id={addId}
              label={t('addMode')}
              value={mode}
              disabled={switchLocked}
              options={[
                {
                  value: 'catalog',
                  label: t('addCatalog'),
                  disabled: !catalogEnabled,
                  ...catalogEnabled ? {} : { title: t('addCatalogExhausted') },
                },
                {
                  value: 'custom',
                  label: t('addCustom'),
                  disabled: !customEnabled,
                  ...customEnabled ? {} : { title: t('addCustomUnavailable') },
                },
              ]}
              onChange={(next) => {
                setAddMode(next)
                setVisited(previous => new Set([...previous, next]))
              }}
            />
          )
          : (
            // One mode alone has no switch to name it, so the card carries the mode as its title instead.
            <div className={styles['editorHeader']}>
              <span className={styles['editorTitle']}>{t(mode === 'catalog' ? 'addCatalog' : 'addCustom')}</span>
            </div>
          )}
        <p className={styles['advancedHint']}>
          {t(mode === 'catalog' ? 'addCatalogHint' : 'addCustomHint')}
        </p>
      </div>
      {mounted('catalog') && draft !== undefined
        ? (
          <div
            id={`${addId}-catalog-panel`}
            {...bothOffered ? { role: 'tabpanel', 'aria-labelledby': `${addId}-catalog` } : {}}
            hidden={mode !== 'catalog'}
            className={styles['addPanel']}
          >
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('provider')}</span>
              <select
                className={`${styles['input']} ${styles['selectInput']}`}
                value={draft.target.provider}
                aria-label={t('provider')}
                disabled={catalogBusy}
                onChange={(event) => {
                  const picked = addable.find(candidate => candidate.row.entry.provider === event.target.value)
                  /* v8 ignore next -- the select only lists addable rows */
                  if (picked === undefined) return
                  setTarget(targetOf(picked.row))
                }}
              >
                {addable.map(({ row }) => (
                  <option key={row.entry.provider} value={row.entry.provider}>{row.entry.displayName}</option>
                ))}
              </select>
            </div>
            <ProviderEditor
              key={draft.target.provider}
              provider={draft.target.provider}
              displayName={draft.target.displayName}
              hideTitle
              namespace={draft.namespace}
              schema={schema}
              settingsPath={draft.target.settingsPath}
              operations={operations}
              {...draft.target.defaultBaseURL === undefined ? {} : { defaultBaseURL: draft.target.defaultBaseURL }}
              {...draft.target.baseURLEnv === undefined ? {} : { baseURLEnv: draft.target.baseURLEnv }}
              {...draft.target.nativeAuth === undefined ? {} : { nativeAuth: draft.target.nativeAuth }}
              {...draft.target.serviceTiers === undefined ? {} : { serviceTiers: draft.target.serviceTiers }}
              {...addRow?.credentialChecks === undefined ? {} : { credentialChecks: addRow.credentialChecks }}
              t={t}
              readOnly={!state.writable}
              onClose={(changed) => { onClose(changed, draft.target) }}
              onBusyChange={setCatalogBusy}
            />
            {addRow === undefined
              ? null
              : renderSlot(
                'settings.models.provider-card',
                { provider: addRow.entry, configured: addRow.configured, keyConfigured: keyConfiguredOf(addRow) },
                { entryKey: addRow.entry.settingsNs },
              )}
          </div>
        )
        : null}
      {mounted('custom') && piAi !== undefined
        ? (
          <div
            id={`${addId}-custom-panel`}
            {...bothOffered ? { role: 'tabpanel', 'aria-labelledby': `${addId}-custom` } : {}}
            hidden={mode !== 'custom'}
            className={styles['addPanel']}
          >
            <CustomProviderCard
              taken={state.rows.map(row => row.entry.provider)}
              protocols={protocols}
              reasoningLevels={reasoningLevels}
              revision={piAi.revision}
              operations={operations}
              t={t}
              readOnly={!state.writable}
              onClose={(changed) => { onClose(changed) }}
              onBusyChange={setCustomBusy}
            />
          </div>
        )
        : null}
    </div>
  )
}
