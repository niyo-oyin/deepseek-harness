/**
 * First-run model-provider step, the same on every face. Readiness comes from
 * the same provider/settings/credential join as the Models page: any provider
 * the user can already talk to ends the step, and a user with none is shown
 * that page's add-provider panel in the shared onboarding modal, so a provider
 * is added once, the same way, whichever vendor it is.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { onboardingReadiness } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { AddProviderPanel } from './AddProviderPanel.tsx'
import type {} from './slot-contract.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './ProviderOnboardingDialog.module.css'

/** Registration-side dependencies of {@link ProviderOnboardingDialog}. */
export interface ProviderOnboardingInjected {
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** The Host operations the reused add-provider panel writes through. */
  operations: ModelsOperations
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type ProviderOnboardingDialogProps = PropsRuntime<'settings.onboarding'> & InjectFace<ProviderOnboardingInjected>

/**
 * Offer the add-provider panel while no provider can serve requests.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal, or null when onboarding needs no intervention.
 */
export function ProviderOnboardingDialog(props: ProviderOnboardingDialogProps): ReactNode {
  const { complete, controller, useModels, operations, schema, t, explicit = false } = props
  const state = useModels(snapshot => snapshot)
  const readiness = onboardingReadiness(state)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (readiness.kind === 'unavailable' || (!explicit && readiness.kind === 'provider-ready')) complete()
  }, [complete, readiness.kind, explicit])

  if (readiness.kind === 'loading' || readiness.kind === 'unavailable') return null
  if (readiness.kind === 'provider-ready' && !explicit) return null

  return (
    <OnboardingModal title={t('onboardingTitle')}>
      <p className={styles.description}>{t('onboardingDescription')}</p>
      <div className={styles.editor}>
        <AddProviderPanel
          state={state}
          schema={schema}
          operations={operations}
          t={t}
          // The dialog's own Configure later is the one dismissal, so the panel's editors offer no Cancel.
          cancelable={false}
          onClose={(changed) => {
            // A saved provider ends the step once the refreshed join finds it usable.
            if (changed) void controller.load()
          }}
        />
      </div>
      <div className={styles.later}>
        <Button variant="outline" onClick={complete}>{t('onboardingLater')}</Button>
      </div>
    </OnboardingModal>
  )
}
