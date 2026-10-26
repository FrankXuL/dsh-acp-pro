/**
 * Model-catalog cleaning at the ACP adapter boundary. The external agent and the user config
 * are both untrusted: dsh's LLM registry rejects the whole catalog when one entry has a blank
 * id or name, a non-string description, or a duplicate id. claude-code-acp triggers exactly
 * that by advertising its own `default` model next to the synthetic default this adapter adds.
 */
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { AcpAgentProfile, AcpModelProfile } from '../src/shared/types.ts'
import type { AdapterHost } from '../src/host/types/index.ts'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { AcpAdapter } from '../src/host/service/acp-adapter.ts'
import { ContextWindows } from '../src/host/service/context-windows.ts'
import { PromptCapabilitiesCache } from '../src/host/service/prompt-capabilities.ts'

const ROUTE = 'mock-catalog'
const MOCK = join(import.meta.dirname, 'fixtures', 'mock-catalog-agent.mjs')

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

const host: AdapterHost = {
  logger: silentLogger,
  agentOf: () => undefined,
  approve: undefined,
  readImage: undefined,
}

/**
 * A fully shaped profile built outside the config schema on purpose: the adapter also has to
 * survive metadata that user JSON (or a stale schema) can carry at runtime.
 */
function profile(overrides: Partial<AcpAgentProfile> = {}): AcpAgentProfile {
  return {
    displayName: 'Catalog ACP',
    command: process.execPath,
    args: [MOCK],
    env: {},
    models: [],
    discoverModels: false,
    permission: 'ask',
    imageInput: 'off',
    systemPrompt: 'drop',
    showToolCalls: false,
    contextWindow: 200_000,
    startupTimeoutMs: 60_000,
    idleTimeoutMs: 600_000,
    ...overrides,
  }
}

const adapters: AcpAdapter[] = []
function create(p: AcpAgentProfile = profile()): AcpAdapter {
  const adapter = new AcpAdapter(host, () => new Map([[ROUTE, p]]), new ContextWindows(), new PromptCapabilitiesCache())
  adapters.push(adapter)
  return adapter
}

afterEach(() => {
  for (const adapter of adapters.splice(0))
    adapter.dispose()
})

/** Mirrors the registry checks in @deepseek-ai/dsh-llm listModels. */
function expectDshCatalog(models: readonly LlmModelInfo[]): void {
  expect(models.length).toBeGreaterThan(0)
  const seen = new Set<string>()
  for (const model of models) {
    expect(model.provider).toBe(ROUTE)
    expect(typeof model.id).toBe('string')
    expect(model.id.length).toBeGreaterThan(0)
    expect(typeof model.name).toBe('string')
    expect(model.name.length).toBeGreaterThan(0)
    if (model.description !== undefined)
      expect(typeof model.description).toBe('string')
    expect(seen.has(model.id)).toBe(false)
    seen.add(model.id)
  }
}

describe('acp model catalog cleaning', () => {
  it('de-dupes the synthetic default against an agent-advertised "default" and drops dirty entries', async () => {
    const models = await create(profile({ discoverModels: true })).listModels(ROUTE)
    expect(models.map(model => model.id)).toEqual(['default', 'mock-fast', 'mock-nameless', 'mock-weird'])
    // The synthetic default wins the id collision, so the picker still offers "use the agent default".
    expect(models[0]).toMatchObject({ name: 'Catalog ACP (default)' })
    // Duplicate id keeps the first entry; an empty name falls back to the id; a non-string
    // description is dropped instead of failing the catalog.
    expect(models[1]).toMatchObject({ name: 'Fast' })
    expect(models[2]).toMatchObject({ name: 'mock-nameless' })
    expect(models[3]).toMatchObject({ name: 'Weird' })
    expect(models[3]!.description).toBeUndefined()
    expectDshCatalog(models)
  })

  it('cleans a declared model list and preserves definition order', async () => {
    const dirty = [
      { id: 'dup', name: 'First' },
      { id: 'dup', name: 'Second' },
      { id: '   ', name: 'Blank id' },
      { id: '', name: 'Empty id' },
      { id: 'no-name', name: '' },
      { id: 'missing-name' },
      { id: 'weird', name: '', description: 42 },
    ] as unknown as AcpModelProfile[]
    const models = await create(profile({ models: dirty })).listModels(ROUTE)
    expect(models).toEqual([
      { provider: ROUTE, id: 'dup', name: 'First', inputModalities: ['text'] },
      { provider: ROUTE, id: 'no-name', name: 'no-name', inputModalities: ['text'] },
      { provider: ROUTE, id: 'missing-name', name: 'missing-name', inputModalities: ['text'] },
      { provider: ROUTE, id: 'weird', name: 'weird', inputModalities: ['text'] },
    ])
    expectDshCatalog(models)
  })

  it('still offers the synthetic default when every declared entry is unusable', async () => {
    const models = await create(profile({ models: [{ id: '' }, { id: '  ' }] as AcpModelProfile[] })).listModels(ROUTE)
    expect(models).toEqual([{ provider: ROUTE, id: 'default', name: 'Catalog ACP (default)', inputModalities: ['text'] }])
  })

  it('cleans the advertised list the settings surface adopts', async () => {
    const found = await create(profile({ discoverModels: true })).advertisedModels(ROUTE)
    // Here the agent's own "default" is kept: the synthetic fallback is only added by listModels.
    expect(found).toEqual([
      { id: 'default', name: 'Agent Default' },
      { id: 'mock-fast', name: 'Fast' },
      { id: 'mock-nameless', name: 'mock-nameless' },
      { id: 'mock-weird', name: 'Weird' },
    ])
  })

  it('cleans exact-model metadata: name fallback, reasoning efforts and context window', async () => {
    const resolved = await create(profile({ discoverModels: true })).resolveModel(ROUTE, 'mock-nameless')
    expect(resolved).toMatchObject({
      provider: ROUTE,
      id: 'mock-nameless',
      name: 'mock-nameless',
      context: { contextWindow: 200_000 },
    })
    // Duplicate and blank effort ids are dropped; an empty name falls back to the id.
    expect(resolved.reasoning).toEqual({
      efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'high' }],
      defaultEffort: 'low',
    })
  })

  it('ignores runtime-invalid configured names and windows instead of failing the exact-model contract', async () => {
    const dirty = [
      { id: 'mock-fast', name: '   ', contextWindow: 0 },
      { id: 'mock-nameless', name: '', contextWindow: 1.5 },
    ] as unknown as AcpModelProfile[]
    const adapter = create(profile({ models: dirty, discoverModels: true }))
    const fast = await adapter.resolveModel(ROUTE, 'mock-fast')
    expect(fast.name).toBe('Fast')
    expect(fast.context).toEqual({ contextWindow: 200_000 })
    const nameless = await adapter.resolveModel(ROUTE, 'mock-nameless')
    expect(nameless.name).toBe('mock-nameless')
    expect(Number.isSafeInteger(nameless.context?.contextWindow)).toBe(true)
    expect(nameless.context?.contextWindow).toBeGreaterThan(0)
  })
})
