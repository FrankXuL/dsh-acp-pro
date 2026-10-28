/**
 * Ephemeral (purpose-scoped) requests must not fan out. Compaction and session-title
 * generation arrive as bursts; each one opens its own ACP session, so a burst of N opens
 * N sessions — and each session carries its own MCP servers. They are short, independent
 * jobs, so serializing them per route should keep a burst to a single live session.
 */
import type { AcpAgentProfile } from '../src/shared/types.ts'
import type { AdapterHost } from '../src/host/types/index.ts'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { AcpAdapter } from '../src/host/service/acp-adapter.ts'
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

/** Session ids the mock agent logged so far. */
function sessionsOpened(): string[] {
  try {
    return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean)
  }
  catch {
    return []
  }
}

describe('ephemeral serialization', () => {
  it('a burst of concurrent purpose requests does not open one session per request', async () => {
    rmSync(LOG, { force: true })
    const adapter = new AcpAdapter({ ...host, bindingStore: new MemoryAcpBindingStore() },
      () => new Map([[ROUTE, profile()]]),
      new ContextWindows(), new PromptCapabilitiesCache())
    try {
      const BURST = 5
      const runs = Array.from({ length: BURST }, (_, index) => (async () => {
        for await (const _chunk of adapter.stream({
          provider: ROUTE,
          model: 'default',
          sessionId: 'dsh-shared',
          purpose: 'session-title',
          messages: [{ id: `m${index}`, role: 'user', content: [{ type: 'text', text: `title ${index}` }], source: { kind: 'user' } }],
        } as never)) {
          // drain
        }
      })().catch(() => undefined))

      await Promise.all(runs)
      await new Promise(resolve => setTimeout(resolve, 250))

      const lines = sessionsOpened()
      const peaks = lines
        .filter(line => line.startsWith('NEW '))
        .map(line => Number(/live=(\d+)/.exec(line)?.[1] ?? 0))
      const peakLive = peaks.length === 0 ? 0 : Math.max(...peaks)
      // Serialized, the burst never has two sessions alive at once. Before the fix this
      // peaked at BURST (5), one concurrent session per request.
      expect(peakLive, `peak live sessions from a burst of ${BURST} (log: ${lines.join(' | ')})`).toBeLessThanOrEqual(1)
    }
    finally {
      adapter.dispose()
    }
  }, 60_000)
})
