/**
 * ACP agent advertising a model config option plus a `thought_level` option, so effort
 * discovery can be exercised. Logs every `session/new` so a test can count probes.
 */
import * as acp from '@agentclientprotocol/sdk'
import { appendFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import process from 'node:process'

const LOG = process.env.PROBE_LOG ?? '/tmp/effort-agent.log'
const MODELS = [{ value: 'fast', name: 'Fast' }, { value: 'smart', name: 'Smart' }]
const EFFORTS = [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }]
const sessions = new Map()
let counter = 0

function options(session) {
  return [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: session.model, options: MODELS },
    { id: 'effort', name: 'Thinking', category: 'thought_level', type: 'select', currentValue: session.effort, options: EFFORTS },
  ]
}

acp.agent({ name: 'effort-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    agentInfo: { name: 'effort-agent', version: '1.0.0' },
    authMethods: [],
  }))
  .onRequest('session/new', () => {
    const sessionId = `s${++counter}`
    sessions.set(sessionId, { model: 'fast', effort: 'low' })
    appendFileSync(LOG, `NEW ${sessionId}\n`)
    return { sessionId, configOptions: options(sessions.get(sessionId)) }
  })
  .onRequest('session/set_config_option', ({ params }) => {
    const session = sessions.get(params.sessionId) ?? { model: 'fast', effort: 'low' }
    if (params.configId === 'model')
      session.model = params.value
    else if (params.configId === 'effort')
      session.effort = params.value
    sessions.set(params.sessionId, session)
    return { configOptions: options(session) }
  })
  .onRequest('session/prompt', () => ({ stopReason: 'end_turn' }))
  .onNotification('session/cancel', () => {})
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
