/** The MCP servers page: the manager's servers with their live status, and the editor that adds or changes one. */

import { useEffect, useState, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { McpManagedServerStatus } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconPlusOutlineRegular, IconTrashOutlineRegular, IconWarningOutlineRegular, Modal, StateDot, Switch, Tag, Toast,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpNotice, McpProbeState, McpServerRow, McpServersFace } from './controller.ts'
import { EMPTY_DRAFT, draftOf, type DraftProblem, type McpServerDraft } from './mcp-entry.ts'
import css from './McpServersCard.module.css'

/** Props the renderer binds for the MCP servers page. */
export type McpServersCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.mcp'>
  & InjectFace<McpServersFace>

type Translate = McpServersCardProps['t']

/** How many tool names a successful test lists before it says there are more. */
const SHOWN_TOOL_NAMES = 8

/** How long a failure that names what broke stays readable before it fades. */
const FAILURE_HOLD_MS = 8000

type StatusTone = 'ok' | 'busy' | 'bad' | 'off'

/** The dot drawn before each status tone. */
const TONE_DOT: Record<StatusTone, StateDotState> = { ok: 'done', busy: 'ongoing', bad: 'error', off: 'idle' }

/** The status line of one server and the diagnostic beside it, if the manager reported one. */
function statusText(status: McpManagedServerStatus | undefined, t: Translate): { label: string; detail?: string; tone: StatusTone } {
  if (status === undefined) return { label: t('statusUnknown'), tone: 'off' }
  switch (status.state) {
    case 'connected': return { label: t('statusConnected', { count: status.toolCount }), tone: 'ok' }
    case 'connecting': return { label: t('statusConnecting'), tone: 'busy' }
    case 'reconnecting':
      return { label: t('statusReconnecting', { attempt: status.attempt, max: status.maxAttempts }), detail: status.lastError, tone: 'busy' }
    case 'waiting-credentials': return { label: t('statusWaitingCredentials'), detail: status.lastError, tone: 'bad' }
    case 'disabled': return { label: t('statusDisabled'), tone: 'off' }
    case 'closed': return { label: t('statusClosed'), tone: 'off' }
    case 'failed': {
      const detail = 'lastError' in status ? status.lastError : 'result' in status ? status.result.cleanupError : undefined
      return { label: t('statusFailed'), ...detail === undefined ? {} : { detail }, tone: 'bad' }
    }
  }
}

function probeText(probe: McpProbeState, t: Translate): { text: string; failed: boolean } {
  if (probe.state === 'running') return { text: t('testing'), failed: false }
  if (probe.state === 'failed') return { text: t('probeFailed', { message: probe.message }), failed: true }
  if (probe.toolNames.length === 0) return { text: t('probeOkNone', { ms: probe.durationMs }), failed: false }
  const shown = probe.toolNames.slice(0, SHOWN_TOOL_NAMES).join(', ')
  const names = probe.truncated || probe.toolNames.length > SHOWN_TOOL_NAMES ? t('probeMore', { names: shown }) : shown
  return { text: t('probeOk', { ms: probe.durationMs, count: probe.toolNames.length, names }), failed: false }
}

/** Why the editor could not write, and the field at fault when one is; a refusal belongs to the whole entry. */
interface EditorProblem {
  readonly field?: keyof McpServerDraft
  readonly text: string
}

function problemOf(problem: DraftProblem | { kind: 'refused' }, t: Translate): EditorProblem {
  switch (problem.kind) {
    case 'name': return { field: 'name', text: t('problemName') }
    case 'nameTaken': return { field: 'name', text: t('problemNameTaken') }
    case 'command': return { field: 'command', text: t('problemCommand') }
    case 'url': return { field: 'url', text: t('problemUrl') }
    case 'env': return { field: 'env', text: t('problemEnv', { line: problem.line }) }
    case 'headers': return { field: 'headers', text: t('problemHeaders', { line: problem.line }) }
    default: return { text: t('refused') }
  }
}

