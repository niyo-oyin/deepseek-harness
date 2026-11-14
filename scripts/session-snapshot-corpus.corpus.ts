/** Repository-wide ownership and storage invariants for the recorded-session corpus. */

import { existsSync } from 'node:fs'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'
import {
  assertSessionFixtureVersion,
  captureExpectedWorkspaceSnapshot,
  EMPTY_WORKSPACE_MARKER,
  parseSnapshotManifest,
  parseSessionFixtureName,
  redactSessionSnapshotIds,
  scrubSystemPrompts,
  scrubToolSchemas,
  sessionFixtureFiles,
  sessionFixtureNames,
  resolveScenarioFile,
  scenarioFileNames,
  scenarioLayoutProblems,
  SNAPSHOT_PLATFORMS,
  type SnapshotManifest,
} from '@deepseek-ai/dsh-session-snapshot'
import { assertSnapshotCorpusPolicy } from './session-snapshot-corpus-policy.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const corpusRoot = join(repoRoot, 'snapshots')
const profiles = ['acp', 'sdk', 'session', 'web'] as const
const snapshotAdapters = [
  'apps/web/tests/code-language.snapshot.ts',
  'apps/web/tests/message-feedback-protocol.snapshot.ts',
  'apps/web/tests/minimal-preset.snapshot.ts',
  'apps/web/tests/preset-migration.snapshot.ts',
  'apps/web/tests/subagent-fork-schedule.snapshot.ts',
  'snapshots/acp/acp.snapshot.ts',
  'snapshots/sdk/sdk.snapshot.ts',
  'snapshots/session/headless.snapshot.ts',
] as const

interface Scenario {
  readonly key: string
  readonly profile: string
  readonly name: string
  readonly dir: string
  readonly manifest: SnapshotManifest & {
    composition: string
    recording: 'live' | 'authored'
    header: NonNullable<SnapshotManifest['header']>
  }
}

async function scenarios(): Promise<Scenario[]> {
  const result: Scenario[] = []
  for (const profile of profiles) {
    const root = join(corpusRoot, profile)
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      const path = join(dir, 'snapshot.yml')
      expect(existsSync(path), `${profile}/${entry.name}/snapshot.yml`).toBe(true)
      const manifest = parseSnapshotManifest(await readFile(path, 'utf8'), path)
      expect(manifest.scenario, `${profile}/${entry.name}: scenario`).toBe(entry.name)
      if (profile === 'sdk') {
        expect(['sdk', 'sdk-minimal'], `${profile}/${entry.name}: profile`).toContain(manifest.profile)
      } else {
        expect(manifest.profile, `${profile}/${entry.name}: profile`).toBe(profile === 'session' ? 'headless' : profile)
      }
      expect(manifest.composition, `${profile}/${entry.name}: composition`).toBeTypeOf('string')
      expect(manifest.recording, `${profile}/${entry.name}: recording`).toMatch(/^(live|authored)$/)
      expect(manifest.header, `${profile}/${entry.name}: header`).toBeDefined()
      result.push({
        key: `${profile}/${entry.name}`,
        profile,
        name: entry.name,
        dir,
        manifest: {
          ...manifest,
          composition: manifest.composition as string,
          recording: manifest.recording as 'live' | 'authored',
          header: manifest.header as NonNullable<SnapshotManifest['header']>,
        },
      })
    }
  }
  return result
}

function referencedScenario(owner: Scenario, source: string): string {
  return source.includes('/') ? source : `${owner.profile}/${source}`
}

async function snapshotNamedTests(): Promise<string[]> {
  const files: string[] = []
  const visit = async (directory: string, relativeDir: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['dist', 'lib', 'node_modules'].includes(entry.name)) continue
        await visit(join(directory, entry.name), join(relativeDir, entry.name))
      } else if (entry.isFile() && /\.snapshot\.tsx?$/u.test(entry.name)) {
        files.push(join(relativeDir, entry.name).split(/[/\\]/u).join('/'))
      }
    }
  }
  for (const root of ['apps', 'native', 'packages', 'python', 'scripts', 'snapshots', 'website']) {
    await visit(join(repoRoot, root), root)
  }
  return files.sort()
}

