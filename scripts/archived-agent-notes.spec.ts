import { describe, expect, it } from 'vitest'
import {
  extendArchiveManifest,
  parseArchiveManifest,
  renderArchiveManifest,
  validateArchiveArtifacts,
  validateArchiveManifestExtension,
  type ArchiveManifest,
} from './archived-agent-notes.ts'
import { isArchivedAgentNotePath } from './repo-files.ts'

const NOTE = 'process/2026-07-26-example.md'

function note(header = '# Agent Note: Example\n\nStatus: implemented\nArchived: 2026-07-26'): Map<string, Buffer> {
  return new Map([[NOTE, Buffer.from(`${header}\n\n## Problem\n\nExample.\n`)]])
}

describe('archived Agent Notes', () => {
  it('recognizes archived paths with POSIX and Windows separators', () => {
    expect(isArchivedAgentNotePath('.agents/notes/archived/process/example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents\\notes\\archived\\process\\example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents/notes/implemented/process/example.md')).toBe(false)
  })

  it('accepts an implemented note with matching archive metadata', () => {
    expect(validateArchiveArtifacts(note())).toEqual([])
  })

  it.each(['# Agent Note：示例', '# Historical decision'])('preserves historical formatting: %s', (title) => {
    expect(validateArchiveArtifacts(note(`${title}\nStatus: implemented\nArchived: 2026-07-26`))).toEqual([])
  })

  it.each([
    ['Status: proposed\nArchived: 2026-07-26', /requires `Status: implemented`/],
    ['Status: implemented\n\nArchived: 2026-07-26', /immediately after the status/],
    ['Status: implemented\nArchived: 2026-02-30', /valid date/],
    ['Status: implemented\nArchived: 2026-07-25', /predates the note filename/],
  ])('rejects invalid archive metadata: %s', (metadata, error) => {
    expect(validateArchiveArtifacts(note(`# Historical decision\n${metadata}`)).join('\n')).toMatch(error)
  })

  it('rejects a file that is not a dated note of a known kind', () => {
    const content = Buffer.from('# Agent Note: Example\n\nStatus: implemented\nArchived: 2026-07-26\n')
    expect(validateArchiveArtifacts(new Map([
      ['process/notes.txt', content],
      ['process/undated.md', content],
      ['misc/2026-07-26-example.md', content],
    ]))).toEqual([
      'misc/2026-07-26-example.md: unknown Agent Note kind "misc"',
      'process/notes.txt: expected {kind}/yyyy-mm-dd-topic.md',
      'process/undated.md: expected {kind}/yyyy-mm-dd-topic.md',
    ])
  })

  it('extends the manifest without permitting a sealed change or removal', () => {
    const artifacts = note()
    const first = extendArchiveManifest({ version: 1, files: {} }, artifacts)
    expect(first.errors).toEqual([])
    expect(first.added).toEqual([NOTE])

    const sealed: ArchiveManifest = { version: 1, files: first.files }
    const later = 'process/2026-08-01-later.md'
    const extended = extendArchiveManifest(sealed, new Map([...artifacts, [later, Buffer.from('later')]]))
    expect(extended).toMatchObject({ errors: [], added: [later] })
    expect(extended.files[NOTE]).toBe(first.files[NOTE])

    expect(extendArchiveManifest(sealed, new Map([[NOTE, Buffer.from('changed')]])).errors).toEqual([
      `${NOTE}: sealed content hash changed`,
    ])
    expect(extendArchiveManifest(sealed, new Map()).errors).toEqual([`${NOTE}: sealed artifact is missing`])
  })

  it('rejects replacing manifest seals alongside changed archive content', () => {
    const baseline: ArchiveManifest = { version: 1, files: extendArchiveManifest({ version: 1, files: {} }, note()).files }
    const changedArtifacts = new Map([[NOTE, Buffer.from('changed')]])
    const current: ArchiveManifest = { version: 1, files: extendArchiveManifest({ version: 1, files: {} }, changedArtifacts).files }

    // A manifest rewritten to match the changed note passes on its own; only the baseline catches it.
    expect(extendArchiveManifest(current, changedArtifacts).errors).toEqual([])
    expect(validateArchiveManifestExtension(baseline, current)).toEqual([`${NOTE}: sealed manifest hash changed`])
    expect(validateArchiveManifestExtension(baseline, { version: 1, files: {} })).toEqual([
      `${NOTE}: sealed manifest entry is missing`,
    ])
    expect(validateArchiveManifestExtension(baseline, { version: 1, files: { ...baseline.files, 'process/2026-08-01-later.md': baseline.files[NOTE]! } }))
      .toEqual([])
  })

  it('round-trips the deterministic manifest schema', () => {
    const content = renderArchiveManifest({ 'process/z.md': `sha256:${'a'.repeat(64)}` })
    expect(parseArchiveManifest(content)).toEqual({
      version: 1,
      files: { 'process/z.md': `sha256:${'a'.repeat(64)}` },
    })
  })
})
