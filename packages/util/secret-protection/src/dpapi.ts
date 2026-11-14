/**
 * Windows Data Protection API binding. A value protected here can be recovered
 * only by the Windows account that protected it, on the machine it was
 * protected on. Koffi loads lazily so non-Windows processes never open Win32
 * libraries.
 * @module @deepseek-ai/dsh-secret-protection/dpapi
 */

/** Encrypts and decrypts stored secrets for the current OS account. */
export interface SecretProtection {
  /**
   * Encrypt one secret.
   * @param plaintext - the secret.
   * @returns the base64 ciphertext to store.
   */
  protect(plaintext: string): string
  /**
   * Decrypt one stored secret.
   * @param ciphertext - base64 ciphertext a `protect` call returned.
   * @returns the secret.
   * @throws when the ciphertext is malformed or was protected by another account or machine.
   */
  unprotect(ciphertext: string): string
}

interface DataBlob {
  cbData: number
  pbData: unknown
}

type CryptData = (
  input: { cbData: number; pbData: Buffer },
  description: null,
  entropy: null,
  reserved: null,
  prompt: null,
  flags: number,
  output: DataBlob,
) => number

/** Never show a prompt: the provider runs without a window. */
const CRYPTPROTECT_UI_FORBIDDEN = 0x1

let protection: SecretProtection | undefined

/**
 * The protection this platform gives stored secrets.
 * @returns the Windows account's DPAPI binding, or `undefined` on a platform that stores secrets as written.
 */
export async function loadPlatformProtection(): Promise<SecretProtection | undefined> {
  return process.platform === 'win32' ? loadDpapi() : undefined
}

/**
 * Load the protection the current Windows account owns.
 * @returns the process-wide DPAPI binding.
 */
export async function loadDpapi(): Promise<SecretProtection> {
  if (protection !== undefined) return protection
  const koffi = (await import('koffi')).default
  const crypt32 = koffi.load('crypt32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  koffi.struct('DSH_DATA_BLOB', { cbData: 'uint32_t', pbData: 'void *' })
  const signature = (name: string): string => `int __stdcall ${name}(DSH_DATA_BLOB *input, const char16_t *description, `
    + 'DSH_DATA_BLOB *entropy, void *reserved, void *prompt, uint32_t flags, _Out_ DSH_DATA_BLOB *output)'
  const protectData = crypt32.func(signature('CryptProtectData')) as CryptData
  const unprotectData = crypt32.func(signature('CryptUnprotectData')) as CryptData
  const localFree = kernel32.func('void *__stdcall LocalFree(void *memory)') as (memory: unknown) => unknown
  const getLastError = kernel32.func('uint32_t __stdcall GetLastError()') as () => number

  const transform = (call: CryptData, name: string, input: Buffer): Buffer => {
    const output: DataBlob = { cbData: 0, pbData: null }
    if (call({ cbData: input.length, pbData: input }, null, null, null, null, CRYPTPROTECT_UI_FORBIDDEN, output) === 0) {
      throw new Error(`secret-protection: ${name} failed (Win32 ${String(getLastError())})`)
    }
    try {
      return Buffer.from(koffi.decode(output.pbData, koffi.array('uint8_t', output.cbData, 'Typed')) as Uint8Array)
    } finally {
      localFree(output.pbData)
    }
  }
  protection = {
    protect: plaintext => transform(protectData, 'CryptProtectData', Buffer.from(plaintext, 'utf8')).toString('base64'),
    unprotect: ciphertext => transform(unprotectData, 'CryptUnprotectData', Buffer.from(ciphertext, 'base64')).toString('utf8'),
  }
  return protection
}