it('reserves the snapshot test suffix for recorded-session adapters', async () => {
  expect(await snapshotNamedTests()).toEqual([...snapshotAdapters])
})

it('keeps every scenario directory in the per-platform layout', async () => {
  for (const { key, dir } of await scenarios()) expect(scenarioLayoutProblems(dir), `${key}: per-platform layout`).toEqual([])
})

it('owns every borrowed header expectation by a scenario that runs wherever its borrowers run', async () => {
  const all = await scenarios()
  const byKey = new Map(all.map(scenario => [scenario.key, scenario]))
  const pinByClass = new Map(all.filter(scenario => scenario.manifest.header.pin === true)
    .map(scenario => [`${scenario.manifest.composition}/${scenario.manifest.header.class}`, scenario]))
  // An owner that skips a platform its borrowers run on could never produce their expectation there.
  const covers = (owner: Scenario, borrower: Scenario): boolean => {
    const ownerPlatforms = owner.manifest.platforms ?? SNAPSHOT_PLATFORMS
    return (borrower.manifest.platforms ?? SNAPSHOT_PLATFORMS).every(platform => ownerPlatforms.includes(platform))
  }
  for (const scenario of all) {
    const pin = pinByClass.get(`${scenario.manifest.composition}/${scenario.manifest.header.class}`)
    if (pin === undefined) continue
    const owners = [
      ['header pin', pin],
      ['system-prompt owner', byKey.get(referencedScenario(pin, pin.manifest.header.systemPromptSource ?? pin.name))],
      ['tool-schema owner', byKey.get(referencedScenario(pin, pin.manifest.header.toolSchemasSource ?? pin.name))],
    ] as const
    for (const [role, owner] of owners) {
      if (owner === undefined) continue
      expect(covers(owner, scenario), `${scenario.key}: ${role} ${owner.key} must run on every platform ${scenario.key} runs on`).toBe(true)
    }
  }
})

