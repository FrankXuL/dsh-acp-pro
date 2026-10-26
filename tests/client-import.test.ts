import type { ConfigFormSnapshot, JsonValue } from '../src/client/types/runtime.ts'
import { describe, expect, it } from 'vitest'
import { importOpsOf, parseAgentImport, routeOf } from '../src/client/service/agent-import.utils.ts'
import { snapshotOf } from '../src/client/service/agents.utils.ts'

const PATH = '/opt/homebrew/bin:/usr/bin:/bin'

const ZED = JSON.stringify({
  default_mcp_settings: { use_idea_mcp: true },
  agent_servers: {
    'CodeBuddy Code': { command: 'codebuddy', args: ['--acp'], env: {} },
    'Trae': { command: 'traecli', args: ['--acp'] },
    'Claude': {
      command: 'npx',
      args: ['-y', '@agentclientprotocol/claude-agent-acp'],
      env: { PATH, CLAUDE_CODE_EXECUTABLE: '/Users/you/.local/bin/claude' },
    },
    'Codex': { command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp'], env: { PATH } },
  },
})

function rows(user: Record<string, JsonValue>) {
  const form: Pick<ConfigFormSnapshot, 'value' | 'user' | 'base' | 'writable'> = {
    value: { agents: Object.fromEntries(Object.entries(user).map(([route, profile]) => [route, { args: [], env: {}, models: [], permission: 'ask', ...(profile as object) }])) },
    user: { agents: user },
    base: { agents: {} },
    writable: true,
  }
  return snapshotOf(form).rows
}

describe('agent import', () => {
  it('turns client display names into route ids', () => {
    expect(routeOf('CodeBuddy Code')).toBe('codebuddy-code')
    expect(routeOf('  Claude (ACP)!  ')).toBe('claude-acp')
    expect(routeOf('通义')).toBe('')
  })

  it('imports Zed agent_servers and ignores unrelated keys', () => {
    const result = parseAgentImport(ZED, [])
    expect(result.ok).toBe(true)
    if (!result.ok)
      return
    expect(result.skipped).toEqual([])
    expect(result.entries.map(entry => [entry.name, entry.route, entry.replaces])).toEqual([
      ['CodeBuddy Code', 'codebuddy-code', false],
      ['Trae', 'trae', false],
      ['Claude', 'claude', false],
      ['Codex', 'codex', false],
    ])
    expect(result.entries[0]!.profile).toEqual({ permission: 'ask', displayName: 'CodeBuddy Code', command: 'codebuddy', args: ['--acp'] })
    expect(result.entries[2]!.profile).toMatchObject({
      displayName: 'Claude',
      command: 'npx',
      env: { PATH, CLAUDE_CODE_EXECUTABLE: '/Users/you/.local/bin/claude' },
    })
    expect(importOpsOf(result.entries).map(op => op.path)).toEqual([
      ['agents', 'codebuddy-code'],
      ['agents', 'trae'],
      ['agents', 'claude'],
      ['agents', 'codex'],
    ])
  })

  it('replaces the launch fields of an existing route and keeps its other settings', () => {
    const existing = rows({ codex: { displayName: 'Codex (ACP)', command: 'node', args: ['old.js'], permission: 'read-only', authMethod: 'chat-gpt', models: [{ id: 'gpt-5' }] } })
    const result = parseAgentImport(ZED, existing)
    const codex = result.ok ? result.entries.find(entry => entry.route === 'codex') : undefined
    expect(codex).toEqual({
      name: 'Codex',
      route: 'codex',
      replaces: true,
      profile: { permission: 'read-only', authMethod: 'chat-gpt', models: [{ id: 'gpt-5' }], displayName: 'Codex', command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp'], env: { PATH } },
    })
  })

  it('accepts bare maps and this plugin\'s agents section, de-duplicating routes', () => {
    const bare = parseAgentImport(JSON.stringify({ 'My Agent': { command: 'a' }, 'my-agent': { command: 'b' }, '通义': { command: 'c' } }), [])
    expect(bare.ok && bare.entries.map(entry => entry.route)).toEqual(['my-agent', 'my-agent-2', 'agent'])
    const own = parseAgentImport(JSON.stringify({ agents: { MyAgent: { displayName: 'Mine', command: 'x', permission: 'allow' } } }), [])
    expect(own.ok && own.entries.map(entry => [entry.route, entry.profile.displayName])).toEqual([['MyAgent', 'Mine']])
  })

  it('reports invalid JSON and skips malformed servers', () => {
    expect(parseAgentImport('{', [])).toMatchObject({ ok: false })
    expect(parseAgentImport('[]', [])).toEqual({ ok: false, error: 'expected a JSON object' })
    const result = parseAgentImport(JSON.stringify({ agent_servers: {
      'Gemini': {},
      'Bad args': { command: 'x', args: '--acp' },
      'Bad env': { command: 'x', env: { A: 1 } },
      'Ok': { command: ' ok ' },
    } }), [])
    expect(result).toEqual({
      ok: true,
      entries: [{ name: 'Ok', route: 'ok', replaces: false, profile: { permission: 'ask', displayName: 'Ok', command: 'ok' } }],
      skipped: [
        { name: 'Gemini', reason: 'importMissingCommand' },
        { name: 'Bad args', reason: 'importBadArgs' },
        { name: 'Bad env', reason: 'importBadEnv' },
      ],
    })
  })
})
