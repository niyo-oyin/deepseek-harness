/** The Skills page: every skill with its switch, the editor that adds, changes, or shows one, and ZIP import and export. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ManagedSkillDocument, SkillImportEntry } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconPlusOutlineRegular, IconTrashOutlineRegular, IconWarningOutlineRegular, Modal, StateDot, Switch, Tag, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
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

/** How long a notice that names what broke or what the limits are stays readable before it fades. */
const LONG_HOLD_MS = 8000

const EMPTY_DRAFT: ManagedSkillDocument = { name: '', description: '', whenToUse: '', content: '' }

const ORIGIN_LABEL: Record<SkillOrigin, SkillSettingsLocaleKey> = {
  user: 'originUser', shared: 'originShared', builtIn: 'originBuiltIn', plugin: 'originPlugin',
}

const OUTCOME_LABEL: Record<SkillImportEntry['outcome'], SkillSettingsLocaleKey> = {
  'imported': 'outcomeImported', 'replaced': 'outcomeReplaced', 'exists': 'outcomeExists', 'name-taken': 'outcomeNameTaken',
  'invalid': 'outcomeInvalid', 'failed': 'outcomeFailed',
}

const REFUSAL_LABEL: Record<Extract<SkillTransfer, { kind: 'importRefused' }>['reason'], SkillSettingsLocaleKey> = {
  'not-zip': 'refusedNotZip', 'too-large': 'refusedTooLarge', 'no-skill': 'refusedNoSkill', 'unsafe-path': 'refusedUnsafePath',
}

/**
 * The latest import or export: a progress line while importing, a fading banner once exported, and otherwise
 * what the import came to, with the way to replace the skills it left alone.
 */
function TransferView({ transfer, face, t }: {
  readonly transfer: SkillTransfer
  readonly face: Pick<SkillsFace, 'replaceImported' | 'dismissTransfer'>
  readonly t: Translate
}): ReactNode {
  if (transfer.kind === 'importing') {
    return <p className={css.progress} role="status"><StateDot state="ongoing" />{t('importing')}</p>
  }
  if (transfer.kind === 'exported') {
    const text = transfer.path === undefined ? t('exported', { name: transfer.name }) : t('exportedTo', { name: transfer.name, path: transfer.path })
    return <Toast key={text} text={text} tone="success" onDone={face.dismissTransfer} />
  }
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
        : <span className={css.problem}>{t(REFUSAL_LABEL[transfer.reason])}</span>}
      <div className={css.actions}>
        {transfer.kind === 'imported' && transfer.replaceable
          ? <Button variant="outline" size="sm" onClick={face.replaceImported}>{t('replaceImported')}</Button>
          : null}
        <Button variant="ghost" size="sm" onClick={face.dismissTransfer}>{t('dismiss')}</Button>
      </div>
    </div>
  )
}

/** Why the editor could not save, and the field at fault when one is. */
interface EditorProblem {
  readonly field?: keyof ManagedSkillDocument
  readonly text: string
}

function problemOf(problem: SkillSaveProblem, t: Translate): EditorProblem {
  switch (problem.kind) {
    case 'invalid-name': return { field: 'name', text: t('problemInvalidName') }
    case 'name-taken': return { field: 'name', text: t('problemNameTaken') }
    case 'no-description': return { field: 'description', text: t('problemNoDescription') }
    case 'failed': return { text: t('problemFailed', { message: problem.message }) }
    default: return { text: t('problemGone') }
  }
}

function noticeText(notice: SkillNotice, t: Translate): string {
  switch (notice.kind) {
    case 'refused': return t('noticeRefused')
    case 'failed': return t('noticeFailed', { message: notice.message })
    case 'exportTooLarge': return t('noticeExportTooLarge', { name: notice.name })
    default: return t('noticeGone', { name: notice.name })
  }
}

/** A write or an operation that did not go through, as a banner that fades on its own. */
function NoticeToast({ notice, onDone, t }: {
  readonly notice: SkillNotice
  readonly onDone: () => void
  readonly t: Translate
}): ReactNode {
  const text = noticeText(notice, t)
  const long = notice.kind === 'failed' || notice.kind === 'exportTooLarge'
  return (
    <Toast key={text} text={text} icon={<IconWarningOutlineRegular size={18} />}
      {...long ? { holdMs: LONG_HOLD_MS } : {}} onDone={onDone} />
  )
}

/**
 * One labelled editor field; `rows` makes it a multi-line box of that height. A problem with the field takes the
 * place of its hint and marks the control invalid.
 */
