/**
 * ModelRouteField: a settings field that names one model route — provider,
 * model, and optional reasoning effort — over the same Host model catalog the
 * composer's picker reads. Its first entry leaves the field unset, which the
 * owning setting reads as "the session's model". A configured route the
 * catalog no longer offers stays listed and marked unavailable, so the stored
 * value never disappears from view. The effort select appears only when the
 * chosen model offers levels, and the chosen model's context window is shown
 * when its adapter knows it.
 *
 * It renders as the `plugins.config.field` editor of the `model-route` schema
 * role: any plugin whose Config declares an object field
 * `{ provider, model, reasoningEffort }` with `.role('model-route')` gets this
 * picker on its generated settings page.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelCatalogState } from './catalog.ts'
import type { ModelKey } from './locales.ts'
import { orderModelProviders } from './provider-order.ts'
import css from './ModelSelect.module.css'

/** One model route as the field stores it; absent means the field is unset. */
export interface ModelRouteValue {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Props of {@link ModelRouteField}. */
export interface ModelRouteFieldProps {
  /** Element id of the model select, which the field's own heading labels. */
  readonly id: string
  /** What the owning form shows beside the heading, such as its override status. */
  readonly status?: ReactNode
  /** The stored value, or `undefined` while unset. */
  readonly value: unknown
  readonly disabled: boolean
  /** Stage a new route, or `undefined` to unset the field. */
  readonly onChange: (value: ModelRouteValue | undefined) => void
  /** The shared Host model catalog. */
  readonly catalog: SnapshotStore<ModelCatalogState>
  /** Load the catalog when the field first shows. */
  readonly load: () => void
  readonly t: (key: ModelKey) => string
}

/** Read a stored value as a complete route, or `undefined` for anything else. */
export function modelRouteOf(value: unknown): ModelRouteValue | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { provider, model, reasoningEffort } = value as Record<string, unknown>
  if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') return undefined
  return { provider, model, ...typeof reasoningEffort === 'string' && reasoningEffort !== '' ? { reasoningEffort } : {} }
}

/**
 * A token count in the K/M spelling the Models page uses.
 * @param tokens - a positive count.
 * @returns the count, such as `200K` or `1M`.
 */
function tokenCount(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 100_000 === 0) return `${String(tokens / 1_000_000)}M`
  if (tokens >= 1_000 && tokens % 1_000 === 0) return `${String(tokens / 1_000)}K`
  return String(tokens)
}

/** The select value of one route: provider and model, which cannot contain a NUL. */
function routeKey(provider: string, model: string): string {
  return `${provider}\0${model}`
}

/**
 * Render the route picker.
 * @param props - the stored value, its edit action, and the shared catalog.
 * @returns the heading, the model select and, when the chosen model offers levels, the effort select.
 */
export function ModelRouteField(props: ModelRouteFieldProps): ReactNode {
  const { id, disabled, onChange, t, load } = props
  const store = props.catalog
  const catalog = useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())
  useEffect(() => { load() }, [load])
  const current = modelRouteOf(props.value)
  const groups: readonly ModelProviderGroup[] = orderModelProviders(catalog.value?.groups ?? [])
  const chosen = current === undefined
    ? undefined
    : groups.find(group => group.id === current.provider)?.models.find(model => model.id === current.model)
  const unavailable = current !== undefined && chosen === undefined && catalog.status === 'ready'
  const efforts = chosen?.reasoning?.efforts ?? []
  const pick = (key: string): void => {
    if (key === '') { onChange(undefined); return }
    const [provider = '', model = ''] = key.split('\0')
    onChange({ provider, model })
  }
  return (
    <div className={css.routeField}>
      <div className={css.routeHead}>
        <label className={css.routeLabel} htmlFor={id}>{t('route.heading')}</label>
        {props.status}
      </div>
      <select
        id={id}
        className={css.routeSelect}
        value={current === undefined ? '' : routeKey(current.provider, current.model)}
        disabled={disabled}
        onChange={(event) => { pick(event.target.value) }}
      >
        <option value="">{t('route.session')}</option>
        {current !== undefined && chosen === undefined
          ? (
            <option value={routeKey(current.provider, current.model)}>
              {unavailable
                ? t('route.unavailable').replace('{model}', () => `${current.provider} · ${current.model}`)
                : `${current.provider} · ${current.model}`}
            </option>
          )
          : null}
        {groups.map(group => (
          <optgroup key={group.id} label={group.id === 'deepseek-account' ? t('provider.account') : group.name}>
            {group.models.map(model => (
              <option key={model.id} value={routeKey(group.id, model.id)}>{model.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {current !== undefined && efforts.length > 0
        ? (
          <label className={css.routeEffort}>
            <span>{t('menu.effort')}</span>
            <select
              className={css.routeSelect}
              value={current.reasoningEffort ?? ''}
              disabled={disabled}
              onChange={(event) => {
                const effort = event.target.value
                onChange({ provider: current.provider, model: current.model, ...effort === '' ? {} : { reasoningEffort: effort } })
              }}
            >
              <option value="">{t('effort.providerDefault')}</option>
              {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
            </select>
          </label>
        )
        : null}
      {chosen?.contextWindow === undefined
        ? null
        : <p className={css.routeNote}>{t('route.contextWindow').replace('{tokens}', () => tokenCount(chosen.contextWindow ?? 0))}</p>}
      {unavailable ? <p className={css.routeWarning}>{t('route.unavailableHint')}</p> : null}
      {catalog.status === 'error' && catalog.error !== null
        ? <p className={css.routeWarning}>{t('option.loadError').replace('{message}', () => catalog.error ?? '')}</p>
        : null}
    </div>
  )
}
