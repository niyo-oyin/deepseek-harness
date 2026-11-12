import { describe, expect, it } from 'vitest'
import { EMPTY_DRAFT, draftOf, fieldsOf, type McpServerDraft } from '../src/client/mcp-entry.ts'

const NONE = new Set<string>()
const draft = (fields: Partial<McpServerDraft>): McpServerDraft => ({ ...EMPTY_DRAFT, ...fields })

describe('draftOf', () => {
  it('lays an entry out one argument, variable, and header per line', () => {
    expect(draftOf('github', {
      transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: '${credential:GITHUB_TOKEN}', DEBUG: '1' }, cwd: 'C:\\work',
    })).toEqual({
      name: 'github', transport: 'stdio', command: 'npx', args: '-y\n@modelcontextprotocol/server-github',
      env: 'GITHUB_TOKEN=${credential:GITHUB_TOKEN}\nDEBUG=1', cwd: 'C:\\work', url: '', headers: '',
    })
    expect(draftOf('remote', { transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } }))
      .toMatchObject({ transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: 'Authorization: Bearer x', command: '', args: '' })
  })
})

describe('fieldsOf', () => {
  it('reads a local command with its arguments and variables, and empties the HTTP fields', () => {
    expect(fieldsOf(draft({
      name: ' github ', command: ' npx ', args: '-y\n\n  @scope/server  \n', env: 'A=1\nB = two=2\n', cwd: ' C:\\work ',
      // Left over from switching the transport: not written for a local command.
      url: 'https://ignored.example', headers: 'not a pair',
    }), NONE)).toEqual({
      name: 'github',
      fields: {
        transport: 'stdio', command: 'npx', args: ['-y', '@scope/server'], env: { A: '1', B: 'two=2' }, cwd: 'C:\\work',
        url: '', headers: {},
      },
    })
  })

  it('reads an HTTP server with its headers, and empties the local-command fields', () => {
    expect(fieldsOf(draft({
      name: 'remote', transport: 'streamable-http', url: ' https://mcp.example.com/mcp ',
      headers: 'Authorization: Bearer ${credential:TOKEN}\nX-Trace:on',
      command: 'ignored', args: 'ignored', env: 'not a pair',
    }), NONE)).toEqual({
      name: 'remote',
      fields: {
        transport: 'streamable-http', command: '', args: [], env: {}, cwd: '',
        url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${credential:TOKEN}', 'X-Trace': 'on' },
      },
    })
  })

  it.each([
    [{ name: '' }, { kind: 'name' }],
    [{ name: 'has space', command: 'x' }, { kind: 'name' }],
    [{ name: 'x'.repeat(33), command: 'x' }, { kind: 'name' }],
    [{ name: 'taken', command: 'x' }, { kind: 'nameTaken' }],
    [{ name: 'local' }, { kind: 'command' }],
    [{ name: 'remote', transport: 'streamable-http' }, { kind: 'url' }],
    [{ name: 'local', command: 'x', env: 'A=1\nno separator' }, { kind: 'env', line: 'no separator' }],
    [{ name: 'local', command: 'x', env: '=value' }, { kind: 'env', line: '=value' }],
    [{ name: 'remote', transport: 'streamable-http', url: 'https://x', headers: 'Authorization Bearer' }, { kind: 'headers', line: 'Authorization Bearer' }],
  ] as const)('reports why %j cannot be written', (fields, problem) => {
    expect(fieldsOf(draft(fields), new Set(['taken']))).toEqual({ problem })
  })

  it('accepts a variable named like a field of the result', () => {
    // The pair parser's own result must not be confused with what the user typed.
    expect(fieldsOf(draft({ name: 'local', command: 'x', env: 'badLine=1\nvalues=2' }), NONE))
      .toMatchObject({ fields: { env: { badLine: '1', values: '2' } } })
  })
})
