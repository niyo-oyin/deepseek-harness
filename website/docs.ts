/**
 * Canonical publication manifest for the documentation website.
 *
 * Markdown stays in its owning repository tier. This manifest maps each
 * canonical source onto one site route instead of copying Markdown.
 */

/** Sidebar collection rendered for one top-level module. */
export type DocsSidebar = 'guide' | 'develop' | 'reference'

/** A page projected into the VitePress source tree. */
export interface DocsPage {
  /** Repository-relative canonical Markdown source. */
  source: string
  /** VitePress route, including the `.md` suffix. */
  route: string
  /** Navigation label shown in the sidebar. */
  label: string
  /** Sidebar collection that owns the page, or null for the site home page. */
  sidebar: DocsSidebar | null
  /** Section label within the sidebar. */
  section: string
  /** Stable order within the section. */
  order: number
  /** Heading levels included in this page's VitePress outline. */
  outline?: number | readonly [number, number] | 'deep' | false
  /** Additional repository paths that resolve to this page, such as the directory of an index page. */
  sourceAliases?: string[]
}

const homeAndGuide: DocsPage[] = [
  {
    source: 'docs/user/index.md',
    route: 'index.md',
    label: 'DeepSeek Harness',
    sidebar: null,
    section: 'Home',
    order: 0,
  },
  {
    source: 'docs/user/guide/index.md',
    route: 'guide/quickstart.md',
    label: 'Use the Web UI',
    sidebar: 'guide',
    section: 'Guide',
    order: 1,
    sourceAliases: ['docs/user/guide'],
  },
  ...([
    ['providers.md', 'Configure models', 'Guide', 2],
    ['network-proxy.md', 'Network proxy', 'Guide', 3],
    ['public-deployments.md', 'Public deployments', 'Guide', 4],
    ['desktop-uninstall-cleanup.md', 'Uninstall DSH Desktop', 'Guide', 5],
    ['python-sdk.md', 'Python', 'SDK', 1],
    ['github-review.md', 'GitHub review sessions', 'Automation', 1],
    ['schedule.md', 'Session reminders', 'Automation', 2],
    ['plugin-market.md', 'Plugin indexes', 'Integrations', 2],
    ['mcp-memory.md', 'Memory MCP', 'Integrations', 1],
  ] as const).map(([file, label, section, order]): DocsPage => ({
    source: `docs/user/guide/${file}`, route: `guide/${file}`, label, sidebar: 'guide', section, order,
  })),
]

/**
 * Pages of one documentation directory that share a sidebar section.
 *
 * @param sourceDirectory - Repository directory holding the sources.
 * @param routeDirectory - Site directory receiving the routes.
 * @param sidebar - Sidebar collection that owns the pages.
 * @param section - Section label shared by the pages.
 * @param files - `[file, label]` pairs in sidebar order; an `index.md` also answers to its directory.
 * @returns The pages, ordered from zero.
 */
function directoryPages(
  sourceDirectory: string,
  routeDirectory: string,
  sidebar: DocsSidebar,
  section: string,
  files: readonly (readonly [string, string])[],
): DocsPage[] {
  return files.map(([file, label], order) => ({
    source: `${sourceDirectory}/${file}`,
    route: `${routeDirectory}/${file}`,
    label,
    sidebar,
    section,
    order,
    ...(file === 'index.md' ? { sourceAliases: [sourceDirectory] } : {}),
  }))
}

const develop: DocsPage[] = [
  ...directoryPages('docs/user/develop/basic', 'develop/basic', 'develop', 'Basics', [
    ['index.md', 'Your first Harness plugin'],
    ['tool.md', 'Build a tool'],
    ['config.md', 'Plugin configuration'],
    ['publish.md', 'Package and install'],
  ]),
  ...directoryPages('docs/user/develop/framework', 'develop/framework', 'develop', 'Framework', [
    ['index.md', 'Plugin lifecycle'],
    ['service.md', 'Services and dependencies'],
    ['events.md', 'Event system'],
  ]),
  ...directoryPages('docs/user/develop/practice', 'develop/practice', 'develop', 'Practice', [
    ['index.md', 'Capability layering'],
    ['llm-adapter.md', 'LLM adapter'],
    ['dynamic-cordis.md', 'Persistent Harness plugins'],
  ]),
  ...directoryPages('docs/cordis-tutorial', 'develop/cordis-tutorial', 'develop', 'Cordis framework tutorial', [
    ['index.md', 'Overview'],
    ['01-first-plugin.md', '1. Your first plugin'],
    ['02-lifecycle-and-effects.md', '2. Lifecycle and effects'],
    ['03-services.md', '3. Services'],
    ['04-events.md', '4. Events'],
    ['05-config.md', '5. Configuration'],
    ['06-composition-and-hmr.md', '6. Composition and HMR'],
    ['07-into-the-harness.md', '7. Into the harness'],
  ]),
]

