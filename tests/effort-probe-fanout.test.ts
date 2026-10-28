/**
 * Effort discovery must not open one session per model. The host resolves every model in a
 * catalog build, and each resolve used to start its own probe session — which on a real
 * agent means a whole process tree per model. Concurrent resolves for the same model must
 * share one probe, and the probe must be reused across models rather than one per model.
 */
import type { AcpAgentProfile } from '../src/shared/types.ts'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { AcpAgentProcess } from '../src/host/transport/acp-agent.ts'

const LOG = '/tmp/effort-agent.log'
const MOCK = join(import.meta.dirname, 'fixtures', 'mock-effort-agent.mjs')
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

function profile(): AcpAgentProfile {
  return {
    displayName: 'Effort', command: process.execPath, args: [MOCK], env: { PROBE_LOG: LOG },
    models: [], discoverModels: true, permission: 'ask', imageInput: 'off',
    systemPrompt: 'drop', showToolCalls: false, contextWindow: 200_000,
    startupTimeoutMs: 30_000, idleTimeoutMs: 600_000,
  }
}

function sessionsOpened(): number {
  try {
    return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).length
  }
  catch {
    return 0
  }
}

describe('effort probe fan-out', () => {
  it('concurrent resolves for the same model share one probe session', async () => {
    rmSync(LOG, { force: true })
    const agent = new AcpAgentProcess({
      route: 'effort',
      profile,
      logger: silentLogger,
      onCapabilities: () => {},
      onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    } as never)
    try {
      const cwd = process.cwd()
      const burst = 5
      await Promise.all(Array.from({ length: burst }, () =>
        agent.discoverEffortsForModel('smart', cwd).catch(() => undefined)))
      await new Promise(resolve => setTimeout(resolve, 200))
      const opened = sessionsOpened()
      expect(opened, `probe sessions for ${burst} concurrent resolves`).toBeLessThanOrEqual(1)
    }
    finally {
      agent.dispose()
    }
  }, 60_000)

  it('probing several different models reuses one session', async () => {
    rmSync(LOG, { force: true })
    const agent = new AcpAgentProcess({
      route: 'effort',
      profile,
      logger: silentLogger,
      onCapabilities: () => {},
      onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    } as never)
    try {
      const cwd = process.cwd()
      // The catalog resolves every advertised model, each with its own cache key, so
      // same-model sharing cannot help here — only a shared session can.
      await Promise.all(['fast', 'smart', 'fast', 'smart'].map(model =>
        agent.discoverEffortsForModel(model, cwd).catch(() => undefined)))
      await new Promise(resolve => setTimeout(resolve, 200))
      const opened = sessionsOpened()
      expect(opened, `sessions opened while probing distinct models`).toBeLessThanOrEqual(1)
    }
    finally {
      agent.dispose()
    }
  }, 60_000)
})
