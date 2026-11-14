/** A fixed error producer for SDK transport coverage; it does not enable Auto. */
import { PtcExecutor } from '@deepseek-ai/dsh-tool-executor-ptc'

/** The shell tool a composition offers: bash on POSIX, pwsh on Windows. */
const SHELLS = new Set(['bash', 'pwsh'])

export const name = 'structured-denial-fixture'
export const inject = ['tools']
export function apply(ctx) {
  ctx.on('tools/pre-execute', (exec, next) => {
    if (!SHELLS.has(exec.name) || exec.arguments.command !== 'echo AUTO_DENIED') return next()
    return {
      kind: 'deny',
      reason: `Auto review rejected tool "${exec.name}"; its body was not executed`,
      info: {
        name: 'AutoReviewDeniedError',
        code: 'AUTO_REVIEW_DENIED',
        reason: '  transport raw\r\nreason  ',
      },
    }
  })
  // Each request uses one supported presentation: native first, then PTC.
  ctx.on('tools/result', (exec, result) => {
    if (!SHELLS.has(exec.name) || exec.parent !== undefined
      || result.error?.info?.code !== 'AUTO_REVIEW_DENIED' || exec.agent === undefined) return
    exec.agent.ctx.tools.setExecutor(new PtcExecutor(exec.agent.ctx))
  })
}
