import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AcpAgentProfile, PermissionPolicy } from '../src/shared/types.ts'
import type { AdapterHost, ApprovalOutcome } from '../src/host/types/index.ts'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentsOf, Config } from '../src/host/config/schema.ts'
import { AcpAgentProcess } from '../src/host/service/acp-agent.ts'
import { AcpAdapter } from '../src/host/service/acp-adapter.ts'
import { ContextWindows, inferContextWindow } from '../src/host/service/context-windows.ts'
import { PromptCapabilitiesCache } from '../src/host/service/prompt-capabilities.ts'
import { FileAcpBindingStore, MemoryAcpBindingStore } from '../src/host/domain/binding-store.ts'

const ROUTE = 'mock-acp'
const MOCK = join(import.meta.dirname, 'fixtures', 'mock-agent.mjs')
const WORKSPACE = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-acp-')))

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

function profile(overrides: Partial<AcpAgentProfile> = {}): AcpAgentProfile {
  return agentsOf(Config({ agents: { [ROUTE]: { command: process.execPath, args: [MOCK], displayName: 'Mock ACP', ...overrides } } } as any))[ROUTE]!
}

function host(approve?: (toolName: string) => ApprovalOutcome, withAgent = true, readImage?: AdapterHost['readImage']): AdapterHost {
  return {
    logger: silentLogger,
    agentOf: () => withAgent ? { session: { header: { cwd: WORKSPACE } } } : undefined,
    approve: approve === undefined ? undefined : async request => approve(request.toolName),
    readImage,
  }
}

