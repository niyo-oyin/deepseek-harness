/** The Skills page: every skill with its switch, the editor that adds, changes, or shows one, and ZIP import and export. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ManagedSkillDocument } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillNotice, SkillOrigin, SkillRow, SkillSaveProblem, SkillsFace, SkillTransfer } from './controller.ts'
import type { SkillSettingsLocaleKey } from './locales.ts'
import css from './SkillsCard.module.css'

/** Props the renderer binds for the Skills page. */
export type SkillsCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.skills'>
  & InjectFace<SkillsFace>

type Translate = SkillsCardProps['t']

const EMPTY_DRAFT: ManagedSkillDocument = { name: '', description: '', whenToUse: '', content: '' }

const ORIGIN_LABEL: Record<SkillOrigin, SkillSettingsLocaleKey> = {
  user: 'originUser', shared: 'originShared', builtIn: 'originBuiltIn', plugin: 'originPlugin',
}

type ImportedSkill = Extract<SkillTransfer, { kind: 'imported' }>['skills'][number]

const OUTCOME_LABEL: Record<ImportedSkill['outcome'], SkillSettingsLocaleKey> = {
  'imported': 'outcomeImported', 'replaced': 'outcomeReplaced', 'exists': 'outcomeExists', 'name-taken': 'outcomeNameTaken',
  'invalid': 'outcomeInvalid',
}

const REFUSAL_LABEL: Record<Extract<SkillTransfer, { kind: 'importRefused' }>['reason'], SkillSettingsLocaleKey> = {
  'not-zip': 'refusedNotZip', 'too-large': 'refusedTooLarge', 'no-skill': 'refusedNoSkill', 'unsafe-path': 'refusedUnsafePath',
}

/** What the latest import or export came to, with the way to replace the skills an import left alone. */
function TransferPanel({ transfer, face, t }: {
  readonly transfer: SkillTransfer
  readonly face: Pick<SkillsFace, 'replaceImported' | 'dismissTransfer'>
  readonly t: Translate
}): ReactNode {
  if (transfer.kind === 'importing') return <p className={css.hint} role="status">{t('importing')}</p>
  return (
    <div className={css.transfer} role="status" data-skill-transfer={transfer.kind}>
      {transfer.kind === 'imported'
        ? (
          <ul className={css.outcomes}>
            {transfer.skills.map(skill => (
              <li key={skill.name} data-outcome={skill.outcome}>{t(OUTCOME_LABEL[skill.outcome], { name: skill.name })}</li>
            ))}
          </ul>
        )
        : transfer.kind === 'importRefused'
          ? <span className={css.problem}>{t(REFUSAL_LABEL[transfer.reason])}</span>
          : <span>{transfer.path === undefined ? t('exported', { name: transfer.name }) : t('exportedTo', { name: transfer.name, path: transfer.path })}</span>}
      <div className={css.rowActions}>
        {transfer.kind === 'imported' && transfer.replaceable
          ? <Button variant="outline" size="sm" onClick={face.replaceImported}>{t('replaceImported')}</Button>
          : null}
        <Button variant="ghost" size="sm" onClick={face.dismissTransfer}>{t('dismiss')}</Button>
      </div>
    </div>
  )
}

function problemText(problem: SkillSaveProblem, t: Translate): string {
  switch (problem.kind) {
    case 'invalid-name': return t('problemInvalidName')
    case 'name-taken': return t('problemNameTaken')
    case 'no-description': return t('problemNoDescription')
    case 'failed': return t('problemFailed', { message: problem.message })
    default: return t('problemGone')
  }
}

function noticeText(notice: SkillNotice, t: Translate): string {
  switch (notice.kind) {
    case 'refused': return t('noticeRefused')
    case 'failed': return t('noticeFailed', { message: notice.message })
    default: return t('noticeGone', { name: notice.name })
  }
}

/** One labelled editor field; `rows` makes it a multi-line box of that height. */
function Field({ id, label, hint, value, rows, disabled, onChange }: {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly value: string
  readonly rows?: number
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}): ReactNode {
  return (
    <div className={css.editorField}>
      <label className={css.fieldLabel} htmlFor={id}>{label}</label>
      {rows === undefined
        ? (
          <input id={id} className={css.input} type="text" spellCheck={false} value={value} disabled={disabled}
            onChange={(event) => { onChange(event.target.value) }} />
        )
        : (
          <textarea id={id} className={css.textarea} rows={rows} spellCheck={false} value={value} disabled={disabled}
            onChange={(event) => { onChange(event.target.value) }} />
        )}
      <p className={css.hint}>{hint}</p>
    </div>
  )
}

