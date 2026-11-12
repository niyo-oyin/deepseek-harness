/**
 * A row's configuration form generated from the schema the Host serves for its
 * entry, shown when the row's bundle registers no page of its own. The form
 * stages edits and writes them on save, like the pages plugins register.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  SettingsForm, SettingsFormModel, SettingsSecretField, SettingsValueField, settingsNumberField, settingsTextField, Switch, Tag,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormShell, type SettingsSecretSpec,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { autoBooleanField, autoChoiceField, type AutoConfig, type AutoField } from './auto-config.ts'
import type { Translate } from './presentation.ts'
import css from './AutoConfigForm.module.css'

/** What the generated form renders: the form state and every field's control state. */
interface AutoFormState {
  readonly shell: SettingsFormShell
  readonly fields: Readonly<Record<string, SettingsFieldState>>
}

/** One generated form's staged model with its published state and actions. */
interface BoundForm {
  readonly model: SettingsFormModel<Record<string, unknown>>
  readonly store: SnapshotStore<AutoFormState>
  readonly actions: SettingsFormActions
}

function specOf(field: AutoField): SettingsFieldSpec {
  if (field.kind === 'number') return settingsNumberField(field.name)
  if (field.kind === 'boolean') return autoBooleanField(field.name)
  if (field.kind === 'choice') return autoChoiceField(field.name, field.choices ?? [])
  return settingsTextField(field.name)
}

function bindForm(scope: ConfigForm<Record<string, unknown>>, config: AutoConfig): BoundForm {
  const specs = config.fields.flatMap(field => field.kind === 'secret' ? [] : [specOf(field)])
  const secrets: SettingsSecretSpec[] = config.fields.flatMap(field => field.kind !== 'secret' ? [] : [{
    field: field.name,
    write: text => scope.mutate([{ op: 'set', path: [field.name], value: text }]),
  }])
  const model = new SettingsFormModel(scope, specs, secrets)
  const store = model.bind((): AutoFormState => ({
    shell: model.shell(),
    fields: Object.fromEntries(config.fields.map(field => [field.name, model.field(field.name)])),
  }))
  return { model, store, actions: model.actions() }
}

/** Props of {@link AutoConfigForm}. */
export interface AutoConfigFormProps {
  /** The shared configuration form of the row's Host entry. */
  readonly scope: ConfigForm<Record<string, unknown>>
  /** The fields read from the entry's served schema; a new object rebinds the form. */
  readonly config: AutoConfig
  /** Names of the secret fields the Host reports a stored value for. */
  readonly storedSecrets: ReadonlySet<string>
  readonly t: Translate
}

/**
 * Render the generated form of one row.
 * @param props - the entry's shared form, its editable fields, the stored secrets, and the page copy.
 * @returns the form, or nothing before its model is bound.
 */
export function AutoConfigForm(props: AutoConfigFormProps): ReactNode {
  const { scope, config } = props
  const [bound, setBound] = useState<BoundForm | null>(null)
  // Bound in an effect so a remount releases the scope subscription it took.
  useEffect(() => {
    const next = bindForm(scope, config)
    setBound(next)
    return () => { next.model.dispose() }
  }, [scope, config])
  return bound === null ? null : <AutoConfigFields {...props} bound={bound} />
}

function AutoConfigFields({ bound, scope, config, storedSecrets, t }: AutoConfigFormProps & { readonly bound: BoundForm }): ReactNode {
  const state = useSyncExternalStore(bound.store.subscribe, bound.store.getSnapshot)
  const { actions } = bound
  const disabled = !state.shell.writable
  const hintOf = (field: AutoField): string => [
    field.description,
    field.choices === undefined ? undefined : t('autoConfigChoices', { values: field.choices.join(' / ') }),
    field.defaultText === undefined ? undefined : t('autoConfigDefault', { value: field.defaultText }),
  ].filter(part => part !== undefined).join(' ')
  const control = (field: AutoField): ReactNode => {
    const id = `plugin-auto-config-${field.name}`
    const fieldState = state.fields[field.name]
    if (fieldState === undefined) return null
    if (field.kind === 'secret') {
      const stored = storedSecrets.has(field.name)
      return (
        <div key={field.name} className={css.secret}>
          <SettingsSecretField
            id={id}
            label={field.name}
            hint={[field.description, t('autoConfigSecretHint')].filter(part => part !== undefined).join(' ')}
            text={fieldState.text}
            disabled={disabled}
            configured={stored}
            stateLabel={t(stored ? 'autoConfigSecretSet' : 'autoConfigSecretUnset')}
            onEdit={(text) => { actions.edit(field.name, text) }}
          />
          {stored
            ? (
              <button type="button" className={css.clear} disabled={disabled || state.shell.saving}
                onClick={() => { void scope.mutate([{ op: 'unset', path: [field.name] }]) }}>
                {t('autoConfigSecretClear', { name: field.name })}
              </button>
            )
            : null}
        </div>
      )
    }
    if (field.kind === 'boolean') {
      const hint = hintOf(field)
      return (
        <div key={field.name} className={css.field}>
          <div className={css.head}>
            <span className={css.label}>{field.name}</span>
            {fieldState.overridden
              ? (
                <span className={css.badges}>
                  <Tag tone="neutral">{t('autoConfigOverridden')}</Tag>
                  <button type="button" className={css.reset} disabled={disabled} onClick={() => { actions.resetField(field.name) }}>
                    {t('autoConfigReset')}
                  </button>
                </span>
              )
              : null}
            <Switch checked={fieldState.text === 'true'} label={field.name} disabled={disabled}
              onChange={(next) => { actions.edit(field.name, String(next)) }} />
          </div>
          {hint === '' ? null : <p className={css.hint}>{hint}</p>}
        </div>
      )
    }
    return (
      <SettingsValueField
        key={field.name}
        id={id}
        label={field.name}
        hint={hintOf(field)}
        overriddenLabel={t('autoConfigOverridden')}
        resetLabel={t('autoConfigReset')}
        invalidLabel={field.kind === 'choice'
          ? t('autoConfigInvalidChoice', { values: (field.choices ?? []).join(' / ') })
          : t('autoConfigInvalidNumber')}
        numeric={field.kind === 'number'}
        disabled={disabled}
        {...fieldState}
        onEdit={(text) => { actions.edit(field.name, text) }}
        onReset={() => { actions.resetField(field.name) }}
      />
    )
  }
  return (
    <section className={css.section} data-plugin-auto-config>
      <SettingsForm
        labels={{
          unavailable: t('autoConfigUnavailable'), readOnly: t('autoConfigReadOnly'), saveFailed: t('autoConfigSaveFailed'),
          save: t('autoConfigSave'), saving: t('autoConfigSaving'),
        }}
        state={state.shell}
        onSave={actions.save}
        onDiscard={actions.discard}
      >
        {config.fields.map(control)}
      </SettingsForm>
      {config.unsupported.length === 0
        ? null
        : <p className={css.note}>{t('autoConfigUnsupported', { fields: config.unsupported.join(', ') })}</p>}
    </section>
  )
}
