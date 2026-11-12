/**
 * One MCP server entry as the page edits it: the stored entry of the manager's `servers` map on one
 * side, and the text the editor's fields hold on the other. The Host validates every write, so the
 * checks here only catch what the editor can explain better than a refused write: a name the Host
 * would reject, a missing command or URL, and a line that is not a pair.
 */

/** The fields of a server entry this page edits. */
export interface McpServerFields {
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  url: string
  headers: Record<string, string>
}

/**
 * One entry of the MCP manager's `servers` map as this page reads it. The entry's other fields
 * (timeouts, reconnect policy) are neither read nor written here: an edit writes the fields above one
 * by one and leaves the rest as stored.
 */
export interface McpServerEntry extends Partial<McpServerFields> {
  transport: McpServerFields['transport']
  enabled?: boolean
}

/** The MCP manager's configuration section. */
export interface McpSettings {
  servers?: Record<string, McpServerEntry>
}

/** The editor's fields as typed: lists and maps are one item per line. */
export interface McpServerDraft {
  name: string
  transport: McpServerEntry['transport']
  command: string
  /** One argument per line. */
  args: string
  /** One `NAME=value` per line. */
  env: string
  cwd: string
  url: string
  /** One `Name: value` per line. */
  headers: string
}

/** Why a draft cannot be written, with the offending line where one line is at fault. */
export type DraftProblem =
  | { kind: 'name' | 'nameTaken' | 'command' | 'url' }
  | { kind: 'env' | 'headers'; line: string }

/** The names the Host accepts for a server; it also namespaces the server's tools. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/u

/** A draft for a server that does not exist yet. */
export const EMPTY_DRAFT: McpServerDraft = {
  name: '', transport: 'stdio', command: '', args: '', env: '', cwd: '', url: '', headers: '',
}

/**
 * The editor fields of an existing entry.
 * @param name - the entry's key in the `servers` map.
 * @param entry - the resolved entry.
 * @returns the draft the editor starts from.
 */
export function draftOf(name: string, entry: McpServerEntry): McpServerDraft {
  return {
    name,
    transport: entry.transport,
    command: entry.command ?? '',
    args: (entry.args ?? []).join('\n'),
    env: Object.entries(entry.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
    cwd: entry.cwd ?? '',
    url: entry.url ?? '',
    headers: Object.entries(entry.headers ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n'),
  }
}

/** Split `text` into pairs at the first `separator` of each non-blank line; a line without a name or a separator is reported instead. */
function pairs(text: string, separator: string): { values: Record<string, string> } | { badLine: string } {
  const values: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '') continue
    const at = line.indexOf(separator)
    const name = at < 0 ? '' : line.slice(0, at).trim()
    if (name === '') return { badLine: line }
    values[name] = line.slice(at + separator.length).trim()
  }
  return { values }
}

/**
 * The fields a draft stands for. Every one is returned, including the empty ones of the other
 * transport: an omitted field would keep a value the composition layer supplies, and the Host refuses
 * an entry that carries the other transport's fields.
 * @param draft - the editor's fields.
 * @param taken - names of the other servers.
 * @returns the server's name and fields, or why the draft cannot be written.
 */
export function fieldsOf(
  draft: McpServerDraft, taken: ReadonlySet<string>,
): { name: string; fields: McpServerFields } | { problem: DraftProblem } {
  const name = draft.name.trim()
  if (!SERVER_NAME.test(name)) return { problem: { kind: 'name' } }
  if (taken.has(name)) return { problem: { kind: 'nameTaken' } }
  const stdio = draft.transport === 'stdio'
  const command = draft.command.trim()
  const url = draft.url.trim()
  if (stdio && command === '') return { problem: { kind: 'command' } }
  if (!stdio && url === '') return { problem: { kind: 'url' } }
  // Only the fields of the chosen transport are read: the other transport's text is not written.
  const env = stdio ? pairs(draft.env, '=') : { values: {} }
  if ('badLine' in env) return { problem: { kind: 'env', line: env.badLine } }
  const headers = stdio ? { values: {} } : pairs(draft.headers, ':')
  if ('badLine' in headers) return { problem: { kind: 'headers', line: headers.badLine } }
  return {
    name,
    fields: {
      transport: draft.transport,
      command: stdio ? command : '',
      args: stdio ? draft.args.split(/\r?\n/u).map(line => line.trim()).filter(line => line !== '') : [],
      env: env.values,
      cwd: stdio ? draft.cwd.trim() : '',
      url: stdio ? '' : url,
      headers: headers.values,
    },
  }
}