/**
 * One labelled editor field; `lines` makes it a multi-line box for one item per line. A problem with the field
 * takes the place of its hint and marks the control invalid.
 */
function Field({ id, label, hint, problem, value, lines, disabled, onChange }: {
  readonly id: string
  readonly label: string
  readonly hint?: string
  readonly problem: string | undefined
  readonly value: string
  readonly lines?: boolean
  readonly disabled?: boolean
  readonly onChange: (value: string) => void
}): ReactNode {
  const message = problem ?? hint
  const messageId = `${id}-message`
  const described = {
    'aria-invalid': problem === undefined ? undefined : true,
    'aria-describedby': message === undefined ? undefined : messageId,
  }
  return (
    <div className={css.field}>
      <label className={css.fieldLabel} htmlFor={id}>{label}</label>
      {lines === true
        ? (
          <textarea id={id} className={css.textarea} rows={3} spellCheck={false} value={value} disabled={disabled} {...described}
            onChange={(event) => { onChange(event.target.value) }} />
        )
        : (
          <input id={id} className={css.input} type="text" spellCheck={false} value={value} disabled={disabled} {...described}
            onChange={(event) => { onChange(event.target.value) }} />
        )}
      {message === undefined
        ? null
        : <p id={messageId} className={problem === undefined ? css.hint : css.problem} role={problem === undefined ? undefined : 'alert'}>{message}</p>}
    </div>
  )
}

/** The form that adds a server or changes one; the name of an existing server is fixed, because it namespaces the server's tools. */
function Editor({ id, initial, existing, save, close, t }: {
  readonly id: string
  readonly initial: McpServerDraft
  readonly existing: boolean
  readonly save: McpServersFace['save']
  readonly close: () => void
  readonly t: Translate
}): ReactNode {
  const [draft, setDraft] = useState(initial)
  const [problem, setProblem] = useState<EditorProblem>()
  const [saving, setSaving] = useState(false)
  const edit = (field: keyof McpServerDraft) => (value: string): void => {
    setDraft(current => ({ ...current, [field]: value }))
    // Changing the field at fault withdraws what was said about it; the next save checks it again.
    setProblem(current => current?.field === field ? undefined : current)
  }
  const fieldId = (field: string): string => `plugin-config-mcp-${field}`
  const fieldProblem = (field: keyof McpServerDraft): string | undefined => problem?.field === field ? problem.text : undefined
  const submit = (): void => {
    setSaving(true)
    void save(draft, existing).then((result) => {
      setSaving(false)
      if (result === undefined) close()
      else setProblem(problemOf(result, t))
    })
  }
  return (
    <form id={id} className={css.editor} data-mcp-editor onSubmit={(event) => { event.preventDefault(); submit() }}>
      <Field id={fieldId('name')} label={t('fieldName')} hint={t('fieldNameHint')} problem={fieldProblem('name')} value={draft.name}
        disabled={existing} onChange={edit('name')} />
      <div className={css.field}>
        <label className={css.fieldLabel} htmlFor={fieldId('transport')}>{t('fieldTransport')}</label>
        <select
          id={fieldId('transport')}
          className={css.input}
          value={draft.transport}
          onChange={(event) => { setDraft(current => ({ ...current, transport: event.target.value === 'stdio' ? 'stdio' : 'streamable-http' })) }}
        >
          <option value="stdio">{t('transportStdio')}</option>
          <option value="streamable-http">{t('transportHttp')}</option>
        </select>
      </div>
      {draft.transport === 'stdio'
        ? (
          <>
            <Field id={fieldId('command')} label={t('fieldCommand')} problem={fieldProblem('command')} value={draft.command}
              onChange={edit('command')} />
            <Field id={fieldId('args')} label={t('fieldArgs')} hint={t('fieldArgsHint')} problem={undefined} value={draft.args} lines
              onChange={edit('args')} />
            <Field id={fieldId('env')} label={t('fieldEnv')} hint={t('fieldEnvHint')} problem={fieldProblem('env')} value={draft.env} lines
              onChange={edit('env')} />
            <Field id={fieldId('cwd')} label={t('fieldCwd')} problem={undefined} value={draft.cwd} onChange={edit('cwd')} />
          </>
        )
        : (
          <>
            <Field id={fieldId('url')} label={t('fieldUrl')} problem={fieldProblem('url')} value={draft.url} onChange={edit('url')} />
            <Field id={fieldId('headers')} label={t('fieldHeaders')} hint={t('fieldHeadersHint')} problem={fieldProblem('headers')}
              value={draft.headers} lines onChange={edit('headers')} />
          </>
        )}
      {problem === undefined || problem.field !== undefined ? null : <p className={css.problem} role="alert">{problem.text}</p>}
      <div className={css.actions}>
        <Button variant="primary" size="sm" type="submit" disabled={saving}>{saving ? t('saving') : t('save')}</Button>
        <Button variant="ghost" size="sm" disabled={saving} onClick={close}>{t('cancel')}</Button>
      </div>
    </form>
  )
}