/**
 * The form that adds a skill, changes one of the user's own, or shows one that cannot be changed here.
 * The name of an existing skill is fixed: agents and the `disabled` setting refer to a skill by it.
 */
function Editor({ existing, editable, face, close, t }: {
  /** The listed skill to open; absent for a new skill. */
  readonly existing?: string
  readonly editable: boolean
  readonly face: Pick<SkillsFace, 'load' | 'save'>
  readonly close: () => void
  readonly t: Translate
}): ReactNode {
  const { save } = face
  // The skill is read once per opening: the latest callbacks are reached through a ref, so a re-render of the
  // list behind the editor never reloads it over what is being typed.
  const opening = useRef({ load: face.load, close })
  opening.current = { load: face.load, close }
  const [draft, setDraft] = useState(existing === undefined ? EMPTY_DRAFT : undefined)
  const [problem, setProblem] = useState<string>()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (existing === undefined) return
    let current = true
    void opening.current.load(existing).then((document) => {
      if (!current) return
      // A skill that could not be read is reported as the page notice; there is nothing to show here.
      if (document === undefined) opening.current.close()
      else setDraft(document)
    })
    return () => { current = false }
  }, [existing])
  if (draft === undefined) return <p className={css.hint}>{t('loading')}</p>
  const edit = (field: keyof ManagedSkillDocument) => (value: string): void => {
    setDraft(current => current === undefined ? current : { ...current, [field]: value })
  }
  const id = (field: string): string => `plugin-config-skill-${field}`
  const submit = (): void => {
    setSaving(true)
    void save(draft, existing !== undefined).then((result) => {
      setSaving(false)
      if (result === undefined) close()
      else setProblem(problemText(result, t))
    })
  }
  return (
    <form className={css.editor} data-skill-editor onSubmit={(event) => { event.preventDefault(); if (editable) submit() }}>
      {editable ? null : <p className={css.hint}>{t('viewOnly')}</p>}
      <Field id={id('name')} label={t('fieldName')} hint={t('fieldNameHint')} value={draft.name}
        disabled={existing !== undefined} onChange={edit('name')} />
      <Field id={id('description')} label={t('fieldDescription')} hint={t('fieldDescriptionHint')} value={draft.description}
        disabled={!editable} onChange={edit('description')} />
      <Field id={id('when-to-use')} label={t('fieldWhenToUse')} hint={t('fieldWhenToUseHint')} value={draft.whenToUse} rows={2}
        disabled={!editable} onChange={edit('whenToUse')} />
      <Field id={id('content')} label={t('fieldContent')} hint={t('fieldContentHint')} value={draft.content} rows={12}
        disabled={!editable} onChange={edit('content')} />
      {problem === undefined ? null : <p className={css.problem} role="alert">{problem}</p>}
      <div className={css.editorActions}>
        {editable
          ? (
            <>
              <Button variant="primary" size="sm" type="submit" disabled={saving}>{saving ? t('saving') : t('save')}</Button>
              <Button variant="ghost" size="sm" disabled={saving} onClick={close}>{t('cancel')}</Button>
            </>
          )
          : <Button variant="outline" size="sm" onClick={close}>{t('close')}</Button>}
      </div>
    </form>
  )
}