/**
 * Subsystem pages grouped by the concern they document, as `[section, pages]`.
 * One flat list of every subsystem pushed the rest of the reference sidebar
 * below the fold.
 */
const subsystemGroups = [
  ['Overview', [
    ['README.md', 'Subsystems'],
  ]],
  ['Core and scopes', [
    ['core.md', 'Core'],
    ['scope.md', 'Scopes'],
  ]],
  ['Sessions and persistence', [
    ['session.md', 'Sessions'],
    ['session-query.md', 'Session query'],
    ['session-reference.md', 'Session references'],
    ['session-title.md', 'Session titles'],
    ['session-projection.md', 'Session projections'],
    ['persistence.md', 'Session persistence'],
    ['spill.md', 'Spill storage'],
  ]],
  ['Model and context', [
    ['llm-streaming.md', 'LLM streaming'],
    ['token-meter.md', 'Token metering'],
    ['system-prompt.md', 'System prompts'],
    ['compaction.md', 'Compaction'],
  ]],
  ['Execution and tools', [
    ['tools.md', 'Tools'],
    ['shell.md', 'Bash execution'],
    ['subprocess.md', 'Subprocesses'],
    ['terminal.md', 'PTY sessions'],
    ['jobs.md', 'Background jobs'],
    ['filesystem.md', 'Filesystem'],
    ['lsp.md', 'LSP navigation'],
    ['ptc-runtime.md', 'PTC runtime'],
    ['web.md', 'Web access'],
    ['skills.md', 'Skills'],
    ['workflow.md', 'Workflows'],
    ['subagent.md', 'Subagents'],
  ]],
  ['Policy and interaction', [
    ['approval.md', 'Approvals'],
    ['permission-presets.md', 'Permission presets'],
    ['sandbox.md', 'Sandboxing'],
    ['plan.md', 'Plan mode'],
    ['user-questions.md', 'User interaction'],
    ['commands.md', 'Human commands'],
    ['goal.md', 'Goals'],
    ['schedule.md', 'Scheduled reminders'],
  ]],
  ['Platform and access', [
    ['web-server.md', 'HTTP server'],
    ['web-client.md', 'Web Client architecture'],
    ['client-modules.md', 'Client modules'],
    ['slots.md', 'Client slots'],
    ['client-resources.md', 'Client resources'],
    ['sidebar-right.md', 'Right Sidebar'],
    ['conversation.md', 'Conversation assembly'],
    ['typert.md', 'Typert'],
    ['storage.md', 'Storage'],
    ['workspace.md', 'Workspaces'],
    ['settings.md', 'User settings'],
    ['credentials.md', 'User credentials'],
  ]],
] as const

const subsystemsReference: DocsPage[] = subsystemGroups.flatMap(([section, files]) => files.map(([file, label], order) => ({
  source: `docs/subsystems/${file}`,
  route: file === 'README.md' ? 'reference/subsystems/index.md' : `reference/subsystems/${file}`,
  label,
  sidebar: 'reference' as const,
  section,
  order,
  // Subsystem pages carry long third-level sections a two-level outline reaches.
  outline: [2, 3] as const,
  ...(file === 'README.md' ? { sourceAliases: ['docs/subsystems'] } : {}),
})))

const reference: DocsPage[] = [
  // `docs/deepseek-llm-api-wire-extensions.md` is a repository-only provider protocol reference.
  // Projected links intentionally resolve to its GitHub source instead of a public site route.
  ...([
    ['docs/architecture.md', 'reference/index.md', 'Architecture', 0],
    ['docs/cordis-primer.md', 'reference/cordis-primer.md', 'Cordis primer', 1],
    ['docs/capability-seams.md', 'reference/capability-seams.md', 'Capability services', 2],
    ['docs/agent-lifecycle.md', 'reference/agent-lifecycle.md', 'Agent lifecycle', 3],
    ['docs/tool-execution-pipeline.md', 'reference/tool-execution-pipeline.md', 'Tool execution', 4],
    ['docs/api-gateway.md', 'reference/api-gateway.md', 'API Gateway', 5],
  ] as const).map(([source, route, label, order]): DocsPage => ({
    source, route, label, sidebar: 'reference', section: 'Concepts', order,
  })),
  ...([
    ['docs/config-catalog.md', 'reference/config-catalog.md', 'Plugin configuration'],
    ['docs/tool-catalog.md', 'reference/tool-catalog.md', 'Tool schemas'],
    ['docs/persistence-catalog.md', 'reference/persistence-catalog.md', 'Persistence events', 'deep'],
    ['docs/experimental-persistence-catalog.md', 'reference/experimental-persistence-catalog.md', 'Experimental persistence'],
  ] as const).map(([source, route, label, outline], order): DocsPage => ({
    source,
    route,
    label,
    sidebar: 'reference',
    section: 'Generated reference',
    order,
    ...(outline === undefined ? {} : { outline }),
  })),
  ...directoryPages('docs/cordis-api', 'reference/cordis-api', 'reference', 'Cordis Core API', [
    ['context.md', 'Context'],
    ['events.md', 'Events'],
    ['fiber.md', 'Fiber'],
    ['registry.md', 'Plugin Registry'],
    ['service.md', 'Service'],
    ['inherited.md', 'Inherited surface'],
  ]),
  ...directoryPages('docs/cookbook', 'reference/cookbook', 'reference', 'Cookbook', [
    ['adding-a-package.md', 'Adding a package'],
    ['adding-a-tool.md', 'Adding a tool'],
    ['adding-an-llm-adapter.md', 'Adding an LLM adapter'],
    ['adding-a-settings-card.md', 'Adding a settings page'],
    ['extension-cookbook.md', 'Extension patterns'],
  ]),
]