/** One listed server: its origin and live status, its switch, and the operations its origin allows. */
function ServerRow({ row, writable, editing, locked, face, onEdit, onRemove, t }: {
  readonly row: McpServerRow
  readonly writable: boolean
  readonly editing: boolean
  /** Another editor is open, so this row's editor cannot open over its draft. */
  readonly locked: boolean
  readonly face: Omit<McpServersFace, 'hooks'>
  readonly onEdit: (name: string | undefined) => void
  readonly onRemove: (name: string) => void
  readonly t: Translate
}): ReactNode {
  const { name } = row
  const status = statusText(row.status, t)
  const probe = row.probe === undefined ? undefined : probeText(row.probe, t)
  const origin = row.origin === 'profile' ? t('originProfile') : row.origin === 'composition' ? t('originComposition') : t('originPlugin')
  const entry = row.entry
  const target = entry === undefined ? undefined
    : entry.transport === 'stdio' ? [entry.command ?? '', ...entry.args ?? []].join(' ') : entry.url
  const editorId = `plugin-config-mcp-editor-${name}`
  return (
    <li className={css.row} data-mcp-server={name}>
      <div className={css.rowHead}>
        <div className={css.title}>
          <span className={css.name}>{name}</span>
          <Tag tone="quiet">{origin}</Tag>
          <span className={css.state} data-tone={status.tone}>
            <StateDot state={TONE_DOT[status.tone]} />
            {status.label}
          </span>
        </div>
        {entry === undefined
          ? null
          : (
            <>
              <span className={css.busy}>{row.switching ? <StateDot state="ongoing" /> : null}</span>
              <Switch checked={row.enabled} label={t('enable', { name })} disabled={!writable || row.switching}
                onChange={(next) => { face.setEnabled(name, next) }} />
            </>
          )}
      </div>
      {target === undefined || target === '' ? null : <p className={css.target}>{target}</p>}
      {status.detail === undefined ? null : <p className={css.problem}>{status.detail}</p>}
      {probe === undefined ? null : <p className={probe.failed ? css.problem : css.hint} role="status">{probe.text}</p>}
      <div className={css.actions}>
        {entry === undefined
          ? null
          : (
            <Button variant="outline" size="sm" aria-label={t('testLabel', { name })} disabled={row.probe?.state === 'running'}
              onClick={() => { face.probe(name) }}>{t('test')}</Button>
          )}
        <Button variant="outline" size="sm" aria-label={t('restartLabel', { name })} disabled={!row.enabled}
          onClick={() => { face.restart(name) }}>{t('restart')}</Button>
        {entry === undefined
          ? null
          : (
            <Button variant="outline" size="sm" aria-label={t('editLabel', { name })} aria-expanded={editing}
              aria-controls={editing ? editorId : undefined} disabled={!writable || locked}
              onClick={() => { onEdit(editing ? undefined : name) }}>{t('edit')}</Button>
          )}
        {row.origin === 'profile'
          ? (
            <Button variant="outline" size="sm" className={css.danger} icon={<IconTrashOutlineRegular size={13} />}
              aria-label={t('removeLabel', { name })} disabled={!writable} onClick={() => { onRemove(name) }}>{t('remove')}</Button>
          )
          : null}
      </div>
      {editing && entry !== undefined
        ? <Editor id={editorId} initial={draftOf(name, entry)} existing save={face.save} close={() => { onEdit(undefined) }} t={t} />
        : null}
    </li>
  )
}