/** One listed skill: where it comes from, its switch, and the operations its origin allows. */
function SkillItem({ row, writable, open, face, onOpen, t }: {
  readonly row: SkillRow
  readonly writable: boolean
  readonly open: boolean
  readonly face: Omit<SkillsFace, 'hooks'>
  readonly onOpen: (name: string | undefined) => void
  readonly t: Translate
}): ReactNode {
  const [confirming, setConfirming] = useState(false)
  return (
    <li className={css.row} data-skill={row.name} data-enabled={row.enabled}>
      <div className={css.rowHead}>
        <span className={css.name}>{row.name}</span>
        <Tag tone="quiet">{t(ORIGIN_LABEL[row.origin])}</Tag>
        {row.modelInvocable ? null : <Tag tone="quiet">{t('manualOnly')}</Tag>}
        {row.userInvocable ? null : <Tag tone="quiet">{t('modelOnly')}</Tag>}
        <span className={css.spacer} />
        <Switch checked={row.enabled} label={t('enable', { name: row.name })} disabled={!writable}
          onChange={(next) => { face.setEnabled(row.name, next) }} />
      </div>
      <p className={css.text}>{row.description}</p>
      {row.path === undefined ? null : <p className={css.target}>{row.path}</p>}
      <div className={css.rowActions}>
        <Button variant="outline" size="sm" onClick={() => { onOpen(open ? undefined : row.name) }}>
          {row.editable ? t('edit') : t('view')}
        </Button>
        {row.path === undefined
          ? null
          : <Button variant="outline" size="sm" onClick={() => { face.exportArchive(row.name) }}>{t('export')}</Button>}
        {!row.editable
          ? null
          : confirming
            ? (
              <>
                <span className={css.confirm}>{t('removeConfirm', { name: row.name })}</span>
                <Button variant="outline" size="sm" onClick={() => { setConfirming(false); face.remove(row.name) }}>{t('remove')}</Button>
                <Button variant="ghost" size="sm" onClick={() => { setConfirming(false) }}>{t('cancel')}</Button>
              </>
            )
            : <Button variant="ghost" size="sm" onClick={() => { setConfirming(true) }}>{t('remove')}</Button>}
      </div>
      {open ? <Editor existing={row.name} editable={row.editable} face={face} close={() => { onOpen(undefined) }} t={t} /> : null}
    </li>
  )
}

/**
 * Render the Skills one-liner or the page, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the page snapshot, and its actions.
 * @returns the one-liner, or the page.
 */
export function SkillsCard(props: SkillsCardProps): ReactNode {
  return props.view === 'summary' ? props.t('description') : <SkillsPage {...props} />
}

function SkillsPage(props: SkillsCardProps): ReactNode {
  const { t, observe } = props
  const state = props.useSkills(snapshot => snapshot)
  /** The open editor: `''` adds a skill, a name opens that skill. */
  const [open, setOpen] = useState<string>()
  const picker = useRef<HTMLInputElement>(null)
  // The skill list is followed only while the page is on screen.
  useEffect(() => observe(), [observe])
  return (
    <section className={css.page} data-skills>
      {state.status === 'unavailable' ? <p className={css.hint}>{t('unavailable')}</p> : null}
      {state.status === 'ready' && !state.writable ? <p className={css.hint}>{t('readOnly')}</p> : null}
      {state.notice === null
        ? null
        : (
          <p className={css.notice} role="alert">
            <span>{noticeText(state.notice, t)}</span>
            <Button variant="ghost" size="sm" onClick={props.dismissNotice}>{t('dismiss')}</Button>
          </p>
        )}
      <div className={css.toolbar}>
        <p className={css.hint}>{t('scope')}</p>
        <input
          ref={picker}
          type="file"
          accept=".zip,.skill,application/zip"
          hidden
          data-skill-import
          onChange={(event) => {
            const archive = event.target.files?.[0]
            // Cleared, so choosing the same file again imports it again.
            event.target.value = ''
            if (archive !== undefined) props.importArchive(archive)
          }}
        />
        <Button variant="outline" size="sm" disabled={state.transfer?.kind === 'importing'} onClick={() => { picker.current?.click() }}>
          {t('importZip')}
        </Button>
        <Button variant="outline" size="sm" disabled={open === ''} onClick={() => { setOpen('') }}>{t('add')}</Button>
      </div>
      {state.transfer === null ? null : <TransferPanel transfer={state.transfer} face={props} t={t} />}
      {open === '' ? <Editor editable face={props} close={() => { setOpen(undefined) }} t={t} /> : null}
      {state.listed ? null : <p className={css.hint}>{t('loading')}</p>}
      {state.listed && state.rows.length === 0 && open !== '' ? <p className={css.hint}>{t('empty')}</p> : null}
      <ul className={css.list}>
        {state.rows.map(row => (
          <SkillItem key={row.name} row={row} writable={state.writable} open={open === row.name} face={props} onOpen={setOpen} t={t} />
        ))}
      </ul>
    </section>
  )
}
