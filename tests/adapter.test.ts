import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AcpAgentProfile, PermissionPolicy } from '../src/shared/types.ts'
import type { AdapterHost, ApprovalOutcome } from '../src/host/types/index.ts'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { agentsOf, Config } from '../src/host/config/schema.ts'
import { AcpAdapter } from '../src/host/service/acp-adapter.ts'
import { ContextWindows, inferContextWindow } from '../src/host/service/context-windows.ts'
import { PromptCapabilitiesCache } from '../src/host/service/prompt-capabilities.ts'

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

  it('reports an empty turn as a retryable EMPTY_RESPONSE', async () => {
    const result = await run(create(), request([user('silent')]))
    expect(result.finish).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } } })
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
    expect(withImages.text).toMatch(/^effort:medium\|images:image\/png:aGk=\|probe pic\|Image .+request preview 8x8px/)

    const textOnly = await run(create(), request([{ ...message, id: `m${++counter}` }]))
    expect(textOnly.text).toMatch(/^effort:medium\|images:\|probe pic\|\[image omitted because this model accepts text only/)
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

