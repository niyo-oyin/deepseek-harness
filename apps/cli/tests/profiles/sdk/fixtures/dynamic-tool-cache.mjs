/** SDK fixture for native registry changes; the test's loopback proxy records the unmodified DeepSeek requests. */
import { appendFile } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'sdk-dynamic-tool-cache-fixture'
export const inject = ['tools', 'systemPrompt']

/** Record each model step's registry stage and let the model add or remove a scoped tool. */
export function apply(ctx, config) {
  const states = new Map()
  ctx.on('session/event', (session, event) => {
    const state = states.get(session.id)
    if (state === undefined || event.type !== 'step/start') return
    state.turn = event.data.turn
    state.step = event.data.step
    // Each step makes exactly one model request after this event, in the order recorded here.
    appendFileSync(config.evidencePath, `${JSON.stringify(state)}\n`)
  })
  ctx.on('agent/created', ({ agent }) => {
    const scope = agent.ctx
    const state = { stage: 'initial', turn: 0, step: 0 }
    states.set(agent.id, state)
    scope.effect(() => () => { states.delete(agent.id) })
    scope.effect(() => scope.tools.restrict({ allow: [] }))
    let guidance = ''
    scope.systemPrompt.section({ name: 'sdk:dynamic-tool-guidance', order: 400, text: () => guidance })
    let removeTool
    scope.effect(() => scope.tools.register(defineTool({
      name: 'cache_tool_control',
      description: 'Add or remove the temporary cache_sample tool. It becomes available on the model step after add returns.',
      parameters: { action: { type: 'string', enum: ['add', 'remove'], required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute({ action }) {
        if (action === 'add') {
          if (removeTool !== undefined) throw new Error('The sample tool is already registered.')
          if (config.updatePrompt) guidance = 'Place each generated sample label on its own line.'
          removeTool = scope.effect(() => scope.tools.register(defineTool({
            name: 'cache_sample',
            description: 'Read a randomly generated sample label created for this example run.',
            parameters: {},
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
            async execute() {
              await appendFile(config.callsPath, 'sample\n')
              return config.sampleLabel
            },
          })))
          state.stage = 'added'
          await appendFile(config.callsPath, 'add\n')
          return 'Tool added. Call cache_sample on the next model step to obtain the generated sample label.'
        }
        if (removeTool === undefined) throw new Error('The sample tool is not registered.')
        await removeTool()
        removeTool = undefined
        state.stage = 'removed'
        await appendFile(config.callsPath, 'remove\n')
        return 'Tool removed. The sample tool is unavailable.'
      },
    })))
  })
}
