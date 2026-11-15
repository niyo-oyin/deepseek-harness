/** pi-ai's per-session state is released when the harness session leaves the store. */

import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { registerSessionResourceCleanup } from '@earendil-works/pi-ai'
import * as PiAi from '../src/index.ts'

it('releases pi-ai session resources when a session is disposed', async () => {
  const released: (string | undefined)[] = []
  onTestFinished(registerSessionResourceCleanup((sessionId) => { released.push(sessionId) }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(PiAi, { providers: {} })
  ctx.emit('session/disposed', { id: 'session-fixture' } as unknown as Session)
  expect(released).toEqual(['session-fixture'])
})
