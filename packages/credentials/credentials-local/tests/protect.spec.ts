/** Stored secrets are written protected where the platform protects them. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider, parseCredentialsDocument } from '../src/index.ts'
import type { SecretProtection } from '@deepseek-ai/dsh-secret-protection'

/** A reversible stand-in whose ciphertext never contains the secret's text. */
const protection: SecretProtection = {
  protect: plaintext => Buffer.from(`sealed:${plaintext}`, 'utf8').toString('hex'),
  unprotect: (ciphertext) => {
    const text = Buffer.from(ciphertext, 'hex').toString('utf8')
    if (!text.startsWith('sealed:')) throw new Error('not sealed here')
    return text.slice('sealed:'.length)
  },
}
const seal = (secret: string): string => `!dpapi ${protection.protect(secret)}`

vi.mock('@deepseek-ai/dsh-secret-protection', () => ({ loadPlatformProtection: () => Promise.resolve(protection) }))

const dirs: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

async function store(initial?: string): Promise<{ file: string; boot: () => Promise<LocalCredentialProvider> }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-protect-'))
  dirs.push(dir)
  const file = join(dir, '.credentials.yaml')
  if (initial !== undefined) await writeFile(file, initial, { mode: 0o600 })
  return {
    file,
    boot: async () => {
      const ctx = new Context()
      contexts.push(ctx)
      const fiber = ctx.plugin(LocalCredentialProvider, { path: file, watch: false })
      await fiber.await()
      return ctx.get('credentials') as LocalCredentialProvider
    },
  }
}

const KEY = credentialRef('EXA_API_KEY')
const GRANT = credentialKey('oauth', 'example')
const API_KEY = credentialKey('provider', 'example')

describe('protected storage', () => {
  it('writes a reference protected and serves it to the next boot', async () => {
    const { file, boot } = await store()
    const first = await boot()
    await first.set(KEY, 'exa-secret-value')

    const text = await readFile(file, 'utf8')
    expect(text).not.toContain('exa-secret-value')
    expect(text).toContain(`EXA_API_KEY: ${seal('exa-secret-value')}`)
    expect(await (await boot()).resolve(KEY)).toEqual({ value: 'exa-secret-value', source: 'file' })
  })

  it('writes every secret of a record protected and returns the record unchanged', async () => {
    const { file, boot } = await store()
    const provider = await boot()
    const grant: CredentialRecord = { kind: 'grant', payload: { access: 'grant-token', scopes: ['a', 'b'], expires: 42 } }
    const apiKey: CredentialRecord = { kind: 'api-key', key: 'record-key', env: { REGION_TOKEN: 'region-secret' } }
    await provider.modifyRecord(GRANT, () => Promise.resolve(grant))
    await provider.modifyRecord(API_KEY, () => Promise.resolve(apiKey))

    const text = await readFile(file, 'utf8')
    for (const secret of ['grant-token', 'record-key', 'region-secret']) expect(text).not.toContain(secret)
    const next = await boot()
    expect(await next.readRecord(GRANT)).toEqual(grant)
    expect(await next.readRecord(API_KEY)).toEqual(apiKey)
  })

  it('protects a document stored as plain text at boot and keeps its comments', async () => {
    const { file, boot } = await store([
      'version: 1',
      'refs:',
      '  # search',
      '  EXA_API_KEY: exa-plain',
      '  OTHER_KEY: other-plain # trailing',
      'records:',
      '  provider/example:',
      '    kind: api-key',
      '    key: record-plain',
      '',
    ].join('\n'))
    const provider = await boot()

    expect(await provider.resolve(KEY)).toEqual({ value: 'exa-plain', source: 'file' })
    const text = await readFile(file, 'utf8')
    for (const secret of ['exa-plain', 'other-plain', 'record-plain']) expect(text).not.toContain(secret)
    expect(text).toContain('  # search\n')
    expect(text).toContain('# trailing')
    expect(await (await boot()).readRecord(API_KEY)).toEqual({ kind: 'api-key', key: 'record-plain' })
  })

  it('protects the plain-text entries beside the one a write changes', async () => {
    const { file, boot } = await store(`version: 1\nrefs:\n  EXA_API_KEY: ${seal('exa-sealed')}\n`)
    const provider = await boot()
    // An entry added by hand while the product runs, picked up by the write's own re-read.
    await writeFile(file, `version: 1\nrefs:\n  EXA_API_KEY: ${seal('exa-sealed')}\n  HAND_KEY: hand-plain\n`)
    await provider.set(credentialRef('NEW_KEY'), 'new-secret')

    const text = await readFile(file, 'utf8')
    for (const secret of ['hand-plain', 'new-secret']) expect(text).not.toContain(secret)
    expect(await provider.resolve(credentialRef('HAND_KEY'))).toEqual({ value: 'hand-plain', source: 'file' })
  })

  it('refuses a document whose protected value this account cannot open, naming the entry and not the value', async () => {
    const foreign = Buffer.from('other-account', 'utf8').toString('hex')
    const { boot } = await store(`version: 1\nrefs:\n  EXA_API_KEY: !dpapi ${foreign}\n`)
    const failure = await boot().then(() => undefined, (error: unknown) => error as Error)
    expect(failure?.message).toMatch(/the value for "EXA_API_KEY" in .* cannot be decrypted by this Windows account/)
    expect(failure?.message).toContain('remove the entry and store the credential again')
    expect(failure?.message).not.toContain(foreign)
  })
})

describe('parsing protected values', () => {
  it('reports whether any secret is stored as plain text', () => {
    const sealed = `version: 1\nrefs:\n  A: ${seal('a')}\nrecords:\n  oauth/x:\n    kind: grant\n    payload: ${seal('{"t":1}')}\n`
    expect(parseCredentialsDocument(sealed, 'f', protection)).toMatchObject({ unprotected: false })
    expect(parseCredentialsDocument(sealed, 'f', protection).records.get('oauth/x')).toEqual({ kind: 'grant', payload: { t: 1 } })
    expect(parseCredentialsDocument(`${sealed}  provider/y:\n    kind: api-key\n    key: plain\n`, 'f', protection).unprotected).toBe(true)
  })

  it('refuses a protected value on a platform without protection', () => {
    expect(() => parseCredentialsDocument(`version: 1\nrefs:\n  A: ${seal('a')}\n`, 'f'))
      .toThrow(/the value for "A" in f is protected by a Windows account and cannot be read on this platform/)
  })

  it('still applies the stored-value rules to what a protected value opens to', () => {
    expect(() => parseCredentialsDocument(`version: 1\nrefs:\n  A: ${seal('')}\n`, 'f', protection))
      .toThrow(/the value for "A" in f is empty/)
    expect(() => parseCredentialsDocument(`version: 1\nrecords:\n  oauth/x:\n    kind: grant\n    payload: ${seal('not json')}\n`, 'f', protection))
      .toThrow(/record "oauth\/x" payload in f does not hold JSON/)
  })
})
