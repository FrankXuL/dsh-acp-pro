/**
 * Ephemeral requests never run tools: compaction summarizes what it was handed, and a
 * session title is one short completion. Forwarding the host's MCP servers to them buys
 * nothing and costs a full MCP process tree per request, so they must be offered none.
 */
import type { AcpAgentProfile } from '../src/shared/types.ts'
import type { AdapterHost } from '../src/host/types/index.ts'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { ContextWindows } from '../src/host/service/context-windows.ts'
import { PromptCapabilitiesCache } from '../src/host/service/prompt-capabilities.ts'
import { MemoryAcpBindingStore } from '../src/host/domain/binding-store.ts'

const ROUTE = 'counting'
const LOG = '/tmp/counting-agent.log'
const MOCK = join(import.meta.dirname, 'fixtures', 'mock-counting-agent.mjs')
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }
const host: AdapterHost = { logger: silentLogger, agentOf: () => undefined, approve: undefined, readImage: undefined }

function profile(): AcpAgentProfile {
  return {
    displayName: 'Counting', command: process.execPath, args: [MOCK], env: { PROBE_LOG: LOG },
    models: [], discoverModels: false, permission: 'ask', imageInput: 'off',
    systemPrompt: 'drop', showToolCalls: false, contextWindow: 200_000,
    startupTimeoutMs: 30_000, idleTimeoutMs: 600_000,
  }
}

describe('ephemeral MCP forwarding', () => {
  it('offers no MCP servers to a purpose-scoped request', async () => {
    rmSync(LOG, { force: true })
    // Pretend the host installed MCP servers, so a pass-through would be visible.
    const installed = Array.from({ length: 3 }, (_, index) => ({
      name: `mcp-${index}`, command: process.execPath, args: ['-e', ''], env: [],
    }))
    vi.doMock('../src/host/service/mcp-servers.ts', () => ({ installedMcpServers: () => installed }))
    const { AcpAdapter } = await import('../src/host/service/acp-adapter.ts')

    const adapter = new AcpAdapter({ ...host, bindingStore: new MemoryAcpBindingStore() },
      () => new Map([[ROUTE, profile()]]),
      new ContextWindows(), new PromptCapabilitiesCache())
    try {
      for await (const _chunk of adapter.stream({
        provider: ROUTE,
        model: 'default',
        sessionId: 'dsh-shared',
        purpose: 'compaction',
        messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'summarize' }], source: { kind: 'user' } }],
      } as never)) {
        // drain
      }
      await new Promise(resolve => setTimeout(resolve, 200))

      const lines = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean)
      const forwards = lines.map(line => Number(/mcp=(\d+)/.exec(line)?.[1] ?? -1))
      expect(forwards.length, `log: ${lines.join(' | ')}`).toBeGreaterThan(0)
      expect(Math.max(...forwards), `MCP servers forwarded to ephemeral request (log: ${lines.join(' | ')})`).toBe(0)
    }
    finally {
      adapter.dispose()
    }
  }, 60_000)
})

  it('still offers the installed servers to a real conversation', async () => {
    rmSync(LOG, { force: true })
    const installed = Array.from({ length: 3 }, (_, index) => ({
      name: `mcp-${index}`, command: process.execPath, args: ['-e', ''], env: [],
    }))
    vi.doMock('../src/host/service/mcp-servers.ts', () => ({ installedMcpServers: () => installed }))
    const { AcpAdapter } = await import('../src/host/service/acp-adapter.ts')
    const adapter = new AcpAdapter({ ...host, bindingStore: new MemoryAcpBindingStore() },
      () => new Map([[ROUTE, profile()]]),
      new ContextWindows(), new PromptCapabilitiesCache())
    try {
      for await (const _chunk of adapter.stream({
        provider: ROUTE,
        model: 'default',
        sessionId: 'dsh-real',
        messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }],
      } as never)) {
        // drain
      }
      await new Promise(resolve => setTimeout(resolve, 200))
      const lines = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean)
      const forwards = lines.map(line => Number(/mcp=(\d+)/.exec(line)?.[1] ?? -1))
      expect(Math.max(...forwards), `real conversation must keep its MCP servers (log: ${lines.join(' | ')})`).toBe(3)
    }
    finally {
      adapter.dispose()
    }
  }, 60_000)
