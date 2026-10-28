/**
 * ACP agent that logs every `session/new` with a timestamp and the live-session count,
 * so a test can prove whether a burst peaks at one concurrent session or at the burst size.
 */
import * as acp from '@agentclientprotocol/sdk'
import { appendFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import process from 'node:process'

const LOG = process.env.PROBE_LOG ?? '/tmp/counting-agent.log'
let opened = 0
let live = 0

acp.agent({ name: 'counting-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    agentInfo: { name: 'counting-agent', version: '1.0.0' },
    authMethods: [],
  }))
  .onRequest('session/new', ({ params }) => {
    opened += 1
    live += 1
    appendFileSync(LOG, `NEW opened=${opened} live=${live} mcp=${(params.mcpServers ?? []).length} at=${Date.now()}\n`)
    return { sessionId: `s${opened}`, configOptions: [] }
  })
  .onRequest('session/prompt', () => {
    live -= 1
    appendFileSync(LOG, `DONE live=${live} at=${Date.now()}\n`)
    return { stopReason: 'end_turn' }
  })
  .onRequest('session/set_config_option', () => ({ configOptions: [] }))
  .onNotification('session/cancel', () => {})
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
