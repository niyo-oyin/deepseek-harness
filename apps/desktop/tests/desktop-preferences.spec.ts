/** Startup preferences read from the owned Host before the workspace becomes visible. */
import { expect, it, vi } from 'vitest'
import { connectDesktopPreferences } from '../src/desktop-preferences.ts'

function hostAnswering(namespaces: unknown[]) {
  return vi.fn(async (_input: string, init?: RequestInit) => {
    const request = JSON.parse(init?.body as string) as { rpcId: string }
    return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { namespaces } } })
  })
}

it('reads the language and theme over settings/describe with the private cookie only', async () => {
  const send = hostAnswering([
    { ns: 'locale', value: { preference: 'ja' } },
    { ns: 'ui-theme', value: { preference: 'dark' } },
  ])
  const preferences = connectDesktopPreferences('http://127.0.0.1:3080/app', 'dsh-desktop-session=private', send)
  await expect(preferences.read()).resolves.toEqual({ localePreference: 'ja', themePreference: 'dark' })
  await expect(preferences.readLocalePreference()).resolves.toBe('ja')
  const [url, init] = send.mock.calls[0]!
  expect(url).toBe('http://127.0.0.1:3080/api/settings/describe')
  expect(init?.headers).toEqual({ 'content-type': 'application/json', cookie: 'dsh-desktop-session=private' })
})

it('falls back to the system appearance and no saved language', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(connectDesktopPreferences('http://127.0.0.1:1/', 'c', hostAnswering([{ ns: 'locale', value: {} }])).read())
    .resolves.toEqual({ localePreference: null, themePreference: 'system' })
  await expect(connectDesktopPreferences('http://127.0.0.1:1/', 'c', hostAnswering([
    { ns: 'locale', value: {} }, { ns: 'ui-theme', value: { preference: 'sepia' } },
  ])).read()).resolves.toEqual({ localePreference: null, themePreference: 'system' })
  expect(warn).toHaveBeenCalledOnce()
  warn.mockRestore()
})

it('refuses a failed or malformed answer', async () => {
  const failed = vi.fn(async () => new Response('', { status: 500 }))
  await expect(connectDesktopPreferences('http://127.0.0.1:1/', 'c', failed).read()).rejects.toThrow('Web request failed')
  await expect(connectDesktopPreferences('http://127.0.0.1:1/', 'c', hostAnswering([{ ns: 'locale', value: { preference: 3 } }])).read())
    .rejects.toThrow('invalid locale preference')
})
