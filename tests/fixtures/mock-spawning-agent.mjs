/**
 * ACP agent that spawns its own grandchild (standing in for the MCP servers a real
 * agent starts). It reports the grandchild pid on stderr so a test can prove the
 * whole process tree is reaped, not just the direct child.
 */
import * as acp from '@agentclientprotocol/sdk'
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import process from 'node:process'

const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
process.stderr.write(`GRANDCHILD:${grandchild.pid}\n`)

let counter = 0

acp.agent({ name: 'spawning-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    agentInfo: { name: 'spawning-agent', version: '1.0.0' },
    authMethods: [],
  }))
  .onRequest('session/new', () => ({ sessionId: `s${++counter}`, configOptions: [] }))
  .onRequest('session/prompt', () => ({ stopReason: 'end_turn' }))
  .onNotification('session/cancel', () => {})
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
