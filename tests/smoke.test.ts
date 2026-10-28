import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { inspectAgent, parseSmokeArgs } from '../scripts/smoke-lib.mts'

const MOCK = join(import.meta.dirname, 'fixtures', 'mock-smoke-agent.mjs')

describe('ACP smoke diagnostics', () => {
  it('preserves the command/argument separator and optional prompt syntax', () => {
    expect(parseSmokeArgs(['codex-acp', '--stdio', '--', 'hello', 'world'])).toEqual({
      command: 'codex-acp',
      args: ['--stdio'],
      prompt: 'hello world',
    })
    expect(parseSmokeArgs([])).toBeUndefined()
  })

  it('reports safe handshake and session metadata, closes the session, and cleans up', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-smoke-test-'))
    const closeMarker = join(tempRoot, 'closed')
    const promptMarker = join(tempRoot, 'prompted')
    const privateEnv = 'smoke-env-private-sentinel'
    try {
      const report = await inspectAgent({
        command: process.execPath,
        args: [MOCK, 'smoke-argument-private-sentinel'],
        env: {
          ACP_AUTH_METHOD: '',
          DSH_SMOKE_CLOSE_MARKER: closeMarker,
          DSH_SMOKE_PROMPT_MARKER: promptMarker,
          DSH_SMOKE_PRIVATE_ENV: privateEnv,
        },
        tempRoot,
      })

      expect(report).toEqual({
        protocol: 1,
        agent: { name: 'Mock smoke agent', version: '1.0.0' },
        capabilities: {
          loadSession: true,
          prompt: { image: true, audio: false, embeddedContext: false },
          mcp: { http: false, sse: false, acp: false },
          session: { close: true },
        },
        options: [{
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'mock-fast',
          values: ['mock-fast'],
        }],
        modes: { currentModeId: 'ask', availableModes: [{ id: 'ask', name: 'Ask' }] },
        commands: ['inspect'],
      })
      expect(existsSync(closeMarker)).toBe(true)
      expect(existsSync(promptMarker)).toBe(false)
      expect(readdirSync(tempRoot)).toEqual(['closed'])
      const serialized = JSON.stringify(report)
      expect(serialized).not.toContain(privateEnv)
      expect(serialized).not.toContain('smoke-argument-private-sentinel')
      expect(serialized).not.toContain('private-token-value')
      expect(serialized).not.toContain('private command input')
      expect(serialized).not.toContain('must not be reported')
    }
    finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }, 10_000)

  it('leaves command availability unknown when its notification arrives after the probe snapshot', async () => {
    const report = await inspectAgent({
      command: process.execPath,
      args: [MOCK],
      env: { DSH_SMOKE_LATE_COMMANDS: '1' },
    })
    expect(report.commands).toBeNull()
  }, 10_000)
})
