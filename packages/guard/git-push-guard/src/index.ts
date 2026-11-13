/**
 * Git push guard: a shell command that runs `git push` does not start until
 * the user confirms it. The question shows the exact command and goes through
 * the user-questions channel, so it reaches the user under every permission
 * preset, including the ones whose approval policy never asks. While the
 * plugin is mounted the guard is on; disabling its row in the profile patch
 * turns it off.
 * @module @deepseek-ai/dsh-git-push-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { runsGitPush } from './push-command.ts'

/** Cordis function-plugin name. */
export const name = 'git-push-guard'

/** The tool pipeline the guard listens on and the channel that reaches the user. */
export const inject = ['tools', 'userQuestions']

/** The argument that carries the command line, by shell tool. */
const COMMAND_ARGUMENTS: Readonly<Record<string, string>> = { bash: 'command', pwsh: 'command', terminal_send: 'text' }

/** Longest command excerpt shown in the question. */
const DETAIL_LIMIT = 2000

const QUESTION_ID = 'git-push-guard'
const APPROVE = 'Push'
const REJECT = 'Do not push'

/** Model-facing denial after the user declined. */
const REJECTED = 'Git push guard: the user declined this push, so the command did not run. Do not push again unless the user asks for it.'

/** Model-facing denial when a subagent attempted the push. */
const DELEGATED = 'Git push guard: a subagent cannot ask the user to confirm a push, so the command did not run. '
  + 'Report the push you intended to the agent that started you.'

/** Model-facing denial when nobody can be asked. */
const UNREACHABLE = 'Git push guard: the user could not be asked to confirm this push, so the command did not run.'

/**
 * The command line of a shell tool call that runs a Git push.
 * @param exec - the pending tool call.
 * @returns the command line, or undefined for another tool or a command without a push.
 */
function pushCommandOf(exec: ToolExecution): string | undefined {
  const argument = COMMAND_ARGUMENTS[exec.name]
  if (argument === undefined || typeof exec.arguments !== 'object' || exec.arguments === null) return undefined
  const command: unknown = Reflect.get(exec.arguments, argument)
  return typeof command === 'string' && runsGitPush(command) ? command : undefined
}

/**
 * Ask the user whether one push may run.
 * @param ctx - plugin context holding the user-questions service.
 * @param exec - the pending shell tool call.
 * @param command - its command line.
 * @returns `allow` after the user confirmed, `cancel` when the call was cancelled meanwhile, otherwise a denial naming why.
 */
async function confirmPush(ctx: Context, exec: ToolExecution, command: string): Promise<PreToolDecision> {
  if (exec.agent === undefined) return { kind: 'deny', reason: UNREACHABLE }
  try {
    const answer = await ctx.userQuestions.ask({
      agent: exec.agent,
      signal: exec.signal,
      questions: [{
        id: QUESTION_ID,
        header: 'Git push',
        question: 'Run this Git push?',
        detail: command.length > DETAIL_LIMIT ? `${command.slice(0, DETAIL_LIMIT)}…` : command,
        options: [{ label: APPROVE }, { label: REJECT }],
        intent: {
          kind: 'approval',
          approve: APPROVE,
          reject: REJECT,
          display: {
            question: {
              en: 'Run this Git push?', ja: 'この Git プッシュを実行しますか？', zh: '要执行这次 Git 推送吗？',
              es: '¿Ejecutar este push de Git?', fr: 'Exécuter ce push Git ?', de: 'Diesen Git-Push ausführen?',
              ru: 'Выполнить этот git push?', pt: 'Executar este push do Git?',
            },
            approve: {
              en: 'Push', ja: 'プッシュする', zh: '推送', es: 'Hacer push', fr: 'Pousser', de: 'Pushen', ru: 'Отправить', pt: 'Fazer push',
            },
          },
        },
      }],
    })
    const selected = answer.answers.find(item => item.id === QUESTION_ID)?.selected ?? []
    return selected.length === 1 && selected[0] === APPROVE ? { kind: 'allow' } : { kind: 'deny', reason: REJECTED }
  } catch (error) {
    if (exec.signal.aborted) return { kind: 'cancel' }
    return { kind: 'deny', reason: error instanceof UserQuestionError && error.code === 'DELEGATED_CALLER' ? DELEGATED : UNREACHABLE }
  }
}

/**
 * Mount the guard on the tool pipeline.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec, next) => {
    const command = pushCommandOf(exec)
    if (command === undefined) return next()
    const decision = await confirmPush(ctx, exec, command)
    // A confirmed push still passes the listeners after this one, which may narrow it further.
    return decision.kind === 'allow' ? next() : decision
  })
}
