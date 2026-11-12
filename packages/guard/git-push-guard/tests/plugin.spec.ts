import { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as GitPushGuard from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** How the stand-in user answers: one of the two options, or a failure of the question channel. */
type Answer = 'Push' | 'Do not push' | Error

/**
 * Mount the guard beside a recording stand-in for the question channel.
 * @param answer - what the user, or the channel, answers.
 * @returns the context and the questions asked so far.
 */
async function guard(answer: Answer = 'Push') {
  const ctx = new Context()
  contexts.push(ctx)
  const asks: AskUserQuestionRequest[] = []
  ctx.provide('tools', {})
  ctx.provide('userQuestions', {
    ask: vi.fn(async (request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> => {
      asks.push(request)
      if (answer instanceof Error) throw answer
      return { answers: [{ id: 'git-push-guard', selected: [answer] }] }
    }),
  })
  await ctx.plugin(GitPushGuard)
  return { ctx, asks }
}

const AGENT = { session: { id: 'session-1' } }

/** Run one tool call through the pre-execute waterfall; `allow` is what the pipeline answers when every listener passes. */
function preExecute(
  ctx: Context, name: string, args: unknown, options: { agent?: unknown; signal?: AbortSignal } = {},
): Promise<PreToolDecision> {
  const exec = { name, arguments: args, agent: 'agent' in options ? options.agent : AGENT, signal: options.signal ?? new AbortController().signal }
  const dispatch = Reflect.get(ctx, 'waterfall') as (name: string, ...args: unknown[]) => Promise<PreToolDecision>
  return Reflect.apply(dispatch, ctx, ['tools/pre-execute', exec, () => Promise.resolve<PreToolDecision>({ kind: 'allow' })])
}

describe('git push guard', () => {
  it('asks the user before a push with the exact command, and lets a confirmed push run', async () => {
    const { ctx, asks } = await guard('Push')
    await expect(preExecute(ctx, 'pwsh', { command: 'git push origin main' })).resolves.toEqual({ kind: 'allow' })
    expect(asks).toHaveLength(1)
    expect(asks[0]).toMatchObject({
      agent: AGENT,
      questions: [{
        id: 'git-push-guard', detail: 'git push origin main', options: [{ label: 'Push' }, { label: 'Do not push' }],
        intent: { kind: 'approval', approve: 'Push', reject: 'Do not push' },
      }],
    })
  })

  it.each([
    ['bash', { command: 'git commit -m wip && git push' }],
    ['terminal_send', { text: 'git push\n' }],
  ])('guards the command line of %s', async (name, args) => {
    const { ctx, asks } = await guard('Push')
    await preExecute(ctx, name, args)
    expect(asks).toHaveLength(1)
  })

  it('does not ask about commands without a push or about other tools', async () => {
    const { ctx, asks } = await guard('Do not push')
    for (const [name, args] of [
      ['pwsh', { command: 'git status' }],
      ['bash', { command: 'git commit -m "push the fix"' }],
      ['write', { command: 'git push', content: 'git push' }],
      ['pwsh', { command: 42 }],
      ['pwsh', null],
    ] as const) {
      await expect(preExecute(ctx, name, args)).resolves.toEqual({ kind: 'allow' })
    }
    expect(asks).toEqual([])
  })

  it('keeps a declined push from running and tells the model the user declined', async () => {
    const { ctx } = await guard('Do not push')
    const decision = await preExecute(ctx, 'pwsh', { command: 'git push' })
    expect(decision).toMatchObject({ kind: 'deny' })
    expect(decision.kind === 'deny' ? decision.reason : '').toContain('the user declined this push')
  })

  it('shortens a very long command in the question', async () => {
    const { ctx, asks } = await guard('Push')
    await preExecute(ctx, 'bash', { command: `git push origin ${'x'.repeat(5000)}` })
    expect(asks[0]?.questions[0]?.detail).toHaveLength(2001)
    expect(asks[0]?.questions[0]?.detail?.endsWith('…')).toBe(true)
  })

  it('blocks a push nobody can confirm: a subagent, a missing answerer, or a call without an agent', async () => {
    const delegated = await guard(new UserQuestionError('a subagent cannot ask the user', 'DELEGATED_CALLER'))
    const fromSubagent = await preExecute(delegated.ctx, 'pwsh', { command: 'git push' })
    expect(fromSubagent.kind === 'deny' ? fromSubagent.reason : '').toContain('a subagent cannot ask the user to confirm a push')

    const unanswered = await guard(new UserQuestionError('no user-questions answerer accepted the request', 'NO_PROVIDER'))
    const withoutAnswerer = await preExecute(unanswered.ctx, 'pwsh', { command: 'git push' })
    expect(withoutAnswerer.kind === 'deny' ? withoutAnswerer.reason : '').toContain('the user could not be asked')

    const agentless = await guard('Push')
    const withoutAgent = await preExecute(agentless.ctx, 'pwsh', { command: 'git push' }, { agent: undefined })
    expect(withoutAgent.kind === 'deny' ? withoutAgent.reason : '').toContain('the user could not be asked')
    expect(agentless.asks).toEqual([])
  })

  it('cancels the call when it is cancelled while the question is open', async () => {
    const controller = new AbortController()
    const { ctx } = await guard(new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
    controller.abort()
    await expect(preExecute(ctx, 'pwsh', { command: 'git push' }, { signal: controller.signal })).resolves.toEqual({ kind: 'cancel' })
  })

  it('stops guarding once the plugin is unloaded', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const ask = vi.fn()
    ctx.provide('tools', {})
    ctx.provide('userQuestions', { ask })
    const fiber = await ctx.plugin(GitPushGuard)
    await fiber.dispose()
    await expect(preExecute(ctx, 'pwsh', { command: 'git push' })).resolves.toEqual({ kind: 'allow' })
    expect(ask).not.toHaveBeenCalled()
  })
})
