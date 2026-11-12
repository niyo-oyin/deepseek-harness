/** The MCP servers page: the manager's servers with their live status, and the editor that adds or changes one. */

import { useEffect, useState, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { McpManagedServerStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpProbeState, McpServerRow, McpServersFace } from './controller.ts'
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

/** The status line of one server and the diagnostic beside it, if the manager reported one. */
function statusText(status: McpManagedServerStatus | undefined, t: Translate): { label: string; detail?: string; tone: 'ok' | 'busy' | 'bad' | 'off' } {
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
    default: return { label: t('statusUnknown'), tone: 'off' }
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

function problemText(problem: DraftProblem | { kind: 'refused' }, t: Translate): string {
  switch (problem.kind) {
    case 'name': return t('problemName')
    case 'nameTaken': return t('problemNameTaken')
    case 'command': return t('problemCommand')
    case 'url': return t('problemUrl')
    case 'env': return t('problemEnv', { line: problem.line })
    case 'headers': return t('problemHeaders', { line: problem.line })
    default: return t('refused')
  }
}

/** One labelled editor field; `lines` makes it a multi-line box for one item per line. */
function Field({ id, label, hint, value, lines, disabled, onChange }: {
  readonly id: string
  readonly label: string
  readonly hint?: string
  readonly value: string
  readonly lines?: boolean
  readonly disabled?: boolean
  readonly onChange: (value: string) => void
}): ReactNode {
  return (
    <div className={css.editorField}>
      <label className={css.fieldLabel} htmlFor={id}>{label}</label>
      {lines === true
        ? (
          <textarea id={id} className={css.textarea} rows={3} spellCheck={false} value={value} disabled={disabled}
            onChange={(event) => { onChange(event.target.value) }} />
        )
        : (
          <input id={id} className={css.input} type="text" spellCheck={false} value={value} disabled={disabled}
            onChange={(event) => { onChange(event.target.value) }} />
        )}
      {hint === undefined ? null : <p className={css.hint}>{hint}</p>}
    </div>
  )
}

/** The form that adds a server or changes one; the name of an existing server is fixed, because it namespaces the server's tools. */
function Editor({ initial, existing, save, close, t }: {
  readonly initial: McpServerDraft
  readonly existing: boolean
  readonly save: McpServersFace['save']
  readonly close: () => void
  readonly t: Translate
}): ReactNode {
  const [draft, setDraft] = useState(initial)
  const [problem, setProblem] = useState<string>()
  const [saving, setSaving] = useState(false)
  const edit = (field: keyof McpServerDraft) => (value: string): void => { setDraft(current => ({ ...current, [field]: value })) }
  const id = (field: string): string => `plugin-config-mcp-${field}`
  const submit = (): void => {
    setSaving(true)
    void save(draft, existing).then((result) => {
      setSaving(false)
      if (result === undefined) close()
      else setProblem(problemText(result, t))
    })
  }
  return (
    <form className={css.editor} data-mcp-editor onSubmit={(event) => { event.preventDefault(); submit() }}>
      <Field id={id('name')} label={t('fieldName')} hint={t('fieldNameHint')} value={draft.name} disabled={existing} onChange={edit('name')} />
      <div className={css.editorField}>
        <label className={css.fieldLabel} htmlFor={id('transport')}>{t('fieldTransport')}</label>
        <select
          id={id('transport')}
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
            <Field id={id('command')} label={t('fieldCommand')} value={draft.command} onChange={edit('command')} />
            <Field id={id('args')} label={t('fieldArgs')} hint={t('fieldArgsHint')} value={draft.args} lines onChange={edit('args')} />
            <Field id={id('env')} label={t('fieldEnv')} hint={t('fieldEnvHint')} value={draft.env} lines onChange={edit('env')} />
            <Field id={id('cwd')} label={t('fieldCwd')} value={draft.cwd} onChange={edit('cwd')} />
          </>
        )
        : (
          <>
            <Field id={id('url')} label={t('fieldUrl')} value={draft.url} onChange={edit('url')} />
            <Field id={id('headers')} label={t('fieldHeaders')} hint={t('fieldHeadersHint')} value={draft.headers} lines onChange={edit('headers')} />
          </>
        )}
      {problem === undefined ? null : <p className={css.problem} role="alert">{problem}</p>}
      <div className={css.editorActions}>
        <Button variant="primary" size="sm" type="submit" disabled={saving}>{saving ? t('saving') : t('save')}</Button>
        <Button variant="ghost" size="sm" disabled={saving} onClick={close}>{t('cancel')}</Button>
      </div>
    </form>
  )
}

