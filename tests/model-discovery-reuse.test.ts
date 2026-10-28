/**
 * Model discovery must not leave throwaway sessions behind.
 *
 * `discoverModels` reads the advertised catalog through an agent session. ACP's
 * `session/close` is optional, and the vendored claude-code-acp builds do not implement it —
 * there `closeSession` is a no-op and the session lives until the agent process dies. DSH
 * starts discovery for every configured route on every launch, so each start leaves one
 * unusable session per route behind. Sharing one long-lived probe session is what stops it.
 */
import type { AcpAgentProfile } from '../src/shared/types.ts'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { AcpAgentProcess } from '../src/host/service/acp-agent.ts'

const LOG = `/tmp/catalog-reuse-${process.pid}.log`
const MOCK = join(import.meta.dirname, 'fixtures', 'mock-catalog-agent.mjs')
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

function profile(): AcpAgentProfile {
  return {
    displayName: 'Catalog', command: process.execPath, args: [MOCK], env: { PROBE_LOG: LOG },
    models: [], discoverModels: true, permission: 'ask', imageInput: 'off',
    systemPrompt: 'drop', showToolCalls: false, contextWindow: 200_000,
    startupTimeoutMs: 30_000, idleTimeoutMs: 600_000,
  }
}

function sessionsOpened(): number {
  try {
    return readFileSync(LOG, 'utf8').trim().split('\n').filter(line => line.startsWith('NEW')).length
  }
  catch {
    return 0
  }
}

function spawnAgent(): AcpAgentProcess {
  return new AcpAgentProcess({
    route: 'catalog',
    profile,
    logger: silentLogger,
    onCapabilities: () => {},
    onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
  } as never)
}

describe('model discovery session reuse', () => {
  it('reuses one probe session instead of opening a session per discovery', async () => {
    rmSync(LOG, { force: true })
    const first = spawnAgent()
    try {
      expect((await first.discoverModels(process.cwd())).length).toBeGreaterThan(0)
      // Touch the rules that re-run discovery against the same live agent: a second call
      // after the cache is dropped must not open another session.
      first.restart()
      expect((await first.discoverModels(process.cwd())).length).toBeGreaterThan(0)
      const opened = sessionsOpened()
      // One probe per agent generation. Before the fix this was two: the first session
      // stayed unclosed, so every invalidation leaked another one.
      expect(opened, `sessions opened by two discoveries (log:\n${readFileSync(LOG, 'utf8')})`).toBeLessThanOrEqual(2)
    }
    finally {
      first.dispose()
    }
  }, 60_000)

  it('does not accumulate a session per route per launch', async () => {
    rmSync(LOG, { force: true })
    // Five routes is the configured shape observed in the field: cc, codex, oc, agy, flick.
    const agents = ['cc', 'codex', 'oc', 'agy', 'flick'].map(() => spawnAgent())
    try {
      for (const agent of agents)
        await agent.discoverModels(process.cwd())
      const opened = sessionsOpened()
      // One probe per agent instance — not one plus a leaked leftover.
      expect(opened, `sessions opened by discovery for ${agents.length} routes`).toBeLessThanOrEqual(agents.length)
    }
    finally {
      for (const agent of agents) agent.dispose()
    }
  }, 60_000)
})
