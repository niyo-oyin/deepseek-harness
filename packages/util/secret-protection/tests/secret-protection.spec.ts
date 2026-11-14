import { describe, expect, it } from 'vitest'
import { isProtectedValue, loadDpapi, loadPlatformProtection, openProtectedValues, protectValue } from '../src/index.ts'
import type { SecretProtection } from '../src/index.ts'

/** A reversible stand-in whose ciphertext never contains the secret's text. */
const protection: SecretProtection = {
  protect: plaintext => Buffer.from(`sealed:${plaintext}`, 'utf8').toString('hex'),
  unprotect: (ciphertext) => {
    const text = Buffer.from(ciphertext, 'hex').toString('utf8')
    if (!text.startsWith('sealed:')) throw new Error('not sealed here')
    return text.slice('sealed:'.length)
  },
}

describe('protected configuration values', () => {
  it('opens protected values wherever they sit and leaves the rest untouched', () => {
    const handler = (): void => {}
    const config = {
      apiKey: protectValue('top-secret', protection),
      servers: [{ name: 'a', token: protectValue('nested-secret', protection) }, { name: 'b' }],
      expression: { __jsExpr: 'process.env.X' },
      handler,
    }
    expect(JSON.stringify(config)).not.toContain('secret')
    expect(openProtectedValues(config, protection, 'configuration of "search"')).toEqual({
      apiKey: 'top-secret',
      servers: [{ name: 'a', token: 'nested-secret' }, { name: 'b' }],
      expression: { __jsExpr: 'process.env.X' },
      handler,
    })
  })

  it('returns a configuration with nothing protected as the same object', () => {
    const config = { name: 'plain', list: [{ a: 1 }], nested: { deep: 'x' } }
    expect(openProtectedValues(config, protection, 'configuration of "x"')).toBe(config)
    expect(openProtectedValues(config, undefined, 'configuration of "x"')).toBe(config)
  })

  it('recognizes only a mapping holding a ciphertext alone', () => {
    expect(isProtectedValue(protectValue('s', protection))).toBe(true)
    expect(isProtectedValue({ __dpapi: 'abc', other: 1 })).toBe(false)
    expect(isProtectedValue({ __dpapi: 1 })).toBe(false)
    expect(isProtectedValue('abc')).toBe(false)
  })

  it('names the field, not the value, when a protected value cannot be opened', () => {
    const foreign = { servers: [{ token: { __dpapi: Buffer.from('other-account').toString('hex') } }] }
    expect(() => openProtectedValues(foreign, protection, 'configuration of "mcp"'))
      .toThrow('configuration of "mcp" field "servers.0.token" cannot be decrypted by this Windows account')
    expect(() => openProtectedValues(foreign, undefined, 'configuration of "mcp"'))
      .toThrow('configuration of "mcp" field "servers.0.token" is protected by a Windows account and cannot be read on this platform')
  })
})

describe('platform protection', () => {
  it('protects secrets on Windows only', async () => {
    expect(await loadPlatformProtection() !== undefined).toBe(process.platform === 'win32')
  })

  it.runIf(process.platform === 'win32')('round-trips a secret and refuses bytes this account did not protect', async () => {
    const dpapi = await loadDpapi()
    const sealed = dpapi.protect('sk-秘密-123')
    expect(Buffer.from(sealed, 'base64').toString('latin1')).not.toContain('sk-')
    expect(dpapi.unprotect(sealed)).toBe('sk-秘密-123')
    expect(() => dpapi.unprotect(Buffer.from('not a protected blob').toString('base64'))).toThrow(/CryptUnprotectData failed/)
  })
})