/** One top-level documentation module. */
export interface DocsCollection {
  /** Sidebar collection holding the module's pages. */
  sidebar: DocsSidebar
  /** Module label shown in the navigation bar, the guide sidebar, and llms.txt. */
  label: string
}

/**
 * Documentation modules in the order the site's navigation presents them. The
 * navigation bar and the llms.txt index both read this sequence, so a new
 * collection lands in both surfaces together.
 */
export const collections: readonly DocsCollection[] = [
  { sidebar: 'guide', label: 'Guide' },
  { sidebar: 'develop', label: 'Development' },
  { sidebar: 'reference', label: 'Reference' },
]

/** A sidebar group, matched to pages by `label`. */
export interface DocsSection {
  /** Group heading, equal to the `section` field of every page it holds. */
  label: string
  /** Render the group collapsed until it holds the page being read. */
  collapsed?: boolean
}

/**
 * Every sidebar group, in the order the site renders it.
 *
 * The subsystem groups collapse because together they outnumber the rest of the
 * reference sidebar; expanded, they push every other group below the fold.
 */
const sections: readonly DocsSection[] = [
  { label: 'Guide' }, { label: 'SDK' }, { label: 'Automation' }, { label: 'Integrations' },
  { label: 'Basics' }, { label: 'Framework' }, { label: 'Practice' }, { label: 'Cordis framework tutorial' },
  { label: 'Concepts' }, { label: 'Generated reference' }, { label: 'Cordis Core API' }, { label: 'Cookbook' },
  { label: 'Overview' },
  { label: 'Core and scopes', collapsed: true },
  { label: 'Sessions and persistence', collapsed: true },
  { label: 'Model and context', collapsed: true },
  { label: 'Execution and tools', collapsed: true },
  { label: 'Policy and interaction', collapsed: true },
  { label: 'Platform and access', collapsed: true },
]

/**
 * Placement and collapse behavior of one sidebar group.
 *
 * @param label - Section label carried by the pages in the group.
 * @returns The declared group, plus its zero-based position in the sidebar order.
 * @throws When no placement is declared for the label. Ranking by list
 *   membership alone would sort an undeclared group silently ahead of every
 *   declared one.
 */
export function sectionSpec(label: string): DocsSection & { index: number } {
  const section = sections.find(candidate => candidate.label === label)
  if (section === undefined) throw new Error(`Sidebar section "${label}" has no placement.`)
  return { ...section, index: sections.indexOf(section) }
}

/** Every canonical page published by the documentation website. */
export const docsPages: DocsPage[] = [
  ...homeAndGuide,
  ...develop,
  ...subsystemsReference,
  ...reference,
]

/**
 * Pages of one sidebar collection, in the order the sidebar lists them.
 *
 * @param collection - Sidebar collection to read.
 * @returns The collection's pages, ordered by section placement then by `order`.
 */
export function orderedPages(collection: DocsSidebar): DocsPage[] {
  return docsPages
    .filter(page => page.sidebar === collection)
    .sort((left, right) => (
      sectionSpec(left.section).index - sectionSpec(right.section).index
      || left.order - right.order
    ))
}

/**
 * Site-relative link for a published route.
 *
 * @param route - Manifest route, including its `.md` suffix.
 * @returns The link VitePress serves the route at.
 */
export function routeLink(route: string): string {
  return `/${route.replace(/(?:index)?\.md$/, '')}`
}

/**
 * Where a top-level navigation item lands.
 *
 * The target is derived rather than written down: a collection whose first page
 * is renamed or reordered would otherwise leave the navigation bar pointing at
 * a route the manifest no longer publishes.
 *
 * @param collection - Sidebar collection the item opens.
 * @returns Site-relative link of the collection's first page.
 * @throws When the collection publishes no page.
 */
export function landingLink(collection: DocsSidebar): string {
  const first = orderedPages(collection)[0]
  if (first === undefined) throw new Error(`Sidebar collection "${collection}" publishes no page.`)
  return routeLink(first.route)
}
