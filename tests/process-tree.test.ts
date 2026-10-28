/**
 * Process-tree reaping. A real ACP agent starts its MCP servers as grandchildren, and
 * a single-pid kill leaves them orphaned (their parent dies, they keep running). Disposing
 * the agent must take the whole tree down with it.
 */
import type { AcpAgentProfile } from '../src/shared/types.ts'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { AcpAgentProcess } from '../src/host/transport/acp-agent.ts'

const MOCK = join(import.meta.dirname, 'fixtures', 'mock-spawning-agent.mjs')
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

function profile(): AcpAgentProfile {
  return {
    displayName: 'Spawning', command: process.execPath, args: [MOCK], env: {},
    models: [], discoverModels: false, permission: 'ask', imageInput: 'off',
    systemPrompt: 'drop', showToolCalls: false, contextWindow: 200_000,
    startupTimeoutMs: 30_000, idleTimeoutMs: 600_000,
  }
}

/** True while the pid still exists. `process.kill(pid, 0)` is the portable probe; `ps` is not allowed here. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

describe('process tree reaping', () => {
  it('dispose reaps the grandchild the agent spawned', async () => {
    const agent = new AcpAgentProcess({
      route: 'spawning',
      profile,
      logger: silentLogger,
      onCapabilities: () => {},
      onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    } as never)

    let grandchildPid: number | undefined
    // The fixture prints the pid on stderr during spawn; wait for the handshake to have started.
    const probe = setInterval(() => {
      const child = Reflect.get(agent, 'live') as { child?: { stderr?: NodeJS.ReadableStream } } | undefined
      void child
    }, 50)
    clearInterval(probe)

    try {
      const session = await agent.newSession(process.cwd(), undefined, [])
      expect(session.sessionId).not.toBe('')
      // Read the pid the fixture announced.
      const stderrTail = Reflect.get(agent, 'stderrTail') as string
      const match = /GRANDCHILD:(\d+)/.exec(stderrTail)
      grandchildPid = match === null ? undefined : Number(match[1])
      expect(grandchildPid, 'fixture should announce its grandchild pid').toBeDefined()
      expect(alive(grandchildPid!)).toBe(true)
    }
    finally {
      agent.dispose()
    }

    // Give SIGTERM/SIGKILL a moment to land.
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(alive(grandchildPid!)).toBe(false)
  }, 60_000)
})
