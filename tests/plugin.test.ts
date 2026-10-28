import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { join } from 'node:path'
import process from 'node:process'
import { Context } from '@deepseek-ai/cordis'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

const MOCK = join(import.meta.dirname, 'fixtures', 'mock-agent.mjs')

describe('plugin wiring', () => {
  it('registers configured ACP agents as llm provider routes', async () => {
    const ctx = new Context()
    ctx.plugin(LlmRuntime)
    const fiber = ctx.plugin(plugin, {
      agents: {
        'claude-acp': { displayName: 'Mock Claude', command: process.execPath, args: [MOCK] },
      },
    } as any)
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(ctx.llm.listProviders()).toEqual([{ id: 'claude-acp', name: 'Mock Claude' }])
    expect(ctx.llm.listConfigurableProviders()).toMatchObject([{ provider: 'claude-acp', settingsNs: 'dsh-acp-pro', settingsPath: ['agents', 'claude-acp'] }])
    const models = await ctx.llm.listModels('claude-acp')
    expect(models.map(model => model.id)).toEqual(['default', 'mock-fast', 'mock-smart'])
    const info = await ctx.llm.resolveModelInfo('claude-acp', 'mock-fast')
    expect(info.reasoning?.defaultEffort).toBe('medium')
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'medium', 'high'])
    const discovered = await ctx.llm.discoverModels('llm-acp-pro', { provider: 'claude-acp' })
    expect(discovered.map(model => model.id)).toEqual(['mock-fast', 'mock-smart'])
    await expect(ctx.llm.discoverModels('llm-acp-pro', { provider: 'unsaved' })).rejects.toThrow(/save ACP agent "unsaved"/)

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'claude-acp',
      model: 'mock-fast',
      messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'ping' }], source: { kind: 'user' } } as any],
    }))
      chunks.push(chunk)
    const text = chunks.flatMap(chunk => chunk.type === 'text-delta' ? [chunk.text] : []).join('')
    expect(text).toMatch(/^echo\[mock-fast\|turn 1\|cwd .+\]: ping$/)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })

    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('follows the settings generation for the directory namespace and page policy', async () => {
    const profile = { agents: { 'claude-acp': { command: process.execPath, args: [MOCK] } } } as any

    const formsCtx = new Context()
    formsCtx.plugin(LlmRuntime)
    const policies: unknown[] = []
    formsCtx.provide('settings', { configure: (presentation: unknown) => (policies.push(presentation), () => {}) })
    const forms = formsCtx.plugin(plugin, profile)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(formsCtx.llm.listConfigurableProviders()).toMatchObject([{ settingsNs: 'dsh-acp-pro' }])
    expect(policies).toEqual([{ auto: false }])
    await forms.dispose()

    const sectionCtx = new Context()
    sectionCtx.plugin(LlmRuntime)
    const installed: string[] = []
    sectionCtx.provide('settings', {
      installSection: (_owner: unknown, ns: string, _schema: unknown, entry: unknown, hooks: { setSource: (source: () => unknown) => void, onChange: () => void }) => {
        installed.push(ns)
        hooks.setSource(() => entry)
        hooks.onChange()
      },
    })
    const section = sectionCtx.plugin(plugin, profile)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(installed).toEqual(['llm-acp-pro'])
    expect(sectionCtx.llm.listConfigurableProviders()).toMatchObject([{ settingsNs: 'llm-acp-pro' }])
    await section.dispose()
  })

  it('sizes request images the way the attachment service expects', async () => {
    const ctx = new Context()
    ctx.plugin(LlmRuntime)
    const targets: unknown[] = []
    // The service resizes to an exact target; handing it a policy made every read throw and
    // the image reached the agent as text instead.
    ctx.provide('attachments', {
      readImageRequest: (_ref: unknown, target: unknown) => {
        targets.push(target)
        return Promise.resolve({ data: new Uint8Array([104, 105]), mediaType: 'image/png', width: 2508, height: 1672 })
      },
    })
    const fiber = ctx.plugin(plugin, { agents: { 'claude-acp': { command: process.execPath, args: [MOCK] } } } as any)
    await new Promise(resolve => setTimeout(resolve, 50))

    const attachment = { attachmentId: 'sha256:abc', mediaType: 'image/png', width: 3000, height: 2000, bytes: 9 }
    expect((await ctx.llm.resolveModelInfo('claude-acp', 'mock-fast')).inputModalities).toEqual(['text', 'image'])
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'claude-acp',
      model: 'mock-fast',
      messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'probe pic' }, { type: 'image', attachment }], source: { kind: 'user' } } as any],
    }))
      chunks.push(chunk)

    expect(targets).toEqual([{ width: 2508, height: 1672, maxBytes: 1_048_576 }])
    const text = chunks.flatMap(chunk => chunk.type === 'text-delta' ? [chunk.text] : []).join('')
    expect(text).toContain('images:image/png:aGk=')
    await fiber.dispose()
  })

  it('serves agents as a volatile form field and applies in-place edits', async () => {
    expect((plugin.Config as any).dict.agents.meta.volatile).toBe(true)
    const ctx = new Context()
    ctx.plugin(LlmRuntime)
    const fiber = ctx.plugin(plugin, { agents: { 'claude-acp': { command: process.execPath, args: [MOCK] } } } as any)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['claude-acp'])

    const next = plugin.Config({ agents: { codex: { displayName: 'Codex', command: process.execPath, args: [MOCK] } } } as any)
    updateVolatile((fiber as any).config.agents, next.agents)
    ctx.emit('loader/volatile-update', [['agents']])
    expect(ctx.llm.listProviders()).toEqual([{ id: 'codex', name: 'Codex' }])
    await fiber.dispose()
  })
})

describe('disabled routes', () => {
  it('drops a disabled route from providers and the settings directory but keeps it in the form', async () => {
    const ctx = new Context()
    ctx.plugin(LlmRuntime)
    const fiber = ctx.plugin(plugin, {
      agents: {
        on: { displayName: 'Enabled', command: process.execPath, args: [MOCK] },
        off: { displayName: 'Disabled', command: process.execPath, args: [MOCK], enabled: false },
      },
    } as any)
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['on'])
    expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).toEqual(['on'])
    await fiber.dispose()
  })

  it('does not re-register when only favorites change', async () => {
    const ctx = new Context()
    ctx.plugin(LlmRuntime)
    const fiber = ctx.plugin(plugin, {
      agents: { on: { displayName: 'Enabled', command: process.execPath, args: [MOCK] } },
      favorites: [{ provider: 'on', model: 'mock-fast' }],
    } as any)
    await new Promise(resolve => setTimeout(resolve, 50))
    const before = ctx.llm.listProviders()

    const next = plugin.Config({
      agents: { on: { displayName: 'Enabled', command: process.execPath, args: [MOCK] } },
      favorites: [{ provider: 'on', model: 'mock-smart' }],
    } as any)
    updateVolatile((fiber as any).config.favorites!, next.favorites!)
    ctx.emit('loader/volatile-update', [['favorites']])
    expect(ctx.llm.listProviders()).toEqual(before)
    await fiber.dispose()
  })
})
