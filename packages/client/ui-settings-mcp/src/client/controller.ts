/**
 * The MCP servers page's model: the manager's configured entries from its settings namespace, joined
 * with the live server list the manager streams, and the writes and operations the page offers.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote, McpManagedServerStatus, McpManagedServerView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { fieldsOf, type DraftProblem, type McpServerDraft, type McpServerEntry, type McpSettings } from './mcp-entry.ts'

/** Profile entry id of the MCP manager, which is also its settings namespace. */
export const MCP_NS = 'mcp-manager'

/** What one connection test found. */
type ProbeResult = Extract<Awaited<ReturnType<ClientRemote['mcpManager']['probe']>>, { ok: true }>['value']

/** The live operations of the MCP manager this page calls, bound to the Remote by the plugin. */
export interface McpManagerFace {
  /**
   * Follow the manager's server list.
   * @param onList - receives the complete list at subscription and after every change.
   * @returns the disposer ending the subscription.
   */
  watch(onList: (servers: readonly McpManagedServerView[]) => void): () => void
  /**
   * Test one configured server without touching its live instance.
   * @param name - the server to test.
   * @returns what the test found, or the reason it could not run.
   */
  probe(name: string): Promise<ProbeResult | { failed: string }>
  /**
   * Replace one server's live instance.
   * @param name - the server to restart.
   * @returns nothing on success, or the reason it could not restart.
   */
  restart(name: string): Promise<{ failed: string } | undefined>
}

/** The latest connection test of one server. */
export type McpProbeState =
  | { readonly state: 'running' }
  | { readonly state: 'ok'; readonly toolNames: readonly string[]; readonly truncated: boolean; readonly durationMs: number }
  | { readonly state: 'failed'; readonly message: string }

/** One server as the page lists it. */
export interface McpServerRow {
  readonly name: string
  /**
   * Where the entry lives: `profile` entries are stored in this profile and can be edited and removed,
   * `composition` entries ship with the deployment and can be overridden, and `plugin` entries are
   * registered by an installed plugin for its own lifetime and are read-only here.
   */
  readonly origin: 'profile' | 'composition' | 'plugin'
  /** The resolved entry; absent for a plugin's server. */
  readonly entry: McpServerEntry | undefined
  /** Whether the entry asks for a running instance; a plugin's server always does. */
  readonly enabled: boolean
  /** Live status from the manager; absent until its first list arrives. */
  readonly status: McpManagedServerStatus | undefined
  readonly probe: McpProbeState | undefined
}

/** A write or an operation that did not go through. */
export type McpNotice =
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed'; readonly message: string }

/** What the MCP servers page renders. */
export interface McpPageState {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly writable: boolean
  readonly rows: readonly McpServerRow[]
  readonly notice: McpNotice | null
}

/** The registration-side face the page's slot entry injects. */
export interface McpServersFace {
  hooks: {
    /** Page snapshot bound by the renderer as useMcpServers. */
    mcpServers: SnapshotStore<McpPageState>
  }
  /** Follow the live server list while the page is shown; returns the disposer. */
  observe: () => () => void
  setEnabled: (name: string, enabled: boolean) => void
  remove: (name: string) => void
  /**
   * Write a new server, or the edited fields of the existing server named by the draft.
   * @param draft - the editor's fields.
   * @param existing - whether the draft edits a server that is already listed.
   * @returns the draft's problem, `refused` when the Host did not accept the entry, or nothing once written.
   */
  save: (draft: McpServerDraft, existing: boolean) => Promise<DraftProblem | { kind: 'refused' } | undefined>
  probe: (name: string) => void
  restart: (name: string) => void
  dismissNotice: () => void
}

/** Joins the manager's settings entries with its live list and carries the page's writes. */
export class McpServersController {
  private readonly store: SnapshotStore<McpPageState>
  private readonly unsubscribe: () => void
  private live: readonly McpManagedServerView[] | undefined
  private readonly probes = new Map<string, McpProbeState>()
  private notice: McpNotice | null = null
  private observers = 0
  private unwatch: (() => void) | undefined