function Field({ id, label, hint, problem, value, rows, disabled, onChange }: {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly problem: string | undefined
  readonly value: string
  readonly rows?: number
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}): ReactNode {
  const messageId = `${id}-message`
  const described = { 'aria-invalid': problem === undefined ? undefined : true, 'aria-describedby': messageId }
  return (
    <div className={css.field}>
      <label className={css.fieldLabel} htmlFor={id}>{label}</label>
      {rows === undefined
        ? (
          <input id={id} className={css.input} type="text" spellCheck={false} value={value} disabled={disabled} {...described}
            onChange={(event) => { onChange(event.target.value) }} />
        )
        : (
          <textarea id={id} className={css.textarea} rows={rows} spellCheck={false} value={value} disabled={disabled} {...described}
            onChange={(event) => { onChange(event.target.value) }} />
        )}
      {problem === undefined
        ? <p id={messageId} className={css.hint}>{hint}</p>
        : <p id={messageId} className={css.problem} role="alert">{problem}</p>}
    </div>
  )
}

/**
 * The form that adds a skill, changes one of the user's own, or shows one that cannot be changed here.
 * The name of an existing skill is fixed: agents and the `disabled` setting refer to a skill by it.
 */
function Editor({ id, existing, editable, face, close, t }: {
  readonly id: string
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
  const [problem, setProblem] = useState<EditorProblem>()
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
  if (draft === undefined) {
    return <div id={id} className={css.editorLoading} role="status" aria-label={t('loading')}><StateDot state="ongoing" /></div>
  }
  const edit = (field: keyof ManagedSkillDocument) => (value: string): void => {
    setDraft({ ...draft, [field]: value })
    // Changing the field at fault withdraws what was said about it; the next save checks it again.
    setProblem(current => current?.field === field ? undefined : current)
  }
  const fieldId = (field: string): string => `plugin-config-skill-${field}`
  const fieldProblem = (field: keyof ManagedSkillDocument): string | undefined => problem?.field === field ? problem.text : undefined
  const submit = (): void => {
    setSaving(true)
    void save(draft, existing !== undefined).then((result) => {
      setSaving(false)
      if (result === undefined) close()
      else setProblem(problemOf(result, t))
    })
  }
  return (
    <form id={id} className={css.editor} data-skill-editor onSubmit={(event) => { event.preventDefault(); if (editable) submit() }}>
      {editable ? null : <p className={css.hint}>{t('viewOnly')}</p>}
      <Field id={fieldId('name')} label={t('fieldName')} hint={t('fieldNameHint')} problem={fieldProblem('name')} value={draft.name}
        disabled={existing !== undefined} onChange={edit('name')} />
      <Field id={fieldId('description')} label={t('fieldDescription')} hint={t('fieldDescriptionHint')} problem={fieldProblem('description')}
        value={draft.description} disabled={!editable} onChange={edit('description')} />
      <Field id={fieldId('when-to-use')} label={t('fieldWhenToUse')} hint={t('fieldWhenToUseHint')} problem={undefined} value={draft.whenToUse}
        rows={2} disabled={!editable} onChange={edit('whenToUse')} />
      <Field id={fieldId('content')} label={t('fieldContent')} hint={t('fieldContentHint')} problem={undefined} value={draft.content} rows={12}
        disabled={!editable} onChange={edit('content')} />
      {problem === undefined || problem.field !== undefined ? null : <p className={css.problem} role="alert">{problem.text}</p>}
      <div className={css.actions}>
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
function SkillItem({ row, writable, open, locked, face, onOpen, onRemove, t }: {
  readonly row: SkillRow
  readonly writable: boolean
  readonly open: boolean
  /** Another editor is open, so this skill's editor cannot open over its draft. */
  readonly locked: boolean
  readonly face: Omit<SkillsFace, 'hooks'>
  readonly onOpen: (name: string | undefined) => void
  readonly onRemove: (name: string) => void
  readonly t: Translate
}): ReactNode {
  const { name } = row
  const editorId = `plugin-config-skill-editor-${name}`
  return (
    <li className={css.row} data-skill={name} data-enabled={row.enabled}>
      <div className={css.rowHead}>
        <div className={css.title}>
          <span className={css.name}>{name}</span>
          <Tag tone="quiet">{t(ORIGIN_LABEL[row.origin])}</Tag>
          {row.modelInvocable ? null : <Tag tone="quiet">{t('manualOnly')}</Tag>}
          {row.userInvocable ? null : <Tag tone="quiet">{t('modelOnly')}</Tag>}
        </div>
        <span className={css.busy}>{row.switching ? <StateDot state="ongoing" /> : null}</span>
        <Switch checked={row.enabled} label={t('enable', { name })} disabled={!writable || row.switching}
          onChange={(next) => { face.setEnabled(name, next) }} />
      </div>
      <p className={css.text}>{row.description}</p>
      {row.path === undefined ? null : <p className={css.target}>{row.path}</p>}
      <div className={css.actions}>
        <Button variant="outline" size="sm" aria-label={t(row.editable ? 'editLabel' : 'viewLabel', { name })} aria-expanded={open}
          aria-controls={open ? editorId : undefined} disabled={locked} onClick={() => { onOpen(open ? undefined : name) }}>
          {row.editable ? t('edit') : t('view')}
        </Button>
        {row.path === undefined
          ? null
          : (
            <Button variant="outline" size="sm" aria-label={t('exportLabel', { name })} onClick={() => { face.exportArchive(name) }}>
              {t('export')}
            </Button>
          )}
        {row.editable
          ? (
            <Button variant="outline" size="sm" className={css.danger} icon={<IconTrashOutlineRegular size={13} />}
              aria-label={t('removeLabel', { name })} onClick={() => { onRemove(name) }}>{t('remove')}</Button>
          )
          : null}
      </div>
      {open ? <Editor id={editorId} existing={name} editable={row.editable} face={face} close={() => { onOpen(undefined) }} t={t} /> : null}
    </li>
  )
}

/** First-read placeholders in the shape of the skill rows. */
function ListSkeleton({ label }: { readonly label: string }): ReactNode {
  return (
    <div role="status" aria-label={label} data-skills-loading>
      <ul className={css.list} aria-hidden="true">
        {[0, 1, 2].map(index => (
          <li key={index} className={css.row}>
            <span className={`${css.skeletonLine} ${css.skeletonName}`}><span className={css.skeletonBar} /></span>
            <span className={`${css.skeletonLine} ${css.skeletonDetail}`}><span className={css.skeletonBar} /></span>
          </li>
        ))}
      </ul>
    </div>
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
  /** The skill whose removal waits on the confirmation. */
  const [removing, setRemoving] = useState<string>()
  const picker = useRef<HTMLInputElement>(null)
  // The skill list is followed only while the page is on screen.
  useEffect(() => observe(), [observe])
  return (
    <section className={css.page} data-skills>
      {state.status === 'unavailable' ? <p className={css.hint}>{t('unavailable')}</p> : null}
      {state.status === 'ready' && !state.writable ? <p className={css.hint}>{t('readOnly')}</p> : null}
      {state.stale === null ? null : <p className={css.problem} role="alert">{t('listStale', { message: state.stale })}</p>}
      <div className={css.toolbar}>
        <p className={css.hint}>{t('scope')}</p>
        <div className={css.toolbarActions}>
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
          <Button variant="outline" size="sm" disabled={state.transfer?.kind === 'importing' || open !== undefined}
            onClick={() => { picker.current?.click() }}>
            {t('importZip')}
          </Button>
          <Button variant="outline" size="sm" icon={<IconPlusOutlineRegular size={13} />} disabled={open !== undefined}
            onClick={() => { setOpen('') }}>{t('add')}</Button>
        </div>
      </div>
      {state.transfer === null ? null : <TransferView transfer={state.transfer} face={props} t={t} />}
      {open === '' ? <Editor id="plugin-config-skill-editor" editable face={props} close={() => { setOpen(undefined) }} t={t} /> : null}
      {state.listed || state.stale !== null || state.status === 'unavailable' ? null : <ListSkeleton label={t('loading')} />}
      {state.listed && state.rows.length === 0 && open !== '' ? <p className={css.hint}>{t('empty')}</p> : null}
      <ul className={css.list}>
        {state.rows.map(row => (
          <SkillItem key={row.name} row={row} writable={state.writable} open={open === row.name}
            locked={open !== undefined && open !== row.name} face={props} onOpen={setOpen} onRemove={setRemoving} t={t} />
        ))}
      </ul>
      {removing === undefined
        ? null
        : (
          <Modal
            open
            onClose={() => { setRemoving(undefined) }}
            title={t('removeConfirm', { name: removing })}
            description={t('removeDescription')}
            closeLabel={t('close')}
            footer={(
              <>
                <Button variant="outline" data-modal-autofocus onClick={() => { setRemoving(undefined) }}>{t('cancel')}</Button>
                <Button variant="primary" className={css.dangerButton} onClick={() => { setRemoving(undefined); props.remove(removing) }}>
                  {t('remove')}
                </Button>
              </>
            )}
          />
        )}
      {state.notice === null ? null : <NoticeToast notice={state.notice} onDone={props.dismissNotice} t={t} />}
    </section>
  )
}
