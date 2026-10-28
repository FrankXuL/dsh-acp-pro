/**
 * Reading session-control snapshots must not open agent sessions.
 *
 * The panel polls `getSessionSnapshots` once a second to render config options and turn
 * state. It used to materialize any stored binding that had no live session, so a snapshot
 * read for a conversation that was never used still started a full agent session — and on
 * an agent that spawns its MCP servers per session, that is an entire process tree for a
 * read that only needs the persisted record.
 */
import type { AcpAgentProfile } from '../src/shared/types.ts'
import type { AdapterHost } from '../src/host/types/index.ts'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { AcpAdapter } from '../src/host/service/acp-adapter.ts'
import { AcpAgentProcess } from '../src/host/service/acp-agent.ts'
import { ContextWindows } from '../src/host/service/context-windows.ts'
import { PromptCapabilitiesCache } from '../src/host/service/prompt-capabilities.ts'
import { MemoryAcpBindingStore } from '../src/host/domain/binding-store.ts'

const ROUTE = 'counting'
const MOCK = join(import.meta.dirname, 'fixtures', 'mock-counting-agent.mjs')
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }
const host: AdapterHost = { logger: silentLogger, agentOf: () => undefined, approve: undefined, readImage: undefined }

function profile(): AcpAgentProfile {
  return {
    displayName: 'Counting', command: process.execPath, args: [MOCK], env: {},
    models: [], discoverModels: false, permission: 'ask', imageInput: 'off',
    systemPrompt: 'drop', showToolCalls: false, contextWindow: 200_000,
    startupTimeoutMs: 30_000, idleTimeoutMs: 600_000,
  }
}

describe('snapshot reads', () => {
  it('does not open an agent session for a stored binding that has none', async () => {
    const store = new MemoryAcpBindingStore()
    await store.save({
      version: 1, provider: ROUTE, dshSessionId: 'dsh-unused', cwd: process.cwd(),
      protocolVersion: 1, spawnFactsHash: 'stale', model: 'default',
      consumedIds: [], replayBarrierIds: [], needsFreshInput: false, revision: 0,
    })
    const adapter = new AcpAdapter({ ...host, bindingStore: store },
      () => new Map([[ROUTE, profile()]]),
      new ContextWindows(), new PromptCapabilitiesCache())
    const newSession = vi.spyOn(AcpAgentProcess.prototype, 'newSession')
    try {
      const snapshots = await adapter.getSessionSnapshots('dsh-unused')
      expect(snapshots.length).toBe(1)
      expect(snapshots[0]!.provider).toBe(ROUTE)
      expect(newSession, 'a snapshot read must not start a session').not.toHaveBeenCalled()
    }
    finally {
      newSession.mockRestore()
      adapter.dispose()
    }
  }, 60_000)

  it('does not fall back to a fresh session when the recorded one cannot be loaded', async () => {
    const store = new MemoryAcpBindingStore()
    await store.save({
      version: 1, provider: ROUTE, dshSessionId: 'dsh-recorded', cwd: process.cwd(),
      acpSessionId: 's-recorded', protocolVersion: 1, spawnFactsHash: 'stale', model: 'default',
      consumedIds: [], replayBarrierIds: [], needsFreshInput: false, revision: 0,
    })
    const adapter = new AcpAdapter({ ...host, bindingStore: store },
      () => new Map([[ROUTE, profile()]]),
      new ContextWindows(), new PromptCapabilitiesCache())
    const newSession = vi.spyOn(AcpAgentProcess.prototype, 'newSession')
    try {
      // The fixture agent does not advertise loadSession, so restoring the recorded session
      // fails. Falling back to session/new here would spawn an agent for a conversation that
      // has not sent anything — the exact leak this read must not cause.
      const snapshots = await adapter.getSessionSnapshots('dsh-recorded')
      expect(snapshots.length).toBe(1)
      expect(newSession, 'a snapshot read must not open a replacement session').not.toHaveBeenCalled()
    }
    finally {
      newSession.mockRestore()
      adapter.dispose()
    }
  }, 60_000)
})