  /**
   * @param form - the shared configuration form of the MCP manager's entry.
   * @param manager - the manager's live operations.
   */
  constructor(private readonly form: ConfigForm<McpSettings>, private readonly manager: McpManagerFace) {
    this.store = createSnapshotStore<McpPageState>(this.projection(), { flush: 'sync' })
    this.unsubscribe = form.subscribe(() => { this.publish() })
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  private projection(): McpPageState {
    const snapshot = this.form.getSnapshot()
    const servers = snapshot.value?.servers ?? {}
    const stored = (snapshot.user as McpSettings | undefined)?.servers ?? {}
    const statusOf = (name: string): McpManagedServerStatus | undefined => this.live?.find(server => server.name === name)?.status
    const rows: McpServerRow[] = Object.entries(servers).map(([name, entry]) => ({
      name,
      origin: name in stored ? 'profile' : 'composition',
      entry,
      enabled: entry.enabled !== false,
      status: statusOf(name),
      probe: this.probes.get(name),
    }))
    for (const server of this.live ?? []) {
      // A server the manager lists without a settings entry was registered by a plugin; one that is no
      // longer configured or registered remains listed only while its cleanup failure stands.
      if (server.name in servers || !server.configured) continue
      rows.push({ name: server.name, origin: 'plugin', entry: undefined, enabled: true, status: server.status, probe: this.probes.get(server.name) })
    }
    return { status: snapshot.status, writable: snapshot.writable, rows, notice: this.notice }
  }

  /** Apply ordered writes to the `servers` map and report a refusal or a carrier failure as the page notice. */
  private async write(ops: Parameters<ConfigForm<McpSettings>['mutate']>[0]): Promise<boolean> {
    let accepted: boolean
    try {
      accepted = await this.form.mutate(ops)
      this.notice = accepted ? null : { kind: 'refused' }
    } catch (error) {
      accepted = false
      this.notice = { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
    this.publish()
    return accepted
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its actions.
   */
  inject(): McpServersFace {
    return {
      hooks: { mcpServers: this.store },
      observe: () => {
        if (this.observers++ === 0) {
          this.unwatch = this.manager.watch((servers) => {
            this.live = servers
            this.publish()
          })
        }
        return () => {
          if (--this.observers > 0) return
          this.unwatch?.()
          this.unwatch = undefined
        }
      },
      setEnabled: (name, enabled) => { void this.write([{ op: 'set', path: ['servers', name, 'enabled'], value: enabled }]) },
      remove: (name) => {
        this.probes.delete(name)
        void this.write([{ op: 'unset', path: ['servers', name] }])
      },
      save: async (draft, existing) => {
        // A new server must not take a name already listed, whether configured or registered by a plugin.
        const taken = existing ? new Set<string>() : new Set([
          ...Object.keys(this.form.getSnapshot().value?.servers ?? {}), ...(this.live ?? []).map(server => server.name),
        ])
        const result = fieldsOf(draft, taken)
        if ('problem' in result) return result.problem
        // One write carries every edited field; the entry's other fields stay as stored.
        const accepted = await this.write(Object.entries(result.fields).map(([field, value]) => ({
          op: 'set' as const, path: ['servers', result.name, field], value,
        })))
        return accepted ? undefined : { kind: 'refused' }
      },
      probe: (name) => {
        this.probes.set(name, { state: 'running' })
        this.publish()
        void this.manager.probe(name).then((result) => {
          this.probes.set(name, 'failed' in result
            ? { state: 'failed', message: result.failed }
            : result.ok
              ? { state: 'ok', toolNames: result.toolNames, truncated: result.truncated, durationMs: result.durationMs }
              : { state: 'failed', message: result.message })
          this.publish()
        })
      },
      restart: (name) => {
        void this.manager.restart(name).then((result) => {
          if (result === undefined) return
          this.notice = { kind: 'failed', message: result.failed }
          this.publish()
        })
      },
      dismissNotice: () => {
        this.notice = null
        this.publish()
      },
    }
  }

  /** Release the form subscription and the live list. */
  dispose(): void {
    this.unsubscribe()
    this.unwatch?.()
    this.unwatch = undefined
  }
}