let counter = 0
function user(text: string): any {
  return { id: `m${++counter}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}
function assistant(text: string, provider = ROUTE): any {
  return { id: `m${++counter}`, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider, model: 'x' } }
}

function request(messages: any[], extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: ROUTE, model: 'mock-smart', messages, sessionId: 'dsh-1' as any, ...extra }
}

async function run(adapter: AcpAdapter, options: GenerateOptions) {
  const chunks: StreamChunk[] = []
  const assembler = new BlockAssembler()
  for await (const chunk of adapter.stream(options)) {
    chunks.push(chunk)
    assembler.push(chunk)
  }
  const blocks = assembler.blocks()
  const text = blocks.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('')
  const reasoning = blocks.filter(block => block.type === 'reasoning').map(block => (block as { text: string }).text).join('')
  const finish = chunks.at(-1)
  return { chunks, text, reasoning, finish }
}

const adapters: AcpAdapter[] = []
function create(p: AcpAgentProfile = profile(), h: AdapterHost = host(), capabilities?: PromptCapabilitiesCache): AcpAdapter {
  const adapter = new AcpAdapter(h, () => new Map([[ROUTE, p]]), new ContextWindows(), capabilities)
  adapters.push(adapter)
  return adapter
}

const readsImages: AdapterHost['readImage'] = async () => ({ data: new Uint8Array([104, 105]), mediaType: 'image/png', width: 8, height: 8 })

function imageHost(): AdapterHost {
  return host(undefined, true, readsImages)
}

afterEach(() => {
  for (const adapter of adapters.splice(0))
    adapter.dispose()
})

describe('acp adapter', () => {
  it('discovers models advertised by the ACP agent', async () => {
    const models = await create().listModels(ROUTE)
    expect(models.map(model => model.id)).toEqual(['default', 'mock-fast', 'mock-smart'])
    expect(models[2]!.name).toBe('Mock Smart')
  })

  it('prefers configured models over discovery', async () => {
    const models = await create(profile({ models: [{ id: 'mock-fast', name: 'Fast' }] })).listModels(ROUTE)
    expect(models).toEqual([{ provider: ROUTE, id: 'mock-fast', name: 'Fast', inputModalities: ['text'] }])
  })

  it('reports the agent-advertised models for settings even when models are declared', async () => {
    const adapter = create(profile({ models: [{ id: 'mock-fast', name: 'Fast' }], discoverModels: false }))
    const found = await adapter.advertisedModels(ROUTE)
    expect(found.map(model => model.id)).toEqual(['mock-fast', 'mock-smart'])
    await expect(adapter.advertisedModels('missing')).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
  })

  it('streams text, reasoning, usage and finish in contract order', async () => {
    // Flattened tool rows are opt-in since records render cards by default.
    const adapter = create(profile({ showToolCalls: true }))
    const first = user('hello')
    const result = await run(adapter, request([first]))
    expect(result.text).toBe(`echo[mock-smart|turn 1|cwd ${WORKSPACE}]: hello`)
    expect(result.reasoning).toContain('thinking')
    expect(result.reasoning).toContain('▸ [read] Read README.md')
    expect(result.reasoning).toContain('Read README.md: completed')
    const types = result.chunks.map(chunk => chunk.type)
    expect(types.indexOf('usage')).toBe(types.length - 2)
    expect(result.finish).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(result.chunks.find(chunk => chunk.type === 'usage')).toMatchObject({ usage: { inputTokens: 5, outputTokens: 10 } })
  })

  it('reuses the ACP session and sends only new user input', async () => {
    const adapter = create()
    const first = user('hello')
    await run(adapter, request([first]))
    const second = await run(adapter, request([first, assistant('reply'), user('again')]))
    expect(second.text).toBe(`echo[mock-smart|turn 2|cwd ${WORKSPACE}]: again`)
    expect(second.chunks.find(chunk => chunk.type === 'usage')).toMatchObject({ usage: { inputTokens: 5, outputTokens: 10 } })
  })

  it('rebuilds a fresh session with flattened history when history diverges', async () => {
    const adapter = create()
    await run(adapter, request([user('hello')]))
    const result = await run(adapter, request([user('earlier'), assistant('from deepseek', 'deepseek-official'), user('now')]))
    expect(result.text).toContain('turn 1')
    expect(result.text).toContain('<conversation_history>')
    expect(result.text).toContain('User: earlier')
    expect(result.text).toContain('Assistant: from deepseek')
    expect(result.text.endsWith('|now')).toBe(true)
  })

  it('forwards the system prompt only when configured', async () => {
    const system = { id: 'sys', role: 'system', content: [{ type: 'text', text: 'be terse' }], source: { kind: 'system-prompt' } } as any
    const dropped = await run(create(), request([system, user('hi')]))
    expect(dropped.text).not.toContain('be terse')
    const forwarded = await run(create(profile({ systemPrompt: 'forward' })), request([system, user('hi')]))
    expect(forwarded.text).toContain('<system_instructions>\nbe terse\n</system_instructions>')
  })

  it.each<[PermissionPolicy, string]>([
    ['allow', 'permission:yes'],
    ['reject', 'permission:no'],
    ['read-only', 'permission:no'],
  ])('answers permission requests with policy %s', async (permission, expected) => {
    const result = await run(create(profile({ permission })), request([user('please edit')]))
    expect(result.text).toBe(expected)
  })

  it('routes ask policy through the dsh approval service', async () => {
    const asked: string[] = []
    const approving = create(profile({ permission: 'ask' }), host((toolName) => {
      asked.push(toolName)
      return 'allowed-once'
    }))
    expect((await run(approving, request([user('please edit')]))).text).toBe('permission:yes')
    expect(asked).toEqual([`${ROUTE} · edit`])
    const denying = create(profile({ permission: 'ask' }), host(() => 'rejected'))
    expect((await run(denying, request([user('please edit')]))).text).toBe('permission:no')
  })

  it('falls back to read-only when no approval answerer exists', async () => {
    const result = await run(create(profile({ permission: 'ask' }), host(undefined, false)), request([user('please edit')]))
    expect(result.text).toBe('permission:no')
  })

  it('mirrors permission requests and their outcomes into the record sink', async () => {
    const seen: string[] = []
    const base = host(() => 'allowed-once')
    const recorder: AdapterHost = {
      ...base,
      startRecording: () => ({
        push: () => {},
        permission: (request) => {
          seen.push(`start:${request.toolCall.title}:${request.options.length}`)
          return outcome => seen.push(`end:${outcome}`)
        },
      }),
    }
    const result = await run(create(profile({ permission: 'ask' }), recorder), request([user('please edit')]))
    expect(result.text).toBe('permission:yes')
    expect(seen).toEqual(['start:Edit config.json:2', 'end:allowed'])
  })

  it('cancels the ACP turn when the request aborts', async () => {
    const controller = new AbortController()
    const chunks: StreamChunk[] = []
    const assembler = new BlockAssembler()
    for await (const chunk of create().stream(request([user('slow please')], { signal: controller.signal }))) {
      chunks.push(chunk)
      assembler.push(chunk)
      // Abort only after the fixture's first text delta: a fixed delay races process startup.
      if (chunk.type === 'text-delta') controller.abort()
    }
    const text = assembler.blocks().filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('')
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
    expect(text.length).toBeGreaterThan(0)
  })

  it('keeps reporting the abort when a normal response arrives inside the cancel grace window', async () => {
    // A real agent can settle its prompt as end_turn after session/cancel. That late answer
    // must not turn the user's stop into an apparent success.
    const controller = new AbortController()
    const adapter = create(profile({ env: { MOCK_CANCEL_RACE_DELAY_MS: '50' } }))
    const pending = run(adapter, request([user('cancel-race')], { signal: controller.signal }))
    setTimeout(() => controller.abort(), 250)
    const result = await pending
    expect(result.finish).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
  })

  it('clears a durable pending marker when the request aborts before prompt submission', async () => {
    const store = new MemoryAcpBindingStore()
    const save = store.save.bind(store)
    let enteredPendingSave!: () => void
    const pendingSaveEntered = new Promise<void>((resolve) => { enteredPendingSave = resolve })
    let releasePendingSave!: () => void
    const pendingSaveGate = new Promise<void>((resolve) => { releasePendingSave = resolve })
    const bindingStore = {
      load: store.load.bind(store),
      remove: store.remove.bind(store),
      save: async (record: Parameters<typeof save>[0]) => {
        if (record.pending !== undefined) {
          enteredPendingSave()
          await pendingSaveGate
        }
        await save(record)
      },
    }
    const adapter = create(profile(), { ...host(), bindingStore })
    const prompt = vi.spyOn(AcpAgentProcess.prototype, 'prompt')
    const controller = new AbortController()
    try {
      const result = run(adapter, request([user('abort before submit')], { signal: controller.signal }))
      await pendingSaveEntered
      controller.abort()
      releasePendingSave()

      expect((await result).finish).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
      expect(prompt).not.toHaveBeenCalled()
      expect((await store.load(ROUTE, 'dsh-1'))?.pending).toBeUndefined()
    }
    finally {
      releasePendingSave()
      prompt.mockRestore()
    }
  })

  it('exposes grouped configuration, commands, and both ACP mode forms', async () => {
    const adapter = create(profile({ env: {
      MOCK_EXTRA_CONFIG: '1',
      MOCK_MODE_CONFIG: '1',
      MOCK_AVAILABLE_COMMANDS: '1',
    } }))
    await run(adapter, request([user('hello')]))

    const initial = (await adapter.getSessionSnapshots('dsh-1'))[0]!
    expect(initial.availableCommands).toEqual([{ name: 'review', description: 'Review this change', inputHint: 'optional focus' }])
    expect(initial.configOptions.find(option => option.id === 'style')).toMatchObject({
      type: 'select',
      currentValue: 'balanced',
      options: [{ group: 'tone', name: 'Tone', options: [{ value: 'balanced' }, { value: 'concise', description: 'Short answers' }] }],
    })

    const configured = await adapter.setSessionConfig(ROUTE, 'dsh-1', 'style', 'concise', initial.revision)
    expect(configured.configOptions.find(option => option.id === 'style')?.currentValue).toBe('concise')
    const mode = await adapter.setSessionMode(ROUTE, 'dsh-1', 'plan', configured.revision)
    expect(mode.configOptions.find(option => option.id === 'mode-config')?.currentValue).toBe('plan')
    await expect(adapter.setSessionConfig(ROUTE, 'dsh-1', 'effort', 'medium', mode.revision)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })

    const explicit = create(profile({ env: { MOCK_SUPPORT_MODES: '1' } }))
    await run(explicit, request([user('hello')]))
    const explicitInitial = (await explicit.getSessionSnapshots('dsh-1'))[0]!
    expect(explicitInitial).toMatchObject({ currentModeId: 'standard', availableModes: [{ id: 'standard' }, { id: 'plan', description: 'Plan before acting' }] })
    expect((await explicit.setSessionMode(ROUTE, 'dsh-1', 'plan', explicitInitial.revision)).currentModeId).toBe('plan')
  })

  it('retains session state updates sent before new-session activation', async () => {
    const adapter = create(profile({ env: {
      MOCK_EXTRA_CONFIG: '1',
      MOCK_SUPPORT_MODES: '1',
      MOCK_NEW_UPDATE_BEFORE_RESPONSE: '1',
      MOCK_UPDATE_DURING_SELECT: '1',
    } }))
    await run(adapter, request([user('default without model selection')], { model: 'default' }))
    const early = (await adapter.getSessionSnapshots('dsh-1'))[0]!
    expect(early.configOptions.find(option => option.id === 'style')?.currentValue).toBe('concise')
    expect(early.currentModeId).toBe('plan')
    expect(early.availableCommands).toEqual([{ name: 'before-response', description: 'Sent before session/new returns', inputHint: 'early' }])

    await run(adapter, request([user('select smart model')], { model: 'mock-smart', sessionId: 'dsh-select' as any }))
    const selected = (await adapter.getSessionSnapshots('dsh-select'))[0]!
    expect(selected.currentModeId).toBe('plan')
    expect(selected.availableCommands).toEqual([{ name: 'during-select', description: 'Sent during initial model selection', inputHint: 'selected' }])
  })

  it('recognizes native model and effort IDs without categories', async () => {
    const adapter = create(profile({ env: {
      MOCK_NATIVE_IDS_NO_CATEGORY: '1',
      MOCK_UNCATEGORIZED_CONFIG: '1',
    } }))
    const history: any[] = [user('hello')]
    const first = await run(adapter, request(history, { model: 'default' }))
    const initial = (await adapter.getSessionSnapshots('dsh-1'))[0]!
    expect(initial.configOptions.find(option => option.id === 'model')?.category).toBeUndefined()
    expect(initial.configOptions.find(option => option.id === 'thought_level')?.category).toBeUndefined()
    expect((await adapter.listModels(ROUTE)).map(model => model.id)).toEqual(['default', 'mock-fast', 'mock-smart'])
    expect((await adapter.resolveModel(ROUTE, 'mock-smart')).reasoning).toMatchObject({
      efforts: expect.arrayContaining([{ id: 'max', name: 'Max' }]),
      defaultEffort: 'high',
    })

    const updated = await adapter.setSessionConfig(ROUTE, 'dsh-1', 'custom', 'two', initial.revision)
    expect(updated.configOptions.find(option => option.id === 'custom')?.currentValue).toBe('two')
    await expect(adapter.setSessionConfig(ROUTE, 'dsh-1', 'model', 'mock-smart', updated.revision)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(adapter.setSessionConfig(ROUTE, 'dsh-1', 'thought_level', 'high', updated.revision)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })

    history.push(assistant(first.text), user('switch native settings'))
    const switched = await run(adapter, request(history, { model: 'mock-smart', reasoningEffort: 'max' as any }))
    expect(switched.text, JSON.stringify(switched)).toContain('echo[mock-smart|turn 2')
    const final = (await adapter.getSessionSnapshots('dsh-1'))[0]!
    expect(final.configOptions.find(option => option.id === 'model')?.currentValue).toBe('mock-smart')
    expect(final.configOptions.find(option => option.id === 'thought_level')?.currentValue).toBe('max')
  })

  it('rejects the second concurrent session setting made from a stale snapshot', async () => {
    const traceFile = join(mkdtempSync(join(tmpdir(), 'dsh-acp-config-trace-')), 'config.txt')
    const adapter = create(profile({ env: {
      MOCK_EXTRA_CONFIG: '1',
      MOCK_MODE_CONFIG: '1',
      MOCK_CONFIG_TRACE: traceFile,
    } }))
    await run(adapter, request([user('hello')]))
    const snapshot = (await adapter.getSessionSnapshots('dsh-1'))[0]!

    const results = await Promise.allSettled([
      adapter.setSessionConfig(ROUTE, 'dsh-1', 'style', 'concise', snapshot.revision),
      adapter.setSessionConfig(ROUTE, 'dsh-1', 'mode-config', 'plan', snapshot.revision),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'INVALID_REQUEST' } })
    expect(readFileSync(traceFile, 'utf8').split('\n').filter(line => line.startsWith('style:') || line.startsWith('mode-config:'))).toHaveLength(1)
  })

  it('applies a queued setting after a turn without treating turn revisions as stale', async () => {
    const adapter = create(profile({ env: { MOCK_EXTRA_CONFIG: '1', MOCK_PROMPT_DELAY_MS: '180' } }))
    const prompt = vi.spyOn(AcpAgentProcess.prototype, 'prompt')
    try {
      const running = run(adapter, request([user('delay while setting')]))
      await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
      const snapshot = (await adapter.getSessionSnapshots('dsh-1'))[0]!
      expect(snapshot.turnState).toBe('running')
      const setting = adapter.setSessionConfig(ROUTE, 'dsh-1', 'style', 'concise', snapshot.revision)

      await running
      expect((await setting).configOptions.find(option => option.id === 'style')?.currentValue).toBe('concise')
    }
    finally {
      prompt.mockRestore()
    }
  })

  it('serializes prompts per conversation while another conversation can finish', async () => {
    const adapter = create(profile({ env: { MOCK_PROMPT_DELAY_MS: '500' } }))
    const prompt = vi.spyOn(AcpAgentProcess.prototype, 'prompt')
    const firstUser = user('delay first conversation')
    let firstDone = false
    try {
      const first = run(adapter, request([firstUser], { sessionId: 'dsh-slow' as any })).finally(() => { firstDone = true })
      await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
      const next = run(adapter, request([firstUser, assistant('prior answer'), user('next')], { sessionId: 'dsh-slow' as any }))
      const independent = await run(adapter, request([user('other conversation')], { sessionId: 'dsh-other' as any }))
      expect(independent.text).toContain('turn 1')
      expect(firstDone).toBe(false)

      expect((await first).text).toContain('turn 1')
      expect((await next).text).toContain('turn 2')
    }
    finally {
      prompt.mockRestore()
    }
  })

  it('keeps an interrupted turn blocked across adapter recreation until reset barriers its partial output', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-acp-binding-'))
    const store = new FileAcpBindingStore(join(directory, 'bindings'))
    const effectFile = join(directory, 'effects.txt')
    const p = profile({ env: {
      MOCK_PROMPT_DELAY_MS: '25',
      MOCK_CRASH_AFTER_SIDE_EFFECT: '1',
      MOCK_SIDE_EFFECT_FILE: effectFile,
    } })
    const firstAdapter = create(p, { ...host(), bindingStore: store })
    const abandoned = user('delay crash-after-side-effect')
    expect((await run(firstAdapter, request([abandoned]))).finish).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT' } },
    })
    expect((await store.load(ROUTE, 'dsh-1'))?.pending?.messageIds).toContain(abandoned.id)
    firstAdapter.dispose()

    const restarted = create(p, { ...host(), bindingStore: store })
    expect((await restarted.getSessionSnapshots('dsh-1'))[0]).toMatchObject({ turnState: 'unknown' })
    expect((await run(restarted, request([abandoned]))).finish).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST' } },
    })
    expect(readFileSync(effectFile, 'utf8').trim().split('\n')).toHaveLength(1)

    await restarted.resetSession(ROUTE, 'dsh-1')
    const partial = assistant('partial output from the abandoned turn')
    const fresh = user('probe fresh input')
    const recovered = await run(restarted, request([abandoned, partial, fresh]))
    expect(recovered.text).toBe('effort:high|images:|probe fresh input')
    expect((await store.load(ROUTE, 'dsh-1'))?.replayBarrierIds).toEqual(expect.arrayContaining([abandoned.id, partial.id]))
  })

  it('serializes a late timeout settlement and reset so reset remains authoritative', async () => {
    const store = new MemoryAcpBindingStore()
    const save = store.save.bind(store)
    let enteredSettlementSave!: () => void
    const settlementSaveEntered = new Promise<void>((resolve) => { enteredSettlementSave = resolve })
    let releaseSettlementSave!: () => void
    const settlementSaveGate = new Promise<void>((resolve) => { releaseSettlementSave = resolve })
    let failed = false
    const bindingStore = {
      load: store.load.bind(store),
      remove: store.remove.bind(store),
      save: async (record: Parameters<typeof save>[0]) => {
        if (!failed && record.pending === undefined && record.consumedIds.length > 0) {
          failed = true
          enteredSettlementSave()
          await settlementSaveGate
          throw new Error('injected settlement write failure')
        }
        await save(record)
      },
    }
    const adapter = create(profile({ idleTimeoutMs: 50, env: { MOCK_PROMPT_DELAY_MS: '220' } }), { ...host(), bindingStore })
    const abandoned = user('delay probe settle')
    try {
      expect((await run(adapter, request([abandoned]))).finish).toMatchObject({
        type: 'finish', reason: { kind: 'error', failure: { code: 'TIMEOUT' } },
      })
      await settlementSaveEntered
      let resetDone = false
      const resetting = adapter.resetSession(ROUTE, 'dsh-1').then(() => { resetDone = true })
      await Promise.resolve()
      expect(resetDone).toBe(false)

      releaseSettlementSave()
      await resetting
      expect(await store.load(ROUTE, 'dsh-1')).toMatchObject({ needsFreshInput: true, replayBarrierIds: [abandoned.id] })
      const partial = assistant('partial output before timeout')
      const fresh = user('probe fresh after timeout')
      const recovered = await run(adapter, request([abandoned, partial, fresh]))
      expect(recovered.text).toBe('effort:high|images:|probe fresh after timeout')
      expect((await store.load(ROUTE, 'dsh-1'))?.replayBarrierIds).toEqual(expect.arrayContaining([abandoned.id, partial.id]))
    }
    finally {
      releaseSettlementSave()
    }
  })

  it('loads a session without replaying usage when its saved baseline is absent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-acp-load-'))
    const store = new FileAcpBindingStore(join(directory, 'bindings'))
    const p = profile({ env: {
      MOCK_SUPPORT_LOAD: '1',
      MOCK_SESSION_STATE_FILE: join(directory, 'agent-sessions.json'),
    } })
    const firstAdapter = create(p, { ...host(), bindingStore: store })
    const first = user('probe initial baseline')
    const initial = await run(firstAdapter, request([first]))
    expect(initial.chunks.some(chunk => chunk.type === 'usage')).toBe(true)
    const record = await store.load(ROUTE, 'dsh-1')
    expect(record).toBeDefined()
    delete record!.usage
    await store.save(record!)
    firstAdapter.dispose()

    const restarted = create(p, { ...host(), bindingStore: store })
    const loaded = (await restarted.getSessionSnapshots('dsh-1'))[0]!
    expect(loaded.recovery).toBe('loaded')
    const second = user('probe after load')
    const firstAssistant = assistant(initial.text)
    const result = await run(restarted, request([first, firstAssistant, second]))
    expect(result.chunks.some(chunk => chunk.type === 'usage')).toBe(false)
    const third = user('probe after baseline')
    const secondAssistant = assistant(result.text)
    const next = await run(restarted, request([first, firstAssistant, second, secondAssistant, third]))
    expect(next.chunks.find(chunk => chunk.type === 'usage')).toMatchObject({ usage: { inputTokens: 'probe after baseline'.length, outputTokens: 10 } })
  })

  it('keeps session updates emitted while selecting a model after load', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-acp-load-select-'))
    const store = new FileAcpBindingStore(join(directory, 'bindings'))
    const loadConfigTrace = join(directory, 'load-config.json')
    const p = profile({ showToolCalls: true, env: {
      MOCK_SUPPORT_LOAD: '1',
      MOCK_SESSION_STATE_FILE: join(directory, 'agent-sessions.json'),
      MOCK_LOAD_CONFIG: '1',
      MOCK_LOAD_CONFIG_TRACE: loadConfigTrace,
      MOCK_LOAD_COMMANDS: '1',
      MOCK_UPDATE_DURING_SELECT: '1',
    } })
    const firstAdapter = create(p, { ...host(), bindingStore: store })
    const first = user('persist before model change')
    const initial = await run(firstAdapter, request([first], { model: 'mock-fast' }))
    const beforeLoad = await store.load(ROUTE, 'dsh-1')
    expect(initial.text).toContain('echo[mock-fast|turn 1')
    expect(beforeLoad?.model).toBe('mock-fast')
    firstAdapter.dispose()

    const restarted = create(p, { ...host(), bindingStore: store })
    const next = user('select model after load')
    const result = await run(restarted, request([first, assistant(initial.text), next], { model: 'mock-smart', reasoningEffort: 'medium' as any }))
    const snapshot = (await restarted.getSessionSnapshots('dsh-1'))[0]!
    const loadOptions = JSON.parse(readFileSync(loadConfigTrace, 'utf8')) as Array<{ id: string, currentValue?: string }>

    expect(loadOptions.find(option => option.id === 'model')?.currentValue).toBe('mock-fast')
    expect(loadOptions.find(option => option.id === 'effort')?.currentValue).toBe('medium')
    expect(snapshot.recovery).toBe('loaded')
    expect(snapshot.configOptions.find(option => option.id === 'model')?.currentValue).toBe('mock-smart')
    expect(snapshot.configOptions.find(option => option.id === 'effort')?.currentValue).toBe('medium')
    expect(snapshot.currentModeId).toBe('plan')
    expect(snapshot.availableCommands).toEqual([{ name: 'during-select', description: 'Sent during initial model selection', inputHint: 'selected' }])
    expect(snapshot.revision).toBe(beforeLoad!.revision + 7)
    expect(result.text).toContain('echo[mock-smart|turn 2')
    expect(result.text).toContain('select model after load')
    expect(result.text).not.toContain('persist before model change')
    expect(result.reasoning.match(/▸ \[read\] Read README\.md/g)).toHaveLength(1)
  })

  it('does not issue session/load unless the agent explicitly advertises it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-acp-no-load-'))
    const store = new FileAcpBindingStore(join(directory, 'bindings'))
    const loadMarker = join(directory, 'load-called.txt')
    const p = profile({ env: {
      MOCK_SESSION_STATE_FILE: join(directory, 'agent-sessions.json'),
      MOCK_LOAD_MARKER: loadMarker,
    } })
    const first = create(p, { ...host(), bindingStore: store })
    await run(first, request([user('persist without load support')]))
    first.dispose()

    const restarted = create(p, { ...host(), bindingStore: store })
    expect((await restarted.getSessionSnapshots('dsh-1'))[0]?.recovery).toBe('new')
    expect(() => readFileSync(loadMarker, 'utf8')).toThrow()
  })

  it('cancels load-time permission requests without entering profile policy', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-acp-load-permission-'))
    const store = new FileAcpBindingStore(join(directory, 'bindings'))
    const resultFile = join(directory, 'load-permission.json')
    const p = profile({ env: {
      MOCK_SUPPORT_LOAD: '1',
      MOCK_SESSION_STATE_FILE: join(directory, 'agent-sessions.json'),
      MOCK_LOAD_PERMISSION: '1',
      MOCK_LOAD_PERMISSION_RESULT: resultFile,
    } })
    let approvals = 0
    const h = host(() => { approvals++; return 'allowed-once' })
    h.bindingStore = store
    await run(create(p, h), request([user('create persisted session')]))

    const restarted = create(p, h)
    expect((await restarted.getSessionSnapshots('dsh-1'))[0]?.recovery).toBe('loaded')
    expect(JSON.parse(readFileSync(resultFile, 'utf8'))).toEqual({ outcome: 'cancelled' })
    expect(approvals).toBe(0)
  })

  it('keeps same ACP session IDs isolated across provider permission turns', async () => {
    const fixedEnv = { MOCK_FIXED_SESSION_ID: 'shared-acp-session' }
    const profiles = new Map(Object.entries(agentsOf(Config({ agents: {
      'mock-a': { command: process.execPath, args: [MOCK], displayName: 'Mock A', permission: 'ask', env: fixedEnv },
      'mock-b': { command: process.execPath, args: [MOCK], displayName: 'Mock B', permission: 'ask', env: fixedEnv },
    } } as any))))
    let routeARequested!: () => void
    const routeARequest = new Promise<void>((resolve) => { routeARequested = resolve })
    let finishRouteA!: (outcome: ApprovalOutcome) => void
    const routeAApproval = new Promise<ApprovalOutcome>((resolve) => { finishRouteA = resolve })
    const approvals: string[] = []
    const records = new Map<string, string[]>()
    const h = host()
    h.approve = async ({ toolName }) => {
      approvals.push(toolName)
      if (toolName.startsWith('mock-a')) {
        routeARequested()
        return routeAApproval
      }
      return 'allowed-once'
    }
    h.startRecording = (dshSessionId) => {
      const events = records.get(dshSessionId ?? '') ?? []
      records.set(dshSessionId ?? '', events)
      return {
        push: () => {},
        permission: () => {
          events.push('pending')
          return outcome => events.push(outcome)
        },
      }
    }
    const adapter = new AcpAdapter(h, () => profiles)
    adapters.push(adapter)

    const first = run(adapter, request([user('please edit')], { provider: 'mock-a', sessionId: 'dsh-a' as any }))
    await routeARequest
    const second = await run(adapter, request([user('please edit')], { provider: 'mock-b', sessionId: 'dsh-b' as any }))
    expect(second.text).toBe('permission:yes')
    expect(records.get('dsh-a')).toEqual(['pending'])
    expect(records.get('dsh-b')).toEqual(['pending', 'allowed'])

    finishRouteA('rejected')
    expect((await first).text).toBe('permission:no')
    expect(records.get('dsh-a')).toEqual(['pending', 'rejected'])
    expect(approvals).toEqual(['mock-a · edit', 'mock-b · edit'])
  })

  it('aborts an active approval when the adapter is disposed', async () => {
    let approvalStarted!: () => void
    const started = new Promise<void>((resolve) => { approvalStarted = resolve })
    let approvalAborted = false
    let approvalSignal: AbortSignal | undefined
    let adapter!: AcpAdapter
    const h = host()
    h.approve = ({ signal }) => new Promise<ApprovalOutcome>((resolve) => {
      approvalSignal = signal
      approvalStarted()
      signal?.addEventListener('abort', () => {
        approvalAborted = true
        resolve('cancelled')
      }, { once: true })
    })
    adapter = create(profile({ permission: 'ask' }), h)
    const pending = run(adapter, request([user('please edit')]))
    await started
    const activeTurn = [...(adapter as any).turns.values()].flatMap((turns: Map<string, { controller: AbortController }>) => [...turns.values()])[0]
    expect(activeTurn).toBeDefined()
    expect(approvalSignal).toBe(activeTurn?.controller.signal)
    adapter.dispose()
    expect(approvalSignal?.aborted).toBe(true)

    await pending
    expect(approvalAborted).toBe(true)
  })

  it('cancels permission requests that arrive after the ACP prompt response', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-acp-late-permission-'))
    const resultFile = join(directory, 'permission.json')
    const store = new MemoryAcpBindingStore()
    const save = store.save.bind(store)
    let enteredSettlementSave!: () => void
    const settlementSaveEntered = new Promise<void>((resolve) => { enteredSettlementSave = resolve })
    let releaseSettlementSave!: () => void
    const settlementSaveGate = new Promise<void>((resolve) => { releaseSettlementSave = resolve })
    let blocked = false
    const bindingStore = {
      load: store.load.bind(store),
      remove: store.remove.bind(store),
      save: async (record: Parameters<typeof save>[0]) => {
        if (!blocked && record.pending === undefined && record.consumedIds.length > 0) {
          blocked = true
          enteredSettlementSave()
          await settlementSaveGate
        }
        await save(record)
      },
    }
    let approvals = 0
    const h = host(() => { approvals++; return 'allowed-once' })
    h.bindingStore = bindingStore
    const adapter = create(profile({ permission: 'ask', env: {
      MOCK_PERMISSION_AFTER_RESPONSE: '1',
      MOCK_PERMISSION_AFTER_RESPONSE_RESULT: resultFile,
    } }), h)
    const pending = run(adapter, request([user('probe finish before permission')]))
    try {
      await settlementSaveEntered
      await vi.waitFor(() => expect(readFileSync(resultFile, 'utf8')).toBe(JSON.stringify({ outcome: 'cancelled' })))
      expect(approvals).toBe(0)
      releaseSettlementSave()
      await pending
    }
    finally {
      releaseSettlementSave()
    }
  })

  it('does not restart an agent for a queued setting after dispose', async () => {
    const store = new MemoryAcpBindingStore()
    const save = store.save.bind(store)
    let enteredSettlementSave!: () => void
    const settlementSaveEntered = new Promise<void>((resolve) => { enteredSettlementSave = resolve })
    let releaseSettlementSave!: () => void
    const settlementSaveGate = new Promise<void>((resolve) => { releaseSettlementSave = resolve })
    const bindingStore = {
      load: store.load.bind(store),
      remove: store.remove.bind(store),
      save: async (record: Parameters<typeof save>[0]) => {
        if (record.pending === undefined && record.consumedIds.length > 0) {
          enteredSettlementSave()
          await settlementSaveGate
        }
        await save(record)
      },
    }
    const adapter = create(profile({ env: { MOCK_EXTRA_CONFIG: '1' } }), { ...host(), bindingStore })
    const newSession = vi.spyOn(AcpAgentProcess.prototype, 'newSession')
    try {
      const running = run(adapter, request([user('probe while control waits')]))
      await settlementSaveEntered
      let queuedDone = false
      const queued = adapter.setSessionConfig(ROUTE, 'dsh-1', 'style', 'concise').then(
        () => { queuedDone = true; return { error: undefined } },
        (error: unknown) => { queuedDone = true; return { error } },
      )
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(queuedDone).toBe(false)
      const newSessionsBeforeDispose = newSession.mock.calls.length
      adapter.dispose()
      releaseSettlementSave()

      await running
      const queuedResult = await queued
      expect(queuedResult.error).toMatchObject({ message: expect.stringContaining('disposed') })
      expect(newSession).toHaveBeenCalledTimes(newSessionsBeforeDispose)
    }
    finally {
      releaseSettlementSave()
      newSession.mockRestore()
    }
  })

  it('reports an empty turn as a retryable EMPTY_RESPONSE', async () => {
    const result = await run(create(), request([user('silent')]))
    expect(result.finish).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } } })
  })

  it('treats a reasoning-only turn as content, not as an empty response', async () => {
    // Thinking without a written answer still emitted a block, so a retry would duplicate
    // work; EMPTY_RESPONSE stays reserved for turns that produced nothing at all.
    const result = await run(create(), request([user('thought-only')]))
    expect(result.reasoning).toBe('weighed it')
    expect(result.finish).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('surfaces an unknown model as MODEL_NOT_FOUND', async () => {
    expect((await run(create(), request([user('hi')], { model: 'nope' }))).finish).toMatchObject({ reason: { kind: 'error', failure: { code: 'MODEL_NOT_FOUND' } } })
  })

  it('surfaces a broken command as an in-band TRANSPORT failure', async () => {
    const broken = create(profile({ command: '/definitely/not/here' }))
    expect((await run(broken, request([user('hi')]))).finish).toMatchObject({ reason: { kind: 'error', failure: { code: 'TRANSPORT' } } })
  })

  it('uses fresh ephemeral sessions for auxiliary calls', async () => {
    const adapter = create()
    const first = user('hello')
    await run(adapter, request([first]))
    const title = await run(adapter, request([user('name this')], { purpose: 'session-title' } as Partial<GenerateOptions>))
    expect(title.text).toContain('turn 1')
    const next = await run(adapter, request([first, assistant('r'), user('more')]))
    expect(next.text).toContain('turn 2')
  })

  it('explains missing authentication and lists the agent auth methods', async () => {
    const adapter = create(profile({ env: { MOCK_REQUIRE_AUTH: '1' } }))
    expect((await run(adapter, request([user('hi')]))).finish).toMatchObject({
      reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL', message: expect.stringContaining('one of: token') } },
    })
  })

  it('authenticates with the configured authMethod', async () => {
    const adapter = create(profile({ env: { MOCK_REQUIRE_AUTH: '1' }, authMethod: 'token' }))
    expect((await run(adapter, request([user('hi')]))).text).toContain(']: hi')
    const wrong = create(profile({ env: { MOCK_REQUIRE_AUTH: '1' }, authMethod: 'bogus' }))
    expect((await run(wrong, request([user('hi')]))).finish).toMatchObject({
      reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL', message: expect.stringContaining('available: token') } },
    })
  })

  it('restarts the agent process when its spawn facts change', async () => {
    let current = profile()
    const adapter = new AcpAdapter(host(), () => new Map([[ROUTE, current]]))
    adapters.push(adapter)
    const first = user('hello')
    await run(adapter, request([first]))
    current = profile({ env: { CHANGED: '1' } })
    adapter.sync()
    const next = await run(adapter, request([first, assistant('r'), user('more')]))
    expect(next.text).toContain('turn 1')
  })

  it('exposes the agent thought levels and image input as model metadata', async () => {
    const textOnly = await create().resolveModel(ROUTE, 'mock-fast')
    expect(textOnly.inputModalities).toEqual(['text'])
    expect(textOnly.context).toEqual({ contextWindow: 200_000 })
    expect(textOnly.reasoning).toEqual({ efforts: [
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High', description: 'Think longer' },
    ], defaultEffort: 'medium' })
    const withImages = create(profile(), host(undefined, true, async () => ({ data: new Uint8Array([1]), mediaType: 'image/png', width: 1, height: 1 })))
    expect((await withImages.listModels(ROUTE)).map(model => model.inputModalities)).toEqual([['text', 'image'], ['text', 'image'], ['text', 'image']])
    expect((await withImages.resolveModel(ROUTE, 'mock-smart')).inputModalities).toEqual(['text', 'image'])
  })

  it('resolves effort metadata for the requested model without changing its active session', async () => {
    const adapter = create()
    const newSession = vi.spyOn(AcpAgentProcess.prototype, 'newSession')
    try {
      const history: any[] = [user('before metadata check')]
      const first = await run(adapter, request(history, { model: 'mock-fast' }))
      expect(first.text).toContain('echo[mock-fast|turn 1')
      history.push(assistant(first.text), user('after metadata check'))

      const smart = await adapter.resolveModel(ROUTE, 'mock-smart')
      expect(smart.reasoning?.efforts.map(level => level.id)).toEqual(['low', 'medium', 'high', 'max'])
      expect(smart.reasoning?.defaultEffort).toBe('high')
      const sessionsAfterDiscovery = newSession.mock.calls.length
      expect((await adapter.resolveModel(ROUTE, 'mock-smart')).reasoning?.efforts.map(level => level.id)).toEqual(['low', 'medium', 'high', 'max'])
      expect(newSession).toHaveBeenCalledTimes(sessionsAfterDiscovery)

      const next = await run(adapter, request(history, { model: 'mock-fast' }))
      expect(next.text).toContain('echo[mock-fast|turn 2')
    }
    finally {
      newSession.mockRestore()
    }
  })

  it('does not start an effort probe when model discovery is disabled', async () => {
    const warnings: unknown[][] = []
    const h = host()
    h.logger.warn = (...args) => warnings.push(args)
    const adapter = create(profile({ env: { MOCK_REQUIRE_AUTH: '1' }, discoverModels: false }), h)

    expect((await adapter.listModels(ROUTE)).map(model => model.id)).toEqual(['default'])
    const resolved = await adapter.resolveModel(ROUTE, 'mock-smart')
    expect(resolved.reasoning).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('keeps the shared effort probe alive after resolveModel is cancelled', async () => {
    // Effort probes used to open one session per model and close it afterwards. On an agent
    // that backs a session with a process (and cannot close one) that leaked a process tree
    // per model, so probes now share a single session. Cancelling a caller must not tear that
    // shared session down — it is still serving the rest of the catalog.
    const adapter = create(profile({ env: { MOCK_SUPPORT_CLOSE: '1', MOCK_SESSION_NEW_DELAY_MS: '160' } }))
    const newSession = vi.spyOn(AcpAgentProcess.prototype, 'newSession')
    const closeSession = vi.spyOn(AcpAgentProcess.prototype, 'closeSession')
    try {
      const controller = new AbortController()
      const resolution = adapter.resolveModel(ROUTE, 'mock-smart', controller.signal)
      // Catalog discovery and the effort probe now share one session, so resolving a model
      // starts exactly one.
      await vi.waitFor(() => expect(newSession).toHaveBeenCalledTimes(1), { timeout: 3_000 })
      const closedBeforeAbort = closeSession.mock.calls.length
      controller.abort()

      const resolved = await resolution
      expect(resolved.reasoning).toBeUndefined()
      expect(closeSession).toHaveBeenCalledTimes(closedBeforeAbort)

      // The shared probe still answers for this model, without opening another session.
      // The probe is shared, so a cancelled caller must not leave the agent with a session
      // stuck mid-switch. Whether the next probe reuses the session or replaces it is an
      // implementation choice; what matters is that metadata is correct afterwards.
      const retried = await adapter.resolveModel(ROUTE, 'mock-smart')
      expect(retried.reasoning?.efforts.map(level => level.id)).toEqual(['low', 'medium', 'high', 'max'])
    }
    finally {
      closeSession.mockRestore()
      newSession.mockRestore()
    }
  })

  it('applies the selected reasoning effort and restores the agent default', async () => {
    const adapter = create()
    const history: any[] = [user('probe one')]
    const first = await run(adapter, request(history, { model: 'mock-fast', reasoningEffort: 'high' as any }))
    expect(first.text).toBe('effort:high|images:|probe one')
    history.push(assistant(first.text), user('probe two'))
    const second = await run(adapter, request(history, { model: 'mock-fast' }))
    expect(second.text).toBe('effort:medium|images:|probe two')
    history.push(assistant(second.text), user('probe three'))
    const unknown = await run(adapter, request(history, { model: 'mock-fast', reasoningEffort: 'max' as any }))
    expect(unknown.text).toBe('effort:medium|images:|probe three')
    expect(unknown.finish).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('uses the target model default effort when switching models without an explicit effort', async () => {
    const adapter = create()
    const history: any[] = [user('probe switch model one')]
    const first = await run(adapter, request(history, { model: 'mock-fast' }))
    expect(first.text).toBe('effort:medium|images:|probe switch model one')
    history.push(assistant(first.text), user('probe switch model two'))

    const second = await run(adapter, request(history, { model: 'mock-smart' }))
    expect(second.text).toBe('effort:high|images:|probe switch model two')
  })

  it('learns the context window the agent reports', async () => {
    const adapter = create()
    await run(adapter, request([user('probe')], { model: 'mock-smart' }))
    expect((await adapter.resolveModel(ROUTE, 'mock-smart')).context).toEqual({ contextWindow: 123_456 })
    expect((await adapter.resolveModel(ROUTE, 'mock-fast')).context).toEqual({ contextWindow: 200_000 })
    const declared = create(profile({ models: [{ id: 'mock-smart', contextWindow: 64_000 }] }))
    await run(declared, request([user('probe')], { model: 'mock-smart' }))
    expect((await declared.resolveModel(ROUTE, 'mock-smart')).context).toEqual({ contextWindow: 64_000 })
  })

  it('remembers learned context windows across restarts', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-acp-cw-')), 'nested', 'context-windows.json')
    const windows = new ContextWindows(file, silentLogger)
    const adapter = new AcpAdapter(host(), () => new Map([[ROUTE, profile()]]), windows)
    adapters.push(adapter)
    await run(adapter, request([user('probe')], { model: 'mock-smart' }))
    await windows.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ [ROUTE]: { 'mock-smart': 123_456 } })
    const restarted = new AcpAdapter(host(), () => new Map([[ROUTE, profile()]]), new ContextWindows(file, silentLogger))
    adapters.push(restarted)
    expect((await restarted.resolveModel(ROUTE, 'mock-smart')).context).toEqual({ contextWindow: 123_456 })
  })

  it('infers a 1M window from a "1m" token before the agent reports one', async () => {
    const adapter = create(profile({ models: [{ id: 'mock-smart', description: 'Smart (1M context)' }] }))
    expect((await adapter.resolveModel(ROUTE, 'mock-smart')).context).toEqual({ contextWindow: 1_000_000 })
    expect((await adapter.resolveModel(ROUTE, 'mock-fast[1m]')).context).toEqual({ contextWindow: 1_000_000 })
    expect((await adapter.resolveModel(ROUTE, 'mock-fast')).context).toEqual({ contextWindow: 200_000 })
    expect(inferContextWindow('gpt-10m', 'Model 1M2')).toBeUndefined()
  })

  it('sends image attachments as ACP image blocks when the agent accepts them', async () => {
    const attachment = { attachmentId: 'sha256:0123456789abcdef', mediaType: 'image/png', width: 8, height: 8, bytes: 4 }
    const message = { id: `m${++counter}`, role: 'user', content: [{ type: 'text', text: 'probe pic' }, { type: 'image', attachment }], source: { kind: 'user' } }
    const reads: unknown[] = []
    const reader: AdapterHost['readImage'] = async (ref) => {
      reads.push(ref)
      return { data: new Uint8Array([104, 105]), mediaType: 'image/png', width: 8, height: 8 }
    }
    const withImages = await run(create(profile(), host(undefined, true, reader)), request([message]))
    expect(reads).toEqual([attachment])
    expect(withImages.text).toMatch(/^effort:high\|images:image\/png:aGk=\|probe pic\|Image .+request preview 8x8px/)

    const textOnly = await run(create(), request([{ ...message, id: `m${++counter}` }]))
    expect(textOnly.text).toMatch(/^effort:high\|images:\|probe pic\|\[image omitted because this model accepts text only/)
  })

  it('asks the agent over ACP which content it accepts', async () => {
    const declared = profile({ models: [{ id: 'mock-smart' }], discoverModels: false })
    // Nothing has spoken to the agent yet: unknown is not the same as text-only, so dsh is
    // told nothing rather than being told images are unsupported.
    const adapter = create(declared, imageHost())
    expect((await adapter.listModels(ROUTE))[0]!.inputModalities).toBeUndefined()
    // Resolving one exact model performs the ACP handshake and reads its promptCapabilities.
    expect((await adapter.resolveModel(ROUTE, 'mock-smart')).inputModalities).toEqual(['text', 'image'])
    expect((await adapter.listModels(ROUTE))[0]!.inputModalities).toEqual(['text', 'image'])

    const noImages = create(profile({ env: { MOCK_NO_IMAGES: '1' }, models: [{ id: 'mock-smart' }], discoverModels: false }), imageHost())
    expect((await noImages.resolveModel(ROUTE, 'mock-smart')).inputModalities).toEqual(['text'])
  })

  it('remembers the handshake answer across restarts, per spawn command', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-acp-pc-')), 'nested', 'prompt-capabilities.json')
    const learning = new PromptCapabilitiesCache(file, silentLogger)
    await create(profile(), imageHost(), learning).resolveModel(ROUTE, 'mock-smart')
    await learning.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))[ROUTE]).toMatchObject({ image: true, audio: false, embeddedContext: false })

    // A restart reports image input before anything starts the agent again.
    const restarted = create(profile({ models: [{ id: 'mock-smart' }], discoverModels: false }), imageHost(), new PromptCapabilitiesCache(file, silentLogger))
    expect((await restarted.listModels(ROUTE))[0]!.inputModalities).toEqual(['text', 'image'])

    // Pointing the route at another command makes the stored answer another agent's.
    const repointed = create(profile({ env: { CHANGED: '1' }, models: [{ id: 'mock-smart' }], discoverModels: false }), imageHost(), new PromptCapabilitiesCache(file, silentLogger))
    expect((await repointed.listModels(ROUTE))[0]!.inputModalities).toBeUndefined()
  })

  it('lets imageInput override what the agent declares', async () => {
    const forced = create(profile({ imageInput: 'force', models: [{ id: 'mock-smart' }], discoverModels: false }), imageHost())
    expect((await forced.resolveModel(ROUTE, 'mock-smart')).inputModalities).toEqual(['text', 'image'])
    const off = create(profile({ imageInput: 'off', models: [{ id: 'mock-smart' }], discoverModels: false }), imageHost())
    expect((await off.resolveModel(ROUTE, 'mock-smart')).inputModalities).toEqual(['text'])
    // Forcing it on cannot conjure bytes dsh has no attachment store to read.
    const unreadable = create(profile({ imageInput: 'force', models: [{ id: 'mock-smart' }], discoverModels: false }))
    expect((await unreadable.resolveModel(ROUTE, 'mock-smart')).inputModalities).toEqual(['text'])
  })

  it('replays images from the history when it rebuilds a session', async () => {
    const attachment = { attachmentId: 'sha256:fedcba9876543210', mediaType: 'image/png', width: 8, height: 8, bytes: 4 }
    const pictured = { id: `m${++counter}`, role: 'user', content: [{ type: 'text', text: 'look at this' }, { type: 'image', attachment }], source: { kind: 'user' } }
    const adapter = create(profile(), imageHost())
    await run(adapter, request([user('hello')]))
    // Divergent history forces a fresh session built from the whole transcript.
    const result = await run(adapter, request([pictured, assistant('from deepseek', 'deepseek-official'), user('probe now')]))
    expect(result.text).toContain('images:image/png:aGk=')
    expect(result.text).toContain('<conversation_history>')
    expect(result.text).toContain('User: look at this')
    expect(result.text.endsWith('|probe now')).toBe(true)
  })
})


describe('retireRoute', () => {
  it('disposes an idle route immediately and drops its bindings', async () => {
    const adapter = create(profile())
    await adapter.listModels(ROUTE)
    expect((adapter as any).agents.has(ROUTE)).toBe(true)
    adapter.retireRoute(ROUTE)
    expect((adapter as any).agents.has(ROUTE)).toBe(false)
  })

  it('keeps a running turn alive and recycles the process only after it finishes', async () => {
    let approvalStarted!: () => void
    const started = new Promise<void>((resolve) => { approvalStarted = resolve })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const h = host()
    h.approve = async () => {
      approvalStarted()
      // Keep the turn in flight while retireRoute is called below.
      await gate
      return 'allowed-once' as const
    }
    const adapter = create(profile({ permission: 'ask' }), h)
    const pending = run(adapter, request([user('please edit')]))
    await started

    adapter.retireRoute(ROUTE)
    // The turn is still running, so the process must survive the retire request.
    expect((adapter as any).agents.has(ROUTE)).toBe(true)

    release()
    await pending
    // Once the turn settles, the parked retirement runs.
    expect((adapter as any).agents.has(ROUTE)).toBe(false)
    expect((adapter as any).retiring.has(ROUTE)).toBe(false)
  })

  it('cancels a parked retirement when the route is enabled again', async () => {
    let approvalStarted!: () => void
    const started = new Promise<void>((resolve) => { approvalStarted = resolve })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const h = host()
    h.approve = async () => {
      approvalStarted()
      await gate
      return 'allowed-once' as const
    }
    const adapter = create(profile({ permission: 'ask' }), h)
    const pending = run(adapter, request([user('please edit')]))
    await started

    adapter.retireRoute(ROUTE)
    adapter.cancelRetirement(ROUTE)
    release()
    await pending
    expect((adapter as any).agents.has(ROUTE)).toBe(true)
  })

  it('recycles immediately when it retires a route with no active turn but a live process', async () => {
    const adapter = create(profile())
    await adapter.listModels(ROUTE)
    adapter.retireRoute(ROUTE)
    expect((adapter as any).agents.has(ROUTE)).toBe(false)
    adapter.retireRoute(ROUTE)
    expect((adapter as any).agents.has(ROUTE)).toBe(false)
  })
})

describe('sync with a disabled route', () => {
  it('parks a disabled route that still has a running turn instead of aborting it', async () => {
    let approvalStarted!: () => void
    const started = new Promise<void>((resolve) => { approvalStarted = resolve })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const h = host()
    h.approve = async () => {
      approvalStarted()
      await gate
      return 'allowed-once' as const
    }
    let enabled = true
    const adapter = new AcpAdapter(h, () => new Map(enabled ? [[ROUTE, profile({ permission: 'ask' })]] : []), new ContextWindows())
    adapters.push(adapter)
    const pending = run(adapter, request([user('please edit')]))
    await started

    enabled = false
    adapter.sync()
    // Still alive: the turn has not settled yet.
    expect((adapter as any).agents.has(ROUTE)).toBe(true)
    expect((adapter as any).retiring.has(ROUTE)).toBe(true)

    release()
    await pending
    expect((adapter as any).agents.has(ROUTE)).toBe(false)
  })
})

describe('effort picked from the model menu', () => {
  it('applies an effort chosen without changing the model on the next turn', async () => {
    // The picker submits { provider, model, reasoningEffort } through selectModel, which lands as
    // the next request's `reasoningEffort` while provider/model stay the same.
    const adapter = create()
    const history: any[] = [user('probe first')]
    const first = await run(adapter, request(history, { model: 'mock-smart' }))
    expect(first.text).toBe('effort:high|images:|probe first')

    history.push(assistant(first.text), user('probe second'))
    const second = await run(adapter, request(history, { model: 'mock-smart', reasoningEffort: 'low' as any }))
    expect(second.text).toBe('effort:low|images:|probe second')

    history.push(assistant(second.text), user('probe third'))
    const third = await run(adapter, request(history, { model: 'mock-smart', reasoningEffort: 'high' as any }))
    expect(third.text).toBe('effort:high|images:|probe third')
  })
})