/** One listed server: its origin and live status, its switch, and the operations its origin allows. */
function ServerRow({ row, writable, editing, face, onEdit, t }: {
  readonly row: McpServerRow
  readonly writable: boolean
  readonly editing: boolean
  readonly face: Omit<McpServersFace, 'hooks'>
  readonly onEdit: (name: string | undefined) => void
  readonly t: Translate
}): ReactNode {
  const [confirming, setConfirming] = useState(false)
  const status = statusText(row.status, t)
  const probe = row.probe === undefined ? undefined : probeText(row.probe, t)
  const origin = row.origin === 'profile' ? t('originProfile') : row.origin === 'composition' ? t('originComposition') : t('originPlugin')
  const entry = row.entry
  const target = entry === undefined ? undefined
    : entry.transport === 'stdio' ? [entry.command ?? '', ...entry.args ?? []].join(' ') : entry.url
  return (
    <li className={css.row} data-mcp-server={row.name}>
      <div className={css.rowHead}>
        <span className={css.name}>{row.name}</span>
        <Tag tone="quiet">{origin}</Tag>
        <span className={css.status} data-tone={status.tone}>{status.label}</span>
        {entry === undefined
          ? null
          : <Switch checked={row.enabled} label={t('enable', { name: row.name })} disabled={!writable} onChange={(next) => { face.setEnabled(row.name, next) }} />}
      </div>
      {target === undefined || target === '' ? null : <p className={css.target}>{target}</p>}
      {status.detail === undefined ? null : <p className={css.problem}>{status.detail}</p>}
      {probe === undefined ? null : <p className={probe.failed ? css.problem : css.hint} role="status">{probe.text}</p>}
      <div className={css.rowActions}>
        {entry === undefined
          ? null
          : <Button variant="outline" size="sm" disabled={row.probe?.state === 'running'} onClick={() => { face.probe(row.name) }}>{t('test')}</Button>}
        <Button variant="outline" size="sm" disabled={!row.enabled} onClick={() => { face.restart(row.name) }}>{t('restart')}</Button>
        {entry === undefined
          ? null
          : <Button variant="outline" size="sm" disabled={!writable} onClick={() => { onEdit(editing ? undefined : row.name) }}>{t('edit')}</Button>}
        {row.origin !== 'profile'
          ? null
          : confirming
            ? (
              <>
                <span className={css.confirm}>{t('removeConfirm', { name: row.name })}</span>
                <Button variant="outline" size="sm" onClick={() => { setConfirming(false); face.remove(row.name) }}>{t('remove')}</Button>
                <Button variant="ghost" size="sm" onClick={() => { setConfirming(false) }}>{t('cancel')}</Button>
              </>
            )
            : <Button variant="ghost" size="sm" disabled={!writable} onClick={() => { setConfirming(true) }}>{t('remove')}</Button>}
      </div>
      {editing && entry !== undefined
        ? <Editor initial={draftOf(row.name, entry)} existing save={face.save} close={() => { onEdit(undefined) }} t={t} />
        : null}
    </li>
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
  // The live list is followed only while the page is on screen.
  useEffect(() => observe(), [observe])
  return (
    <section className={css.page} data-mcp-servers>
      {state.status === 'unavailable' ? <p className={css.hint}>{t('unavailable')}</p> : null}
      {state.status === 'ready' && !state.writable ? <p className={css.hint}>{t('readOnly')}</p> : null}
      {state.notice === null
        ? null
        : (
          <p className={css.notice} role="alert">
            <span>{state.notice.kind === 'refused' ? t('noticeRefused') : t('noticeFailed', { message: state.notice.message })}</span>
            <Button variant="ghost" size="sm" onClick={props.dismissNotice}>{t('dismiss')}</Button>
          </p>
        )}
      <div className={css.toolbar}>
        <Button variant="outline" size="sm" disabled={!state.writable || editing === ''} onClick={() => { setEditing('') }}>{t('add')}</Button>
      </div>
      {editing === ''
        ? <Editor initial={EMPTY_DRAFT} existing={false} save={props.save} close={() => { setEditing(undefined) }} t={t} />
        : null}
      {state.status === 'ready' && state.rows.length === 0 && editing !== '' ? <p className={css.hint}>{t('empty')}</p> : null}
      <ul className={css.list}>
        {state.rows.map(row => (
          <ServerRow key={row.name} row={row} writable={state.writable} editing={editing === row.name}
            face={props} onEdit={setEditing} t={t} />
        ))}
      </ul>
    </section>
  )
}