/** First-read placeholders in the shape of the server rows. */
function ListSkeleton({ label }: { readonly label: string }): ReactNode {
  return (
    <div role="status" aria-label={label} data-mcp-loading>
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

/** A write or an operation that did not go through, as a banner that fades on its own. */
function NoticeToast({ notice, onDone, t }: { readonly notice: McpNotice; readonly onDone: () => void; readonly t: Translate }): ReactNode {
  const text = notice.kind === 'refused' ? t('noticeRefused') : t('noticeFailed', { message: notice.message })
  return (
    <Toast key={text} text={text} icon={<IconWarningOutlineRegular size={18} />}
      {...notice.kind === 'failed' ? { holdMs: FAILURE_HOLD_MS } : {}} onDone={onDone} />
  )
}

/**
 * Render the MCP servers one-liner or the page, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the page snapshot, and its actions.
 * @returns the one-liner, or the page.
 */
export function McpServersCard(props: McpServersCardProps): ReactNode {
  return props.view === 'summary' ? props.t('description') : <McpServersPage {...props} />
}

function McpServersPage(props: McpServersCardProps): ReactNode {
  const { t, observe } = props
  const state = props.useMcpServers(snapshot => snapshot)
  /** The open editor: `''` adds a server, a name edits that server. */
  const [editing, setEditing] = useState<string>()
  /** The server whose removal waits on the confirmation. */
  const [removing, setRemoving] = useState<string>()
  // The live list is followed only while the page is on screen.
  useEffect(() => observe(), [observe])
  return (
    <section className={css.page} data-mcp-servers>
      {state.status === 'unavailable' ? <p className={css.hint}>{t('unavailable')}</p> : null}
      {state.status === 'ready' && !state.writable ? <p className={css.hint}>{t('readOnly')}</p> : null}
      {state.stale === null ? null : <p className={css.problem} role="alert">{t('listStale', { message: state.stale })}</p>}
      <div className={css.toolbar}>
        <Button variant="outline" size="sm" icon={<IconPlusOutlineRegular size={13} />} disabled={!state.writable || editing !== undefined}
          onClick={() => { setEditing('') }}>{t('add')}</Button>
      </div>
      {editing === ''
        ? <Editor id="plugin-config-mcp-editor" initial={EMPTY_DRAFT} existing={false} save={props.save} close={() => { setEditing(undefined) }} t={t} />
        : null}
      {state.status === 'loading' ? <ListSkeleton label={t('loading')} /> : null}
      {state.status === 'ready' && state.rows.length === 0 && editing !== '' ? <p className={css.hint}>{t('empty')}</p> : null}
      <ul className={css.list}>
        {state.rows.map(row => (
          <ServerRow key={row.name} row={row} writable={state.writable} editing={editing === row.name}
            locked={editing !== undefined && editing !== row.name} face={props} onEdit={setEditing} onRemove={setRemoving} t={t} />
        ))}
      </ul>
      {removing === undefined
        ? null
        : (
          <Modal
            open
            onClose={() => { setRemoving(undefined) }}
            title={t('removeConfirm', { name: removing })}
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