it.each(SNAPSHOT_PLATFORMS)('keeps every recorded session owned, pinned, redacted, and header-scrubbed on %s', async (platform) => {
  const has = (dir: string, name: string): boolean => existsSync(resolveScenarioFile(dir, name, platform))
  const all = await scenarios()
  const byKey = new Map(all.map(scenario => [scenario.key, scenario]))
  const pinByClass = new Map<string, Scenario>()

  for (const scenario of all) {
    if (scenario.manifest.header.pin !== true) continue
    const key = `${scenario.manifest.composition}/${scenario.manifest.header.class}`
    expect(pinByClass.has(key), `${key}: duplicate header pin`).toBe(false)
    pinByClass.set(key, scenario)
  }

  for (const scenario of all) {
    const { manifest, dir, key } = scenario
    const classKey = `${manifest.composition}/${manifest.header.class}`
    expect(pinByClass.has(classKey), `${key}: missing composition/header pin ${classKey}`).toBe(true)

    const localEntries = scenarioFileNames(dir, platform)
    const localSessionNames = localEntries.filter(name => parseSessionFixtureName(name) !== undefined)
    if (manifest.session === undefined) {
      expect(localSessionNames.length, `${key}: owner Session fixture`).toBeGreaterThan(0)
    } else {
      expect(localSessionNames, `${key}: borrower must not own a Session fixture`).toEqual([])
      const target = resolve(dir, manifest.session.source)
      expect(has(dirname(target), basename(target)), `${key}: session source`).toBe(true)
      const targetDir = await realpath(dirname(target))
      const sourceKey = relative(corpusRoot, targetDir).split(/[/\\]/).join('/')
      expect(byKey.has(sourceKey), `${key}: session source must name a corpus owner`).toBe(true)
      expect(byKey.get(sourceKey)?.manifest.session, `${key}: session source cannot chain through a borrower`).toBeUndefined()
      const [selectedParent] = sessionFixtureFiles(scenarioFileNames(targetDir, platform))
      expect(basename(target), `${key}: session source must name the owner's selected parent generation`)
        .toBe(selectedParent?.name)
    }

    expect(has(dir, 'replay.override.json'), `${key}: replay override presence`)
      .toBe(manifest.replay?.override === true)
    expect(existsSync(join(dir, 'workspace.expected')), `${key}: final workspace presence`)
      .toBe(manifest.workspace?.final === true)
    if (manifest.workspace?.final === true) {
      const expectedRoot = join(dir, 'workspace.expected')
      const expectedWorkspace = await captureExpectedWorkspaceSnapshot(expectedRoot)
      expect(existsSync(join(expectedRoot, EMPTY_WORKSPACE_MARKER)), `${key}: empty workspace marker`)
        .toBe(expectedWorkspace.length === 0)
    }
    expect(has(dir, 'input.json'), `${key}: executable input metadata is ACP-only`)
      .toBe(scenario.profile === 'acp')
    if (scenario.profile !== 'acp') {
      expect(has(dir, 'stdout.expected.jsonl'), `${key}: ACP transcript outside ACP`).toBe(false)
    }

    if (manifest.header.pin === true) {
      const promptSource = byKey.get(referencedScenario(scenario, manifest.header.systemPromptSource ?? scenario.name))
      const schemaSource = byKey.get(referencedScenario(scenario, manifest.header.toolSchemasSource ?? scenario.name))
      expect(promptSource, `${key}: system-prompt source`).toBeDefined()
      expect(schemaSource, `${key}: tool-schema source`).toBeDefined()
      expect(has((promptSource as Scenario).dir, 'system-prompt.expected.md'), `${key}: system-prompt sidecar`).toBe(true)
      expect(has((schemaSource as Scenario).dir, 'tool-schemas.expected.json'), `${key}: tool-schema sidecar`).toBe(true)
      for (const [field, source] of [
        ['system-prompt.expected.md', promptSource],
        ['tool-schemas.expected.json', schemaSource],
      ] as const) {
        const local = join(dir, field)
        if (!existsSync(local) || !(await lstat(local)).isSymbolicLink()) continue
        expect(await realpath(local), `${key}: ${field} symlink follows its manifest source`)
          .toBe(await realpath(join((source as Scenario).dir, field)))
      }
    }

    if (manifest.session !== undefined) continue
    const names = sessionFixtureNames(localEntries)
    const fixtures = await Promise.all(names.map(name => readFile(resolveScenarioFile(dir, name, platform), 'utf8')))
    for (const name of localSessionNames) {
      assertSessionFixtureVersion(name, await readFile(resolveScenarioFile(dir, name, platform), 'utf8'))
    }
    expect(redactSessionSnapshotIds(fixtures), `${key}: typed identity fixed point`).toEqual(fixtures)
    for (const [index, fixture] of fixtures.entries()) {
      expect(scrubSystemPrompts(fixture), `${key}/${names[index]}: system prompt must be a sidecar`).toBe(fixture)
      expect(scrubToolSchemas(fixture), `${key}/${names[index]}: tool schemas must be a sidecar`).toBe(fixture)
    }
    for (const index of manifest.header.childSystemPrompts ?? []) {
      expect(names[index], `${key}: child prompt index ${index}`).toBeDefined()
      expect(has(dir, `system-prompt.${index}.expected.md`), `${key}: child prompt sidecar ${index}`).toBe(true)
    }
    for (const index of manifest.header.childToolSchemas ?? []) {
      expect(names[index], `${key}: child schema index ${index}`).toBeDefined()
      expect(has(dir, `tool-schemas.${index}.expected.json`), `${key}: child schema sidecar ${index}`).toBe(true)
    }
  }
})

it.each(SNAPSHOT_PLATFORMS)('keeps V3 replay input plus bounded declared historical migration coverage on %s', async (platform) => {
  const owners = (await scenarios()).filter(scenario => scenario.manifest.session === undefined)
  const inventory = await Promise.all(owners.map(async scenario => ({
    key: scenario.key,
    selectedVersions: sessionFixtureFiles(scenarioFileNames(scenario.dir, platform)).map(file => file.version),
    ...(scenario.manifest.sessionFormat === undefined
      ? {}
      : { retained: scenario.manifest.sessionFormat }),
  })))

  const summary = assertSnapshotCorpusPolicy(inventory)
  expect(summary.baselineRoles).toBeGreaterThan(0)
  expect(summary).toMatchObject({
    retainedRoles: 13,
    retainedScenarios: 10,
  })
})
