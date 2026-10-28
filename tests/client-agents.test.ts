import type { AgentRow } from '../src/client/service/agents.types.ts'
import type { ConfigForm, ConfigFormSnapshot, JsonValue, SettingsPathOpView } from '../src/client/types/runtime.ts'
import { describe, expect, it } from 'vitest'
import { discoverAgentModels, removeAgent, saveAgent } from '../src/client/service/agents.ts'
import {
  draftOf,
  emptyDraft,
  mergeDiscovered,
  parseEnv,
  saveOpsOf,
  snapshotOf,
  validateDraft,
} from '../src/client/service/agents.utils.ts'

function section(user: JsonValue, base: JsonValue = { agents: {} }): ConfigFormSnapshot {
  const merged = { ...(base as any).agents, ...(user as any).agents }
  const value = {
    agents: Object.fromEntries(Object.entries(merged).map(([route, profile]) => [route, {
      args: [],
      env: {},
      models: [],
      discoverModels: true,
      permission: 'ask',
      systemPrompt: 'drop',
      showToolCalls: true,
      contextWindow: 200000,
      startupTimeoutMs: 60000,
      idleTimeoutMs: 600000,
      ...profile as object,
    }])),
  }
  return { status: 'ready', value: value as JsonValue, base, user, revision: 3, writable: true, mode: 'host' }
}

