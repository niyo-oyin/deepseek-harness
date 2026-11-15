import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantMessageEvent, Model } from '@earendil-works/pi-ai'
import { stream as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages'
import { stream as streamCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { stream as streamResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { toStreamChunks } from '../src/stream.ts'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { anthropicFrame as frame, anthropicMessageStart, closeMockServers, mockServer } from './mock-server.ts'

afterEach(closeMockServers)

/** A write call whose arguments arrive in many small deltas. */
const args = { file_path: 'notes.md', content: 'x'.repeat(2048) }
const argsJson = JSON.stringify(args)
const fragments = argsJson.match(/.{1,7}/gs) ?? []

function model<A extends 'anthropic-messages' | 'openai-completions' | 'openai-responses'>(api: A, baseUrl: string): Model<A> {
  return {
    id: 'm', name: 'm', api, provider: 'test', baseUrl, reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024,
  }
}

/** The arguments each `toolcall_delta` partial carries, and the finalized arguments. */
async function collect(events: AsyncIterable<AssistantMessageEvent>): Promise<{ partials: unknown[]; final: unknown }> {
  const partials: unknown[] = []
  let final: unknown
  for await (const event of events) {
    if (event.type === 'toolcall_delta' && event.delta.length > 0) {
      const block = event.partial.content[event.contentIndex]
      partials.push(block?.type === 'toolCall' ? block.arguments : undefined)
    } else if (event.type === 'toolcall_end') {
      final = event.toolCall.arguments
    } else if (event.type === 'error') {
      throw new Error(event.error.errorMessage)
    }
  }
  return { partials, final }
}

const context = normalizeContext({ messages: [{ role: 'user', content: 'hi', timestamp: 0 }] })

describe('streamed tool-call arguments', () => {
  it('preserves an empty Responses message after parallel tool calls with its replay metadata', async () => {
    const calls = [0, 1, 2].map(index => ({ type: 'function_call', call_id: `call_${index}`, id: `item_${index}`, name: 'read', arguments: '{}' }))
    const empty = { type: 'message', id: 'message_empty', role: 'assistant', content: [{ type: 'output_text', text: '', annotations: [] }] }
    const server = await mockServer([{ events: [
      '{"type":"response.created","response":{"id":"response_empty_text"}}',
      ...[...calls, empty].flatMap((item, output_index) => [
        JSON.stringify({ type: 'response.output_item.added', output_index, item }),
        JSON.stringify({ type: 'response.output_item.done', output_index, item }),
      ]),
      JSON.stringify({ type: 'response.completed', response: {
        id: 'response_empty_text', status: 'completed', output: [...calls, empty], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
      } }),
    ] }])
    const assembler = new BlockAssembler()
    for await (const chunk of toStreamChunks(streamResponses(model('openai-responses', server.url), context, { apiKey: 'test-key' }))) {
      assembler.push(chunk)
    }
    expect(assembler.blocks()).toEqual([
      ...calls.map(call => ({ type: 'tool-call', id: `${call.call_id}|${call.id}`, name: 'read', arguments: '{}' })),
      { type: 'text', text: '' },
    ])
    expect(assembler.replayState?.blocks).toEqual([
      ...calls.map(() => ({ type: 'tool-call' })),
      { type: 'text', textSignature: JSON.stringify({ v: 1, id: 'message_empty' }) },
    ])
    expect(assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(server.requests).toHaveLength(1)
  })

  /** Server events for one `write` call whose arguments arrive in the given fragments. */
  const protocols: Array<{ api: 'openai-completions' | 'anthropic-messages' | 'openai-responses'; events: (pieces: readonly string[], json: string) => Array<string | { event: string; data: string }>; stream: (url: string) => AsyncIterable<AssistantMessageEvent> }> = [
    {
      api: 'openai-completions',
      events: pieces => [
        JSON.stringify({ choices: [{
          delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write', arguments: '' } }] },
          index: 0, finish_reason: null,
        }] }),
        ...pieces.map(piece => JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: piece } }] }, index: 0, finish_reason: null }],
        })),
        '{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
        '[DONE]',
      ],
      stream: url => streamCompletions(model('openai-completions', url), context, { apiKey: 'test-key' }),
    },
    {
      api: 'anthropic-messages',
      events: pieces => [
        anthropicMessageStart,
        frame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'write', input: {} } }),
        ...pieces.map(piece => frame({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: piece } })),
        frame({ type: 'content_block_stop', index: 0 }),
        frame({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } }),
        frame({ type: 'message_stop' }),
      ],
      stream: url => streamAnthropic(model('anthropic-messages', url), context, { apiKey: 'test-key' }),
    },
    {
      api: 'openai-responses',
      events: (pieces, json) => {
        const item = { type: 'function_call', call_id: 'call_1', id: 'fc_1', name: 'write' }
        return [
          '{"type":"response.created","response":{"id":"resp_1"}}',
          JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } }),
          ...pieces.map(piece => JSON.stringify({ type: 'response.function_call_arguments.delta', output_index: 0, delta: piece })),
          JSON.stringify({ type: 'response.function_call_arguments.done', output_index: 0, arguments: json }),
          JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { ...item, arguments: json } }),
          JSON.stringify({ type: 'response.completed', response: {
            id: 'resp_1', status: 'completed', output: [], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
          } }),
        ]
      },
      stream: url => streamResponses(model('openai-responses', url), context, { apiKey: 'test-key' }),
    },
  ]

  it.each(protocols)('$api shows each delta as a growing partial and parses the complete arguments', async ({ events, stream }) => {
    const server = await mockServer([{ events: events(fragments, argsJson) }])
    const { partials, final } = await collect(stream(server.url))
    expect(partials).toHaveLength(fragments.length)
    // Every partial is a snapshot of the text read so far, never a value from later text.
    for (const partial of partials) {
      const content = (partial as { content?: unknown }).content
      if (content !== undefined) expect(args.content.startsWith(content as string)).toBe(true)
    }
    expect(final).toEqual(args)
  })

  // Re-parsing the accumulated JSON on every delta costs O(n²) for this stream: tens of seconds,
  // during which the event loop serves no other session. Read once per delta, it takes well under one.
  it.each(protocols)('$api streams a megabyte of arguments in linear time', async ({ events, stream }) => {
    const large = { file_path: 'notes.md', content: 'x'.repeat(1 << 20) }
    const largeJson = JSON.stringify(large)
    // 128-character pieces keep the scripted stream within the mock server's event budget.
    const pieces = largeJson.match(/.{1,128}/gs) ?? []
    const server = await mockServer([{ events: events(pieces, largeJson) }])
    const started = performance.now()
    const { partials, final } = await collect(stream(server.url))
    expect(performance.now() - started).toBeLessThan(15_000)
    expect(partials).toHaveLength(pieces.length)
    expect(final).toEqual(large)
  }, 30_000)
})
