/** Secret fields of plugin configuration are stored protected and reach the plugin opened. */
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { FiberState } from '@deepseek-ai/cordis'
import type { SecretProtection } from '@deepseek-ai/dsh-secret-protection'
import { configurationFixture as fixture } from './configuration-fixture.ts'

/** A reversible stand-in whose ciphertext never contains the secret's text. */
const protection: SecretProtection = {
  protect: plaintext => Buffer.from(`sealed:${plaintext}`, 'utf8').toString('hex'),
  unprotect: (ciphertext) => {
    const text = Buffer.from(ciphertext, 'hex').toString('utf8')
    if (!text.startsWith('sealed:')) throw new Error('not sealed here')
    return text.slice('sealed:'.length)
  },
}

vi.mock('@deepseek-ai/dsh-secret-protection', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-secret-protection')>(),
  loadPlatformProtection: () => Promise.resolve(protection),
}))

const tokenOf = (ctx: Awaited<ReturnType<typeof fixture>>['ctx'], ns: string): unknown =>
  (ctx.settings.describe().find(row => row.ns === ns)!.value as { token?: unknown }).token

it('stores a saved secret protected, gives the plugin its text, and restores it at restart', async () => {
  const { ctx, profile, start } = await fixture()
  await ctx.settings.mutate('second', [{ op: 'set', path: ['token'], value: 'saved-secret' }])

  expect(tokenOf(ctx, 'second')).toBe('saved-secret')
  const text = readFileSync(profile.patchPath, 'utf8')
  expect(text).not.toContain('saved-secret')
  expect(parse(text)).toContainEqual({
    id: 'second', name: 'cordis:probe', config: { ordinary: 'second', token: { __dpapi: protection.protect('saved-secret') } },
  })

  await ctx.fiber.dispose()
  expect(tokenOf(await start(), 'second')).toBe('saved-secret')
})

it('keeps a protected secret through an edit of another field', async () => {
  const { ctx, profile } = await fixture()
  await ctx.settings.mutate('second', [{ op: 'set', path: ['token'], value: 'saved-secret' }])
  const stored = (parse(readFileSync(profile.patchPath, 'utf8')) as { id: string; config: { token: unknown } }[])
    .find(row => row.id === 'second')!.config.token
  await ctx.settings.update('second', { count: 7 })

  expect(tokenOf(ctx, 'second')).toBe('saved-secret')
  expect(parse(readFileSync(profile.patchPath, 'utf8'))).toContainEqual({
    id: 'second', name: 'cordis:probe', config: { ordinary: 'second', token: stored, count: 7 },
  })
})

it('does not copy an inherited secret into the profile when another field changes', async () => {
  const { ctx, profile } = await fixture()
  await ctx.settings.update('first', { count: 5 })

  expect(tokenOf(ctx, 'first')).toBe('private')
  expect(parse(readFileSync(profile.patchPath, 'utf8'))).toContainEqual({
    id: 'first', name: 'cordis:probe', config: { ordinary: 'fixed', token: 'private', count: 5 },
  })
})

it('protects a secret stored as plain text in the profile at startup', async () => {
  const { ctx, profile, start } = await fixture()
  await ctx.fiber.dispose()
  writeFileSync(profile.patchPath, JSON.stringify([{ id: 'second', config: { ordinary: 'second', token: 'hand-written' } }]))
  const restarted = await start()

  await vi.waitFor(() => { expect(readFileSync(profile.patchPath, 'utf8')).not.toContain('hand-written') }, { timeout: 10_000 })
  expect(tokenOf(restarted, 'second')).toBe('hand-written')
})

it('leaves an entry whose protected secret this account cannot open inactive and starts the rest', async () => {
  const { ctx, profile, start } = await fixture()
  await ctx.fiber.dispose()
  const foreign = Buffer.from('other-account', 'utf8').toString('hex')
  writeFileSync(profile.patchPath, JSON.stringify([{ id: 'second', config: { ordinary: 'second', token: { __dpapi: foreign } } }]))

  const restarted = await start()
  const stateOf = (id: string): FiberState | undefined =>
    [...restarted.loader.entries()].find(row => row.options.id === id)?.fiber?.state
  expect(stateOf('second')).not.toBe(FiberState.ACTIVE)
  expect(stateOf('first')).toBe(FiberState.ACTIVE)
  expect(restarted.settings.describe().map(row => row.ns)).not.toContain('second')
})