const USER = {
  agents: {
    'codex': { displayName: 'Codex', command: '/bin/codex-acp', args: ['--fast'], env: { OPENAI_API_KEY: 'sk-1' }, cwd: '/work', systemPrompt: 'forward' },
    'claude-code': { command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'], models: [{ id: 'sonnet', name: 'Sonnet' }] },
  },
}
const BASE = { agents: { gemini: { command: 'gemini', args: ['--experimental-acp'] } } }

function rowsOf(form: ConfigFormSnapshot): AgentRow[] {
  return snapshotOf(form).rows
}

describe('agent settings projection', () => {
  it('lists resolved agents and marks the ones the profile YAML declares', () => {
    const rows = rowsOf(section(USER, BASE))
    expect(rows.map(row => [row.route, row.inherited, row.user !== undefined])).toEqual([
      ['gemini', true, false],
      ['codex', false, true],
      ['claude-code', false, true],
    ])
    expect(rows[1]!.profile).toMatchObject({ displayName: 'Codex', command: '/bin/codex-acp', args: ['--fast'], permission: 'ask' })
  })

  it('round-trips a profile through the editor draft', () => {
    const codex = rowsOf(section(USER))[0]!
    const draft = draftOf(codex)
    expect(draft).toMatchObject({ originalRoute: 'codex', args: '--fast', env: 'OPENAI_API_KEY=sk-1', permission: 'ask' })
    const result = validateDraft({ ...draft, authMethod: ' api-key ', permission: 'read-only' }, rowsOf(section(USER)))
    expect(result).toEqual({
      ok: true,
      route: 'codex',
      profile: {
        cwd: '/work',
        systemPrompt: 'forward',
        displayName: 'Codex',
        command: '/bin/codex-acp',
        args: ['--fast'],
        env: { OPENAI_API_KEY: 'sk-1' },
        authMethod: 'api-key',
        permission: 'read-only',
      },
    })
  })

  it('drops cleared optional fields instead of storing empty values', () => {
    const rows = rowsOf(section(USER))
    const draft = { ...draftOf(rows[0]!), displayName: '', args: '', env: '\n', models: [] }
    const result = validateDraft(draft, rows)
    expect(result.ok && result.profile).toEqual({ cwd: '/work', systemPrompt: 'forward', command: '/bin/codex-acp', permission: 'ask' })
  })

  it('reports the first invalid field', () => {
    const rows = rowsOf(section(USER))
    const draft = { ...emptyDraft(), route: 'new', command: 'x' }
    expect(validateDraft({ ...draft, route: ' ' }, rows)).toEqual({ ok: false, issue: { key: 'routeRequired' } })
    expect(validateDraft({ ...draft, route: 'has space' }, rows)).toEqual({ ok: false, issue: { key: 'routeInvalid' } })
    expect(validateDraft({ ...draft, route: 'codex' }, rows)).toEqual({ ok: false, issue: { key: 'routeTaken', params: { route: 'codex' } } })
    expect(validateDraft({ ...draft, command: '  ' }, rows)).toEqual({ ok: false, issue: { key: 'commandRequired' } })
    expect(validateDraft({ ...draft, env: 'A=1\nbroken' }, rows)).toEqual({ ok: false, issue: { key: 'envInvalid', params: { line: 2 } } })
    expect(validateDraft({ ...draft, models: [{ id: ' ' }] }, rows)).toEqual({ ok: false, issue: { key: 'modelIdRequired' } })
    expect(validateDraft({ ...draft, models: [{ id: 'a' }, { id: 'a ' }] }, rows)).toEqual({ ok: false, issue: { key: 'modelIdDuplicate', params: { id: 'a' } } })
  })

  it('keeps everything after the first = in env values', () => {
    expect(parseEnv('TOKEN=a=b\n  \nEMPTY=')).toEqual({ ok: true, env: { TOKEN: 'a=b', EMPTY: '' } })
  })

  it('moves a renamed agent and appends only new discovered models', () => {
    expect(saveOpsOf('codex', 'codex-2', { command: 'x' })).toEqual([
      { op: 'unset', path: ['agents', 'codex'] },
      { op: 'set', path: ['agents', 'codex-2'], value: { command: 'x' } },
    ])
    expect(saveOpsOf(null, 'codex', { command: 'x' })).toHaveLength(1)
    expect(mergeDiscovered([{ id: 'sonnet', name: 'Mine' }], [{ id: 'sonnet', name: 'Sonnet' }, { id: 'opus', name: 'Opus' }, { id: 'haiku', name: 'haiku' }]))
      .toEqual([{ id: 'sonnet', name: 'Mine' }, { id: 'opus', name: 'Opus' }, { id: 'haiku' }])
  })
})

describe('agent settings service', () => {
  function form(answer: () => Promise<boolean>): ConfigForm & { ops: SettingsPathOpView[][] } {
    const ops: SettingsPathOpView[][] = []
    return {
      ops,
      getSnapshot: () => section(USER),
      subscribe: () => () => {},
      mutate: async (next) => {
        ops.push([...next])
        return answer()
      },
    }
  }

  it('writes saves and removals as atomic path mutations', async () => {
    const f = form(async () => true)
    expect(await saveAgent({ form: f, originalRoute: 'codex', route: 'codex-2', profile: { command: 'x' } })).toEqual({ ok: true })
    expect(await removeAgent({ form: f, route: 'claude-code' })).toEqual({ ok: true })
    expect(f.ops).toEqual([
      [{ op: 'unset', path: ['agents', 'codex'] }, { op: 'set', path: ['agents', 'codex-2'], value: { command: 'x' } }],
      [{ op: 'unset', path: ['agents', 'claude-code'] }],
    ])
  })

  it('separates refusals from transport failures', async () => {
    expect(await removeAgent({ form: form(async () => false), route: 'codex' })).toEqual({ ok: false })
    expect(await removeAgent({ form: form(async () => { throw new Error('offline') }), route: 'codex' })).toEqual({ ok: false, error: 'offline' })
  })

  it('discovers models through the llm-acp discovery', async () => {
    const llm = {
      discoverModels: async (ns: string, request: { provider?: string }) => ns === 'llm-acp-pro' && request.provider === 'codex'
        ? { ok: true as const, value: [{ id: 'gpt-5', name: 'GPT-5' }] }
        : { ok: false as const, error: { code: 'llm/model-discovery-rejected', message: `save ACP agent "${request.provider}" first` } },
    }
    expect(await discoverAgentModels({ llm, route: 'codex' })).toEqual({ ok: true, models: [{ id: 'gpt-5', name: 'GPT-5' }] })
    expect(await discoverAgentModels({ llm, route: 'draft' })).toEqual({ ok: false, error: 'save ACP agent "draft" first' })
  })
})

describe('enabled and icon fields', () => {
  it('carries enabled and icon through the draft and back into the saved profile', () => {
    const rows = rowsOf(section({
      agents: { codex: { displayName: 'Codex', command: '/bin/codex-acp', enabled: false, icon: 'codex' } },
    }))
    const row = rows.find(candidate => candidate.route === 'codex')!
    expect(row.profile.enabled).toBe(false)
    expect(row.profile.icon).toBe('codex')

    const draft = draftOf(row)
    expect(draft.enabled).toBe(false)
    expect(draft.icon).toBe('codex')

    const validation = validateDraft({ ...draft, enabled: true, icon: '🦀' }, rows)
    expect(validation.ok).toBe(true)
    if (!validation.ok)
      throw new Error('expected a valid draft')
    // Enabled is the schema default, so a true value is written as absence rather than noise.
    expect(validation.profile.enabled ?? true).toBe(true)
    expect(validation.profile.icon).toBe('🦀')
  })

  it('omits the icon key when the field is cleared, and writes enabled:false explicitly', () => {
    const rows = rowsOf(section({ agents: { codex: { command: '/bin/codex-acp', icon: 'codex' } } }))
    const draft = draftOf(rows[0]!)
    const validation = validateDraft({ ...draft, icon: '  ', enabled: false }, rows)
    if (!validation.ok)
      throw new Error('expected a valid draft')
    expect('icon' in validation.profile).toBe(false)
    expect(validation.profile.enabled).toBe(false)
  })

  it('does not drop an enabled/icon the editor never showed when saving another field', () => {
    const rows = rowsOf(section({ agents: { codex: { command: '/bin/codex-acp', enabled: false } } }))
    const draft = draftOf(rows[0]!)
    const validation = validateDraft({ ...draft, displayName: 'Renamed' }, rows)
    if (!validation.ok)
      throw new Error('expected a valid draft')
    expect(validation.profile.enabled).toBe(false)
  })

  it('treats an older profile without enabled as enabled', () => {
    const rows = rowsOf(section({ agents: { legacy: { command: '/bin/legacy', args: ['--acp'] } } }))
    expect(rows[0]!.profile.enabled).toBe(true)
    expect(draftOf(rows[0]!).enabled).toBe(true)
  })
})
